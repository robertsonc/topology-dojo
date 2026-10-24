/**
 * Composited contrast for rendered SVG (light-theme contrast fix). Colours
 * alone say little: the engine draws strokes and text at fractional
 * opacity. This walks a rendered SVG, multiplies every opacity that applies
 * to an element (its own and each ancestor's `opacity`, style `opacity`,
 * plus `stroke-opacity` / `fill-opacity` for the channel measured), blends
 * the colour over the page background and returns the WCAG contrast ratio.
 *
 * Only what the test needs: hex / rgb() / rgba() colours, inherited
 * `fill` / `stroke`, attributes and inline styles. Elements with a paint
 * server (`url(#…)`) or `none` are skipped.
 */
import { parseXml, type XmlElement } from '../import/xml.js';

export type Rgb = [number, number, number];

export function parseColor(
  v: string | undefined,
): { rgb: Rgb; a: number } | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s === 'none' || s.startsWith('url(') || s === 'transparent') return null;
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const h = m[1]!;
    return {
      rgb: [0, 1, 2].map((i) => parseInt(h[i]! + h[i]!, 16)) as Rgb,
      a: 1,
    };
  }
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m)
    return {
      rgb: [0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16)) as Rgb,
      a: 1,
    };
  m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (m) {
    const p = m[1]!.split(',').map((x) => Number(x.trim()));
    return { rgb: [p[0]!, p[1]!, p[2]!], a: p.length > 3 ? p[3]! : 1 };
  }
  if (s === 'white') return { rgb: [255, 255, 255], a: 1 };
  if (s === 'black') return { rgb: [0, 0, 0], a: 1 };
  return null;
}

function lum([r, g, b]: Rgb): number {
  const f = (c: number): number => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function blend(c: Rgb, alpha: number, bg: Rgb): Rgb {
  return c.map((v, i) => v * alpha + bg[i]! * (1 - alpha)) as Rgb;
}

function styleMap(el: XmlElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (el.attrs.style ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const prop = (el: XmlElement, name: string): string | undefined =>
  styleMap(el)[name] ?? el.attrs[name];

const num = (v: string | undefined): number => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : 1;
};

function shapeBox(el: XmlElement): [number, number, number, number] | null {
  const n = (k: string): number => Number(el.attrs[k] ?? 0);
  if (el.attrs.transform) return null;
  if (el.name === 'rect')
    return [n('x'), n('y'), n('x') + n('width'), n('y') + n('height')];
  if (el.name === 'circle')
    return [
      n('cx') - n('r'),
      n('cy') - n('r'),
      n('cx') + n('r'),
      n('cy') + n('r'),
    ];
  if (el.name === 'ellipse')
    return [
      n('cx') - n('rx'),
      n('cy') - n('ry'),
      n('cx') + n('rx'),
      n('cy') + n('ry'),
    ];
  return null;
}

export interface Measured {
  kind: 'stroke' | 'text';
  /** Element name and a short identity (role, text). */
  what: string;
  role: string | undefined;
  ratio: number;
  /** Composited alpha of the measured paint. */
  alpha: number;
  color: string;
  width?: number;
}

/**
 * Every stroke and text paint in the SVG, composited over `background`.
 * `role` is the nearest `data-tds-role` (element or ancestor).
 */
export function measure(svg: string, background: string): Measured[] {
  const bg = parseColor(background)!.rgb;
  const root = parseXml(svg);
  const out: Measured[] = [];
  const walk = (
    el: XmlElement,
    alpha: number,
    fill: string | undefined,
    stroke: string | undefined,
    role: string | undefined,
    hidden: boolean,
    under: Rgb,
  ): void => {
    if (el.name === 'defs' || el.name === 'clipPath' || el.name === 'mask')
      return;
    const s = styleMap(el);
    if (s.display === 'none' || el.attrs.display === 'none') hidden = true;
    const a = alpha * num(prop(el, 'opacity'));
    const f = prop(el, 'fill') ?? fill;
    const st = prop(el, 'stroke') ?? stroke;
    const r = el.attrs['data-tds-role'] ?? role;
    if (!hidden && el.name === 'text') {
      const c = parseColor(f ?? '#000000');
      if (c) {
        const fa = a * c.a * num(prop(el, 'fill-opacity'));
        const text = (el.text || el.children.map((x) => x.text).join(''))
          .trim()
          .slice(0, 24);
        if (text)
          out.push({
            kind: 'text',
            what: `text "${text}"`,
            role: r,
            ratio: contrast(blend(c.rgb, fa, under), under),
            alpha: fa,
            color: f ?? '#000000',
          });
      }
    }
    if (
      !hidden &&
      [
        'line',
        'path',
        'polyline',
        'rect',
        'circle',
        'ellipse',
        'polygon',
      ].includes(el.name)
    ) {
      const c = parseColor(st);
      const w = Number(prop(el, 'stroke-width') ?? 1);
      if (c && w > 0) {
        const sa = a * c.a * num(prop(el, 'stroke-opacity'));
        out.push({
          kind: 'stroke',
          what: `${el.name}${r ? ` [${r}]` : ''}`,
          role: r,
          ratio: contrast(blend(c.rgb, sa, bg), bg),
          alpha: sa,
          color: st!,
          width: w,
        });
      }
    }
    // Text sits on the last filled rect / circle drawn before it in the
    // same group whose box holds the text's anchor (a label chip / pill /
    // panel), else on what its parent sits on.
    const backdrops: { box: [number, number, number, number]; rgb: Rgb }[] = [];
    for (const c of el.children) {
      let local = under;
      if (c.name === 'text' || c.name === 'g') {
        const tx = Number(c.attrs.x);
        const ty = Number(c.attrs.y);
        for (let i = backdrops.length - 1; i >= 0; i--) {
          const [x0, y0, x1, y1] = backdrops[i]!.box;
          if (
            c.name === 'g' ||
            (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1)
          ) {
            if (c.name === 'text') local = backdrops[i]!.rgb;
            break;
          }
        }
      }
      walk(c, a, f, st, r, hidden, local);
      const box = shapeBox(c);
      if (box) {
        const cf = parseColor(prop(c, 'fill') ?? f);
        const ca = cf
          ? a * num(prop(c, 'opacity')) * cf.a * num(prop(c, 'fill-opacity'))
          : 0;
        if (cf && ca >= 0.5)
          backdrops.push({ box, rgb: blend(cf.rgb, ca, under) });
      }
    }
  };
  walk(root, 1, undefined, undefined, undefined, false, bg);
  return out;
}
