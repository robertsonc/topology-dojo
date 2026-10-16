/**
 * Auto-generated legend / key (B.1). Built live from the elements *actually in
 * use* on a page — distinct node types (with their colour), policy-marker
 * types, and declared layers — so it regenerates as the diagram changes. The
 * same `<g>` is drawn on the editor canvas and injected into exports, so the
 * key always matches what's on screen.
 */
import type { LegendConfig, Page, TopologyDocument } from '../pages/model.js';
import { getNodeType } from '../api/catalog.js';
import { linkStyleLabel, usedLinkStyles } from '../api/link-styles.js';
import { BUNDLE_KIND_LABELS, usedBundleKinds } from '../api/bundles.js';

/** Engine default node colour when a node sets none (see topology-ds render fns). */
const DEFAULT_NODE_COLOR = '#01a982';
const DEFAULT_MARKER_COLOR = '#fc6161';
const DEFAULT_LAYER_COLOR = '#7d8a92';

export interface LegendItem {
  color: string;
  label: string;
  /** 'dot' for nodes/markers, 'bar' for layers, 'line' for link styles,
   * 'bundle' for a LAG / ECMP outline. */
  shape: 'dot' | 'bar' | 'line' | 'bundle';
  /** For 'line': the sample stroke's dash. */
  dash?: 'solid' | 'dashed' | 'dotted';
  /** For 'line': the sample stroke's width (default 1.6). */
  width?: number;
}

function escXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

/** Node types that carry prose rather than a symbol worth a legend row. */
const ANNOTATION_TYPES = new Set(['text', 'callout']);

/** The distinct in-use symbols for a page, in a stable display order. */
export function buildLegendItems(
  doc: TopologyDocument,
  page: Page,
): LegendItem[] {
  const items: LegendItem[] = [];
  const seen = new Set<string>();
  const push = (key: string, item: LegendItem): void => {
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  // Node types in use → one entry per (type, colour). Annotation nodes (text
  // boxes, callouts) are prose, not symbols, and are coloured per box for
  // emphasis — listing each colour as its own "Text" row says nothing (#254).
  for (const n of page.nodes) {
    if (ANNOTATION_TYPES.has(n.type)) continue;
    const color = n.color ?? DEFAULT_NODE_COLOR;
    const label = getNodeType(n.type, doc.customNodes)?.label ?? n.type;
    push(`node:${n.type}:${color}`, { color, label, shape: 'dot' });
  }
  // Node statuses in use → one LED entry per distinct status.
  const STATUS_COLORS: Record<string, string> = {
    ok: '#01a982',
    warn: '#e0a44a',
    down: '#fc6161',
    maintenance: '#65aef9',
    unknown: '#7d8a92',
  };
  for (const n of page.nodes) {
    const st = (n as { status?: string }).status;
    const color = st ? STATUS_COLORS[st] : undefined;
    if (st && color)
      push(`status:${st}`, { color, label: `status: ${st}`, shape: 'dot' });
  }
  // Policy markers in use → one entry per (type, colour).
  for (const m of page.policyMarkers ?? []) {
    const mm = m as { type?: string; color?: string };
    const type = mm.type ?? 'marker';
    const color = mm.color ?? DEFAULT_MARKER_COLOR;
    push(`marker:${type}:${color}`, {
      color,
      label: `${type} marker`,
      shape: 'dot',
    });
  }
  // Link styles (W1) used by a link on this page → one line sample each, in
  // declaration order — the drawing sheet's Key.
  for (const st of usedLinkStyles(doc.linkStyles, page.links))
    push(`style:${st.id}`, {
      color: st.color,
      label: linkStyleLabel(st),
      shape: 'line',
      ...(st.dash ? { dash: st.dash } : {}),
      ...(st.width !== undefined ? { width: st.width } : {}),
    });
  // Bundle kinds (W3) used by a link end → the LAG / ECMP outline samples.
  for (const kind of usedBundleKinds(doc.bundles, page.links))
    if (kind !== 'icl')
      push(`bundle:${kind}`, {
        color: '#7d8a92',
        label: BUNDLE_KIND_LABELS[kind],
        shape: 'bundle',
        ...(kind === 'ecmp' ? { dash: 'dashed' as const } : {}),
      });
  // Declared layers actually used by an element on this page.
  const usedLayers = new Set<string>();
  for (const coll of [
    page.nodes,
    page.links,
    page.zones ?? [],
    page.flowPaths ?? [],
    page.policyMarkers ?? [],
  ])
    for (const el of coll as { layer?: string }[])
      if (el.layer) usedLayers.add(el.layer);
  for (const layer of doc.layers ?? []) {
    if (!usedLayers.has(layer.id)) continue;
    push(`layer:${layer.id}`, {
      color: layer.color ?? DEFAULT_LAYER_COLOR,
      label: layer.name ?? layer.id,
      shape: 'bar',
    });
  }
  return items;
}

const ROW_H = 18;
const PAD = 10;
const SWATCH = 11; // swatch column width (dots / bars)
const LINE_SWATCH = 24; // line-sample width (link styles)
const TITLE_H = 18; // header strip height when a title is set
/** Max columns the layout honours (row-major). */
export const LEGEND_MAX_COLUMNS = 8;

/** The columns a legend lays its rows out in (clamped). */
export function legendColumns(cfg: LegendConfig | undefined): number {
  const c = cfg?.columns;
  if (typeof c !== 'number' || !Number.isFinite(c)) return 1;
  return Math.max(1, Math.min(LEGEND_MAX_COLUMNS, Math.round(c)));
}

interface LegendLayout {
  w: number;
  h: number;
  cols: number;
  rows: number;
  /** Width of one column (swatch + gap + longest label). */
  colW: number;
  swatch: number;
  /** Body top (below the title strip when present). */
  top: number;
}

/** Estimate the box from the longest label (monospace ≈ 6.6px/char), the
 * column count and the title. */
function legendLayout(
  items: LegendItem[],
  columns = 1,
  title?: string,
): LegendLayout {
  const longest = items.reduce((m, it) => Math.max(m, it.label.length), 0);
  const swatch = items.some(
    (it) => it.shape === 'line' || it.shape === 'bundle',
  )
    ? LINE_SWATCH
    : SWATCH;
  const colW = swatch + 6 + Math.ceil(longest * 6.6) + 4;
  const cols = Math.max(1, Math.min(columns, items.length || 1));
  const rows = Math.ceil(items.length / cols);
  const top = PAD + (title ? TITLE_H : 0);
  const titleW = title ? Math.ceil(title.length * 7) + PAD * 2 : 0;
  const w = Math.max(96, PAD * 2 + cols * colW + (cols - 1) * PAD, titleW);
  const h = top + rows * ROW_H + PAD;
  return { w, h, cols, rows, colW, swatch, top };
}

/** The legend body as an SVG `<g>` anchored at (0,0). Empty string if no items. */
export function legendBodySVG(
  items: LegendItem[],
  columns = 1,
  title?: string,
): string {
  if (!items.length) return '';
  const L = legendLayout(items, columns, title);
  let s =
    `<rect x="0" y="0" width="${L.w}" height="${L.h}" rx="8" ` +
    `fill="rgba(20,24,32,0.86)" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>`;
  if (title)
    s +=
      `<text x="${PAD}" y="${PAD + 12}" font-size="11" font-weight="700" letter-spacing="1" ` +
      `font-family="ui-monospace,monospace" fill="#01a982">${escXml(title)}</text>`;
  items.forEach((it, i) => {
    const col = i % L.cols;
    const row = Math.floor(i / L.cols);
    const cy = L.top + row * ROW_H + ROW_H / 2;
    const sx = PAD + col * (L.colW + PAD);
    if (it.shape === 'bar')
      s += `<rect x="${sx}" y="${cy - 4}" width="${SWATCH}" height="8" rx="2" fill="${it.color}"/>`;
    else if (it.shape === 'line') {
      const dash =
        it.dash === 'dashed'
          ? ' stroke-dasharray="6 4"'
          : it.dash === 'dotted'
            ? ' stroke-dasharray="2 3"'
            : '';
      s += `<line x1="${sx}" y1="${cy}" x2="${sx + LINE_SWATCH}" y2="${cy}" stroke="${it.color}" stroke-width="${it.width ?? 1.6}"${dash}/>`;
    } else if (it.shape === 'bundle')
      s += `<rect x="${sx + 6}" y="${cy - 6}" width="12" height="12" rx="6" fill="none" stroke="${it.color}" stroke-width="1"${it.dash === 'dashed' ? ' stroke-dasharray="3 2"' : ''}/>`;
    else
      s += `<circle cx="${sx + SWATCH / 2}" cy="${cy}" r="5" fill="${it.color}"/>`;
    s +=
      `<text x="${sx + L.swatch + 6}" y="${cy + 3.5}" font-size="11" ` +
      `font-family="ui-monospace,monospace" fill="#e6e8e9">${escXml(it.label)}</text>`;
  });
  return s;
}

/** The legend box size for a page's config (for placement by other overlays). */
export function legendBox(
  doc: TopologyDocument,
  page: Page,
): { w: number; h: number } | null {
  const cfg = doc.legend ?? {};
  if (!cfg.show) return null;
  const items = buildLegendItems(doc, page);
  if (!items.length) return null;
  const L = legendLayout(items, legendColumns(cfg), cfg.title);
  return { w: L.w, h: L.h };
}

/**
 * A positioned legend `<g>` for a page, in page coordinates (so it exports and
 * pans with the canvas). Returns '' when the legend is off or empty.
 */
export function legendSVG(
  doc: TopologyDocument,
  page: Page,
  opts: { margin?: number } = {},
): string {
  const cfg: LegendConfig = doc.legend ?? {};
  if (!cfg.show) return '';
  const items = buildLegendItems(doc, page);
  const body = legendBodySVG(items, legendColumns(cfg), cfg.title);
  if (!body) return '';
  const { w, h } = legendLayout(items, legendColumns(cfg), cfg.title);
  const [vx, vy, vw, vh] = page.viewBox.split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const m = opts.margin ?? 16; // margin from the page edge
  const pos = cfg.position ?? 'tl';
  const x = pos === 'tr' || pos === 'br' ? vx + vw - w - m : vx + m;
  const y = pos === 'bl' || pos === 'br' ? vy + vh - h - m : vy + m;
  return `<g class="tds-legend" transform="translate(${x},${y})">${body}</g>`;
}
