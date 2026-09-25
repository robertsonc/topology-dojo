import { describe, expect, it } from 'vitest';
import {
  nodeLabelPos,
  type LabelPlacement,
} from '../render/label-placement.js';
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';
import { nodeLabelNudge, linkLabelNudge } from './label-position.js';

const directions: [LabelPlacement, number, number][] = [
  ['nw', -1, -1],
  ['n', 0, -1],
  ['ne', 1, -1],
  ['w', -1, 0],
  ['e', 1, 0],
  ['sw', -1, 1],
  ['s', 0, 1],
  ['se', 1, 1],
];

const node: NodeConfig = {
  id: 'a',
  type: 'ec',
  x: 100,
  y: 200,
  label: 'Router',
};
const link: LinkConfig = { id: 'ab', type: 'line', from: 'a', to: 'b' };

const nodes: NodeConfig[] = [
  node,
  { ...node, labelPlacement: 'ne', sublabel: 'Branch' },
  { ...node, labelPlacement: 'w', labelOffsetX: 0, labelOffset: -12.5 },
  { ...node, labelPlacement: 'e', labelOffset: 0 },
  { ...node, type: 'image', imageW: 160, imageH: 120 },
  { ...node, type: 'custom:ap', labelPlacement: 'nw' },
  { ...node, labelY: 280 },
];

describe('node label nudging', () => {
  it.each(directions)(
    'moves %s by one unit from the current baseline',
    (code, dx, dy) => {
      for (const original of nodes) {
        const before = nodeLabelPos(original);
        const patch = nodeLabelNudge(original, code);
        const after = nodeLabelPos({ ...original, ...patch });
        expect(after).toEqual({
          x: before.x + dx,
          y: before.y + dy,
          anchor: before.anchor,
        });
        expect(patch).not.toHaveProperty('labelPlacement');
        expect(patch).not.toHaveProperty('x');
        expect(patch).not.toHaveProperty('y');
      }
    },
  );

  it('accumulates repeated nudges without mutating the source', () => {
    const original = structuredClone(node);
    const once = { ...node, ...nodeLabelNudge(node, 'ne') };
    const twice = { ...once, ...nodeLabelNudge(once, 'ne') };
    expect(twice).toMatchObject({ labelOffsetX: 2, labelOffset: 22 });
    expect(node).toEqual(original);
  });
});

describe('link label nudging', () => {
  it.each(directions)(
    'moves %s relative to auto or a custom offset',
    (code, dx, dy) => {
      expect(linkLabelNudge(link, code)).toEqual({
        labelOffset: { x: dx, y: dy },
      });
      const original = { ...link, labelOffset: { x: -17.5, y: 9 } };
      expect(linkLabelNudge(original, code)).toEqual({
        labelOffset: { x: -17.5 + dx, y: 9 + dy },
      });
      expect(original.labelOffset).toEqual({ x: -17.5, y: 9 });
    },
  );

  it('accumulates repeated nudges', () => {
    const once = { ...link, ...linkLabelNudge(link, 'sw') };
    expect(linkLabelNudge(once, 'sw')).toEqual({
      labelOffset: { x: -2, y: 2 },
    });
  });
});
