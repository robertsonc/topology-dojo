/**
 * Node geometry for editor interactions — hit-testing, bounds, link polylines.
 *
 * The pure node-AABB primitives (nodeHalf/nodeBounds) live in `api/geometry`
 * (DOM-free, shared with the layout analyzer); this module re-exports them and
 * adds the editor-facing hit-testing on top.
 */
import type { Page } from '../pages/model.js';
import { nodeHalf, nodeBounds, type BoundsRect } from '../api/geometry.js';

export { nodeHalf, nodeBounds, type BoundsRect };

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

/** Nearest anchor within `pad` user-units of the point (last drawn = on top), else null. */
export function hitTestAnchor(
  page: Page,
  x: number,
  y: number,
  pad = 8,
): string | null {
  for (let i = page.anchors.length - 1; i >= 0; i--) {
    const a = page.anchors[i]!;
    if (Math.abs(x - a.x) <= pad && Math.abs(y - a.y) <= pad) return a.id;
  }
  return null;
}

/** Resolve a node or anchor id to a position (null if unknown). */
export function resolvePos(
  page: Page,
  id: string,
): { x: number; y: number } | null {
  const n = page.nodes.find((m) => m.id === id);
  if (n) return { x: n.x, y: n.y };
  const a = page.anchors.find((m) => m.id === id);
  return a ? { x: a.x, y: a.y } : null;
}

/** The polyline a link follows: from endpoint, waypoints, to endpoint. */
export function linkPolyline(
  page: Page,
  link: { from: string; to: string; waypoints?: { x: number; y: number }[] },
): { x: number; y: number }[] {
  const a = resolvePos(page, link.from);
  const b = resolvePos(page, link.to);
  if (!a || !b) return [];
  return [a, ...(link.waypoints ?? []), b];
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx,
    cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Topmost link within `pad` user-units of the point (last drawn = on top), else null. */
export function hitTestLink(
  page: Page,
  x: number,
  y: number,
  pad = 7,
): string | null {
  for (let i = page.links.length - 1; i >= 0; i--) {
    const link = page.links[i]!;
    const pts = linkPolyline(page, link);
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s]!,
        b = pts[s + 1]!;
      if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= pad) return link.id;
    }
  }
  return null;
}
