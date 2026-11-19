/**
 * The line the Link attachment section of a node opens with: what applies to
 * this node's link ends now, and where it comes from (the page, or the
 * node's own override). Read from `effectiveLinkAttach`, the same rule the
 * renderer uses, so the panel never says something the canvas does not do.
 */
import { effectiveLinkAttach } from '../../render/link-attach.js';
import type {
  LinkAttachOptions,
  NodeConfig,
} from '../../vendor/topology-ds.js';

/** Whether the node carries its own `linkAttach` (an override of the page). */
export function overridesLinkAttach(node: NodeConfig): boolean {
  return typeof node.linkAttach === 'object' && node.linkAttach !== null;
}

/** "From page: anchor box on, 6 px padding, ends distributed." and the like. */
export function linkAttachSummary(
  page: LinkAttachOptions | null | undefined,
  node: NodeConfig,
): string {
  const source = overridesLinkAttach(node) ? 'This node' : 'From page';
  const applied = effectiveLinkAttach(page, node);
  if (!applied) return `${source}: off. Links meet the icon edge.`;
  const pad = Number.isInteger(applied.pad)
    ? String(applied.pad)
    : String(Math.round(applied.pad * 100) / 100);
  const ends = applied.distribute ? 'ends distributed' : 'ends not distributed';
  return `${source}: anchor box on, ${pad} px padding, ${ends}.`;
}
