/**
 * Node geometry for editor interactions — hit-testing, bounds, link polylines.
 *
 * The pure node-AABB primitives (nodeHalf/nodeBounds) live in `api/geometry`
 * (DOM-free, shared with the layout analyzer); this module re-exports them and
 * adds the editor-facing hit-testing on top.
 */
import type { Page } from '../pages/model.js';
import type { ZoneConfig } from '../vendor/topology-ds.js';
import { nodeHalf, nodeBounds, type BoundsRect } from '../api/geometry.js';
import { nodeLabelPos } from '../render/label-placement.js';

export { nodeHalf, nodeBounds, type BoundsRect };

/** Member node ids of a zone plus those of its descendant zones (cycle-safe). */
function zoneNodeIds(
  page: Page,
  zoneId: string,
  seen = new Set<string>(),
): string[] {
  if (seen.has(zoneId)) return [];
  seen.add(zoneId);
  const zones = page.zones ?? [];
  const zone = zones.find((z) => z.id === zoneId);
  if (!zone) return [];
  const ids = [...(zone.nodes ?? [])];
  for (const child of zones)
    if (child.parentZone === zoneId)
      ids.push(...zoneNodeIds(page, child.id, seen));
  return ids;
}

/**
 * Bounding box of a zone region, matching the engine's `_renderZoneRect`
 * geometry: each member node — including those of descendant zones — adds a
 * ±40×±30 box, and the whole is expanded by the zone's padding (default 40).
 * Returns null when the zone has no present members (nothing to frame).
 */
export function zoneBounds(page: Page, zone: ZoneConfig): BoundsRect | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const nId of zoneNodeIds(page, zone.id)) {
    const n = page.nodes.find((m) => m.id === nId);
    if (!n) continue;
    minX = Math.min(minX, n.x - 40);
    minY = Math.min(minY, n.y - 30);
    maxX = Math.max(maxX, n.x + 40);
    maxY = Math.max(maxY, n.y + 30);
  }
  if (!Number.isFinite(minX)) return null;
  const pad = zone.padding ?? 40;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

/**
 * The smallest zone whose region contains the point, else null. Smallest-area
 * wins so a click inside a nested/overlapping zone lands on the most specific
 * one. (Callers test nodes/anchors/links first, so a click only reaches a zone
 * on the region's empty space.)
 */
export function hitTestZone(page: Page, x: number, y: number): string | null {
  let best: string | null = null;
  let bestArea = Infinity;
  for (const z of page.zones ?? []) {
    const b = zoneBounds(page, z);
    if (!b) continue;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      const area = b.w * b.h;
      if (area < bestArea) {
        bestArea = area;
        best = z.id;
      }
    }
  }
  return best;
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

/** Node types whose label is drawn inside the glyph (or is the glyph). */
const OWN_LABEL = new Set([
  'cloud',
  'idcard',
  'overlayCloud',
  'text',
  'callout',
]);

/**
 * Topmost node whose rendered caption (the label/sublabel drawn beside the
 * glyph — below it by default) contains the point, else null. Lets a click on
 * a node's name select the node instead of falling through to a link or the
 * zone behind it. Box sizes are estimates (≈6 units per glyph, 11 tall).
 */
export function hitTestNodeLabel(
  page: Page,
  x: number,
  y: number,
  pad = 3,
): string | null {
  for (let i = page.nodes.length - 1; i >= 0; i--) {
    const n = page.nodes[i]!;
    if (OWN_LABEL.has(n.type) || n.type.startsWith('shape:')) continue;
    const label = typeof n.label === 'string' ? n.label : '';
    if (!label) continue;
    const sub = typeof n.sublabel === 'string' ? n.sublabel : '';
    const lp = nodeLabelPos(n);
    const w = Math.max(label.length * 6, sub.length * 5);
    const x0 =
      lp.anchor === 'start'
        ? lp.x
        : lp.anchor === 'end'
          ? lp.x - w
          : lp.x - w / 2;
    const y0 = lp.y - 11;
    const y1 = lp.y + (sub ? 16 : 4);
    if (x >= x0 - pad && x <= x0 + w + pad && y >= y0 - pad && y <= y1 + pad)
      return n.id;
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

/** A link's drawn geometry: one or more polylines in page coordinates. */
export type LinkShape = { x: number; y: number }[][];

/** Distance from a point to the nearest segment of any of the polylines. */
export function distToShape(x: number, y: number, shape: LinkShape): number {
  let best = Infinity;
  for (const pts of shape) {
    if (pts.length === 1)
      best = Math.min(best, Math.hypot(x - pts[0]!.x, y - pts[0]!.y));
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s]!,
        b = pts[s + 1]!;
      best = Math.min(best, distToSegment(x, y, a.x, a.y, b.x, b.y));
    }
  }
  return best;
}

/**
 * The link nearest the point within `pad` user-units, else null (ties go to
 * the topmost — last drawn). `shapeOf` supplies a link's rendered geometry
 * (orthogonal routes, curves, parallel fan-out…) when the caller has it, so a
 * link is picked where it is actually drawn; without it the from → waypoints →
 * to polyline is used.
 */
export function hitTestLink(
  page: Page,
  x: number,
  y: number,
  pad = 7,
  shapeOf?: (id: string) => LinkShape | undefined,
): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (let i = page.links.length - 1; i >= 0; i--) {
    const link = page.links[i]!;
    const shape = shapeOf?.(link.id) ?? [linkPolyline(page, link)];
    const d = distToShape(x, y, shape);
    if (d <= pad && d < bestD) {
      bestD = d;
      best = link.id;
    }
  }
  return best;
}
