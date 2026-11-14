/**
 * Copy, cut, paste and duplicate: where the copies land and what they carry.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Page } from '../pages/model.js';
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
