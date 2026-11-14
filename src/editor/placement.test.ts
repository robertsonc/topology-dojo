/**
 * Where new elements land when the user did not point at a spot: a palette
 * click and a stencil stamp go to the middle of the view, and step aside
 * while something is already there.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';
import { hitTestNode, nodeBounds } from './geometry.js';
import { blankPage, harness, installEditorGlobals } from './test-harness.js';

beforeAll(installEditorGlobals);

/** True when two nodes' glyph boxes overlap. */
function overlap(a: NodeConfig, b: NodeConfig): boolean {
  const ra = nodeBounds(a);
  const rb = nodeBounds(b);
  return (
    ra.x < rb.x + rb.w &&
    rb.x < ra.x + ra.w &&
    ra.y < rb.y + rb.h &&
    rb.y < ra.y + ra.h
  );
}

describe('palette adds fan out instead of stacking (CAN-06)', () => {
  it('the first add lands on the centre of the view, on the grid', () => {
    const h = harness(blankPage());
    h.editor.addNode('router');
    expect(h.editor.page.nodes[0]).toMatchObject({ x: 500, y: 360 });
  });

  it('three clicks give three nodes that do not cover each other', () => {
    const h = harness(blankPage());
    h.editor.addNode('router');
    h.editor.addNode('router');
    h.editor.addNode('ec');
    const nodes = h.editor.page.nodes;
    expect(nodes).toHaveLength(3);
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++)
        expect(overlap(nodes[i]!, nodes[j]!), `${i} over ${j}`).toBe(false);
    // The second goes down and to the right of the first; all stay on the
    // grid.
    expect(nodes[1]!.x).toBeGreaterThan(nodes[0]!.x);
    expect(nodes[1]!.y).toBeGreaterThan(nodes[0]!.y);
    for (const n of nodes) expect([n.x % 20, n.y % 20]).toEqual([0, 0]);
    // The last one added is the selection, ready to drag.
    expect(h.editor.getSelectedNode()?.id).toBe(nodes[2]!.id);
  });

  it('many adds gather around the middle of the view instead of leaving it', () => {
    const h = harness(blankPage());
    for (let i = 0; i < 9; i++) h.editor.addNode('router');
    const nodes = h.editor.page.nodes;
    for (let i = 0; i < nodes.length; i++) {
      // Nine nodes fit in the first ring around the centre (500, 350).
      expect(Math.abs(nodes[i]!.x - 500)).toBeLessThanOrEqual(90);
      expect(Math.abs(nodes[i]!.y - 350)).toBeLessThanOrEqual(90);
      for (let j = i + 1; j < nodes.length; j++)
        expect(overlap(nodes[i]!, nodes[j]!), `${i} over ${j}`).toBe(false);
    }
  });

  it('a spot freed by moving the node away is used again', () => {
    const h = harness(blankPage());
    h.editor.addNode('router');
    h.editor.nudge(-300, -200);
    h.editor.addNode('router');
    expect(h.editor.page.nodes[1]).toMatchObject({ x: 500, y: 360 });
  });

  it('an add at an explicit point stays exactly there', () => {
    // Quick-add places the node where the user double-clicked.
    const h = harness(blankPage());
    h.editor.addNode('router', undefined, { x: 500, y: 360 });
    h.editor.addNode('router', undefined, { x: 500, y: 360 });
    expect(h.editor.page.nodes.map((n) => [n.x, n.y])).toEqual([
      [500, 360],
      [500, 360],
    ]);
  });

  it('a node on a hidden layer is not in the way', () => {
    const page = blankPage();
    page.nodes.push({
      id: 'hidden',
      type: 'router',
      x: 500,
      y: 360,
      label: 'Hidden',
      layer: 'underlay',
    });
    const h = harness(page);
    h.editor.setRenderOpts(() => ({
      layers: [{ id: 'underlay', defaultVisible: false }],
    }));
    h.editor.addNode('router');
    expect(h.editor.page.nodes[1]).toMatchObject({ x: 500, y: 360 });
  });

  it('stays one undo step', () => {
    const h = harness(blankPage());
    h.editor.addNode('router');
    h.editor.addNode('router');
    expect(h.editor.historyDepth()).toBe(2);
    h.editor.undo();
    expect(h.editor.page.nodes).toHaveLength(1);
  });
});

describe('repeated stencil stamps do not pile up (CAN-06)', () => {
  const stencilNodes = (): NodeConfig[] => [
    { id: 's1', type: 'router', x: -60, y: 0, label: 'S1' },
    { id: 's2', type: 'router', x: 60, y: 0, label: 'S2' },
  ];
  const stencilLinks = (): LinkConfig[] => [
    { id: 'sl', type: 'line', from: 's1', to: 's2' },
  ];

  it('the first stamp is centred on the view', () => {
    const h = harness(blankPage());
    h.editor.stampStencil(stencilNodes(), stencilLinks());
    expect(h.editor.page.nodes.map((n) => [n.x, n.y])).toEqual([
      [440, 360],
      [560, 360],
    ]);
  });

  it('a second stamp steps aside as a block and keeps its shape', () => {
    const h = harness(blankPage());
    h.editor.stampStencil(stencilNodes(), stencilLinks());
    h.editor.stampStencil(stencilNodes(), stencilLinks());
    const [a1, a2, b1, b2] = h.editor.page.nodes as [
      NodeConfig,
      NodeConfig,
      NodeConfig,
      NodeConfig,
    ];
    // No stamped node lands on a node that was already there.
    for (const fresh of [b1, b2])
      for (const old of [a1, a2]) expect(overlap(fresh, old)).toBe(false);
    // The block moved as one: same spacing as the stencil.
    expect([b2.x - b1.x, b2.y - b1.y]).toEqual([120, 0]);
    expect(b1.x).toBeGreaterThan(a1.x);
    expect(b1.y).toBeGreaterThan(a1.y);
    expect(h.editor.page.links).toHaveLength(2);
    // And the new block is clear to grab: nothing else under its nodes.
    expect(hitTestNode(h.editor.page, b1.x, b1.y, 0)).toBe(b1.id);
  });
});
