/**
 * Link commands that act on the link selection: swap endpoints, paste format.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Page, TopologyDocument } from '../pages/model.js';
import type { LinkConfig } from '../vendor/topology-ds.js';
import { applyOperations, diffDocuments } from '../workspace/operations.js';
import { blankPage, harness, installEditorGlobals } from './test-harness.js';

beforeAll(installEditorGlobals);

function page3(): Page {
  const page = blankPage();
  page.nodes.push(
    { id: 'a', type: 'ec', x: 100, y: 100, label: 'A' },
    { id: 'b', type: 'ec', x: 500, y: 100, label: 'B' },
    { id: 'c', type: 'ec', x: 300, y: 400, label: 'C' },
  );
  page.links.push(
    { id: 'ab', type: 'line', from: 'a', to: 'b' },
    { id: 'bc', type: 'line', from: 'b', to: 'c' },
    { id: 'ca', type: 'line', from: 'c', to: 'a' },
  );
  return page;
}

const wrap = (page: Page): TopologyDocument => ({
  title: 'T',
  customNodes: [],
  pages: [structuredClone(page)],
});

describe('swap endpoints keeps each end’s data with its device (LNK-12)', () => {
  const full = (): LinkConfig => ({
    id: 'ab',
    type: 'line',
    from: 'a',
    to: 'b',
    label: 'core',
    fromLabel: 'A-side Gi0/1',
    toLabel: 'B-side Gi0/2',
    fromInterface: 'ge-0/0/1',
    toInterface: 'xe-0/0/2',
    fromOptic: '1000BASE-T',
    toOptic: '10GBASE-SR',
    fromPort: 'e',
    toPort: 'w',
    fromPortOffset: 0.5,
    toPortOffset: -0.25,
    fromLabelOffset: { x: 4, y: -12 },
    toLabelOffset: { x: -6, y: 9 },
    fromBundle: 'ae0',
    toBundle: 'ae7',
    waypoints: [
      { x: 200, y: 60 },
      { x: 400, y: 140 },
    ],
  });

  it('swaps every from*/to* pair and reverses the bends', () => {
    const page = page3();
    page.links[0] = full();
    const h = harness(page);
    h.editor.focusLink('ab');
    h.editor.swapLink();
    expect(page.links[0]).toEqual({
      id: 'ab',
      type: 'line',
      from: 'b',
      to: 'a',
      label: 'core',
      fromLabel: 'B-side Gi0/2',
      toLabel: 'A-side Gi0/1',
      fromInterface: 'xe-0/0/2',
      toInterface: 'ge-0/0/1',
      fromOptic: '10GBASE-SR',
      toOptic: '1000BASE-T',
      fromPort: 'w',
      toPort: 'e',
      fromPortOffset: -0.25,
      toPortOffset: 0.5,
      fromLabelOffset: { x: -6, y: 9 },
      toLabelOffset: { x: 4, y: -12 },
      fromBundle: 'ae7',
      toBundle: 'ae0',
      waypoints: [
        { x: 400, y: 140 },
        { x: 200, y: 60 },
      ],
    });
  });

  it('a value set on one end only moves to the other end', () => {
    const page = page3();
    Object.assign(page.links[0]!, { fromLabel: 'Gi0/1', toPort: 'n' });
    const h = harness(page);
    h.editor.focusLink('ab');
    h.editor.swapLink();
    const link = page.links[0]!;
    expect(link).toMatchObject({ from: 'b', to: 'a', toLabel: 'Gi0/1' });
    expect(link.fromPort).toBe('n');
    expect('fromLabel' in link).toBe(false);
    expect('toPort' in link).toBe(false);
  });

  it('carries a pair it has never heard of, and leaves look-alike keys alone', () => {
    const page = page3();
    Object.assign(page.links[0]!, {
      fromVrf: 'red',
      toVrf: 'blue',
      // Not end data: these only start with the letters "to" / "from".
      tooltip: 'hover text',
      topology: 'ring',
      fromage: 'brie',
    });
    const h = harness(page);
    h.editor.focusLink('ab');
    h.editor.swapLink();
    expect(page.links[0]).toMatchObject({
      fromVrf: 'blue',
      toVrf: 'red',
      tooltip: 'hover text',
      topology: 'ring',
      fromage: 'brie',
    });
  });

  it('swapping twice restores the link exactly, and undo reverts one swap', () => {
    const page = page3();
    page.links[0] = full();
    const before = structuredClone(page.links[0]);
    const h = harness(page);
    h.editor.focusLink('ab');
    h.editor.swapLink();
    h.editor.swapLink();
    expect(page.links[0]).toEqual(before);
    h.editor.undo();
    expect(h.editor.page.links[0]!.from).toBe('b');
    h.editor.undo();
    expect(h.editor.page.links[0]).toEqual(before);
  });

  it('emits a patch that reproduces the snapshot diff', () => {
    for (const extra of [
      {},
      { fromLabel: 'Gi0/1', toPort: 'n' },
      full(),
    ] as Partial<LinkConfig>[]) {
      const page = page3();
      Object.assign(page.links[0]!, extra);
      const h = harness(page);
      h.editor.focusLink('ab');
      h.editor.takePendingOperations();
      const before = wrap(h.editor.page);
      h.editor.swapLink();
      const after = wrap(h.editor.page);
      const emitted = h.editor.takePendingOperations();
      expect(emitted).toHaveLength(1);
      expect(applyOperations(before, emitted)).toEqual(
        applyOperations(before, diffDocuments(before, after)),
      );
      expect(applyOperations(before, emitted)).toEqual(after);
    }
  });
});

describe('paste format restyles every selected link (LNK-17)', () => {
  const STYLE = {
    type: 'tunnel',
    color: '#01a982',
    dashed: true,
    strokeWidth: 3,
  };

  /** ab carries the style; bc and ca are selected together (bc primary). */
  function styledAndSelected() {
    const page = page3();
    Object.assign(page.links[0]!, STYLE);
    const h = harness(page);
    h.editor.focusLink('ab');
    h.editor.copyFormat();
    h.click(400, 250); // on bc: b (500,100) → c (300,400)
    h.click(200, 250, { ctrlKey: true }); // + ca: c (300,400) → a (100,100)
    expect(h.editor.selectedLinkIds()).toEqual(['bc', 'ca']);
    return { h, page };
  }

  it('brushes the copied style onto all of them, as one undo step', () => {
    const { h, page } = styledAndSelected();
    expect(h.editor.canPasteFormat()).toBe(true);
    h.editor.pasteFormat();
    expect(page.links[1]).toMatchObject({ ...STYLE, from: 'b', to: 'c' });
    expect(page.links[2]).toMatchObject({ ...STYLE, from: 'c', to: 'a' });
    expect(h.editor.selectedLinkIds()).toEqual(['bc', 'ca']);
    h.editor.undo();
    expect(h.editor.page.links[1]).toEqual({
      id: 'bc',
      type: 'line',
      from: 'b',
      to: 'c',
    });
    expect(h.editor.page.links[2]!.type).toBe('line');
  });

  it('emits one patch per restyled link, reproducing the snapshot diff', () => {
    const { h } = styledAndSelected();
    h.editor.takePendingOperations();
    const before = wrap(h.editor.page);
    h.editor.pasteFormat();
    const after = wrap(h.editor.page);
    const emitted = h.editor.takePendingOperations();
    expect(emitted.map((op) => op.type)).toEqual([
      'element.patch',
      'element.patch',
    ]);
    expect(applyOperations(before, emitted)).toEqual(
      applyOperations(before, diffDocuments(before, after)),
    );
  });

  it('a node style still goes onto every selected node', () => {
    const page = page3();
    page.nodes[0]!.color = '#7764fc';
    const h = harness(page);
    h.editor.focusNode('a');
    h.editor.copyFormat();
    h.click(500, 100);
    h.click(300, 400, { shiftKey: true });
    h.editor.pasteFormat();
    expect(page.nodes.map((n) => n.color)).toEqual([
      '#7764fc',
      '#7764fc',
      '#7764fc',
    ]);
  });
});
