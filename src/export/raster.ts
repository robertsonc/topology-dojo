/**
 * Server-side rasterization — the same engine SVG the canvas shows, turned
 * into pixels without a browser, so PNG and PDF exports are agent-callable
 * (MCP `export_topology`) on both the stdio server and the Worker.
 *
 * resvg (WebAssembly) renders the SVG; the fonts it needs are embedded
 * (`fonts.generated.ts`, JetBrains Mono — the engine's typeface) because a
 * Worker has no system fonts. The wasm module is loaded by the runtime that
 * owns it and handed to `initRasterizer` once: Node reads the file
 * (`src/server/raster.ts`), the Worker imports it as a compiled module
 * (`worker/raster.ts`). Everything here is runtime-agnostic.
 *
 * Limits (deliberate): external `https:` images inside the SVG (image nodes,
 * a sheet logo) are not fetched — no outbound requests from a render — so
 * only `data:` images appear; animation is frozen (exports render `calm`).
 */
import { initWasm, Resvg, type InitInput } from '@resvg/resvg-wasm';
import { EXPORT_FONTS_BASE64 } from './fonts.generated.js';

export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major. */
  pixels: Uint8Array;
}

export interface Rasterizer {
  /** Render an SVG at `scale`× its intrinsic (viewBox) size. */
  rasterize(svg: string, scale: number): RasterImage;
  /** Render straight to PNG bytes (resvg's encoder). */
  rasterizePng(
    svg: string,
    scale: number,
  ): {
    png: Uint8Array;
    width: number;
    height: number;
  };
}

let ready: Promise<void> | null = null;
let fonts: Uint8Array[] | null = null;

function fontBuffers(): Uint8Array[] {
  if (fonts) return fonts;
  fonts = EXPORT_FONTS_BASE64.map((b64) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  });
  return fonts;
}

/**
 * Initialise resvg once per isolate / process. Safe to call repeatedly; the
 * loader runs only on the first call (and again after a failed one).
 */
export async function initRasterizer(
  load: () => Promise<InitInput> | InitInput,
): Promise<Rasterizer> {
  if (!ready) {
    ready = Promise.resolve()
      .then(load)
      .then((input) => initWasm(input))
      .catch((err: unknown) => {
        ready = null;
        throw new Error(
          `rasterizer failed to initialise: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
  await ready;
  return RASTERIZER;
}

function render(svg: string, scale: number) {
  if (!svg.includes('<svg')) throw new Error('render produced invalid SVG');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: {
      fontBuffers: fontBuffers(),
      defaultFontFamily: 'JetBrains Mono',
      monospaceFamily: 'JetBrains Mono',
      sansSerifFamily: 'JetBrains Mono',
      serifFamily: 'JetBrains Mono',
    },
    shapeRendering: 2,
    textRendering: 1,
  });
  try {
    return resvg.render();
  } finally {
    resvg.free();
  }
}

const RASTERIZER: Rasterizer = {
  rasterize(svg, scale) {
    const img = render(svg, scale);
    try {
      return { width: img.width, height: img.height, pixels: img.pixels };
    } finally {
      img.free();
    }
  },
  rasterizePng(svg, scale) {
    const img = render(svg, scale);
    try {
      return { png: img.asPng(), width: img.width, height: img.height };
    } finally {
      img.free();
    }
  },
};

/** Width × height of an SVG's viewBox (falls back to its width/height attrs). */
export function svgSize(svg: string): { w: number; h: number } {
  const vb = /viewBox="([^"]*)"/.exec(svg)?.[1];
  if (vb) {
    const [, , w, h] = vb
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (w && h && w > 0 && h > 0) return { w, h };
  }
  const w = Number(/\swidth="([\d.]+)"/.exec(svg)?.[1]);
  const h = Number(/\sheight="([\d.]+)"/.exec(svg)?.[1]);
  return { w: w > 0 ? w : 1050, h: h > 0 ? h : 700 };
}

/**
 * The scale to render at: the requested one, reduced (never below 0.25) so
 * the bitmap stays within `maxPixels`. Returns whether it was reduced.
 */
export function boundedScale(
  size: { w: number; h: number },
  requested: number,
  maxPixels: number,
): { scale: number; reduced: boolean } {
  const want = Math.max(0.1, requested);
  const px = size.w * size.h * want * want;
  if (px <= maxPixels) return { scale: want, reduced: false };
  const scale = Math.max(0.25, Math.sqrt(maxPixels / (size.w * size.h)));
  return { scale: Math.floor(scale * 100) / 100, reduced: true };
}
