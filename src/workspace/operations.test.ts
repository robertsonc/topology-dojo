import { describe, expect, it } from 'vitest';
import type { TopologyDocument } from '../pages/model.js';
import {
  applyOperations,
  conflictAttribution,
  conflictingTargets,
  operationTargets,
  diffDocuments,
  subsetDependencyErrors,
  summarizeOperations,
  supersededTargets,
  type CommittedChange,
} from './operations.js';
import type { Page } from '../pages/model.js';
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

  it('conflicts on the same source identity even when element ids differ', () => {
    const source = { system: 'netbox', kind: 'device', id: 'core/1' };
    const addX: WorkspaceOperation[] = [
      {
        type: 'element.add',
        pageId: 'p1',
        kind: 'nodes',
        element: { id: 'x', type: 'router', x: 0, y: 0, source },
      },
    ];
    const addY: WorkspaceOperation[] = [
      {
        type: 'element.add',
        pageId: 'p1',
        kind: 'nodes',
        element: { id: 'y', type: 'router', x: 0, y: 0, source },
      },
    ];
    const bindZ: WorkspaceOperation[] = [
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'z',
        patch: { set: { source } },
      },
    ];
    const other: WorkspaceOperation[] = [
      {
        type: 'element.add',
        pageId: 'p1',
        kind: 'nodes',
        element: {
          id: 'w',
          type: 'router',
          x: 0,
          y: 0,
          source: { ...source, id: 'core/2' },
        },
      },
    ];
    const target = 'page/p1/source/nodes/netbox/device/core%2F1';
    expect(conflictingTargets(addX, addY)).toEqual([target]);
    expect(conflictingTargets(bindZ, addY)).toEqual([target]);
    expect(conflictingTargets(addX, other)).toEqual([]);
    // An unsourced add still does not conflict with a sourced one.
    expect(
      conflictingTargets(
        [
          {
            type: 'element.add',
            pageId: 'p1',
            kind: 'nodes',
            element: { id: 'v', type: 'router', x: 0, y: 0 },
          },
        ],
        addY,
      ),
    ).toEqual([]);
  });

  it('an external id of "**" cannot forge the wildcard conflict syntax', () => {
    const star = (id: string, elementId: string): WorkspaceOperation[] => [
      {
        type: 'element.add',
        pageId: 'p1',
        kind: 'nodes',
        element: {
          id: elementId,
          type: 'router',
          x: 0,
          y: 0,
          source: { system: 'netbox', kind: 'device', id },
        },
      },
    ];
    const targets = operationTargets(star('**', 'a')[0]!);
    expect(targets).toContain('page/p1/source/nodes/netbox/device/%2A%2A');
    expect(
      targets.some((t) => t.endsWith('/**') && t.includes('/source/')),
    ).toBe(false);
    // The same source still conflicts with itself…
    expect(conflictingTargets(star('**', 'a'), star('**', 'b'))).toEqual([
      'page/p1/source/nodes/netbox/device/%2A%2A',
    ]);
    // …and never with unrelated sources in the namespace it would have wildcarded.
    expect(conflictingTargets(star('**', 'a'), star('core1', 'c'))).toEqual([]);
    expect(conflictingTargets(star('*', 'a'), star('core1', 'c'))).toEqual([]);
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

describe('subsetDependencyErrors (selective acceptance coherence)', () => {
  const addNode = (id: string): WorkspaceOperation => ({
    type: 'element.add',
    pageId: 'p1',
    kind: 'nodes',
    element: { id, type: 'ec', x: 0, y: 0 },
  });
  const addLink = (
    id: string,
    from: string,
    to: string,
  ): WorkspaceOperation => ({
    type: 'element.add',
    pageId: 'p1',
    kind: 'links',
    element: { id, type: 'line', from, to },
  });

  it('flags a link accepted without the new nodes it connects', () => {
    const ops = [addNode('n1'), addNode('n2'), addLink('l1', 'n1', 'n2')];
    const errs = subsetDependencyErrors(ops, [2]);
    expect(errs.map((e) => e.missingId).sort()).toEqual(['n1', 'n2']);
    expect(errs.every((e) => e.index === 2 && e.kind === 'element')).toBe(true);
  });

  it('passes when the link and both endpoints are accepted together', () => {
    const ops = [addNode('n1'), addNode('n2'), addLink('l1', 'n1', 'n2')];
    expect(subsetDependencyErrors(ops, [0, 1, 2])).toEqual([]);
  });

  it('ignores references to elements that already exist in the base document', () => {
    // 'a' and 'b' are not created by this proposal (they pre-exist).
    expect(subsetDependencyErrors([addLink('l1', 'a', 'b')], [0])).toEqual([]);
  });

  it('flags patching an element only an unselected op creates', () => {
    const ops: WorkspaceOperation[] = [
      addNode('n1'),
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'n1',
        patch: { set: { label: 'X' } },
      },
    ];
    const errs = subsetDependencyErrors(ops, [1]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({
      index: 1,
      dependsOnIndex: 0,
      missingId: 'n1',
      kind: 'element',
    });
  });

  it('flags a patch that points a field at a new, unselected element', () => {
    const ops: WorkspaceOperation[] = [
      addNode('n1'),
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'links',
        elementId: 'ab',
        patch: { set: { to: 'n1' } },
      },
    ];
    expect(subsetDependencyErrors(ops, [1]).map((e) => e.missingId)).toEqual([
      'n1',
    ]);
    expect(subsetDependencyErrors(ops, [0, 1])).toEqual([]);
  });

  it('flags an element added to a page only an unselected op creates', () => {
    const page: Page = {
      id: 'p2',
      name: 'F2',
      viewBox: '0 0 100 100',
      nodes: [],
      links: [],
      anchors: [],
      zones: [],
      flowPaths: [],
      policyMarkers: [],
    };
    const ops: WorkspaceOperation[] = [
      { type: 'page.add', page },
      {
        type: 'element.add',
        pageId: 'p2',
        kind: 'nodes',
        element: { id: 'x', type: 'ec', x: 0, y: 0 },
      },
    ];
    const errs = subsetDependencyErrors(ops, [1]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({
      index: 1,
      dependsOnIndex: 0,
      missingId: 'p2',
      kind: 'page',
    });
  });

  it('treats a page.add (with inner elements) as self-contained', () => {
    const page: Page = {
      id: 'p2',
      name: 'F2',
      viewBox: '0 0 100 100',
      nodes: [{ id: 'n', type: 'ec', x: 0, y: 0 }],
      links: [],
      anchors: [],
      zones: [],
      flowPaths: [],
      policyMarkers: [],
    };
    expect(subsetDependencyErrors([{ type: 'page.add', page }], [0])).toEqual(
      [],
    );
  });
});

describe('conflict attribution and same-author supersede (issue #269)', () => {
  const relabel = (
    elementId: string,
    set: Record<string, unknown>,
  ): WorkspaceOperation => ({
    type: 'element.patch',
    pageId: 'p1',
    kind: 'nodes',
    elementId,
    patch: { set },
  });
  const agentX = { kind: 'agent' as const, id: 'x', label: 'x-bot' };
  const agentY = { kind: 'agent' as const, id: 'y' };
  const committed = (
    overrides: Partial<CommittedChange> & { operations: WorkspaceOperation[] },
  ): CommittedChange => ({
    revision: 1,
    operationId: 'op1',
    ...overrides,
  });

  it('attributes each conflicting target to the LAST committed write', () => {
    const incoming = [relabel('a', { label: 'A3', sublabel: 'edge' })];
    const conflicts = conflictAttribution(incoming, [
      committed({
        revision: 1,
        operationId: 'ui_accept_1',
        proposalId: 'pr_first',
        author: agentX,
        operations: [relabel('a', { label: 'A1', sublabel: 'edge' })],
      }),
      committed({
        revision: 2,
        operationId: 'u2',
        author: { kind: 'user', id: 'owner' },
        operations: [relabel('a', { label: 'A2' })],
      }),
    ]);
    expect(conflicts).toEqual([
      {
        target: 'page/p1/element/nodes/a/field/label',
        revision: 2,
        operationId: 'u2',
        author: { kind: 'user', id: 'owner' },
        operationType: 'element.patch',
        value: 'A2',
      },
    ]);
    // `sublabel` was set to the same value at r1 and never touched again:
    // identical writes commute, so it is neither a conflict nor listed.
    expect(conflicts.map((c) => c.target)).not.toContain(
      'page/p1/element/nodes/a/field/sublabel',
    );
  });

  it('keeps a differing value with the committed value, proposal and author', () => {
    const conflicts = conflictAttribution(
      [relabel('a', { meta: { role: 'spine' } })],
      [
        committed({
          revision: 46,
          operationId: 'ui_accept_ef46',
          proposalId: 'pr_d26e',
          author: agentX,
          operations: [relabel('a', { meta: { role: 'leaf' } })],
        }),
      ],
    );
    expect(conflicts).toEqual([
      {
        target: 'page/p1/element/nodes/a/field/meta',
        revision: 46,
        operationId: 'ui_accept_ef46',
        proposalId: 'pr_d26e',
        author: { kind: 'agent', id: 'x', label: 'x-bot' },
        operationType: 'element.patch',
        value: { role: 'leaf' },
      },
    ]);
    // Deep equality, not identity: the same object shape commutes.
    expect(
      conflictAttribution(
        [relabel('a', { meta: { role: 'leaf' } })],
        [
          committed({
            operations: [relabel('a', { meta: { role: 'leaf' } })],
          }),
        ],
      ),
    ).toEqual([]);
  });

  it('never drops removals, adds or unsets as identical writes', () => {
    const remove: WorkspaceOperation = {
      type: 'element.remove',
      pageId: 'p1',
      kind: 'nodes',
      elementId: 'a',
    };
    const edit = relabel('a', { label: 'A' });
    const unset: WorkspaceOperation = {
      type: 'element.patch',
      pageId: 'p1',
      kind: 'nodes',
      elementId: 'a',
      patch: { unset: ['label'] },
    };
    // Edit after a removal: a wildcard collision carries no value.
    expect(
      conflictAttribution([edit], [committed({ operations: [remove] })]),
    ).toEqual([
      {
        target: 'page/p1/element/nodes/a/field/label',
        revision: 1,
        operationId: 'op1',
        operationType: 'element.remove',
      },
    ]);
    // Removal after an edit: conflicts on the element subtree.
    expect(
      conflictAttribution([remove], [committed({ operations: [edit] })]).map(
        (c) => c.target,
      ),
    ).toEqual(['page/p1/element/nodes/a/**']);
    // An unset against a set of the same field is a conflict with the value.
    expect(
      conflictAttribution([unset], [committed({ operations: [edit] })]),
    ).toMatchObject([{ operationType: 'element.patch', value: 'A' }]);
    // A set against an unset is a conflict without a value.
    expect(
      conflictAttribution([edit], [committed({ operations: [unset] })]),
    ).toEqual([
      {
        target: 'page/p1/element/nodes/a/field/label',
        revision: 1,
        operationId: 'op1',
        operationType: 'element.patch',
      },
    ]);
  });

  it('the last incoming write to a field decides whether it commutes', () => {
    const history = [committed({ operations: [relabel('a', { label: 'A' })] })];
    expect(
      conflictAttribution(
        [relabel('a', { label: 'B' }), relabel('a', { label: 'A' })],
        history,
      ),
    ).toEqual([]);
    expect(
      conflictAttribution(
        [relabel('a', { label: 'A' }), relabel('a', { label: 'B' })],
        history,
      ),
    ).toHaveLength(1);
  });

  it('supersedes only when every conflict is the same author and none is a removal', () => {
    const own = conflictAttribution(
      [relabel('a', { label: 'A2' }), relabel('b', { label: 'B2' })],
      [
        committed({
          revision: 1,
          proposalId: 'pr_1',
          author: agentX,
          operations: [relabel('a', { label: 'A1' })],
        }),
        committed({
          revision: 2,
          operationId: 'op2',
          author: { ...agentX, sessionId: 'another-session' },
          operations: [relabel('b', { label: 'B1' })],
        }),
      ],
    );
    expect(supersededTargets(own, agentX)).toEqual([
      'page/p1/element/nodes/a/field/label',
      'page/p1/element/nodes/b/field/label',
    ]);
    expect(supersededTargets(own, agentY)).toBeNull();
    // The owner's own UI edit is a different author even with the same id.
    expect(supersededTargets(own, { kind: 'user', id: 'x' })).toBeNull();
    expect(supersededTargets([], agentX)).toBeNull();

    const mixed = conflictAttribution(
      [relabel('a', { label: 'A2' }), relabel('b', { label: 'B2' })],
      [
        committed({
          revision: 1,
          author: agentX,
          operations: [relabel('a', { label: 'A1' })],
        }),
        committed({
          revision: 2,
          author: agentY,
          operations: [relabel('b', { label: 'B1' })],
        }),
      ],
    );
    expect(supersededTargets(mixed, agentX)).toBeNull();

    const unattributed = conflictAttribution(
      [relabel('a', { label: 'A2' })],
      [committed({ operations: [relabel('a', { label: 'A1' })] })],
    );
    expect(supersededTargets(unattributed, agentX)).toBeNull();

    const removed = conflictAttribution(
      [relabel('a', { label: 'A2' })],
      [
        committed({
          author: agentX,
          operations: [
            {
              type: 'element.remove',
              pageId: 'p1',
              kind: 'nodes',
              elementId: 'a',
            },
          ],
        }),
      ],
    );
    expect(supersededTargets(removed, agentX)).toBeNull();
  });
});
