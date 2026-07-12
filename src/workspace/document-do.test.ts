import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

const bundlePath = resolve(
  `.workspace-do-test-${process.pid}-${Date.now()}.mjs`,
);

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
        case 'accept': result = await stub.acceptProposal(owner, user, String(input.proposalId), String(input.operationId)); break;
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

let miniflare: Miniflare;

async function dispatch(input: Record<string, unknown>) {
  return miniflare.dispatchFetch('http://workspace.test/', {
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

beforeAll(async () => {
  await build({
    stdin: {
      contents: harness,
      loader: 'ts',
      resolveDir: process.cwd(),
      sourcefile: 'workspace-do-harness.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    external: ['cloudflare:workers'],
    outfile: bundlePath,
    logLevel: 'silent',
  });
  miniflare = new Miniflare({
    scriptPath: bundlePath,
    modules: true,
    compatibilityDate: '2026-06-07',
    durableObjects: {
      DOC: { className: 'TopologyDocument', useSQLite: true },
    },
    log: new Log(LogLevel.ERROR),
  });
}, 30_000);

afterAll(async () => {
  await miniflare?.dispose();
  await unlink(bundlePath).catch(() => undefined);
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
});
