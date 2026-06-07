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
  return movedCount;
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
