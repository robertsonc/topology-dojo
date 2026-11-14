import { describe, it, expect } from 'vitest';
import {
  captureStencil,
  nodesCentre,
  stampableLinks,
  stencilViewBox,
} from './stencil.js';
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

describe('stencil bends', () => {
  const bent: LinkConfig[] = [
    {
      id: 'l1',
      type: 'line',
      from: 'a',
      to: 'b',
      waypoints: [{ x: 200, y: 120 }],
    },
  ];

  it('stores bends relative to the group centre and stamps them with the nodes', () => {
    // Nodes at (100,100) and (300,200): centre (200,150).
    const st = captureStencil('S', nodes, bent);
    expect(st.links[0]!.waypoints).toEqual([{ x: 0, y: -30 }]);
    const stamped = cloneElements(
      st.nodes,
      stampableLinks(st.nodes, st.links),
      {
        nextNodeId: (() => {
          let i = 0;
          return () => `n${i++}`;
        })(),
        nextLinkId: () => 'l',
        dx: 1000,
        dy: 500,
      },
    );
    // The bend keeps its place between the stamped nodes.
    expect(stamped.nodes.map((n) => [n.x, n.y])).toEqual([
      [900, 450],
      [1100, 550],
    ]);
    expect(stamped.links[0]!.waypoints).toEqual([{ x: 1000, y: 470 }]);
  });

  it('stamps a link straight when its saved bends are in old page coordinates', () => {
    // A stencil saved before bends were centred: nodes centred on (0,0), the
    // bend still at its original page position far away.
    const legacyNodes: NodeConfig[] = [
      { id: 'a', type: 'ec', x: -100, y: -50 },
      { id: 'b', type: 'ec', x: 100, y: 50 },
    ];
    const legacy: LinkConfig[] = [
      {
        id: 'l1',
        type: 'line',
        from: 'a',
        to: 'b',
        waypoints: [{ x: 2400, y: 1300 }],
      },
      {
        id: 'l2',
        type: 'line',
        from: 'a',
        to: 'b',
        waypoints: [{ x: 0, y: 40 }],
      },
    ];
    const out = stampableLinks(legacyNodes, legacy);
    expect(out[0]).not.toHaveProperty('waypoints');
    expect(out[0]).toMatchObject({ id: 'l1', from: 'a', to: 'b' });
    expect(out[1]!.waypoints).toEqual([{ x: 0, y: 40 }]); // a centred one stays
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
