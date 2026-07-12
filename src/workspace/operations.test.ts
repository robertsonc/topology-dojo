import { describe, expect, it } from 'vitest';
import type { TopologyDocument } from '../pages/model.js';
import {
  applyOperations,
  conflictingTargets,
  diffDocuments,
  summarizeOperations,
} from './operations.js';
import type { WorkspaceOperation } from './model.js';

function fixture(): TopologyDocument {
  return {
    title: 'WAN',
    customNodes: [],
    pages: [
      {
        id: 'p1',
        name: 'Frame 1',
        viewBox: '0 0 1050 700',
        nodes: [
          { id: 'a', type: 'ec', x: 100, y: 100, label: 'A' },
          { id: 'b', type: 'ec', x: 300, y: 100, label: 'B' },
        ],
        links: [{ id: 'ab', type: 'line', from: 'a', to: 'b' }],
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
      },
    ],
  };
}

describe('workspace semantic operations', () => {
  it('round-trips a browser snapshot diff without shipping the document', () => {
    const before = fixture();
    const after = structuredClone(before);
    after.title = 'Production WAN';
    after.pages[0]!.name = 'Current';
    after.pages[0]!.nodes[0]!.x = 160;
    after.pages[0]!.nodes.push({
      id: 'c',
      type: 'cloud',
      x: 500,
      y: 100,
      label: 'Internet',
    });
    const operations = diffDocuments(before, after);
    expect(operations.map((operation) => operation.type)).toEqual([
      'document.patch',
      'page.patch',
      'element.patch',
      'element.add',
    ]);
    expect(applyOperations(before, operations)).toEqual(after);
  });

  it('tracks order changes explicitly', () => {
    const before = fixture();
    const after = structuredClone(before);
    after.pages[0]!.nodes.reverse();
    const operations = diffDocuments(before, after);
    expect(operations).toEqual([
      {
        type: 'element.reorder',
        pageId: 'p1',
        kind: 'nodes',
        elementIds: ['b', 'a'],
      },
    ]);
    expect(applyOperations(before, operations)).toEqual(after);
  });

  it('can replace the only page without a transient empty document', () => {
    const before = fixture();
    const after = structuredClone(before);
    after.pages = [
      {
        id: 'p2',
        name: 'Replacement',
        viewBox: '0 0 800 600',
        nodes: [],
        links: [],
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
      },
    ];
    const operations = diffDocuments(before, after);
    expect(operations.map((operation) => operation.type)).toEqual([
      'page.add',
      'page.remove',
    ]);
    expect(applyOperations(before, operations)).toEqual(after);
  });

  it('allows concurrent edits to different fields of the same element', () => {
    const move: WorkspaceOperation[] = [
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'a',
        patch: { set: { x: 200 } },
      },
    ];
    const relabel: WorkspaceOperation[] = [
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'a',
        patch: { set: { label: 'Branch A' } },
      },
    ];
    expect(conflictingTargets(move, relabel)).toEqual([]);
  });

  it('does not conflict independent additions to the same collection', () => {
    const addC: WorkspaceOperation[] = [
      {
        type: 'element.add',
        pageId: 'p1',
        kind: 'nodes',
        element: { id: 'c', type: 'host', x: 10, y: 10 },
      },
    ];
    const addD: WorkspaceOperation[] = [
      {
        type: 'element.add',
        pageId: 'p1',
        kind: 'nodes',
        element: { id: 'd', type: 'host', x: 20, y: 20 },
      },
    ];
    expect(conflictingTargets(addC, addD)).toEqual([]);
  });

  it('conflicts on the same field and on delete versus edit', () => {
    const move: WorkspaceOperation[] = [
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'a',
        patch: { set: { x: 200 } },
      },
    ];
    const otherMove: WorkspaceOperation[] = [
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'a',
        patch: { set: { x: 240 } },
      },
    ];
    const remove: WorkspaceOperation[] = [
      { type: 'element.remove', pageId: 'p1', kind: 'nodes', elementId: 'a' },
    ];
    expect(conflictingTargets(move, otherMove)).toEqual([
      'page/p1/element/nodes/a/field/x',
    ]);
    expect(conflictingTargets(move, remove)).toEqual([
      'page/p1/element/nodes/a/field/x',
    ]);
  });

  it('rejects invalid mutation batches without changing the source', () => {
    const before = fixture();
    expect(() =>
      applyOperations(before, [{ type: 'page.remove', pageId: 'p1' }]),
    ).toThrow('retain at least one page');
    expect(() =>
      applyOperations(before, [
        { type: 'replace_everything' } as unknown as WorkspaceOperation,
      ]),
    ).toThrow('unknown workspace operation');
    expect(before).toEqual(fixture());
  });

  it('produces compact, human-readable summaries', () => {
    const summary = summarizeOperations([
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'a',
        patch: { set: { x: 200, y: 220 } },
      },
    ]);
    expect(summary).toMatchObject({
      count: 1,
      byType: { 'element.patch': 1 },
      affectedPageIds: ['p1'],
      affectedElementIds: ['a'],
    });
    expect(summary.descriptions[0]).toContain('x, y');
  });
});
