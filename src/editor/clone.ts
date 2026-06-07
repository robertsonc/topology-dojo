/**
 * Pure element-cloning for copy / paste / duplicate.
 *
 * Clones a set of nodes (offset by dx/dy, fresh ids) and the links *internal* to
 * that set (both endpoints copied), re-pointing them at the new node ids. Links
 * to nodes/anchors outside the copied set are dropped — they have nothing to
 * reconnect to. DOM-free, so it's unit-testable on its own.
 */
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';

export interface CloneOptions {
  nextNodeId: () => string;
  nextLinkId: () => string;
  dx: number;
  dy: number;
}

export function cloneElements(
  nodes: NodeConfig[],
  links: LinkConfig[],
  opts: CloneOptions,
): { nodes: NodeConfig[]; links: LinkConfig[] } {
  const idMap = new Map<string, string>();
  const outNodes = nodes.map((n) => {
    const id = opts.nextNodeId();
    idMap.set(n.id, id);
    return {
      ...structuredClone(n),
      id,
      x: Math.round(n.x + opts.dx),
      y: Math.round(n.y + opts.dy),
    };
  });
  const outLinks: LinkConfig[] = [];
  for (const l of links) {
    const from = idMap.get(l.from);
    const to = idMap.get(l.to);
    if (from === undefined || to === undefined) continue; // only internal links
    outLinks.push({ ...structuredClone(l), id: opts.nextLinkId(), from, to });
  }
  return { nodes: outNodes, links: outLinks };
}
