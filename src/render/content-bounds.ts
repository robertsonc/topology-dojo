/**
 * Everything a page draws, as one bounding box — and the frame an export
 * needs to show all of it.
 *
 * A page's `viewBox` is its frame: exports render exactly that rectangle. A
 * frame fitted to node positions alone crops whatever extends past the
 * outermost nodes: zone boxes (padded, and nested ones padded again), and
 * labels placed outside a node. So "fit to content" measures with this, and
 * exports widen the frame when drawn content still pokes out of it.
 */
import type { Page } from '../pages/model.js';
import { nodeBounds, type BoundsRect } from '../api/geometry.js';
import { nodeLabelRect } from './label-placement.js';
import { zoneBox } from './zone-box.js';

/** Bounds of all drawn content (nodes, their labels, anchors, zone boxes),
 * or null for an empty page. */
export function pageContentBounds(page: Page): BoundsRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (r: BoundsRect | null): void => {
    if (!r) return;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  };
  for (const node of page.nodes) {
    add(nodeBounds(node));
    add(nodeLabelRect(node));
  }
  for (const anchor of page.anchors) {
    add({ x: anchor.x - 4, y: anchor.y - 4, w: 8, h: 8 });
  }
  for (const zone of page.zones ?? []) add(zoneBox(page, zone));
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * The page as an export should frame it: unchanged when its content sits
 * inside the viewBox, otherwise a copy whose viewBox is widened (never
 * narrowed) to include the content plus `margin`. A deliberate frame larger
 * than the content is kept as drawn.
 */
export function pageFramedForExport(page: Page, margin = 24): Page {
  const content = pageContentBounds(page);
  const parts = page.viewBox.trim().split(/\s+/).map(Number);
  if (!content || parts.length !== 4 || parts.some((n) => !Number.isFinite(n)))
    return page;
  const [vx, vy, vw, vh] = parts as [number, number, number, number];
  const x0 = Math.min(vx, Math.floor(content.x - margin));
  const y0 = Math.min(vy, Math.floor(content.y - margin));
  const x1 = Math.max(vx + vw, Math.ceil(content.x + content.w + margin));
  const y1 = Math.max(vy + vh, Math.ceil(content.y + content.h + margin));
  if (x0 === vx && y0 === vy && x1 === vx + vw && y1 === vy + vh) return page;
  return { ...page, viewBox: `${x0} ${y0} ${x1 - x0} ${y1 - y0}` };
}
