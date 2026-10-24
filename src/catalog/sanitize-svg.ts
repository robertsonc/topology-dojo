/**
 * SVG sanitizer for panel glyphs (hw-catalog). Glyphs are untrusted input —
 * today the seed, later vendor masters from importers — so every glyph is
 * parsed, rebuilt from an allowlist and re-serialized; no input text is
 * ever passed through. The build sanitizes on ingest, and the renderer runs
 * it again on the bundled copy when it instantiates a panel (so nothing
 * unsanitized can be drawn even from a hand-edited bundle).
 *
 * Removed: <script>, <foreignObject>, <style>, <image>, <a>, animation and
 * every element not on the allowlist (with its subtree); on* attributes;
 * href / xlink:href that is not a same-document "#id" reference; url()
 * anywhere except url(#id); attributes not on the allowlist. DTDs are
 * refused by the parser. Mixed content is flattened (an element's text,
 * then its children) — glyph text is simple labels.
 */
import { parseXml, type XmlElement } from '../import/xml.js';

/** Largest glyph accepted (bytes of UTF-8 input). */
export const MAX_GLYPH_BYTES = 512 * 1024;

const ELEMENTS = new Set([
  'svg',
  'g',
  'title',
  'desc',
  'defs',
  'symbol',
  'use',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
]);

const ATTRS = new Set([
  'id',
  'class',
  'xmlns',
  'viewBox',
  'preserveAspectRatio',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'd',
  'points',
  'transform',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'opacity',
  'clip-path',
  'clip-rule',
  'clipPathUnits',
  'gradientUnits',
  'gradientTransform',
  'offset',
  'stop-color',
  'stop-opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'dx',
  'dy',
  'visibility',
  'display',
  'href',
  'xlink:href',
  'xmlns:xlink',
  'xml:space',
]);

const DATA_ATTR = /^data-[a-z0-9-]+$/;
const LOCAL_REF = /^#[A-Za-z_][\w.-]*$/;

/** A value is safe when every url() in it is a same-document #id. */
function safeValue(v: string): boolean {
  const lower = v.toLowerCase();
  if (lower.includes('javascript:') || lower.includes('expression('))
    return false;
  const urls = v.match(/url\s*\(([^)]*)\)/gi) ?? [];
  return urls.every((u) =>
    LOCAL_REF.test(u.replace(/^url\s*\(\s*['"]?|['"]?\s*\)$/gi, '')),
  );
}

export interface SanitizeResult {
  root: XmlElement;
  /** What was removed (empty for a clean glyph). */
  removed: string[];
}

function clean(el: XmlElement, removed: string[], path: string): XmlElement {
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(el.attrs)) {
    const name = k;
    if (/^on/i.test(name)) {
      removed.push(`${path}@${name}`);
      continue;
    }
    if (!ATTRS.has(name) && !DATA_ATTR.test(name)) {
      removed.push(`${path}@${name}`);
      continue;
    }
    if ((name === 'href' || name === 'xlink:href') && !LOCAL_REF.test(v)) {
      removed.push(`${path}@${name}`);
      continue;
    }
    if (!safeValue(v)) {
      removed.push(`${path}@${name}`);
      continue;
    }
    attrs[name] = v;
  }
  const children: XmlElement[] = [];
  for (const c of el.children) {
    const p = `${path}/${c.name}`;
    if (!ELEMENTS.has(c.name)) {
      removed.push(`<${c.name}> at ${path}`);
      continue;
    }
    children.push(clean(c, removed, p));
  }
  return { name: el.name, attrs, children, text: el.text };
}

/** Parse and sanitize; throws on oversize or malformed input. */
export function sanitizeSvg(input: string): SanitizeResult {
  if (new TextEncoder().encode(input).length > MAX_GLYPH_BYTES)
    throw new Error(`SVG is larger than ${MAX_GLYPH_BYTES} bytes`);
  const parsed = parseXml(input);
  if (parsed.name !== 'svg')
    throw new Error(`root element is <${parsed.name}>, expected <svg>`);
  const removed: string[] = [];
  return { root: clean(parsed, removed, 'svg'), removed };
}

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Serialize an element tree (attributes and text escaped). */
export function serializeSvg(el: XmlElement): string {
  const attrs = Object.entries(el.attrs)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join('');
  const text = el.text.trim() ? esc(el.text.trim()) : '';
  const inner = text + el.children.map(serializeSvg).join('');
  return inner
    ? `<${el.name}${attrs}>${inner}</${el.name}>`
    : `<${el.name}${attrs}/>`;
}

/** Sanitized SVG text: what the build puts in the bundle. */
export function sanitizeSvgText(input: string): {
  svg: string;
  removed: string[];
} {
  const { root, removed } = sanitizeSvg(input);
  return { svg: serializeSvg(root), removed };
}
