import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from '../testing/worker-harness.js';

const harness = String.raw`
import { TopologyDocument } from './worker/document.ts';
export { TopologyDocument };
export default {
  async fetch(request, env) {
    try {
      const input = await request.json();
      const owner = String(input.owner ?? '42');
      const workspace = String(input.workspace ?? 'w1');
      const stub = env.DOC.get(env.DOC.idFromName(owner + ':' + workspace));
      const user = { kind: 'user', id: owner };
      const agent = { kind: 'agent', id: owner };
      let result;
      switch (input.action) {
        case 'initialize': result = await stub.initialize(owner, workspace, input.document); break;
        case 'snapshot': result = await stub.getSnapshot(owner); break;
        case 'changes': result = await stub.getChanges(owner, Number(input.since ?? 0), 20, Boolean(input.detail)); break;
        case 'user': result = await stub.applyUserOperations(owner, user, input.commit); break;
        case 'agent': result = await stub.applyAgentOperations(owner, agent, input.commit); break;
        case 'propose': result = await stub.propose(owner, agent, input.commit, String(input.title ?? 'Proposal')); break;
        case 'accept': result = await stub.acceptProposal(owner, user, String(input.proposalId), String(input.operationId), input.selectedOperationIndices); break;
        case 'proposal': result = await stub.getProposal(owner, String(input.proposalId)); break;
        case 'lease': result = await stub.grantPageLease(owner, user, String(input.pageId), 600); break;
        default: return Response.json({ error: 'bad action' }, { status: 400 });
      }
      return Response.json(result);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }
};
`;

let handle: MiniflareHandle;

async function dispatch(input: Record<string, unknown>) {
  return handle.fetch('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

async function call<T>(input: Record<string, unknown>): Promise<T> {
  const response = await dispatch(input);
  if (!response.ok)
    throw new Error(`${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

function page(id: string, nodeId: string) {
  return {
    id,
    name: id,
    viewBox: '0 0 1050 700',
    nodes: [{ id: nodeId, type: 'ec', x: 10, y: 10, label: nodeId }],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  };
}

function patch(
  pageId: string,
  elementId: string,
  set: Record<string, unknown>,
) {
  return {
    type: 'element.patch',
    pageId,
    kind: 'nodes',
    elementId,
    patch: { set },
  };
}

function addNode(pageId: string, id: string) {
  return {
    type: 'element.add',
    pageId,
    kind: 'nodes',
    element: { id, type: 'ec', x: 40, y: 40, label: id },
  };
}

function addLink(pageId: string, id: string, from: string, to: string) {
  return {
    type: 'element.add',
    pageId,
    kind: 'links',
    element: { id, type: 'line', from, to },
  };
}

beforeAll(async () => {
  const bundle = await buildWorkerBundle(harness, {
    sourcefile: 'workspace-do-harness.ts',
  });
  handle = await startMiniflare({
    bundle,
    durableObjects: {
      DOC: { className: 'TopologyDocument', useSQLite: true },
    },
  });
}, 30_000);

afterAll(async () => {
  await handle?.dispose();
});

describe('TopologyDocument Durable Object', () => {
  it('serializes revisions, rebases disjoint fields, enforces proposals/leases, and is idempotent', async () => {
    const document = {
      title: 'Integration',
      customNodes: [],
      pages: [page('p1', 'a'), page('p2', 'b')],
    };
    const initial = await call<{ revision: number }>({
      action: 'initialize',
      document,
    });
    expect(initial.revision).toBe(0);

    const first = await call<{
      ok: boolean;
      revision: number;
    }>({
      action: 'user',
      commit: {
        baseRevision: 0,
        operationId: 'u1',
        operations: [patch('p1', 'a', { x: 30 })],
      },
    });
    const second = await call<{
      ok: boolean;
      revision: number;
      rebased: boolean;
    }>({
      action: 'user',
      commit: {
        baseRevision: 0,
        operationId: 'u2',
        operations: [patch('p1', 'a', { label: 'Branch A' })],
      },
    });
    expect(first).toMatchObject({ ok: true, revision: 1 });
    expect(second).toMatchObject({ ok: true, revision: 2, rebased: true });

    const conflict = await call<{ ok: boolean; code: string }>({
      action: 'user',
      commit: {
        baseRevision: 0,
        operationId: 'u3',
        operations: [patch('p1', 'a', { x: 40 })],
      },
    });
    expect(conflict).toMatchObject({ ok: false, code: 'conflict' });

    const noLease = await call<{ ok: boolean; code: string }>({
      action: 'agent',
      commit: {
        baseRevision: 2,
        operationId: 'a1',
        operations: [patch('p1', 'a', { y: 40 })],
      },
    });
    expect(noLease).toMatchObject({ ok: false, code: 'lease-required' });

    const proposed = await call<{
      ok: true;
      proposal: { id: string; status: string };
    }>({
      action: 'propose',
      title: 'Rename second branch',
      commit: {
        baseRevision: 2,
        operationId: 'pr1',
        operations: [patch('p2', 'b', { label: 'Branch B' })],
      },
    });
    expect(proposed.proposal.status).toBe('pending');
    const beforeAccept = await call<{
      revision: number;
      document: { pages: Array<{ nodes: Array<{ label: string }> }> };
    }>({ action: 'snapshot' });
    expect(beforeAccept.revision).toBe(2);
    expect(beforeAccept.document.pages[1]!.nodes[0]!.label).toBe('b');

    const accepted = await call<{ ok: boolean; revision: number }>({
      action: 'accept',
      proposalId: proposed.proposal.id,
      operationId: 'accept1',
    });
    expect(accepted).toMatchObject({ ok: true, revision: 3 });

    await call({ action: 'lease', pageId: 'p1' });
    const leased = await call<{ ok: boolean; revision: number }>({
      action: 'agent',
      commit: {
        baseRevision: 3,
        operationId: 'a2',
        operations: [patch('p1', 'a', { y: 50 })],
      },
    });
    const outside = await call<{ ok: boolean; code: string }>({
      action: 'agent',
      commit: {
        baseRevision: 4,
        operationId: 'a3',
        operations: [patch('p2', 'b', { y: 60 })],
      },
    });
    expect(leased).toMatchObject({ ok: true, revision: 4 });
    expect(outside).toMatchObject({ ok: false, code: 'out-of-scope' });

    const duplicate = await call<{ ok: boolean; revision: number }>({
      action: 'agent',
      commit: {
        baseRevision: 3,
        operationId: 'a2',
        operations: [patch('p1', 'a', { y: 50 })],
      },
    });
    expect(duplicate).toMatchObject({ ok: true, revision: 4 });

    const changes = await call<{
      revision: number;
      changes: Array<Record<string, unknown>>;
    }>({ action: 'changes', since: 0 });
    expect(changes.revision).toBe(4);
    expect(changes.changes).toHaveLength(4);
    expect(changes.changes[0]).not.toHaveProperty('operations');
  }, 30_000);

  it('stores an aggregate document above 2 MiB while rejecting an oversize page', async () => {
    const pages = Array.from({ length: 20 }, (_, index) => ({
      ...page(`large-${index}`, `n-${index}`),
      caption: 'x'.repeat(120_000),
    }));
    const aggregate = await call<{ revision: number }>({
      action: 'initialize',
      workspace: 'large',
      document: { title: 'Large', customNodes: [], pages },
    });
    expect(aggregate.revision).toBe(0);

    const oversize = await dispatch({
      action: 'initialize',
      workspace: 'oversize',
      document: {
        title: 'Oversize',
        customNodes: [],
        pages: [{ ...page('huge', 'n'), caption: 'x'.repeat(1_900_000) }],
      },
    });
    expect(oversize.status).toBe(400);
    await expect(oversize.json()).resolves.toMatchObject({
      error: expect.stringContaining('1.8 MiB'),
    });
  }, 30_000);

  it('rejects a selective accept whose ops depend on unselected ones', async () => {
    const W = 'r2-dep';
    await call({
      action: 'initialize',
      workspace: W,
      document: { title: 'T', customNodes: [], pages: [page('p1', 'a')] },
    });
    const proposed = await call<{ proposal: { id: string } }>({
      action: 'propose',
      workspace: W,
      title: 'link two new nodes',
      commit: {
        baseRevision: 0,
        operationId: 'pr1',
        operations: [
          addNode('p1', 'n1'),
          addNode('p1', 'n2'),
          addLink('p1', 'l1', 'n1', 'n2'),
        ],
      },
    });
    // Accept only the link (index 2) — its endpoints are created by ops 0 and 1.
    const rejected = await call<{
      ok: boolean;
      code: string;
      missingDependencies: string[];
    }>({
      action: 'accept',
      workspace: W,
      proposalId: proposed.proposal.id,
      operationId: 'acc1',
      selectedOperationIndices: [2],
    });
    expect(rejected).toMatchObject({ ok: false, code: 'incoherent-subset' });
    expect([...rejected.missingDependencies].sort()).toEqual(['n1', 'n2']);
    // Nothing was applied.
    const snap = await call<{ revision: number }>({
      action: 'snapshot',
      workspace: W,
    });
    expect(snap.revision).toBe(0);
  }, 30_000);

  it('applies a coherent subset and keeps the remainder reviewable', async () => {
    const W = 'r2-partial';
    await call({
      action: 'initialize',
      workspace: W,
      document: { title: 'T', customNodes: [], pages: [page('p1', 'a')] },
    });
    const proposed = await call<{ proposal: { id: string } }>({
      action: 'propose',
      workspace: W,
      title: 'nodes then link',
      commit: {
        baseRevision: 0,
        operationId: 'pr1',
        operations: [
          addNode('p1', 'n1'),
          addNode('p1', 'n2'),
          addLink('p1', 'l1', 'n1', 'n2'),
        ],
      },
    });
    const pid = proposed.proposal.id;
    // Accept the two nodes; the link (index 2) stays behind.
    const partial = await call<{ ok: boolean; revision: number }>({
      action: 'accept',
      workspace: W,
      proposalId: pid,
      operationId: 'acc1',
      selectedOperationIndices: [0, 1],
    });
    expect(partial).toMatchObject({ ok: true, revision: 1 });

    const residual = await call<{
      status: string;
      baseRevision: number;
      operations: Array<{ type: string }>;
    }>({ action: 'proposal', workspace: W, proposalId: pid });
    expect(residual.status).toBe('partially-accepted');
    expect(residual.operations).toHaveLength(1);
    expect(residual.baseRevision).toBe(1); // rebased onto the accepted revision

    const mid = await call<{
      document: {
        pages: Array<{ nodes: Array<{ id: string }>; links: unknown[] }>;
      };
    }>({ action: 'snapshot', workspace: W });
    expect(mid.document.pages[0]!.nodes.map((n) => n.id).sort()).toEqual([
      'a',
      'n1',
      'n2',
    ]);
    expect(mid.document.pages[0]!.links).toHaveLength(0);

    // Accept the residual — the link now resolves against the new revision.
    const rest = await call<{ ok: boolean; revision: number }>({
      action: 'accept',
      workspace: W,
      proposalId: pid,
      operationId: 'acc2',
    });
    expect(rest).toMatchObject({ ok: true, revision: 2 });
    const done = await call<{ status: string }>({
      action: 'proposal',
      workspace: W,
      proposalId: pid,
    });
    expect(done.status).toBe('accepted');
    const final = await call<{
      document: { pages: Array<{ links: Array<{ id: string }> }> };
    }>({ action: 'snapshot', workspace: W });
    expect(final.document.pages[0]!.links.map((l) => l.id)).toEqual(['l1']);
  }, 30_000);

  it('is idempotent for a repeated selective accept (same operationId)', async () => {
    const W = 'r2-idem';
    await call({
      action: 'initialize',
      workspace: W,
      document: { title: 'T', customNodes: [], pages: [page('p1', 'a')] },
    });
    const proposed = await call<{ proposal: { id: string } }>({
      action: 'propose',
      workspace: W,
      title: 'two nodes',
      commit: {
        baseRevision: 0,
        operationId: 'pr1',
        operations: [addNode('p1', 'n1'), addNode('p1', 'n2')],
      },
    });
    const pid = proposed.proposal.id;
    const first = await call<{ ok: boolean; revision: number }>({
      action: 'accept',
      workspace: W,
      proposalId: pid,
      operationId: 'accX',
      selectedOperationIndices: [0],
    });
    expect(first).toMatchObject({ ok: true, revision: 1 });
    // Same operationId → cached result, no second application.
    const repeat = await call<{ ok: boolean; revision: number }>({
      action: 'accept',
      workspace: W,
      proposalId: pid,
      operationId: 'accX',
      selectedOperationIndices: [0],
    });
    expect(repeat).toMatchObject({ ok: true, revision: 1 });
    const snap = await call<{ revision: number }>({
      action: 'snapshot',
      workspace: W,
    });
    expect(snap.revision).toBe(1);
    const prop = await call<{ operations: unknown[] }>({
      action: 'proposal',
      workspace: W,
      proposalId: pid,
    });
    expect(prop.operations).toHaveLength(1); // residual n2, not doubled
  }, 30_000);

  it('conflicts a subset overlapping an interleaved user revision', async () => {
    const W = 'r2-conflict';
    await call({
      action: 'initialize',
      workspace: W,
      document: {
        title: 'T',
        customNodes: [],
        pages: [
          {
            id: 'p1',
            name: 'p1',
            viewBox: '0 0 1050 700',
            nodes: [
              { id: 'a', type: 'ec', x: 10, y: 10, label: 'a' },
              { id: 'b', type: 'ec', x: 20, y: 20, label: 'b' },
            ],
            links: [],
            anchors: [],
            zones: [],
            flowPaths: [],
            policyMarkers: [],
          },
        ],
      },
    });
    const proposed = await call<{ proposal: { id: string } }>({
      action: 'propose',
      workspace: W,
      title: 'move a and b',
      commit: {
        baseRevision: 0,
        operationId: 'pr1',
        operations: [
          patch('p1', 'a', { x: 100 }),
          patch('p1', 'b', { x: 200 }),
        ],
      },
    });
    const pid = proposed.proposal.id;
    // Interleaved user edit to node 'a'.
    await call({
      action: 'user',
      workspace: W,
      commit: {
        baseRevision: 0,
        operationId: 'u1',
        operations: [patch('p1', 'a', { x: 5 })],
      },
    });
    // Accepting the 'a' patch (index 0) overlaps the user edit → conflict.
    const conflictSub = await call<{ ok: boolean; code: string }>({
      action: 'accept',
      workspace: W,
      proposalId: pid,
      operationId: 'accA',
      selectedOperationIndices: [0],
    });
    expect(conflictSub).toMatchObject({ ok: false, code: 'conflict' });
    // Accepting the disjoint 'b' patch (index 1) is unaffected.
    const okSub = await call<{ ok: boolean }>({
      action: 'accept',
      workspace: W,
      proposalId: pid,
      operationId: 'accB',
      selectedOperationIndices: [1],
    });
    expect(okSub).toMatchObject({ ok: true });
  }, 30_000);
});
