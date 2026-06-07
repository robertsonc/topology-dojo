/**
 * Node geometry for editor interactions — hit-testing and bounds.
 *
 * Node art is drawn by the vendored engine centered on (x, y); these are the
 * approximate half-extents per type, ported from the legacy editor's
 * getNodeBounds so selection/hit-testing line up with what's drawn.
 */
import type { NodeConfig } from '../vendor/topology-ds.js';
import type { Page } from '../pages/model.js';

/** Half-width / half-height per node type (extent from the node's center). */
const HALF: Record<string, { w: number; h: number }> = {
  ec: { w: 28, h: 18 },
  switch: { w: 22, h: 8 },
  switchEnterprise: { w: 44, h: 16 },
  cloud: { w: 55, h: 32 },
  host: { w: 14, h: 18 },
  connector: { w: 16, h: 16 },
  apps: { w: 26, h: 22 },
  saas: { w: 18, h: 18 },
  server: { w: 14, h: 22 },
  router: { w: 18, h: 18 },
  firewall: { w: 20, h: 18 },
  database: { w: 16, h: 20 },
  idcard: { w: 97, h: 37 },
  ap: { w: 18, h: 16 },
  text: { w: 40, h: 10 },
  custom: { w: 20, h: 20 },
  'shape:arrow': { w: 24, h: 12 },
  'shape:square': { w: 18, h: 18 },
  'shape:rectangle': { w: 28, h: 16 },
  'shape:triangle': { w: 20, h: 18 },
  'shape:circle': { w: 18, h: 18 },
  'shape:ellipse': { w: 26, h: 16 },
  'shape:diamond': { w: 20, h: 20 },
  'shape:pentagon': { w: 20, h: 20 },
  'shape:hexagon': { w: 22, h: 20 },
  'shape:star': { w: 22, h: 22 },
  'shape:cross': { w: 18, h: 18 },
};

export function nodeHalf(node: NodeConfig): { w: number; h: number } {
  if (node.type === 'text' && typeof node.sublabel === 'string') {
    const lines = node.sublabel.split('\n').length;
    return { w: 50, h: 10 + lines * 7 };
  }
  return HALF[node.type] ?? HALF.custom!;
}

export interface BoundsRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Axis-aligned bounds rect (top-left origin) for a node. */
export function nodeBounds(node: NodeConfig): BoundsRect {
  const h = nodeHalf(node);
  return { x: node.x - h.w, y: node.y - h.h, w: h.w * 2, h: h.h * 2 };
}

/** Topmost node whose bounds contain the point (last drawn = on top), else null. */
export function hitTestNode(
  page: Page,
  x: number,
  y: number,
  pad = 4,
): string | null {
  for (let i = page.nodes.length - 1; i >= 0; i--) {
    const n = page.nodes[i]!;
    const h = nodeHalf(n);
    if (Math.abs(x - n.x) <= h.w + pad && Math.abs(y - n.y) <= h.h + pad) {
      return n.id;
    }
  }
  return null;
}

/** Ids of nodes whose center falls within the rectangle (any corner order). */
export function nodesInRect(
  page: Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): string[] {
  const xa = Math.min(x0, x1),
    xb = Math.max(x0, x1),
    ya = Math.min(y0, y1),
    yb = Math.max(y0, y1);
  return page.nodes
    .filter((n) => n.x >= xa && n.x <= xb && n.y >= ya && n.y <= yb)
    .map((n) => n.id);
}
