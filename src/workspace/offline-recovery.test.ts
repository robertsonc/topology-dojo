/**
 * Simulated offline → replay → conflict tests (Packet S3).
 *
 * These are pure/unit tests around the offline cache module + the workspace
 * commit path (`commitWorkspaceOperations`) — they do not boot a real editor or
 * network. They characterize the three recovery invariants the packet requires:
 *
 *   (a) a pending batch cached "offline" replays on reconnect and commits
 *       exactly once — a second replay carrying the same `operationId` is a
 *       server-side no-op (the coordinator dedupes by `request:<operationId>`),
 *       which we simulate here with an idempotent fake coordinator;
 *   (b) a cached snapshot restores the full document (offline-capable reopen);
 *   (c) a stale cached `baseRevision` routes through the *existing* conflict
 *       path — `commitWorkspaceOperations` returns a typed `ok:false` conflict
 *       (HTTP 409), never a throw and never a new bespoke conflict path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { commitWorkspaceOperations } from './client.js';
import {
  cacheWorkspace,
  readCachedWorkspace,
  type CacheWorkspaceInput,
} from './offline.js';
import type { CommitRequest, CommitResult, OperationSummary } from './model.js';
import type { TopologyDocument } from '../pages/model.js';

const DOC: TopologyDocument = {
  title: 'Recoverable diagram',
  pages: [],
  customNodes: [],
};

const SUMMARY: OperationSummary = {
  count: 1,
  byType: { 'page.patch': 1 },
  affectedPageIds: ['page_1'],
  affectedElementIds: [],
  descriptions: ['Rename page'],
};

function pending(operationId: string, baseRevision = 4): CommitRequest {
  return {
    baseRevision,
    operationId,
    operations: [
      {
        type: 'page.patch',
        pageId: 'page_1',
        patch: { set: { name: 'Renamed' } },
      },
    ],
  };
}

function input(
  overrides: Partial<CacheWorkspaceInput> = {},
): CacheWorkspaceInput {
  return { revision: 4, document: DOC, pending: null, ...overrides };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Packet S3 recovery — offline replay is idempotent', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('replays a cached pending batch and commits exactly once across repeats', async () => {
    const factory = new IDBFactory();
    const batch = pending('ui_11111111-1111-1111-1111-111111111111');

    // Persist the unacked batch while "offline" (the sync path caches this
    // before the network call and on the offline-retry catch).
    await cacheWorkspace('ws_a', input({ pending: batch }), factory);

    // A fake coordinator that dedupes by operationId: the first commit applies
    // and advances the revision; a replay of the same operationId returns the
    // cached result without re-applying.
    const applied = new Map<string, CommitResult>();
    let applyCount = 0;
    globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as CommitRequest;
      const cached = applied.get(body.operationId);
      if (cached) return jsonResponse(cached, 200); // idempotent replay
      applyCount += 1;
      const result: CommitResult = {
        ok: true,
        revision: body.baseRevision + 1,
        rebased: false,
        summary: SUMMARY,
      };
      applied.set(body.operationId, result);
      return jsonResponse(result, 200);
    }) as typeof fetch;

    // On reconnect the recovery path reads the cached batch and replays it.
    const recovered = await readCachedWorkspace('ws_a', factory);
    expect(recovered!.pending).toEqual(batch);

    const first = await commitWorkspaceOperations('ws_a', recovered!.pending!);
    const second = await commitWorkspaceOperations('ws_a', recovered!.pending!);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // Same operationId → coordinator applied the batch only once.
    expect(applyCount).toBe(1);
    expect((first as { revision: number }).revision).toBe(5);
    expect((second as { revision: number }).revision).toBe(5);
  });
});

describe('Packet S3 recovery — a cached snapshot restores the document', () => {
  it('round-trips the full document + revision for an offline reopen', async () => {
    const factory = new IDBFactory();
    const doc: TopologyDocument = {
      title: 'Offline reopen',
      pages: [],
      customNodes: [],
    };
    await cacheWorkspace(
      'ws_b',
      { revision: 12, document: doc, pending: null },
      factory,
    );

    const restored = await readCachedWorkspace('ws_b', factory);
    expect(restored).not.toBeNull();
    expect(restored!.revision).toBe(12);
    // Deep structural equality — the editor can reopen this without the server.
    expect(restored!.document).toEqual(doc);
    expect(restored!.pending).toBeNull();
  });
});

describe('Packet S3 recovery — a stale cached revision hits the conflict path', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('surfaces the existing typed conflict (409), not a throw or a new path', async () => {
    const factory = new IDBFactory();
    // The cached batch's baseRevision (4) is behind the server head (7) and
    // touches the same field a later commit changed → the coordinator conflicts.
    const staleBatch = pending('ui_22222222-2222-2222-2222-222222222222', 4);
    await cacheWorkspace('ws_c', input({ pending: staleBatch }), factory);

    globalThis.fetch = vi.fn(async () =>
      jsonResponse(
        {
          ok: false,
          code: 'conflict',
          revision: 7,
          message: 'This change conflicts with a newer edit to the same field.',
          conflictingTargets: ['page:page_1#name'],
        } satisfies CommitResult,
        409,
      ),
    ) as typeof fetch;

    const recovered = await readCachedWorkspace('ws_c', factory);
    // Must not throw — a conflict is a typed result the recovery path handles.
    const result = await commitWorkspaceOperations('ws_c', recovered!.pending!);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('conflict');
      expect(result.revision).toBe(7);
      expect(result.conflictingTargets).toEqual(['page:page_1#name']);
    }
  });
});
