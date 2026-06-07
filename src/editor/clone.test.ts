import { describe, it, expect } from 'vitest';
import { cloneElements } from './clone.js';
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';

describe('cloneElements (copy / paste / duplicate)', () => {
  const nodes: NodeConfig[] = [
    { id: 'a', type: 'ec', x: 100, y: 100, label: 'A' },
    { id: 'b', type: 'cloud', x: 300, y: 100 },
  ];
  const links: LinkConfig[] = [
    { id: 'internal', type: 'line', from: 'a', to: 'b' },
    { id: 'external', type: 'line', from: 'a', to: 'z' }, // z not copied
  ];

  it('clones nodes with fresh ids + offset and remaps internal links', () => {
    let n = 0;
    let l = 0;
    const out = cloneElements(nodes, links, {
      nextNodeId: () => `N${n++}`,
      nextLinkId: () => `L${l++}`,
      dx: 24,
      dy: 24,
    });
    expect(out.nodes.map((x) => x.id)).toEqual(['N0', 'N1']);
    expect(out.nodes[0]).toMatchObject({ x: 124, y: 124, label: 'A' });
    // internal link kept + re-pointed to the new ids; external link dropped
    expect(out.links).toHaveLength(1);
    expect(out.links[0]).toMatchObject({ id: 'L0', from: 'N0', to: 'N1' });
  });

  it('is a deep copy — mutating output does not touch the source', () => {
    const out = cloneElements(nodes, [], {
      nextNodeId: () => 'X',
      nextLinkId: () => 'Y',
      dx: 0,
      dy: 0,
    });
    out.nodes[0]!.label = 'changed';
    expect(nodes[0]!.label).toBe('A');
  });
});
