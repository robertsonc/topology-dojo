/**
 * Miniflare WebSocket harness for the coordinator's push + presence surface
 * (Packet S1). Like `document-do.test.ts`, the worker entry is TypeScript
 * *source text* fed to esbuild (never a file under `src/`, so the root
 * `tsc --noEmit` program — which lacks the Cloudflare Workers globals — never
 * sees `worker/*.ts`). These suites require `workerd`/WebSocket and so run only
 * in CI, not the local sandbox; the assertions below exercise the hibernation
 * WebSocket API end to end.
 *
 * The harness worker mirrors the real `GET /api/workspaces/:id/socket` route:
 * it injects the actor identity (`actorKind`/`actorLabel`) before handing the
 * upgrade to the DO stub's `fetch`, and forwards a non-upgrade GET straight
 * through so the DO's own 426 path is what the test observes. `/raw-socket`
 * bypasses that injection so the DO's own clamp/allow-list can be asserted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from '../testing/worker-harness.js';
import type { WorkspaceNotice } from './model.js';

const harness = String.raw`
import { TopologyDocument } from './worker/document.ts';
export { TopologyDocument };
const OWNER = '42';
function stubFor(env, workspace) {
  return env.DOC.get(env.DOC.idFromName(OWNER + ':' + workspace));
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const workspace = url.searchParams.get('workspace') ?? 'w1';
    const stub = stubFor(env, workspace);
    // The socket path mirrors the real route: inject actor identity (never
    // trusted from the client) and hand off to the DO. A non-upgrade GET flows
    // through too, so the DO's own 426 is what the test sees.
    if (url.pathname === '/socket') {
      // Mirror the real browser route: drop client-supplied identity, then
      // inject the authenticated session as `user`.
      const as = url.searchParams.get('as') ?? 'alice';
      url.searchParams.delete('actorKind');
      url.searchParams.delete('actorLabel');
      url.searchParams.set('actorKind', 'user');
      url.searchParams.set('actorLabel', as);
      return stub.fetch(new Request(url.toString(), request));
    }
    // Direct DO upgrade — used to assert the coordinator itself clamps and
    // allow-lists query params even when the forwarding route is bypassed.
    if (url.pathname === '/raw-socket') {
      return stub.fetch(new Request(url.toString(), request));
    }
    try {
      const input = await request.json();
      const user = { kind: 'user', id: OWNER };
      const agent = { kind: 'agent', id: OWNER };
      let result;
      switch (input.action) {
        case 'initialize': result = await stub.initialize(OWNER, workspace, input.document); break;
        case 'user': result = await stub.applyUserOperations(OWNER, user, input.commit); break;
        case 'propose': result = await stub.propose(OWNER, agent, input.commit, String(input.title ?? 'Proposal')); break;
        case 'accept': result = await stub.acceptProposal(OWNER, user, String(input.proposalId), String(input.operationId)); break;
        case 'reject': result = await stub.rejectProposal(OWNER, user, String(input.proposalId)); break;
        case 'lease': result = await stub.grantPageLease(OWNER, user, String(input.pageId), 600); break;
        case 'revoke': result = await stub.revokeLease(OWNER, user); break;
        default: return Response.json({ error: 'bad action' }, { status: 400 });
      }
      return Response.json(result ?? null);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }
};
`;

let handle: MiniflareHandle;

function query(workspace: string, extra: Record<string, string> = {}): string {
  return '?' + new URLSearchParams({ workspace, ...extra }).toString();
}

async function call<T>(
  workspace: string,
  input: Record<string, unknown>,
): Promise<T> {
  const response = await handle.fetch('/' + query(workspace), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok)
    throw new Error(`${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

/** A queue over one socket's decoded notices, with a promise-returning `next`. */
interface NoticeStream {
  next(timeoutMs?: number): Promise<WorkspaceNotice>;
  /** Wait for the first notice satisfying `predicate` (drains earlier ones). */
  until(
    predicate: (notice: WorkspaceNotice) => boolean,
    timeoutMs?: number,
  ): Promise<WorkspaceNotice>;
}

async function openSocket(
  workspace: string,
  extra: Record<string, string> = {},
  path = '/socket',
): Promise<{
  ws: { close(): void; send(data: string): void };
  stream: NoticeStream;
}> {
  const response = await handle.fetch(path + query(workspace, extra), {
    headers: { Upgrade: 'websocket' },
  });
  const ws = response.webSocket;
  if (!ws) throw new Error(`no webSocket (status ${response.status})`);
  ws.accept();
  const queued: WorkspaceNotice[] = [];
  const waiters: Array<(notice: WorkspaceNotice) => void> = [];
  ws.addEventListener('message', (event: { data: unknown }) => {
    let parsed: WorkspaceNotice;
    try {
      parsed = JSON.parse(String(event.data)) as WorkspaceNotice;
    } catch {
      return;
    }
    const waiter = waiters.shift();
    if (waiter) waiter(parsed);
    else queued.push(parsed);
  });
  const next = (timeoutMs = 2000): Promise<WorkspaceNotice> => {
    const buffered = queued.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timed out waiting for a notice')),
        timeoutMs,
      );
      waiters.push((notice) => {
        clearTimeout(timer);
        resolve(notice);
      });
    });
  };
  const stream: NoticeStream = {
    next,
    async until(predicate, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const notice = await next(Math.max(1, deadline - Date.now()));
        if (predicate(notice)) return notice;
      }
    },
  };
  return { ws, stream };
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
  const bundle = await buildWorkerBundle(harness, {
    sourcefile: 'workspace-socket-harness.ts',
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

describe('TopologyDocument push + presence socket', () => {
  it('pushes a compact notice after a revision-creating commit', async () => {
    const W = 's1-notice';
    await call(W, {
      action: 'initialize',
      document: { title: 'T', customNodes: [], pages: [page('p1', 'a')] },
    });
    const { stream } = await openSocket(W, { pageId: 'p1' });
    // The join itself broadcasts current state (revision 0).
    const joined = await stream.next();
    expect(joined.type).toBe('notice');
    expect(joined.revision).toBe(0);

    await call(W, {
      action: 'user',
      commit: {
        baseRevision: 0,
        operationId: 'u1',
        operations: [patch('p1', 'a', { x: 30 })],
      },
    });
    const notice = await stream.until((n) => n.revision === 1);
    // Compact notice only — never document content.
    expect(Object.keys(notice).sort()).toEqual([
      'lease',
      'presence',
      'proposalCount',
      'revision',
      'type',
    ]);
    expect(notice.proposalCount).toBe(0);
    expect(notice.lease).toBeNull();
  }, 30_000);

  it('reflects proposal count and lease changes in the notice', async () => {
    const W = 's1-proposal-lease';
    await call(W, {
      action: 'initialize',
      document: { title: 'T', customNodes: [], pages: [page('p1', 'a')] },
    });
    const { stream } = await openSocket(W, { pageId: 'p1' });
    await stream.next(); // drain the join notice

    const proposed = await call<{ proposal: { id: string } }>(W, {
      action: 'propose',
      title: 'move a',
      commit: {
        baseRevision: 0,
        operationId: 'pr1',
        operations: [patch('p1', 'a', { x: 99 })],
      },
    });
    const withProposal = await stream.until((n) => n.proposalCount === 1);
    expect(withProposal.proposalCount).toBe(1);

    await call(W, { action: 'lease', pageId: 'p1' });
    const withLease = await stream.until((n) => n.lease !== null);
    expect(withLease.lease?.scope.pageId).toBe('p1');

    await call(W, { action: 'reject', proposalId: proposed.proposal.id });
    const rejected = await stream.until((n) => n.proposalCount === 0);
    expect(rejected.proposalCount).toBe(0);
  }, 30_000);

  it('tracks presence across two sockets and on close', async () => {
    const W = 's1-presence';
    await call(W, {
      action: 'initialize',
      document: { title: 'T', customNodes: [], pages: [page('p1', 'a')] },
    });
    const first = await openSocket(W, { pageId: 'p1', as: 'alice' });
    await first.stream.next(); // join notice, presence length 1

    const second = await openSocket(W, { pageId: 'p2', as: 'bob' });
    // Both sockets learn there are now two editors.
    const twoOnFirst = await first.stream.until((n) => n.presence.length === 2);
    expect(twoOnFirst.presence.map((p) => p.pageId).sort()).toEqual([
      'p1',
      'p2',
    ]);
    const joinOnSecond = await second.stream.until(
      (n) => n.presence.length === 2,
    );
    expect(joinOnSecond.presence.some((p) => p.label === 'bob')).toBe(true);

    // A presence update from the second socket re-broadcasts to the first.
    second.ws.send(JSON.stringify({ type: 'presence', pageId: 'p9' }));
    const moved = await first.stream.until((n) =>
      n.presence.some((p) => p.pageId === 'p9'),
    );
    expect(moved.presence.length).toBe(2);

    // Closing the second socket drops it from the roster the first sees.
    second.ws.close();
    const oneLeft = await first.stream.until((n) => n.presence.length === 1);
    expect(oneLeft.presence[0]?.pageId).toBe('p1');
  }, 30_000);

  it('resumes cleanly after a reconnect', async () => {
    const W = 's1-reconnect';
    await call(W, {
      action: 'initialize',
      document: { title: 'T', customNodes: [], pages: [page('p1', 'a')] },
    });
    const original = await openSocket(W, { pageId: 'p1' });
    await original.stream.next();
    original.ws.close();

    const reconnected = await openSocket(W, { pageId: 'p1' });
    await reconnected.stream.next(); // fresh join notice
    await call(W, {
      action: 'user',
      commit: {
        baseRevision: 0,
        operationId: 'u1',
        operations: [patch('p1', 'a', { x: 42 })],
      },
    });
    const notice = await reconnected.stream.until((n) => n.revision === 1);
    expect(notice.revision).toBe(1);
    expect(notice.presence.length).toBe(1);
  }, 30_000);

  it('rejects a non-upgrade GET to the socket route with 426', async () => {
    const response = await handle.fetch('/socket' + query('s1-426'), {
      method: 'GET',
    });
    expect(response.status).toBe(426);
  }, 30_000);

  it('ignores a client-supplied actorKind on the browser socket route', async () => {
    const W = 's1-force-user';
    await call(W, {
      action: 'initialize',
      document: { title: 'T', customNodes: [], pages: [page('p1', 'a')] },
    });
    const { stream } = await openSocket(W, {
      pageId: 'p1',
      as: 'alice',
      actorKind: 'agent',
      actorLabel: '<script>x</script>',
    });
    const joined = await stream.next();
    expect(joined.presence).toEqual([
      { kind: 'user', label: 'alice', pageId: 'p1' },
    ]);
  }, 30_000);

  it('clamps and strips actorLabel on a direct DO upgrade', async () => {
    const W = 's1-clamp-label';
    await call(W, {
      action: 'initialize',
      document: { title: 'T', customNodes: [], pages: [page('p1', 'a')] },
    });
    const long = 'z'.repeat(80);
    const { stream } = await openSocket(
      W,
      {
        pageId: 'p1',
        actorKind: 'admin',
        actorLabel: `\u0000${long}`,
      },
      '/raw-socket',
    );
    const joined = await stream.next();
    expect(joined.presence).toEqual([
      { kind: 'user', label: 'z'.repeat(64), pageId: 'p1' },
    ]);
  }, 30_000);
});
