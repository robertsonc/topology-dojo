/**
 * Node label placement — the TypeScript mirror of the vendored engine's
 * `_nodeLabelPos` (public/vendor/topology-ds.js). Headless code (inspect,
 * layout metrics) uses this to estimate where a node's label is drawn; the
 * engine is the source of truth for pixels, so keep the two in step.
 *
 * `labelPlacement` is a compass code; absent = `'s'`, the classic centred
 * label below the node (baseline y + 24). `labelOffsetX` / `labelOffset` are
 * ABSOLUTE offsets from the node centre that override the placement's default
 * distances, so pre-placement documents render unchanged.
 */
import type { NodeConfig } from '../vendor/topology-ds.js';

export type LabelPlacement = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export type LabelAnchor = 'start' | 'middle' | 'end';

export interface NodeLabelPos {
  /** Baseline anchor point of the label text (page coordinates). */
  x: number;
  y: number;
  anchor: LabelAnchor;
}

/** Half-extents the engine uses for placement (its `_STATUS_HALF` table). */
const HALF: Record<string, [number, number]> = {
  ec: [28, 18],
  switch: [22, 8],
  switchEnterprise: [44, 16],
  cloud: [55, 32],
  host: [14, 18],
  connector: [16, 16],
  apps: [26, 22],
  saas: [18, 18],
  server: [14, 22],
  router: [18, 18],
  firewall: [20, 18],
  database: [16, 20],
  idcard: [97, 37],
  ap: [18, 16],
  text: [40, 10],
};

const CODES = new Set<string>(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);

/** The node's placement code, normalised (unknown / absent → `'s'`). */
export function labelPlacementOf(n: NodeConfig): LabelPlacement {
  const p = String(n.labelPlacement ?? 's').toLowerCase();
  return (CODES.has(p) ? p : 's') as LabelPlacement;
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Where the engine draws the node's label baseline, and its text anchor. */
export function nodeLabelPos(n: NodeConfig): NodeLabelPos {
  const p = labelPlacementOf(n);
  const image = n.type === 'image';
  let hw = 22;
  let hh = 18;
  if (image) {
    hw = Math.max(16, finiteOr(n.imageW, 96)) / 2;
    hh = Math.max(16, finiteOr(n.imageH, 72)) / 2;
  } else if (HALF[n.type]) {
    [hw, hh] = HALF[n.type]!;
  }
  const north = p === 'n' || p === 'ne' || p === 'nw';
  const south = p === 's' || p === 'se' || p === 'sw';
  const east = p === 'e' || p === 'ne' || p === 'se';
  const west = p === 'w' || p === 'nw' || p === 'sw';
  let dx = 0;
  let anchor: LabelAnchor = 'middle';
  if (east) {
    dx = hw + 6;
    anchor = 'start';
  } else if (west) {
    dx = -(hw + 6);
    anchor = 'end';
  }
  let dy: number;
  if (north) dy = -(hh + 6) - (n.sublabel ? 13 : 0);
  else if (south) dy = image ? hh + 14 : 24;
  else dy = 4;
  const x = n.x + finiteOr(n.labelOffsetX, dx);
  const labelY = finiteOr((n as { labelY?: unknown }).labelY, NaN);
  const y = Number.isFinite(labelY)
    ? labelY
    : n.y + finiteOr(n.labelOffset, dy);
  return { x, y, anchor };
}
