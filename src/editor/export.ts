/**
 * Image export — wrap the browser render path into a standalone, downloadable
 * SVG, and rasterize that to PNG. Reuses the exact engine output shown on the
 * canvas (`renderPageSVG`), so an export looks identical to the editor; the only
 * additions are the `<svg>` wrapper + the dark backdrop.
 *
 * Browser-only (depends on the engine + DOM); driven from the app shell.
 */
import { renderPageSVG, type RenderOptions } from '../vendor/topology-ds.js';
import type { Page } from '../pages/model.js';

/** All four viewBox components — origins can be non-zero or negative after
 * fit-to-content/layout growth, so the backdrop must track (vx, vy). */
function viewBoxParts(viewBox: string): {
  vx: number;
  vy: number;
  vw: number;
  vh: number;
} {
  const [vx, vy, vw, vh] = viewBox.trim().split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return { vx: vx || 0, vy: vy || 0, vw: vw || 1050, vh: vh || 700 };
}

/** A complete, standalone SVG string for a page (wrapper + backdrop + art).
 * `extra` is appended after the art (e.g. a legend `<g>` in page coordinates). */
export function pageToSVG(
  page: Page,
  opts: RenderOptions = {},
  extra = '',
): string {
  const { vx, vy, vw, vh } = viewBoxParts(page.viewBox);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${page.viewBox}" width="${vw}" height="${vh}">` +
    `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#0e1613"/>` +
    renderPageSVG(page, opts) +
    extra +
    `</svg>`
  );
}

/** How long the object URL stays alive after a programmatic download click.
 * Chrome starts the download asynchronously; revoking in the same turn as
 * `a.click()` (and clicking a detached `<a>`) can drop the download with no
 * error — the #222 Chrome QA symptom. */
export const DOWNLOAD_URL_TTL_MS = 2_000;

/** Give up if the browser never finishes decoding the SVG into a bitmap. */
const PNG_RASTERIZE_TIMEOUT_MS = 20_000;

/**
 * Rasterize an SVG string onto a canvas at `scale`× the viewBox size, with
 * the #222 hardening (invalid-markup rejection, decode timeout, settle
 * guard). Shared by the PNG blob path and the PDF exporter so both inherit
 * the same failure behavior.
 */
function svgToCanvas(svg: string, scale = 2): Promise<HTMLCanvasElement> {
  if (!svg.includes('<svg')) {
    return Promise.reject(new Error('SVG export produced invalid markup'));
  }
  const m = /viewBox="([^"]*)"/.exec(svg);
  const { vw, vh } = viewBoxParts(m?.[1] ?? '');
  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = globalThis.setTimeout(() => {
      finish(() => reject(new Error('PNG rasterization timed out')));
    }, PNG_RASTERIZE_TIMEOUT_MS);
    img.onload = () => {
      finish(() => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(vw * scale));
          canvas.height = Math.max(1, Math.round(vh * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('no 2d context'));
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas);
        } catch (err) {
          reject(
            err instanceof Error ? err : new Error('PNG rasterization failed'),
          );
        }
      });
    };
    img.onerror = () =>
      finish(() => reject(new Error('failed to rasterize SVG')));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

/** Rasterize an SVG string to a PNG blob at `scale`× the viewBox size. */
export async function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  const canvas = await svgToCanvas(svg, scale);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('toBlob returned null'));
    }, 'image/png');
  });
}

/** Trigger a browser download of a blob.
 * The anchor is inserted into the document and the object URL is kept alive
 * briefly so the UA can start the download (#222). Throws if the file cannot
 * be offered — callers must surface that to the user. */
export function downloadBlob(filename: string, blob: Blob): void {
  const name = filename.trim();
  if (!name) throw new Error('Export filename is missing.');
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error('Export produced an empty file.');
  }
  const doc = document;
  if (!doc?.body) {
    throw new Error('Download requires a browser document.');
  }
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.setAttribute('data-export-download', name);
  a.style.display = 'none';
  doc.body.appendChild(a);
  a.click();
  globalThis.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, DOWNLOAD_URL_TTL_MS);
}

export function exportPageSVG(
  filename: string,
  page: Page,
  opts?: RenderOptions,
  extra = '',
): void {
  const svg = pageToSVG(page, opts, extra);
  if (!svg.includes('<svg')) {
    throw new Error('SVG export produced invalid markup');
  }
  downloadBlob(filename, new Blob([svg], { type: 'image/svg+xml' }));
}

export async function exportPagePNG(
  filename: string,
  page: Page,
  scale = 2,
  extra = '',
  opts: RenderOptions = {},
): Promise<void> {
  // Always rasterize a static frame (calm) so the captured image is clean.
  const blob = await svgToPngBlob(
    pageToSVG(page, { ...opts, calm: true }, extra),
    scale,
  );
  downloadBlob(filename, blob);
}

/** One page of a PDF export: the page plus its render options/extras. */
export interface PdfPageSpec {
  page: Page;
  opts?: RenderOptions;
  extra?: string;
}

/**
 * Render pages into one multi-page PDF (each PDF page sized to its frame's
 * viewBox, landscape/portrait as needed). Raster-based on purpose: the
 * engine's SVG leans on filters/animation that vector PDF converters do not
 * support, so each frame is rasterized at 2× through the SAME pipeline as
 * PNG export — the PDF always matches the canvas. jspdf loads lazily so the
 * editor bundle doesn't carry it.
 */
export async function pagesToPDFBlob(specs: PdfPageSpec[]): Promise<Blob> {
  if (specs.length === 0) throw new Error('nothing to export');
  const { jsPDF } = await import('jspdf');
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (const spec of specs) {
    const { vw, vh } = viewBoxParts(spec.page.viewBox);
    const svg = pageToSVG(
      spec.page,
      { ...(spec.opts ?? {}), calm: true },
      spec.extra ?? '',
    );
    // JPEG keeps a multi-page PDF ~10× smaller than PNG; the export always
    // paints an opaque backdrop, so no transparency is lost.
    const canvas = await svgToCanvas(svg, 2);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const orientation = vw >= vh ? 'landscape' : 'portrait';
    if (!pdf) pdf = new jsPDF({ orientation, unit: 'pt', format: [vw, vh] });
    else pdf.addPage([vw, vh], orientation);
    pdf.addImage(dataUrl, 'JPEG', 0, 0, vw, vh);
  }
  return (pdf as InstanceType<typeof jsPDF>).output('blob');
}

/**
 * Copy a page render to the system clipboard as a PNG. Feature-detected:
 * throws a descriptive error where the async Clipboard API is unavailable
 * (the caller falls back to a download).
 */
export async function copyPagePNG(
  page: Page,
  extra = '',
  opts: RenderOptions = {},
): Promise<void> {
  const clip = navigator.clipboard as Clipboard | undefined;
  const Item = (
    globalThis as unknown as { ClipboardItem?: typeof ClipboardItem }
  ).ClipboardItem;
  if (!clip?.write || !Item)
    throw new Error('clipboard image copy is not supported in this browser');
  const blob = await svgToPngBlob(
    pageToSVG(page, { ...opts, calm: true }, extra),
    2,
  );
  await clip.write([new Item({ 'image/png': blob })]);
}

/**
 * A cropped, selection-only Page: just the given nodes + the links whose both
 * endpoints are in the selection, with the viewBox shrunk to their bounds
 * (+padding) — the draw.io-style "export selection".
 */
export function selectionPage(
  page: Page,
  nodes: { id: string; x: number; y: number }[],
  links: { from: string; to: string; waypoints?: { x: number; y: number }[] }[],
  pad = 48,
): Page {
  if (nodes.length === 0) throw new Error('nothing selected');
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const grow = (x: number, y: number, m = 0): void => {
    minX = Math.min(minX, x - m);
    minY = Math.min(minY, y - m);
    maxX = Math.max(maxX, x + m);
    maxY = Math.max(maxY, y + m);
  };
  for (const n of nodes) grow(n.x, n.y, 56); // node art + label allowance
  for (const l of links) for (const w of l.waypoints ?? []) grow(w.x, w.y, 8);
  const vb = `${Math.round(minX - pad)} ${Math.round(minY - pad)} ${Math.round(maxX - minX + pad * 2)} ${Math.round(maxY - minY + pad * 2)}`;
  return {
    ...page,
    viewBox: vb,
    nodes: nodes as Page['nodes'],
    links: links as Page['links'],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  };
}
