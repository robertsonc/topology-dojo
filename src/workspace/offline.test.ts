/**
 * Unit tests for the IndexedDB offline workspace cache (Packet S3).
 *
 * The repo's test environment is Node (`vite.config.ts` → `test.environment:
 * 'node'`), so there is no browser IndexedDB. The module takes an injectable
 * `IDBFactory`; here we inject `fake-indexeddb`'s in-memory factory (a
 * devDependency) so the *real* promisified IndexedDB glue is exercised — put /
 * get / clear / list round-trips, not a hand-rolled stand-in. Separately we
 * assert the two degraded paths the spec requires: feature-absent (factory
 * `null`) and a throwing/failing factory both no-op gracefully.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  cacheWorkspace,
  clearCachedWorkspace,
  listCachedWorkspaces,
  readCachedWorkspace,
  type CacheWorkspaceInput,
} from './offline.js';
import type { TopologyDocument } from '../pages/model.js';
import type { CommitRequest } from './model.js';

const DOC: TopologyDocument = {
  title: 'Cached diagram',
  pages: [],
  customNodes: [],
};

const PENDING: CommitRequest = {
  baseRevision: 4,
  operationId: 'ui_11111111-1111-1111-1111-111111111111',
  operations: [
    {
      type: 'page.patch',
      pageId: 'page_1',
      patch: { set: { name: 'Renamed' } },
    },
  ],
};

function input(
  overrides: Partial<CacheWorkspaceInput> = {},
): CacheWorkspaceInput {
  return { revision: 4, document: DOC, pending: null, ...overrides };
}

describe('offline workspace cache — round-trip (fake IndexedDB)', () => {
  let factory: IDBFactory;

  beforeEach(() => {
    // A fresh in-memory database per test keeps them independent.
    factory = new IDBFactory();
  });

  it('puts then reads back a snapshot record', async () => {
    expect(await cacheWorkspace('ws_a', input(), factory)).toBe(true);
    const record = await readCachedWorkspace('ws_a', factory);
    expect(record).not.toBeNull();
    expect(record!.id).toBe('ws_a');
    expect(record!.revision).toBe(4);
    expect(record!.document.title).toBe('Cached diagram');
    expect(record!.pending).toBeNull();
    expect(typeof record!.updatedAt).toBe('number');
  });

  it('persists the unacknowledged pending batch for replay', async () => {
    await cacheWorkspace('ws_a', input({ pending: PENDING }), factory);
    const record = await readCachedWorkspace('ws_a', factory);
    expect(record!.pending).toEqual(PENDING);
    expect(record!.pending!.operationId).toBe(PENDING.operationId);
  });

  it('overwrites the record for the same id (keyPath = id)', async () => {
    await cacheWorkspace(
      'ws_a',
      input({ revision: 4, pending: PENDING }),
      factory,
    );
    await cacheWorkspace(
      'ws_a',
      input({ revision: 5, pending: null }),
      factory,
    );
    const record = await readCachedWorkspace('ws_a', factory);
    expect(record!.revision).toBe(5);
    expect(record!.pending).toBeNull();
    expect(await listCachedWorkspaces(factory)).toHaveLength(1);
  });

  it('returns null for an unknown id', async () => {
    expect(await readCachedWorkspace('ws_missing', factory)).toBeNull();
  });

  it('clears a cached record', async () => {
    await cacheWorkspace('ws_a', input(), factory);
    expect(await clearCachedWorkspace('ws_a', factory)).toBe(true);
    expect(await readCachedWorkspace('ws_a', factory)).toBeNull();
  });

  it('lists all cached workspaces', async () => {
    await cacheWorkspace('ws_a', input(), factory);
    await cacheWorkspace('ws_b', input({ revision: 9 }), factory);
    const all = await listCachedWorkspaces(factory);
    expect(all.map((r) => r.id).sort()).toEqual(['ws_a', 'ws_b']);
  });
});

describe('offline workspace cache — graceful degradation', () => {
  it('no-ops when IndexedDB is absent (factory null)', async () => {
    expect(await cacheWorkspace('ws_a', input(), null)).toBe(false);
    expect(await readCachedWorkspace('ws_a', null)).toBeNull();
    expect(await clearCachedWorkspace('ws_a', null)).toBe(false);
    expect(await listCachedWorkspaces(null)).toEqual([]);
  });

  it('no-ops (never rejects) when the factory throws — quota / private mode', async () => {
    // A factory whose `open` throws stands in for a browser that surfaces the
    // feature but denies it (Safari private mode, exhausted quota).
    const throwing = {
      open() {
        throw new Error('QuotaExceededError');
      },
    } as unknown as IDBFactory;

    await expect(cacheWorkspace('ws_a', input(), throwing)).resolves.toBe(
      false,
    );
    await expect(readCachedWorkspace('ws_a', throwing)).resolves.toBeNull();
    await expect(clearCachedWorkspace('ws_a', throwing)).resolves.toBe(false);
    await expect(listCachedWorkspaces(throwing)).resolves.toEqual([]);
  });

  it('no-ops when an open request errors asynchronously', async () => {
    // `open` returns a request object that fires `onerror` on the next tick —
    // the async failure mode (corrupt DB, VersionError) must also degrade.
    const failing = {
      open() {
        const req: Record<string, unknown> = {
          error: new Error('VersionError'),
          result: undefined,
        };
        queueMicrotask(() => {
          (req.onerror as ((this: unknown) => void) | undefined)?.call(req);
        });
        return req as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;

    await expect(cacheWorkspace('ws_a', input(), failing)).resolves.toBe(false);
    await expect(readCachedWorkspace('ws_a', failing)).resolves.toBeNull();
  });
});
