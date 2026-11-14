/**
 * The diagram typeface, embedded into an SVG that is about to be rasterized.
 *
 * PNG, PDF and clipboard exports draw the page's SVG through an `<img>`. An
 * SVG loaded that way is a sealed document: it cannot use the page's fonts or
 * fetch anything, so a `font-family` alone falls back to whatever the system
 * has. The only font it can use is one carried inside it as a data URI.
 *
 * The faces are read from the page's own `@font-face` rules (the ones
 * `main.ts` loads through @fontsource), so the picture uses exactly the files
 * the canvas does, including any subset added later. They are fetched once, on
 * the first export; the browser already has them cached. Browser-only.
 */

/** One `@font-face` of the diagram typeface, as the page declares it. */
export interface FontFace {
  weight: string;
  style: string;
  /** `unicode-range`, when the face is a subset. */
  range: string;
  /** Absolute URL of the font file. */
  url: string;
}

const FAMILY = 'JetBrains Mono';

/** The page's `@font-face` rules for the diagram typeface. */
export function pageFontFaces(): FontFace[] {
  if (typeof document === 'undefined') return [];
  const faces: FontFace[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet: not ours, not readable
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style
        .getPropertyValue('font-family')
        .replace(/["']/g, '')
        .trim();
      if (family !== FAMILY) continue;
      const src = rule.style.getPropertyValue('src');
      // Prefer the woff2 source; any url() otherwise.
      const m =
        /url\((["']?)([^"')]+)\1\)\s*format\((["']?)woff2\3\)/.exec(src) ??
        /url\((["']?)([^"')]+)\1\)/.exec(src);
      if (!m) continue;
      faces.push({
        weight: rule.style.getPropertyValue('font-weight') || '400',
        style: rule.style.getPropertyValue('font-style') || 'normal',
        range: rule.style.getPropertyValue('unicode-range'),
        url: new URL(m[2]!, sheet.href ?? document.baseURI).href,
      });
    }
  }
  return faces;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function mime(url: string): string {
  return /\.woff2(\?|$)/.test(url)
    ? 'font/woff2'
    : /\.woff(\?|$)/.test(url)
      ? 'font/woff'
      : 'font/ttf';
}

/** `@font-face` rules with each file inlined, or '' if any cannot be read. */
export async function fontFaceCss(
  faces: readonly FontFace[],
  fetchFont: (url: string) => Promise<ArrayBuffer>,
): Promise<string> {
  if (faces.length === 0) return '';
  try {
    const rules = await Promise.all(
      faces.map(async (face) => {
        const data = toBase64(new Uint8Array(await fetchFont(face.url)));
        return (
          `@font-face{font-family:'${FAMILY}';font-style:${face.style};` +
          `font-weight:${face.weight};` +
          (face.range ? `unicode-range:${face.range};` : '') +
          `src:url(data:${mime(face.url)};base64,${data})}`
        );
      }),
    );
    return rules.join('');
  } catch {
    // No embedded font is better than no export: the root font-family still
    // names fixed-width fallbacks.
    return '';
  }
}

/** `svg` with `css` in a `<style>` right after its root tag. */
export function withStyle(svg: string, css: string): string {
  const root = /<svg\b[^>]*>/.exec(svg);
  if (!root || !css) return svg;
  const at = root.index + root[0].length;
  return `${svg.slice(0, at)}<style>${css}</style>${svg.slice(at)}`;
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font ${res.status}`);
  return res.arrayBuffer();
}

let cached: Promise<string> | null = null;

/**
 * `svg` with the diagram typeface embedded. Returns `svg` unchanged when the
 * page declares no such face or the files cannot be read.
 */
export async function embedDiagramFont(svg: string): Promise<string> {
  cached ??= fontFaceCss(pageFontFaces(), fetchBytes);
  return withStyle(svg, await cached);
}
