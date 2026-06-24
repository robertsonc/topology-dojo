/**
 * Auto-layout algorithms — *arrange* a topology from scratch, complementing
 * `tidy` (which only de-overlaps existing positions). Big lever for AI
 * generation: an agent can place nodes roughly (or pile them up) and ask for a
 * `hierarchical` / `grid` / `circular` / `force` layout.
 *
 * Pure + DOM-free; deterministic (no randomness — force-directed seeds from a
 * circle). Links inform structure (treated as directed from→to). Each algorithm
 * mutates node positions in place; a final `tidy` pass de-overlaps and clamps
 * into the page.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import type { NodeConfig } from '../vendor/topology-ds.js';
import { LAYOUT_RULES, nodeFootprint, parseViewBox } from './layout.js';
import { tidyPage } from './tidy.js';

export type LayoutAlgorithm = 'grid' | 'hierarchical' | 'circular' | 'force';

export interface AutoLayoutOptions {
  algorithm: LayoutAlgorithm;
  /** Hierarchical flow direction (default 'TB'). */
  direction?: 'TB' | 'LR';
  /** Gap between node footprints (default LAYOUT_RULES.minNodeGap * 1.5). */
  spacing?: number;
  /** Run the tidy finisher (de-overlap + keep-in-bounds) after (default true). */
  tidy?: boolean;
}

export interface AutoLayoutResult {
  movedNodes: number;
}

/** Largest node footprint → a uniform cell the layout can step by. */
function cell(page: Page, spacing: number): { cw: number; ch: number } {
  let w = 0;
  let h = 0;
  for (const n of page.nodes) {
    const f = nodeFootprint(n);
    w = Math.max(w, f.w);
    h = Math.max(h, f.h);
  }
  return { cw: w + spacing, ch: h + spacing };
}

function gridLayout(page: Page, vb: number[], spacing: number): void {
  const [vx, vy, vw] = vb as [number, number, number, number];
  const m = LAYOUT_RULES.edgeMargin;
  const n = page.nodes.length;
  const { cw, ch } = cell(page, spacing);
  const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n))));
  const totalW = cols * cw;
  const startX = Math.max(vx + m + cw / 2, vx + (vw - totalW) / 2 + cw / 2);
  const startY = vy + m + ch / 2;
  page.nodes.forEach((node, i) => {
    node.x = startX + (i % cols) * cw;
    node.y = startY + Math.floor(i / cols) * ch;
  });
}

function circularLayout(page: Page, vb: number[], spacing: number): void {
  const [vx, vy, vw, vh] = vb as [number, number, number, number];
  const n = page.nodes.length;
  const cx = vx + vw / 2;
  const cy = vy + vh / 2;
  const { cw, ch } = cell(page, spacing);
  // radius from circumference need (n cells) and the page bounds.
  const need = (n * Math.max(cw, ch)) / (2 * Math.PI);
  const bound =
    Math.min(vw, vh) / 2 - LAYOUT_RULES.edgeMargin - Math.max(cw, ch) / 2;
  const r = n <= 1 ? 0 : Math.max(Math.min(need, bound), Math.max(cw, ch));
  page.nodes.forEach((node, i) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    node.x = cx + r * Math.cos(a);
    node.y = cy + r * Math.sin(a);
  });
}

/** Longest-path layering on the directed link graph (cycles are capped). */
function depths(page: Page): Map<string, number> {
  const ids = new Set(page.nodes.map((n) => n.id));
  const edges = page.links.filter((l) => ids.has(l.from) && ids.has(l.to));
  const depth = new Map<string, number>();
  for (const n of page.nodes) depth.set(n.id, 0);
  for (let pass = 0; pass < page.nodes.length; pass++) {
    let changed = false;
    for (const e of edges) {
      const d = depth.get(e.from)! + 1;
      if (d > depth.get(e.to)!) {
        depth.set(e.to, d);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
}

function hierarchicalLayout(
  page: Page,
  vb: number[],
  spacing: number,
  dir: 'TB' | 'LR',
): void {
  const [vx, vy, vw, vh] = vb as [number, number, number, number];
  const m = LAYOUT_RULES.edgeMargin;
  const { cw, ch } = cell(page, spacing);
  const depth = depths(page);
  const layers = new Map<number, NodeConfig[]>();
  for (const node of page.nodes) {
    const d = depth.get(node.id)!;
    const arr = layers.get(d) ?? [];
    arr.push(node);
    layers.set(d, arr);
  }
  const ds = [...layers.keys()].sort((a, b) => a - b);
  const along = dir === 'TB' ? cw : ch; // step within a layer
  const across = dir === 'TB' ? ch : cw; // step between layers
  const alongSpan = dir === 'TB' ? vw : vh;
  const alongOrigin = dir === 'TB' ? vx : vy;
  const acrossOrigin = dir === 'TB' ? vy : vx;
  const acrossExtent = dir === 'TB' ? vh : vw;
  const acrossStart =
    acrossOrigin +
    Math.max(m + across / 2, (acrossExtent - (ds.length - 1) * across) / 2);
  ds.forEach((d, li) => {
    const row = layers.get(d)!;
    const total = (row.length - 1) * along;
    const start =
      alongOrigin + Math.max(m + along / 2, (alongSpan - total) / 2);
    const acrossPos = acrossStart + li * across;
    row.forEach((node, i) => {
      const alongPos = start + i * along;
      if (dir === 'TB') {
        node.x = alongPos;
        node.y = acrossPos;
      } else {
        node.x = acrossPos;
        node.y = alongPos;
      }
    });
  });
}

function forceLayout(page: Page, vb: number[], spacing: number): void {
  const [vx, vy, vw, vh] = vb as [number, number, number, number];
  const m = LAYOUT_RULES.edgeMargin;
  const nodes = page.nodes;
  const n = nodes.length;
  const ids = new Set(nodes.map((x) => x.id));
  const edges = page.links.filter((l) => ids.has(l.from) && ids.has(l.to));
  // Deterministic seed: a circle.
  circularLayout(page, vb, spacing);
  const k = Math.sqrt(((vw - 2 * m) * (vh - 2 * m)) / Math.max(1, n)) * 0.8;
  const idx = new Map(nodes.map((x, i) => [x.id, i]));
  let temp = Math.min(vw, vh) / 8;
  const cool = temp / 90;
  for (let iter = 0; iter < 90; iter++) {
    const dispX = new Array<number>(n).fill(0);
    const dispY = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = nodes[i]!.x - nodes[j]!.x;
        let dy = nodes[i]!.y - nodes[j]!.y;
        if (dx === 0 && dy === 0) {
          dx = (i - j) * 0.1 || 0.1; // deterministic nudge for coincident nodes
          dy = 0.1;
        }
        const dist = Math.hypot(dx, dy) || 0.01;
        const rep = (k * k) / dist;
        const ux = (dx / dist) * rep;
        const uy = (dy / dist) * rep;
        dispX[i]! += ux;
        dispY[i]! += uy;
        dispX[j]! -= ux;
        dispY[j]! -= uy;
      }
    }
    for (const e of edges) {
      const a = idx.get(e.from)!;
      const b = idx.get(e.to)!;
      const dx = nodes[a]!.x - nodes[b]!.x;
      const dy = nodes[a]!.y - nodes[b]!.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const att = (dist * dist) / k;
      const ux = (dx / dist) * att;
      const uy = (dy / dist) * att;
      dispX[a]! -= ux;
      dispY[a]! -= uy;
      dispX[b]! += ux;
      dispY[b]! += uy;
    }
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(dispX[i]!, dispY[i]!) || 0.01;
      nodes[i]!.x += (dispX[i]! / d) * Math.min(d, temp);
      nodes[i]!.y += (dispY[i]! / d) * Math.min(d, temp);
      nodes[i]!.x = Math.min(vx + vw - m, Math.max(vx + m, nodes[i]!.x));
      nodes[i]!.y = Math.min(vy + vh - m, Math.max(vy + m, nodes[i]!.y));
    }
    temp = Math.max(1, temp - cool);
  }
}

function applyAlgorithm(
  page: Page,
  vb: number[],
  spacing: number,
  opts: AutoLayoutOptions,
): void {
  if (opts.algorithm === 'grid') gridLayout(page, vb, spacing);
  else if (opts.algorithm === 'circular') circularLayout(page, vb, spacing);
  else if (opts.algorithm === 'force') forceLayout(page, vb, spacing);
  else hierarchicalLayout(page, vb, spacing, opts.direction ?? 'TB');
}

/* ── zone-aware layout ────────────────────────────────────────────────
 * Laying nodes out as a flat graph scatters a zone's members across the
 * page; the zone then auto-sizes a box that spans — and visually swallows —
 * unrelated nodes. When a page has zones we instead keep each zone's members
 * together (a compact grid per zone), then pack the zones and the remaining
 * free nodes as non-overlapping blocks. Block reserves mirror the engine's
 * zone box (member centers padded by `gridPad`+`zonePadding`), so adjacent
 * zones never overlap. The chosen algorithm governs the no-zone path; with
 * zones it influences only the (grid) intra-cluster arrangement for now.
 */

/** All node ids belonging to a zone and its descendant zones. */
function zoneMembers(
  zones: { id: string; nodes?: string[]; parentZone?: string }[],
  zoneId: string,
): string[] {
  const z = zones.find((x) => x.id === zoneId);
  if (!z) return [];
  const ids = [...(z.nodes ?? [])];
  for (const child of zones)
    if (child.parentZone === zoneId) ids.push(...zoneMembers(zones, child.id));
  return ids;
}

/** Arrange a cluster's members in a compact grid; centers start at (0,0). */
function gridCluster(
  nodes: NodeConfig[],
  spacing: number,
): { centerW: number; centerH: number } {
  let cw = 0;
  let ch = 0;
  for (const n of nodes) {
    const f = nodeFootprint(n);
    cw = Math.max(cw, f.w);
    ch = Math.max(ch, f.h);
  }
  cw += spacing;
  ch += spacing;
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const rows = Math.ceil(nodes.length / cols);
  nodes.forEach((n, i) => {
    n.x = (i % cols) * cw;
    n.y = Math.floor(i / cols) * ch;
  });
  return { centerW: (cols - 1) * cw, centerH: (rows - 1) * ch };
}

interface LayoutBlock {
  nodes: NodeConfig[];
  /** Reserve extents from the member-center origin to the block's edges. */
  l: number;
  r: number;
  t: number;
  b: number;
}

function zoneAwareLayout(page: Page, vb: number[], spacing: number): void {
  const [vx, vy, vw, vh] = vb as [number, number, number, number];
  const m = LAYOUT_RULES.edgeMargin;
  const zones = page.zones ?? [];
  // The engine pads a zone box by these around member *centers* (see layout.ts
  // `zoneBox`): a fixed inset plus the zone's padding.
  const pad = LAYOUT_RULES.zonePadding;
  const insetX = 40 + pad;
  const insetY = 30 + pad;

  // Assign each node to its top-level zone (first wins); the rest are free.
  const assigned = new Map<string, string>();
  const topZones = zones.filter(
    (z) => !(z.parentZone && zones.some((o) => o.id === z.parentZone)),
  );
  for (const z of topZones)
    for (const id of zoneMembers(zones, z.id))
      if (!assigned.has(id)) assigned.set(id, z.id);

  const blocks: LayoutBlock[] = [];
  for (const z of topZones) {
    const members = page.nodes.filter((n) => assigned.get(n.id) === z.id);
    if (!members.length) continue;
    const { centerW, centerH } = gridCluster(members, spacing);
    blocks.push({
      nodes: members,
      l: insetX,
      r: centerW + insetX,
      t: insetY,
      b: centerH + insetY,
    });
  }
  for (const n of page.nodes) {
    if (assigned.has(n.id)) continue;
    n.x = 0;
    n.y = 0;
    const f = nodeFootprint(n); // relative to the (0,0) center
    blocks.push({ nodes: [n], l: -f.x, r: f.x + f.w, t: -f.y, b: f.y + f.h });
  }

  // Pack blocks left→right, wrapping at the usable width; `gap` keeps both
  // free-node footprints (≥ minNodeGap) and zone boxes clear of each other.
  const gap = LAYOUT_RULES.minNodeGap;
  const usableW = Math.max(1, vw - 2 * m);
  const placed: { block: LayoutBlock; originX: number; originY: number }[] = [];
  let curX = 0;
  let rowTop = 0;
  let rowH = 0;
  let totalW = 0;
  for (const block of blocks) {
    const bw = block.l + block.r;
    const bh = block.t + block.b;
    if (curX > 0 && curX + bw > usableW) {
      rowTop += rowH + gap;
      curX = 0;
      rowH = 0;
    }
    placed.push({ block, originX: curX + block.l, originY: rowTop + block.t });
    curX += bw + gap;
    rowH = Math.max(rowH, bh);
    totalW = Math.max(totalW, curX - gap);
  }
  const totalH = rowTop + rowH;
  const offX = vx + Math.max(m, (vw - totalW) / 2);
  const offY = vy + Math.max(m, (vh - totalH) / 2);
  for (const { block, originX, originY } of placed)
    for (const n of block.nodes) {
      n.x += offX + originX;
      n.y += offY + originY;
    }
}

/** Arrange a page with the given algorithm (mutates); returns count moved. */
export function layoutPage(page: Page, opts: AutoLayoutOptions): number {
  if (page.nodes.length < 2) return 0;
  const vb = parseViewBox(page.viewBox);
  const spacing = opts.spacing ?? LAYOUT_RULES.minNodeGap * 1.5;
  const orig = page.nodes.map((n) => ({ x: n.x, y: n.y }));

  if ((page.zones?.length ?? 0) > 0) zoneAwareLayout(page, vb, spacing);
  else applyAlgorithm(page, vb, spacing, opts);

  if (opts.tidy !== false) tidyPage(page, { snapToGrid: false });

  let moved = 0;
  page.nodes.forEach((n, i) => {
    n.x = Math.round(n.x);
    n.y = Math.round(n.y);
    if (n.x !== orig[i]!.x || n.y !== orig[i]!.y) moved++;
  });
  return moved;
}

/** Arrange every page of a document; returns how many nodes moved. */
export function layoutDocument(
  doc: TopologyDocument,
  opts: AutoLayoutOptions,
): AutoLayoutResult {
  let movedNodes = 0;
  for (const page of doc.pages) movedNodes += layoutPage(page, opts);
  return { movedNodes };
}

/** Pure variant: arrange a deep copy and return it. */
export function autoLayout(
  doc: TopologyDocument,
  opts: AutoLayoutOptions,
): TopologyDocument {
  const next = structuredClone(doc);
  layoutDocument(next, opts);
  return next;
}
