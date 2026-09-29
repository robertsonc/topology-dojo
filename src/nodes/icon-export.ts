/**
 * Standalone, theme-aware SVG export of the node/icon library.
 *
 * Every icon is produced by the same code the canvas uses — the vendored
 * engine's built-in node renderers, the stock `CustomNodeSpec`s through
 * `renderCustomNode`, and the raw 24×24 glyph paths in `ICONS` — not by
 * snapshotting a rendered canvas. Pure string work, no DOM.
 *
 * Theming: the engine bakes a DARK card surface + light text into its markup
 * (see `LIGHT_CANVAS`). Each icon keeps those dark colours as the plain
 * presentation attributes (so it renders correctly anywhere, including tools
 * that ignore CSS) and adds a small `<style>` that swaps to the app's light
 * palette under `prefers-color-scheme: light`. Every themed colour is also a
 * CSS custom property (`--tds-c0`…), so a page that inlines the SVG can
 * override it.
 */
import { LIGHT_CANVAS, flattenViewer } from '../vendor/topology-ds.js';
import { ICONS } from './data.js';
import { customHitBox, renderCustomNode } from './render.js';
import { STOCK_NODE_LABELS, STOCK_NODE_SPECS } from './stock.js';

/** The slice of the engine class the exporter needs. */
export interface IconEngine {
  NODE_TYPES: Record<
    string,
    (x: number, y: number, cfg: Record<string, unknown>) => string
  >;
}

export interface IconBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A themed icon ready to be measured + written. */
export interface IconArt {
  /** File-safe id, unique across all groups. */
  id: string;
  group: 'node' | 'stock' | 'glyph';
  label: string;
  /** Node-type name (`node`/`stock`) or glyph key. */
  source: string;
  /** Glyph category (`glyph` only). */
  category?: string;
  /** Themed markup (attributes + class hooks) WITHOUT the `<style>`. */
  markup: string;
  /** Design-space bounding box: hit-box estimate, replaced by a measurement. */
  box: IconBox;
}

/** Engine types that need no/extra config to draw an icon-sized preview. */
const SKIP_NODE_TYPES = new Set(['image']);
const NODE_VARIANTS: {
  id: string;
  type: string;
  cfg: Record<string, unknown>;
}[] = [
  ...['virtual', 'physical', 'aws', 'azure', 'gcp', 'oracle', 'axis'].map(
    (v) => ({ id: `ec-${v}`, type: 'ec', cfg: { variant: v } }),
  ),
  { id: 'host-managed', type: 'host', cfg: { managed: true } },
  { id: 'connector-pe', type: 'connector', cfg: { pe: true } },
];
const NODE_SAMPLE_CFG: Record<string, Record<string, unknown>> = {
  text: { label: 'Text' },
  callout: { label: 'Note' },
};

/** Rough half-extents per engine type (mirrors the engine's `_getNodeAABB`). */
const NODE_HALF: Record<string, [number, number]> = {
  ec: [32, 17],
  switch: [34, 15],
  switchEnterprise: [46, 18],
  cloud: [64, 36],
  host: [22, 17],
  connector: [24, 17],
  apps: [20, 24],
  saas: [36, 22],
  server: [22, 22],
  router: [20, 20],
  firewall: [24, 18],
  database: [20, 22],
  ap: [20, 22],
  idcard: [99, 39],
};

const HEX = (h: string): RegExp => new RegExp(`^#${h}$`, 'i');

/** Index of the LIGHT_CANVAS entry a fill/stroke value belongs to, plus alpha. */
function themeEntry(value: string): { i: number; alpha?: string } | null {
  const v = value.trim();
  for (let i = 0; i < LIGHT_CANVAS.length; i++) {
    const c = LIGHT_CANVAS[i]!;
    if (HEX(c.from).test(v)) return { i };
    const m = new RegExp(
      `^rgba?\\(\\s*${c.rgb.replace(/,/g, '\\s*,\\s*')}\\s*(?:,\\s*([\\d.]+))?\\s*\\)$`,
      'i',
    ).exec(v);
    if (m) return m[1] !== undefined ? { i, alpha: m[1] } : { i };
  }
  return null;
}

/**
 * Tag each `fill`/`stroke` that uses a themed colour with a class, and return
 * the markup plus the extra rules needed for translucent (`rgba`) variants.
 * Untouched colours (accents, alerts, greys) are theme-independent by design.
 */
export function themeMarkup(markup: string): {
  markup: string;
  extra: Set<string>;
} {
  const extra = new Set<string>();
  // The label chip gradient can't be recoloured in SVG (see lightenCanvas);
  // use the equivalent solid surface so it themes like any other fill.
  const src = markup.split('url(#tds-labelGlass)').join('#1d1f27');
  const out = src.replace(
    /<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*?)(\s*\/?)>/g,
    (whole, tag: string, attrs: string, close: string) => {
      const classes: string[] = [];
      for (const prop of ['fill', 'stroke'] as const) {
        const m = new RegExp(`\\s${prop}="([^"]*)"`).exec(attrs);
        if (!m) continue;
        const hit = themeEntry(m[1]!);
        if (!hit) continue;
        const p = prop === 'fill' ? 'f' : 's';
        if (hit.alpha === undefined) {
          classes.push(`tds-${p}${hit.i}`);
        } else {
          const a = hit.alpha.replace('.', '_');
          classes.push(`tds-${p}${hit.i}a${a}`);
          extra.add(`${p}${hit.i}:${hit.alpha}`);
        }
      }
      if (!classes.length) return whole;
      const has = /\sclass="([^"]*)"/.exec(attrs);
      const next = has
        ? attrs.replace(has[0], ` class="${has[1]} ${classes.join(' ')}"`)
        : `${attrs} class="${classes.join(' ')}"`;
      return `<${tag}${next}${close}>`;
    },
  );
  return { markup: out, extra };
}

/** The `<style>` block for a themed icon (dark default, light override). */
export function themeStyle(markup: string, extra: Set<string>): string {
  const used = new Set(
    [...markup.matchAll(/tds-([fs]\d+)(?![\da])/g)].map((m) => m[1]!),
  );
  const rules = (light: boolean): string => {
    let css = '';
    LIGHT_CANVAS.forEach((c, i) => {
      if (!used.has(`f${i}`) && !used.has(`s${i}`)) return;
      const dark = `#${c.from}`;
      const val = light ? c.to : dark;
      css += `.tds-f${i}{fill:var(--tds-c${i},${val})}.tds-s${i}{stroke:var(--tds-c${i},${val})}`;
    });
    for (const e of extra) {
      const m = /^([fs])(\d+):(.+)$/.exec(e)!;
      const i = Number(m[2]);
      const c = LIGHT_CANVAS[i]!;
      const rgb = light ? c.toRgb : c.rgb;
      const prop = m[1] === 'f' ? 'fill' : 'stroke';
      css += `.tds-${m[1]}${i}a${m[3]!.replace('.', '_')}{${prop}:rgba(${rgb},${m[3]})}`;
    }
    return css;
  };
  return `<style>${rules(false)}@media (prefers-color-scheme:light){${rules(true)}}</style>`;
}

function fileId(s: string): string {
  return s.replace(/^shape:/, 'shape-').replace(/[^A-Za-z0-9_-]/g, '-');
}

const titleCase = (s: string): string =>
  s
    .replace(/^shape:/, 'Shape ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase());

function half(type: string): IconBox {
  const [rx, ry] = NODE_HALF[type] ?? [20, 20];
  return { x: -rx, y: -ry, w: rx * 2, h: ry * 2 };
}

/** Collect every icon in the library as themed markup (no measuring yet). */
export function collectIcons(engine: IconEngine): IconArt[] {
  const arts: IconArt[] = [];
  const push = (a: Omit<IconArt, 'markup'> & { raw: string }): void => {
    const { raw, ...rest } = a;
    const flat = flattenViewer(raw);
    arts.push({ ...rest, markup: flat });
  };

  for (const [type, render] of Object.entries(engine.NODE_TYPES)) {
    if (SKIP_NODE_TYPES.has(type)) continue;
    push({
      id: fileId(type),
      group: 'node',
      label: titleCase(type),
      source: type,
      raw: render(0, 0, NODE_SAMPLE_CFG[type] ?? {}),
      box: half(type),
    });
  }
  for (const v of NODE_VARIANTS) {
    const render = engine.NODE_TYPES[v.type];
    if (!render) continue;
    push({
      id: v.id,
      group: 'node',
      label: `${titleCase(v.type)} (${v.id.slice(v.type.length + 1)})`,
      source: v.type,
      raw: render(0, 0, v.cfg),
      box: half(v.type),
    });
  }
  for (const spec of STOCK_NODE_SPECS) {
    const hb = customHitBox(spec);
    push({
      id: fileId(spec.typeName),
      group: 'stock',
      label: STOCK_NODE_LABELS[spec.typeName] ?? spec.typeName,
      source: spec.typeName,
      raw: renderCustomNode(spec, 0, 0),
      box: { x: -hb.rx, y: -hb.ry, w: hb.rx * 2, h: hb.ry * 2 },
    });
  }
  return arts;
}

/** Wrap themed art in a standalone `<svg>` sized to its measured box. */
export function nodeIconSvg(
  art: IconArt,
  box: IconBox = art.box,
  pad = 4,
): string {
  const { markup, extra } = themeMarkup(art.markup);
  const vb = [box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2]
    .map((n) => Math.round(n * 100) / 100)
    .join(' ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="${art.label.replace(/"/g, '&quot;')}">` +
    `<title>${art.label.replace(/[<>&]/g, '')}</title>` +
    themeStyle(markup, extra) +
    markup +
    `</svg>\n`
  );
}

/**
 * A glyph is a single filled path on a 24×24 grid. It is a monochrome mask, so
 * it themes through one variable: dark ink on light, light ink on dark.
 */
export function glyphSvg(key: string): string {
  const g = ICONS[key];
  if (!g) throw new Error(`unknown icon glyph "${key}"`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="${key}">` +
    `<title>${key}</title>` +
    `<style>.tds-glyph{fill:var(--tds-glyph,#e6e8e9)}` +
    `@media (prefers-color-scheme:light){.tds-glyph{fill:var(--tds-glyph,#1d1f27)}}</style>` +
    `<path class="tds-glyph" fill="#e6e8e9" d="${g.d}"/></svg>\n`
  );
}

export function glyphArts(): IconArt[] {
  return Object.entries(ICONS).map(([key, v]) => ({
    id: `glyph-${key}`,
    group: 'glyph' as const,
    label: key,
    source: key,
    category: v.cat,
    markup: '',
    box: { x: 0, y: 0, w: 24, h: 24 },
  }));
}
