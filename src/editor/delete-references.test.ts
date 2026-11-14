/**
 * Deleting on the canvas leaves nothing pointing at what was deleted: a link
 * leaves the frame's emphasis list, a flow path leaves the markers that named
 * it. Each change is also published as an operation that reproduces it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Page, TopologyDocument } from '../pages/model.js';
import { applyOperations, diffDocuments } from '../workspace/operations.js';
import { blankPage, harness, installEditorGlobals } from './test-harness.js';

beforeAll(installEditorGlobals);

function page(): Page {
  const p = blankPage();
  p.nodes.push(
    { id: 'a', type: 'router', x: 200, y: 300, label: 'A' },
    { id: 'b', type: 'router', x: 600, y: 300, label: 'B' },
  );
  p.links.push({ id: 'ab', type: 'line', from: 'a', to: 'b' });
  p.flowPaths.push({ id: 'f', waypoints: ['a', 'b'] });
  p.policyMarkers.push({
    id: 'm',
    nodeId: 'a',
    type: 'inspect',
    flowPathId: 'f',
  });
  return p;
}

const wrap = (p: Page): TopologyDocument => ({
  title: 'T',
  customNodes: [],
  pages: [structuredClone(p)],
});

/** The operations a step published reproduce what the step did. */
function expectPublished(
  h: ReturnType<typeof harness>,
  step: () => void,
): void {
  h.editor.takePendingOperations();
  const before = wrap(h.editor.page);
  step();
  const after = wrap(h.editor.page);
  const emitted = h.editor.takePendingOperations();
  expect(emitted.length).toBeGreaterThan(0);
  expect(applyOperations(before, emitted)).toEqual(
    applyOperations(before, diffDocuments(before, after)),
  );
}

describe('deleting a link that is emphasized', () => {
  it('takes it off the emphasis list', () => {
    const p = page();
    p.emphasis = ['ab', 'a'];
    const h = harness(p);
    h.click(400, 300); // the link's midpoint
    expectPublished(h, () => h.editor.deleteSelected());
    expect(h.editor.page.links).toEqual([]);
    expect(h.editor.page.emphasis).toEqual(['a']);
  });

  it('turns emphasis off when it was the only emphasized element', () => {
    const p = page();
    p.emphasis = ['ab'];
    const h = harness(p);
    h.click(400, 300);
    expectPublished(h, () => h.editor.deleteSelected());
    // Not a list of ids that no longer exist, which would dim everything.
    expect(h.editor.page.emphasis).toBeUndefined();
  });
});

describe('removing a flow path', () => {
  it('clears the pointer of a marker that named it', () => {
    const h = harness(page());
    expectPublished(h, () => h.editor.removeAnnotation('flowPaths', 'f'));
    expect(h.editor.page.flowPaths).toEqual([]);
    expect(h.editor.page.policyMarkers).toEqual([
      { id: 'm', nodeId: 'a', type: 'inspect' },
    ]);
  });
});
