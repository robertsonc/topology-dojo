import { describe, it, expect } from 'vitest';
import { captureStencil, nodesCentre, stencilViewBox } from './stencil.js';
import { cloneElements } from './clone.js';
import type { NodeConfig, LinkConfig } from '../vendor/topology-ds.js';

const nodes: NodeConfig[] = [
  { id: 'a', type: 'ec', x: 100, y: 100 },
  { id: 'b', type: 'ec', x: 300, y: 200 },
];
const links: LinkConfig[] = [
  { id: 'l1', type: 'line', from: 'a', to: 'b' }, // internal
  { id: 'l2', type: 'line', from: 'a', to: 'outside' }, // boundary-crossing
];

describe('captureStencil', () => {
  it('re-centres node coordinates on the group bounding box', () => {
    const st = captureStencil('Branch', nodes, links);
    // bbox centre is (200,150); nodes become symmetric about (0,0).
    expect(st.nodes.map((n) => [n.x, n.y])).toEqual([
      [-100, -50],
      [100, 50],
    ]);
    expect(nodesCentre(st.nodes)).toEqual({ cx: 0, cy: 0 });
  });

  it('keeps only links internal to the selection', () => {
    const st = captureStencil('Branch', nodes, links);
    expect(st.links).toHaveLength(1);
    expect(st.links[0]!.id).toBe('l1');
  });

  it('does not mutate the source nodes (deep clone)', () => {
    captureStencil('Branch', nodes, links);
    expect(nodes[0]!.x).toBe(100); // original untouched
  });

  it('stamps back to a chosen centre via cloneElements with fresh ids', () => {
    const st = captureStencil('Branch', nodes, links);
    let n = 0;
    let l = 0;
    const out = cloneElements(st.nodes, st.links, {
      nextNodeId: () => `N${n++}`,
      nextLinkId: () => `L${l++}`,
      dx: 500,
      dy: 400,
    });
    // Centred stencil + offset (500,400) reproduces the original spread,
    // translated so the group centre lands on the drop point.
    expect(out.nodes.map((nd) => [nd.x, nd.y])).toEqual([
      [400, 350],
      [600, 450],
    ]);
    // Fresh ids, and the internal link is re-pointed at them.
    expect(out.nodes.map((nd) => nd.id)).toEqual(['N0', 'N1']);
    expect(out.links).toHaveLength(1);
    expect(out.links[0]!.from).toBe('N0');
    expect(out.links[0]!.to).toBe('N1');
  });
});

describe('stencilViewBox', () => {
  it('frames the centred nodes with padding', () => {
    const st = captureStencil('Branch', nodes, links);
    // nodes span x:[-100,100] y:[-50,50]; pad 60 → "-160 -110 320 220".
    expect(stencilViewBox(st.nodes)).toBe('-160 -110 320 220');
  });

  it('falls back to a default box when empty', () => {
    expect(stencilViewBox([])).toBe('0 0 110 84');
  });
});
