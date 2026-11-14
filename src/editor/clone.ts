/**
 * Pure element-cloning for copy / paste / duplicate.
 *
 * Clones a set of nodes and anchors (offset by dx/dy, fresh ids) and the links
 * whose two endpoints are both in that set, re-pointing them at the new ids.
 * Links to nodes/anchors outside the copied set are dropped — they have
 * nothing to reconnect to. DOM-free, so it's unit-testable on its own.
 */
import type {
  AnchorConfig,
  LinkConfig,
  NodeConfig,
} from '../vendor/topology-ds.js';

export interface CloneOptions {
  nextNodeId: () => string;
  nextLinkId: () => string;
  /** Required when anchors are cloned. */
  nextAnchorId?: () => string;
  dx: number;
  dy: number;
}

export function cloneElements(
  nodes: NodeConfig[],
  links: LinkConfig[],
  opts: CloneOptions,
  anchors: AnchorConfig[] = [],
): { nodes: NodeConfig[]; links: LinkConfig[]; anchors: AnchorConfig[] } {
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
  // Anchors are link endpoints like nodes are, so a link ending on a copied
  // anchor is internal to the copied set too.
  const outAnchors = anchors.map((a) => {
    if (!opts.nextAnchorId)
      throw new Error('cloneElements: nextAnchorId is required for anchors');
    const id = opts.nextAnchorId();
    idMap.set(a.id, id);
    return {
      ...structuredClone(a),
      id,
      x: Math.round(a.x + opts.dx),
      y: Math.round(a.y + opts.dy),
    };
  });
  const outLinks: LinkConfig[] = [];
  for (const l of links) {
    const from = idMap.get(l.from);
    const to = idMap.get(l.to);
    if (from === undefined || to === undefined) continue; // only internal links
    outLinks.push({ ...structuredClone(l), id: opts.nextLinkId(), from, to });
  }
  return { nodes: outNodes, links: outLinks, anchors: outAnchors };
}
