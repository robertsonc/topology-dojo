/**
 * Copy, cut, paste and duplicate: where the copies land and what they carry.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Page, TopologyDocument } from '../pages/model.js';
import { applyOperations, diffDocuments } from '../workspace/operations.js';
import {
  blankPage,
  harness,
  installEditorGlobals,
  type Harness,
} from './test-harness.js';

beforeAll(installEditorGlobals);

function twoNodes(id = 'p1'): Page {
  const page = blankPage(id);
  page.nodes.push(
    { id: 'a', type: 'ec', x: 100, y: 100, label: 'A' },
    { id: 'b', type: 'ec', x: 300, y: 100, label: 'B' },
  );
  page.links.push({ id: 'ab', type: 'line', from: 'a', to: 'b' });
  return page;
}

/** Where the copies of node `label` sit, oldest first (the original excluded). */
const copiesOf = (h: Harness, label: string): [number, number][] =>
  h.editor.page.nodes
    .filter((n) => n.label === label)
    .slice(1)
    .map((n) => [n.x, n.y]);

describe('repeated paste steps away from the last copy (LNK-16 / CAN-07)', () => {
  it('each paste of the same clipboard lands one step further', () => {
    const h = harness(twoNodes());
    h.editor.selectAll();
    h.editor.copySelection();
    h.editor.paste();
    h.editor.paste();
    h.editor.paste();
    expect(copiesOf(h, 'A')).toEqual([
      [124, 124],
      [148, 148],
      [172, 172],
    ]);
    // The link between the two nodes came along each time.
    expect(h.editor.page.links).toHaveLength(4);
  });

  it('a fresh copy of the same node still steps past the earlier copies', () => {
    const h = harness(twoNodes());
    h.editor.selectAll();
    h.editor.copySelection();
    h.editor.paste();
    h.editor.paste();
    h.editor.focusNode('a');
    h.editor.copySelection();
    h.editor.paste();
    expect(copiesOf(h, 'A').at(-1)).toEqual([172, 172]);
  });

  it('once a copy has been moved away, its spot is free again', () => {
    const h = harness(twoNodes());
    h.editor.selectAll();
    h.editor.copySelection();
    h.editor.paste();
    h.editor.nudge(300, 200); // the pasted copies are selected
    h.editor.paste();
    expect(copiesOf(h, 'A')).toEqual([
      [424, 324],
      [124, 124],
    ]);
  });

  it('a paste onto another page starts at one step again', () => {
    const p1 = twoNodes('p1');
    const p2 = blankPage('p2');
    const h = harness(p1);
    h.editor.selectAll();
    h.editor.copySelection();
    h.editor.paste();
    h.editor.paste();
    h.editor.setPage(p2);
    h.editor.paste();
    h.editor.paste();
    expect(
      p2.nodes.filter((n) => n.label === 'A').map((n) => [n.x, n.y]),
    ).toEqual([
      [124, 124],
      [148, 148],
    ]);
  });

  it('undoing a paste lets the next paste reuse its spot', () => {
    const h = harness(twoNodes());
    h.editor.selectAll();
    h.editor.copySelection();
    h.editor.paste();
    h.editor.paste();
    h.editor.undo();
    h.editor.paste();
    expect(copiesOf(h, 'A')).toEqual([
      [124, 124],
      [148, 148],
    ]);
  });

  it('duplicate still cascades from the copies it just made', () => {
    const h = harness(twoNodes());
    h.editor.selectAll();
    h.editor.duplicateSelection();
    h.editor.duplicateSelection();
    h.editor.duplicateSelection();
    expect(copiesOf(h, 'A')).toEqual([
      [124, 124],
      [148, 148],
      [172, 172],
    ]);
  });
});
/* ── anchors travel with the block ───────────────────────────────────────── */

function anchoredPage(): Page {
  const page = twoNodes();
  page.nodes.push({ id: 'c', type: 'ec', x: 200, y: 300, label: 'C' });
  page.anchors.push({ id: 'an1', x: 200, y: 420 });
  page.links.push(
    { id: 'bc', type: 'line', from: 'b', to: 'c' },
    { id: 'c-an', type: 'line', from: 'c', to: 'an1' },
  );
  return page;
}

/** Select by marquee, as a user does: nodes and anchors inside the rect. */
function marquee(
  h: Harness,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  h.drag(from, to);
}

const ids = (h: Harness) => ({
  nodes: h.editor.page.nodes.map((n) => n.id),
  anchors: h.editor.page.anchors.map((a) => a.id),
  links: h.editor.page.links.map((l) => `${l.from}>${l.to}`),
});

describe('copy / cut / paste / duplicate carry anchors (CODE-07)', () => {
  it('cut then paste brings back a selected anchor and the link ending on it', () => {
    const h = harness(anchoredPage());
    marquee(h, { x: 140, y: 250 }, { x: 260, y: 460 }); // node c + anchor an1
    expect(h.editor.selectionCount()).toBe(2);
    h.editor.cut();
    expect(ids(h)).toEqual({
      nodes: ['a', 'b'],
      anchors: [],
      links: ['a>b'],
    });
    h.editor.paste();
    const page = h.editor.page;
    expect(page.nodes).toHaveLength(3);
    expect(page.anchors).toHaveLength(1);
    const node = page.nodes[2]!;
    const anchor = page.anchors[0]!;
    expect(node).toMatchObject({ label: 'C', x: 224, y: 324 });
    expect(anchor).toMatchObject({ x: 224, y: 444 });
    expect(anchor.id).not.toBe('an1');
    expect(page.links.at(-1)).toMatchObject({ from: node.id, to: anchor.id });
  });

  it('copying a node brings the anchor its link ends on, selected or not', () => {
    const h = harness(anchoredPage());
    h.editor.focusNode('c');
    h.editor.copySelection();
    h.editor.paste();
    const page = h.editor.page;
    expect(page.anchors.map((a) => [a.x, a.y])).toEqual([
      [200, 420],
      [224, 444],
    ]);
    expect(page.links.at(-1)).toMatchObject({
      from: page.nodes.at(-1)!.id,
      to: page.anchors.at(-1)!.id,
    });
    // The link to node b is not carried: b was not copied.
    expect(page.links).toHaveLength(4);
  });

  it('cutting a node takes the anchor only that node’s link used', () => {
    const h = harness(anchoredPage());
    h.editor.focusNode('c');
    h.editor.cut();
    // The anchor would be left with no link at all: it goes with the cut.
    expect(ids(h)).toEqual({ nodes: ['a', 'b'], anchors: [], links: ['a>b'] });
    h.editor.paste();
    expect(h.editor.page.anchors).toHaveLength(1);
    expect(h.editor.page.links).toHaveLength(2);
  });

  it('cutting a node leaves an anchor other links still use', () => {
    const page = anchoredPage();
    page.links.push({ id: 'a-an', type: 'line', from: 'a', to: 'an1' });
    const h = harness(page);
    h.editor.focusNode('c');
    h.editor.cut();
    expect(ids(h)).toEqual({
      nodes: ['a', 'b'],
      anchors: ['an1'],
      links: ['a>b', 'a>an1'],
    });
  });

  it('an anchor on its own can be copied, pasted and duplicated', () => {
    const h = harness(anchoredPage());
    h.click(200, 420); // the anchor
    expect(h.editor.getSelectedAnchor()?.id).toBe('an1');
    h.editor.copySelection();
    expect(h.editor.canPaste()).toBe(true);
    h.editor.paste();
    h.editor.duplicateSelection();
    expect(h.editor.page.anchors.map((a) => [a.x, a.y])).toEqual([
      [200, 420],
      [224, 444],
      [248, 468],
    ]);
  });

  it('duplicate selects the copies only, so Delete removes just them', () => {
    const h = harness(anchoredPage());
    const before = ids(h);
    marquee(h, { x: 140, y: 250 }, { x: 260, y: 460 });
    h.editor.duplicateSelection();
    expect(h.editor.page.nodes).toHaveLength(4);
    expect(h.editor.page.anchors).toHaveLength(2);
    expect(h.editor.selectionCount()).toBe(2);
    h.editor.deleteSelected();
    expect(ids(h)).toEqual(before);
  });

  it('emits operations that reproduce the snapshot diff', () => {
    const wrap = (page: Page): TopologyDocument => ({
      title: 'T',
      customNodes: [],
      pages: [structuredClone(page)],
    });
    const runs: ((h: Harness) => void)[] = [
      (h) => h.editor.paste(),
      (h) => h.editor.duplicateSelection(),
      (h) => h.editor.cut(),
    ];
    for (const run of runs) {
      const h = harness(anchoredPage());
      marquee(h, { x: 140, y: 250 }, { x: 260, y: 460 });
      h.editor.copySelection();
      h.editor.takePendingOperations();
      const before = wrap(h.editor.page);
      run(h);
      const after = wrap(h.editor.page);
      const emitted = h.editor.takePendingOperations();
      expect(emitted.length).toBeGreaterThan(0);
      expect(applyOperations(before, emitted)).toEqual(
        applyOperations(before, diffDocuments(before, after)),
      );
    }
  });
});

/* ── a callout's pointer ─────────────────────────────────────────────────── */

function calloutPage(id = 'p1'): Page {
  const page = twoNodes(id);
  page.nodes.push({
    id: 'note',
    type: 'callout',
    x: 300,
    y: 300,
    label: 'Note',
    target: 'b',
  });
  return page;
}

describe('a copied callout keeps a pointer that leads somewhere', () => {
  const callouts = (page: Page) =>
    page.nodes.filter((n) => n.type === 'callout');

  it('copied with its target, the copy points at the copied target', () => {
    for (const run of [
      (h: Harness) => {
        h.editor.copySelection();
        h.editor.paste();
      },
      (h: Harness) => h.editor.duplicateSelection(),
    ]) {
      const h = harness(calloutPage());
      h.editor.selectAll();
      run(h);
      const page = h.editor.page;
      const copyOfB = page.nodes.filter((n) => n.label === 'B')[1]!;
      expect(callouts(page).map((n) => n.target)).toEqual(['b', copyOfB.id]);
    }
  });

  it('copied on its own, it still points at the original on the same page', () => {
    const h = harness(calloutPage());
    h.editor.focusNode('note');
    h.editor.copySelection();
    h.editor.paste();
    expect(callouts(h.editor.page).map((n) => n.target)).toEqual(['b', 'b']);
  });

  it('pasted onto a page without its target, the pointer is dropped', () => {
    const p2 = blankPage('p2');
    const h = harness(calloutPage());
    h.editor.focusNode('note');
    h.editor.copySelection();
    h.editor.setPage(p2);
    h.editor.paste();
    expect(p2.nodes).toHaveLength(1);
    expect('target' in p2.nodes[0]!).toBe(false);
  });

  it('a stamped stencil never points outside itself', () => {
    const h = harness(calloutPage());
    h.editor.stampStencil(
      [
        { id: 's', type: 'router', x: -60, y: 0, label: 'S' },
        { id: 'in', type: 'callout', x: 60, y: 0, label: 'In', target: 's' },
        // Captured with a target that was not part of the stencil; an
        // element with that id happens to exist on this page.
        { id: 'out', type: 'callout', x: 60, y: 80, label: 'Out', target: 'b' },
      ],
      [],
    );
    const stamped = h.editor.page.nodes.slice(-3);
    expect(stamped[1]!.target).toBe(stamped[0]!.id);
    expect('target' in stamped[2]!).toBe(false);
  });
});
