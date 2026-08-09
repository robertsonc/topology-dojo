import { describe, expect, it } from 'vitest';
import type { Page, TopologyDocument } from '../pages/model.js';
import { applyOperations } from './operations.js';
import { computeProposalPreview, operationElementIds } from './preview.js';
import type { WorkspaceOperation } from './model.js';

function page(id: string, name: string): Page {
  return {
    id,
    name,
    viewBox: '0 0 1050 700',
    nodes: [
      { id: `${id}-a`, type: 'ec', x: 100, y: 100, label: 'A' },
      { id: `${id}-b`, type: 'ec', x: 300, y: 100, label: 'B' },
    ],
    links: [{ id: `${id}-ab`, type: 'line', from: `${id}-a`, to: `${id}-b` }],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  };
}

/** A page with one element of every non-node kind, for change classification. */
function richPage(id: string, name: string): Page {
  const base = page(id, name);
  return {
    ...base,
    anchors: [{ id: `${id}-anchor`, x: 500, y: 300 }],
    zones: [{ id: `${id}-zone`, nodes: [`${id}-a`, `${id}-b`], label: 'Z' }],
    flowPaths: [
      { id: `${id}-flow`, waypoints: [`${id}-a`, `${id}-b`], label: 'F' },
    ],
    policyMarkers: [
      { id: `${id}-pm`, nodeId: `${id}-a`, type: 'inspect', label: 'IDP' },
    ],
  };
}

function doc(pages: Page[]): TopologyDocument {
  return { title: 'WAN', customNodes: [], pages };
}

describe('computeProposalPreview', () => {
  it('returns no entries for a document.patch-only batch', () => {
    const operations: WorkspaceOperation[] = [
      { type: 'document.patch', patch: { set: { title: 'Renamed' } } },
    ];
    expect(computeProposalPreview([page('p1', 'Frame 1')], operations)).toEqual(
      [],
    );
  });

  it('previews an element.add: before lacks it, after has it, and it is the only changed id', () => {
    const p1 = page('p1', 'Frame 1');
    const operations: WorkspaceOperation[] = [
      {
        type: 'element.add',
        pageId: 'p1',
        kind: 'nodes',
        element: { id: 'p1-c', type: 'cloud', x: 500, y: 100, label: 'C' },
      },
    ];
    const [entry] = computeProposalPreview([p1], operations);
    expect(entry).toBeDefined();
    expect(entry!.pageId).toBe('p1');
    expect(entry!.pageName).toBe('Frame 1');
    expect(entry!.before).toEqual(p1);
    expect(entry!.after!.nodes.map((n) => n.id)).toEqual([
      'p1-a',
      'p1-b',
      'p1-c',
    ]);
    expect(entry!.changedElementIds).toEqual(['p1-c']);
  });

  it('previews an element.patch: only the patched field differs and the id is flagged changed', () => {
    const p1 = page('p1', 'Frame 1');
    const operations: WorkspaceOperation[] = [
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'p1-a',
        patch: { set: { label: 'Updated A' } },
      },
    ];
    const [entry] = computeProposalPreview([p1], operations);
    expect(entry!.before!.nodes[0]!.label).toBe('A');
    expect(entry!.after!.nodes[0]!.label).toBe('Updated A');
    expect(entry!.after!.nodes[1]).toEqual(p1.nodes[1]);
    expect(entry!.changedElementIds).toEqual(['p1-a']);
  });

  it('previews an element.remove: after omits it and it is flagged changed', () => {
    const p1 = page('p1', 'Frame 1');
    const operations: WorkspaceOperation[] = [
      {
        type: 'element.remove',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'p1-b',
      },
    ];
    const [entry] = computeProposalPreview([p1], operations);
    expect(entry!.after!.nodes.map((n) => n.id)).toEqual(['p1-a']);
    expect(entry!.changedElementIds).toEqual(['p1-b']);
  });

  it('produces a separate entry per affected page for a multi-page batch', () => {
    const p1 = page('p1', 'Frame 1');
    const p2 = page('p2', 'Frame 2');
    const operations: WorkspaceOperation[] = [
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'p1-a',
        patch: { set: { label: 'X' } },
      },
      {
        type: 'element.patch',
        pageId: 'p2',
        kind: 'nodes',
        elementId: 'p2-b',
        patch: { set: { label: 'Y' } },
      },
    ];
    const entries = computeProposalPreview([p1, p2], operations);
    expect(entries.map((e) => e.pageId)).toEqual(['p1', 'p2']);
    expect(entries[0]!.after!.nodes[0]!.label).toBe('X');
    expect(entries[0]!.changedElementIds).toEqual(['p1-a']);
    expect(entries[1]!.after!.nodes[1]!.label).toBe('Y');
    expect(entries[1]!.changedElementIds).toEqual(['p2-b']);
    // Each entry is isolated: page 1's preview never carries page 2's node ids.
    expect(entries[0]!.after!.nodes.map((n) => n.id)).not.toContain('p2-b');
  });

  it('previews a page.add: before is null, after is the new page content', () => {
    const p1 = page('p1', 'Frame 1');
    const newPage = page('p2', 'New Frame');
    const operations: WorkspaceOperation[] = [
      { type: 'page.add', page: newPage, afterPageId: 'p1' },
    ];
    const entries = computeProposalPreview([p1], operations);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.pageId).toBe('p2');
    expect(entries[0]!.before).toBeNull();
    expect(entries[0]!.after).toEqual(newPage);
    expect(entries[0]!.pageName).toBe('New Frame');
  });

  it('previews a page.add followed by an element.add on the new page in the same batch', () => {
    const p1 = page('p1', 'Frame 1');
    const newPage: Page = {
      ...page('p2', 'New Frame'),
      nodes: [],
      links: [],
    };
    const operations: WorkspaceOperation[] = [
      { type: 'page.add', page: newPage, afterPageId: 'p1' },
      {
        type: 'element.add',
        pageId: 'p2',
        kind: 'nodes',
        element: { id: 'p2-solo', type: 'host', x: 10, y: 10, label: 'Solo' },
      },
    ];
    const entries = computeProposalPreview([p1], operations);
    const p2Entry = entries.find((e) => e.pageId === 'p2')!;
    expect(p2Entry.before).toBeNull();
    expect(p2Entry.after!.nodes.map((n) => n.id)).toEqual(['p2-solo']);
    expect(p2Entry.changedElementIds).toEqual(['p2-solo']);
  });

  it('previews a page.remove: after is null, before is the original page', () => {
    const p1 = page('p1', 'Frame 1');
    const p2 = page('p2', 'Frame 2');
    const operations: WorkspaceOperation[] = [
      { type: 'page.remove', pageId: 'p2' },
    ];
    const entries = computeProposalPreview([p1, p2], operations);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.pageId).toBe('p2');
    expect(entries[0]!.before).toEqual(p2);
    expect(entries[0]!.after).toBeNull();
    expect(entries[0]!.pageName).toBe('Frame 2');
  });

  it('classifies an element.add as added, element.remove as removed, element.patch as modified', () => {
    const p1 = page('p1', 'Frame 1');
    const operations: WorkspaceOperation[] = [
      {
        type: 'element.add',
        pageId: 'p1',
        kind: 'nodes',
        element: { id: 'p1-c', type: 'cloud', x: 500, y: 100, label: 'C' },
      },
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'p1-a',
        patch: { set: { label: 'Updated A' } },
      },
      {
        type: 'element.remove',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'p1-b',
      },
    ];
    const [entry] = computeProposalPreview([p1], operations);
    expect(entry!.changes).toEqual([
      { elementId: 'p1-a', kind: 'nodes', change: 'modified' },
      { elementId: 'p1-b', kind: 'nodes', change: 'removed' },
      { elementId: 'p1-c', kind: 'nodes', change: 'added' },
    ]);
  });

  it('classifies changes for every non-node element kind', () => {
    const p1 = richPage('p1', 'Frame 1');
    const operations: WorkspaceOperation[] = [
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'links',
        elementId: 'p1-ab',
        patch: { set: { color: '#fc6161' } },
      },
      {
        type: 'element.remove',
        pageId: 'p1',
        kind: 'zones',
        elementId: 'p1-zone',
      },
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'anchors',
        elementId: 'p1-anchor',
        patch: { set: { x: 520 } },
      },
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'flowPaths',
        elementId: 'p1-flow',
        patch: { set: { label: 'F2' } },
      },
      {
        type: 'element.add',
        pageId: 'p1',
        kind: 'policyMarkers',
        element: { id: 'p1-pm2', nodeId: 'p1-b', type: 'deny' },
      },
    ];
    const [entry] = computeProposalPreview([p1], operations);
    expect(entry!.changes).toEqual([
      { elementId: 'p1-ab', kind: 'links', change: 'modified' },
      { elementId: 'p1-anchor', kind: 'anchors', change: 'modified' },
      { elementId: 'p1-flow', kind: 'flowPaths', change: 'modified' },
      { elementId: 'p1-pm2', kind: 'policyMarkers', change: 'added' },
      { elementId: 'p1-zone', kind: 'zones', change: 'removed' },
    ]);
  });

  it('drops changed ids that resolve to no element on either side, keeping them in changedElementIds', () => {
    const p1 = page('p1', 'Frame 1');
    // Added then removed within the same batch: net-nothing to draw.
    const operations: WorkspaceOperation[] = [
      {
        type: 'element.add',
        pageId: 'p1',
        kind: 'nodes',
        element: { id: 'p1-ghost', type: 'host', x: 10, y: 10 },
      },
      {
        type: 'element.remove',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'p1-ghost',
      },
    ];
    const [entry] = computeProposalPreview([p1], operations);
    expect(entry!.changedElementIds).toEqual(['p1-ghost']);
    expect(entry!.changes).toEqual([]);
  });

  it('does not mutate the source pages or operations', () => {
    const p1 = page('p1', 'Frame 1');
    const p1Clone = structuredClone(p1);
    const operations: WorkspaceOperation[] = [
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'p1-a',
        patch: { set: { label: 'Mutated?' } },
      },
    ];
    const operationsClone = structuredClone(operations);
    computeProposalPreview([p1], operations);
    expect(p1).toEqual(p1Clone);
    expect(operations).toEqual(operationsClone);
  });

  it('agrees with a whole-batch applyOperations for a mixed multi-page proposal', () => {
    const p1 = page('p1', 'Frame 1');
    const p2 = page('p2', 'Frame 2');
    const p3 = page('p3', 'Frame 3');
    const newPage = page('p4', 'Frame 4');
    const source = doc([p1, p2, p3]);

    const operations: WorkspaceOperation[] = [
      { type: 'document.patch', patch: { set: { title: 'Renamed WAN' } } },
      {
        type: 'element.add',
        pageId: 'p1',
        kind: 'nodes',
        element: { id: 'p1-c', type: 'cloud', x: 500, y: 100, label: 'C' },
      },
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'p1-a',
        patch: { set: { label: 'Renamed A' } },
      },
      {
        type: 'element.remove',
        pageId: 'p2',
        kind: 'nodes',
        elementId: 'p2-b',
      },
      { type: 'page.remove', pageId: 'p3' },
      { type: 'page.add', page: newPage, afterPageId: 'p2' },
    ];

    const wholeBatchAfter = applyOperations(source, operations);
    const preview = computeProposalPreview(source.pages, operations);

    expect(preview.map((e) => e.pageId).sort()).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
    ]);
    for (const entry of preview) {
      const expected =
        wholeBatchAfter.pages.find((p) => p.id === entry.pageId) ?? null;
      expect(entry.after).toEqual(expected);
    }
  });
});

describe('operationElementIds', () => {
  it('names the element for element-scoped operations', () => {
    expect(
      operationElementIds({
        type: 'element.patch',
        pageId: 'p1',
        kind: 'links',
        elementId: 'l1',
        patch: { set: { color: '#fff' } },
      }),
    ).toEqual(['l1']);
    expect(
      operationElementIds({
        type: 'element.add',
        pageId: 'p1',
        kind: 'zones',
        element: { id: 'z1', nodes: [] },
      }),
    ).toEqual(['z1']);
  });

  it('names no elements for page/document-scoped operations', () => {
    expect(
      operationElementIds({
        type: 'document.patch',
        patch: { set: { title: 'X' } },
      }),
    ).toEqual([]);
    expect(
      operationElementIds({
        type: 'page.patch',
        pageId: 'p1',
        patch: { set: { name: 'X' } },
      }),
    ).toEqual([]);
  });
});
