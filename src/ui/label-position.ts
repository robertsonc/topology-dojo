import {
  nodeLabelPos,
  type LabelPlacement,
} from '../render/label-placement.js';
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';

const NUDGE: Record<LabelPlacement, { x: number; y: number }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  w: { x: -1, y: 0 },
  e: { x: 1, y: 0 },
  sw: { x: -1, y: 1 },
  s: { x: 0, y: 1 },
  se: { x: 1, y: 1 },
};

export function nodeLabelNudge(
  node: NodeConfig,
  direction: LabelPlacement,
): Partial<NodeConfig> {
  const position = nodeLabelPos(node);
  const delta = NUDGE[direction];
  return {
    labelOffsetX: position.x - node.x + delta.x,
    labelOffset: position.y - node.y + delta.y,
    // Convert the legacy absolute baseline too, or it would override the nudge.
    labelY: undefined,
  };
}

export function linkLabelNudge(
  link: LinkConfig,
  direction: LabelPlacement,
): Partial<LinkConfig> {
  const position = link.labelOffset ?? { x: 0, y: 0 };
  const delta = NUDGE[direction];
  return {
    labelOffset: { x: position.x + delta.x, y: position.y + delta.y },
  };
}
