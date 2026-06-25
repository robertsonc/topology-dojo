/**
 * Auto-generated legend / key (B.1). Built live from the elements *actually in
 * use* on a page — distinct node types (with their colour), policy-marker
 * types, and declared layers — so it regenerates as the diagram changes. The
 * same `<g>` is drawn on the editor canvas and injected into exports, so the
 * key always matches what's on screen.
 */
import type { LegendConfig, Page, TopologyDocument } from '../pages/model.js';
import { getNodeType } from '../api/catalog.js';

/** Engine default node colour when a node sets none (see topology-ds render fns). */
const DEFAULT_NODE_COLOR = '#01a982';
const DEFAULT_MARKER_COLOR = '#fc6161';
const DEFAULT_LAYER_COLOR = '#7d8a92';

export interface LegendItem {
  color: string;
  label: string;
  /** 'dot' for nodes/markers, 'bar' for layers. */
  shape: 'dot' | 'bar';
}

function escXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

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

  // Node types in use → one entry per (type, colour).
  for (const n of page.nodes) {
    const color = n.color ?? DEFAULT_NODE_COLOR;
    const label = getNodeType(n.type, doc.customNodes)?.label ?? n.type;
    push(`node:${n.type}:${color}`, { color, label, shape: 'dot' });
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
const SWATCH = 11; // swatch column width

/** Estimate the box width from the longest label (monospace ≈ 6.6px/char). */
function legendSize(items: LegendItem[]): { w: number; h: number } {
  const longest = items.reduce((m, it) => Math.max(m, it.label.length), 0);
  const w = PAD * 2 + SWATCH + 6 + Math.ceil(longest * 6.6) + 4;
  const h = PAD * 2 + items.length * ROW_H;
  return { w: Math.max(96, w), h };
}

/** The legend body as an SVG `<g>` anchored at (0,0). Empty string if no items. */
export function legendBodySVG(items: LegendItem[]): string {
  if (!items.length) return '';
  const { w, h } = legendSize(items);
  let s =
    `<rect x="0" y="0" width="${w}" height="${h}" rx="8" ` +
    `fill="rgba(20,24,32,0.86)" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>`;
  items.forEach((it, i) => {
    const cy = PAD + i * ROW_H + ROW_H / 2;
    const sx = PAD;
    s +=
      it.shape === 'bar'
        ? `<rect x="${sx}" y="${cy - 4}" width="${SWATCH}" height="8" rx="2" fill="${it.color}"/>`
        : `<circle cx="${sx + SWATCH / 2}" cy="${cy}" r="5" fill="${it.color}"/>`;
    s +=
      `<text x="${sx + SWATCH + 6}" y="${cy + 3.5}" font-size="11" ` +
      `font-family="ui-monospace,monospace" fill="#e6e8e9">${escXml(it.label)}</text>`;
  });
  return s;
}

/**
 * A positioned legend `<g>` for a page, in page coordinates (so it exports and
 * pans with the canvas). Returns '' when the legend is off or empty.
 */
export function legendSVG(doc: TopologyDocument, page: Page): string {
  const cfg: LegendConfig = doc.legend ?? {};
  if (!cfg.show) return '';
  const items = buildLegendItems(doc, page);
  const body = legendBodySVG(items);
  if (!body) return '';
  const { w, h } = legendSize(items);
  const [vx, vy, vw, vh] = page.viewBox.split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const m = 16; // margin from the page edge
  const pos = cfg.position ?? 'tl';
  const x = pos === 'tr' || pos === 'br' ? vx + vw - w - m : vx + m;
  const y = pos === 'bl' || pos === 'br' ? vy + vh - h - m : vy + m;
  return `<g class="tds-legend" transform="translate(${x},${y})">${body}</g>`;
}
