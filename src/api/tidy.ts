/**
 * Auto-layout ("tidy") — active prevention to complement the layout analyzer.
 *
 * Where `analyzeLayout` *detects* overlaps/crowding/off-page nodes, `tidyPage`
 * *resolves* them: snap to the grid, iteratively push apart nodes whose
 * footprints overlap or sit closer than the minimum gap, and keep everything
 * inside the page. So an agent can generate roughly, then call `tidy_topology`
 * to land a clean diagram — or a human can hit "Tidy" in the editor.
 *
 * Node-positioning only: zones auto-size around their (now de-overlapped)
 * members, so spacing the nodes also relaxes most zone crowding. Pure +
 * deterministic (no randomness), so it runs anywhere and is unit-testable.
 */
import type { TopologyDocument, Page } from '../pages/model.js';
import {
  analyzeLayout,
  nodeFootprint,
  parseViewBox,
  rectGap,
  LAYOUT_RULES,
} from './layout.js';
import type { NodeConfig } from '../vendor/topology-ds.js';

export interface TidyOptions {
  /** Snap node coordinates onto the grid first (default true). */
  snapToGrid?: boolean;
  /** Target minimum clear gap between node footprints (default LAYOUT_RULES.minNodeGap). */
  minGap?: number;
  /** Keep node footprints within the page margin (default true). */
  keepInBounds?: boolean;
  /** Max separation passes (default 120). */
  iterations?: number;
}

export interface BalanceOptions {
  /** Centres on an axis snap when nodes are within this many px (default ≈ grid×1.3). */
  alignTolerance?: number;
  /** Centre the whole layout's bounding box in the page (default true). */
  center?: boolean;
}

export interface TidyResult {
  /** How many nodes ended up at a new position. */
  movedNodes: number;
  /** Layout-warning count before / after (from analyzeLayout). */
  before: number;
  after: number;
}

function clampTo(v: number, lo: number, hi: number, fallback: number): number {
  return lo <= hi ? Math.min(Math.max(v, lo), hi) : fallback;
}

/**
 * Carry a layout pass's node movement over to the things pinned to the diagram
 * but not themselves nodes: free-floating anchors (which model device ports,
 * placed against a node) and link waypoints (manual bend points). Without this a
 * pass that shifts nodes leaves ports detached and routes bending back through
 * stale waypoints — stray lines across the canvas. Each point follows the delta
 * of the node nearest its pre-move position; a no-op when there are no nodes.
 */
function carryAttachments(
  page: Page,
  origNodes: { x: number; y: number }[],
): void {
  if (!page.nodes.length) return;
  const delta = (x: number, y: number): { dx: number; dy: number } => {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < origNodes.length; i++) {
      const o = origNodes[i]!;
      const d = (x - o.x) ** 2 + (y - o.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return { dx: 0, dy: 0 };
    return {
      dx: page.nodes[best]!.x - origNodes[best]!.x,
      dy: page.nodes[best]!.y - origNodes[best]!.y,
    };
  };
  const shift = (pt: { x: number; y: number }): void => {
    const { dx, dy } = delta(pt.x, pt.y);
    pt.x = Math.round(pt.x + dx);
    pt.y = Math.round(pt.y + dy);
  };
  for (const a of page.anchors ?? []) shift(a);
  for (const l of page.links ?? []) for (const w of l.waypoints ?? []) shift(w);
}

/** Tidy a single page's node positions in place; returns the count of nodes moved. */
export function tidyPage(page: Page, opts: TidyOptions = {}): number {
  const grid = LAYOUT_RULES.gridStep;
  const minGap = opts.minGap ?? LAYOUT_RULES.minNodeGap;
  const iterations = opts.iterations ?? 120;
  const snap = opts.snapToGrid ?? true;
  const keepInBounds = opts.keepInBounds ?? true;
  const margin = LAYOUT_RULES.edgeMargin;
  const [vx, vy, vw, vh] = parseViewBox(page.viewBox);
  const nodes = page.nodes;
  const orig = nodes.map((n) => ({ x: n.x, y: n.y }));

  const clampNode = (n: NodeConfig): void => {
    const f = nodeFootprint(n);
    const hw = f.w / 2;
    const topOff = n.y - f.y; // center → footprint top
    const botOff = f.y + f.h - n.y; // center → footprint bottom
    const cx = (vx + margin + (vx + vw - margin)) / 2;
    const cy = (vy + margin + (vy + vh - margin)) / 2;
    n.x = clampTo(n.x, vx + margin + hw, vx + vw - margin - hw, cx);
    n.y = clampTo(n.y, vy + margin + topOff, vy + vh - margin - botOff, cy);
  };

  if (snap)
    for (const n of nodes) {
      n.x = Math.round(n.x / grid) * grid;
      n.y = Math.round(n.y / grid) * grid;
    }

  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!,
          b = nodes[j]!;
        const gap = rectGap(nodeFootprint(a), nodeFootprint(b));
        if (gap >= minGap) continue;
        const push = (minGap - gap) / 2 + 0.5;
        let dx = a.x - b.x,
          dy = a.y - b.y;
        if (dx === 0 && dy === 0) {
          dx = 1; // deterministic nudge for coincident nodes
          dy = 0;
        }
        const len = Math.hypot(dx, dy) || 1;
        a.x += (dx / len) * push;
        a.y += (dy / len) * push;
        b.x -= (dx / len) * push;
        b.y -= (dy / len) * push;
        moved = true;
      }
    }
    if (keepInBounds) for (const n of nodes) clampNode(n);
    if (!moved) break;
  }

  let movedCount = 0;
  nodes.forEach((n, k) => {
    n.x = Math.round(n.x);
    n.y = Math.round(n.y);
    if (n.x !== orig[k]!.x || n.y !== orig[k]!.y) movedCount++;
  });
  carryAttachments(page, orig);
  return movedCount;
}

/**
 * Cluster node centres on one axis and snap each cluster to its mean, so nodes
 * that *almost* share a row (y) or column (x) line up exactly. Greedy by
 * proximity: a new cluster starts when the gap to the previous node exceeds
 * `tol`. Returns the per-node target for that axis (keyed by node index).
 */
function alignAxis(values: number[], tol: number): number[] {
  const order = values
    .map((_v, i) => i)
    .sort((a, b) => values[a]! - values[b]!);
  const out = values.slice();
  let i = 0;
  while (i < order.length) {
    let j = i + 1;
    while (
      j < order.length &&
      values[order[j]!]! - values[order[j - 1]!]! <= tol
    )
      j++;
    const group = order.slice(i, j);
    const mean = Math.round(
      group.reduce((s, k) => s + values[k]!, 0) / group.length,
    );
    for (const k of group) out[k] = mean;
    i = j;
  }
  return out;
}

/**
 * Balance + symmetry pass. Aligns nodes that nearly share a row/column onto a
 * common axis (so rows and columns are crisp), then centres the whole layout's
 * bounding box within the page — a deterministic nudge toward the balanced,
 * symmetric arrangement a clean topology wants. Assumes a non-overlapping
 * input (run `tidyPage` first if needed); returns how many nodes moved.
 *
 * Pure node-positioning, like tidy — zones auto-size around their members.
 */
export function balancePage(page: Page, opts: BalanceOptions = {}): number {
  const nodes = page.nodes;
  if (nodes.length === 0) return 0;
  const grid = LAYOUT_RULES.gridStep;
  const tol = opts.alignTolerance ?? grid * 1.3;
  const orig = nodes.map((n) => ({ x: n.x, y: n.y }));

  // Align rows (shared y) and columns (shared x).
  const ys = alignAxis(
    nodes.map((n) => n.y),
    tol,
  );
  const xs = alignAxis(
    nodes.map((n) => n.x),
    tol,
  );
  nodes.forEach((n, k) => {
    n.y = ys[k]!;
    n.x = xs[k]!;
  });

  // Centre the layout's footprint bounding box within the page margins.
  if (opts.center ?? true) {
    const [vx, vy, vw, vh] = parseViewBox(page.viewBox);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      const f = nodeFootprint(n);
      minX = Math.min(minX, f.x);
      minY = Math.min(minY, f.y);
      maxX = Math.max(maxX, f.x + f.w);
      maxY = Math.max(maxY, f.y + f.h);
    }
    const dx = Math.round((vx + vw / 2 - (minX + maxX) / 2) / grid) * grid;
    const dy = Math.round((vy + vh / 2 - (minY + maxY) / 2) / grid) * grid;
    for (const n of nodes) {
      n.x += dx;
      n.y += dy;
    }
  }

  let movedCount = 0;
  nodes.forEach((n, k) => {
    n.x = Math.round(n.x);
    n.y = Math.round(n.y);
    if (n.x !== orig[k]!.x || n.y !== orig[k]!.y) movedCount++;
  });
  carryAttachments(page, orig);
  return movedCount;
}

/** Tidy (separate) then balance (align + centre) — the editor's "Balance" action. */
export function balanceLayout(
  doc: TopologyDocument,
  opts: BalanceOptions = {},
): TopologyDocument {
  const next = structuredClone(doc);
  for (const page of next.pages) {
    tidyPage(page);
    balancePage(page, opts);
  }
  return next;
}

/** Tidy every page of a document in place; returns a before/after summary. */
export function tidyDocument(
  doc: TopologyDocument,
  opts: TidyOptions = {},
): TidyResult {
  const before = analyzeLayout(doc).length;
  let movedNodes = 0;
  for (const page of doc.pages) movedNodes += tidyPage(page, opts);
  const after = analyzeLayout(doc).length;
  return { movedNodes, before, after };
}

/** Pure variant: tidy a deep copy and return it (the original is untouched). */
export function tidyLayout(
  doc: TopologyDocument,
  opts: TidyOptions = {},
): TopologyDocument {
  const next = structuredClone(doc);
  tidyDocument(next, opts);
  return next;
}
