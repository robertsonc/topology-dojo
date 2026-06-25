/**
 * Pure capture/geometry helpers for reusable named groups (stencils, C.3).
 *
 * A stencil is a selection of nodes plus the links internal to them, saved as a
 * sub-assembly that can be re-stamped from the palette. Capture normalizes node
 * coordinates so the group's bounding-box centre sits at (0,0); stamping then
 * offsets by the drop point, so a stencil drops centred wherever it's placed.
 * Re-pointing fresh ids on stamp is handled by `cloneElements` (editor/clone).
 * DOM-free, so it's unit-testable on its own.
 */
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';
import type { Stencil } from '../pages/model.js';

/** Bounding-box centre of a set of nodes (defaults to origin when empty). */
export function nodesCentre(nodes: NodeConfig[]): { cx: number; cy: number } {
  if (nodes.length === 0) return { cx: 0, cy: 0 };
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  return {
    cx: (Math.min(...xs) + Math.max(...xs)) / 2,
    cy: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

/**
 * Capture a selection into a stencil body (id assigned by the caller). Node
 * coordinates are re-centred on the group's bounding box; only links with both
 * endpoints in the selection are kept (boundary-crossing links have nothing to
 * reconnect to — the same rule copy/paste and duplicate use).
 */
export function captureStencil(
  name: string,
  srcNodes: NodeConfig[],
  srcLinks: LinkConfig[],
): Omit<Stencil, 'id'> {
  const ids = new Set(srcNodes.map((n) => n.id));
  const { cx, cy } = nodesCentre(srcNodes);
  const nodes = srcNodes.map((n) => ({
    ...structuredClone(n),
    x: Math.round(n.x - cx),
    y: Math.round(n.y - cy),
  }));
  const links = srcLinks
    .filter((l) => ids.has(l.from) && ids.has(l.to))
    .map((l) => structuredClone(l));
  return { name, nodes, links };
}

/**
 * A padded viewBox string framing a stencil's (centred) nodes — for palette
 * thumbnails. Pads beyond the node centres to leave room for node art + labels.
 */
export function stencilViewBox(nodes: NodeConfig[], pad = 60): string {
  if (nodes.length === 0) return '0 0 110 84';
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
  return `${minX} ${minY} ${w} ${h}`;
}
