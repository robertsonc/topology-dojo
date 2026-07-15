/**
 * IndexedDB offline cache for shared workspaces (Packet S3).
 *
 * The browser already holds the last-synced workspace snapshot and any
 * unacknowledged operation batch in memory (see `ActiveWorkspace` in
 * `src/ui/workspace-panel.ts`). The `localStorage` "workspace link" persists a
 * lightweight *pointer* (which id to reopen, the synced fingerprint, and the
 * pending batch) but deliberately not the heavy document, so it cannot restore
 * editable state while the network is unreachable. This module adds a durable,
 * per-workspace cache of the full confirmed snapshot **plus** the unacked batch,
 * so that after a crash or offline period the editor can reopen the last state
 * without the server and replay the pending batch when back online. Replay is
 * idempotent by construction: the coordinator dedupes commits by `operationId`.
 *
 * Design constraints (from the packet spec):
 *   - **Feature-detect** IndexedDB. If it is absent (old runtime), or any call
 *     throws (Safari private mode, quota, a corrupt DB), every operation
 *     degrades to a **no-op**: writes silently do nothing, reads return `null`
 *     / `[]`. A cache failure must never break editing or sync.
 *   - **Storage-agnostic / testable without a browser.** The `IDBFactory` is
 *     injectable (defaulting to `globalThis.indexedDB`), so tests pass an
 *     in-memory implementation (`fake-indexeddb`) and exercise the real
 *     promisified IndexedDB glue rather than a hand-rolled stand-in.
 *
 * The public API is intentionally tiny and promise-based; none of it rejects on
 * a storage failure (the promise resolves to the degraded fallback instead).
 */
import type { TopologyDocument } from '../pages/model.js';
import type { CommitRequest } from './model.js';

/** One cached workspace: the confirmed snapshot (document @ revision) plus any
 * unacknowledged commit batch to replay on reconnect. Keyed by workspace id. */
export interface CachedWorkspaceRecord {
  id: string;
  revision: number;
  document: TopologyDocument;
  /** The unacked batch (idempotent to replay), or null when fully synced. */
  pending: CommitRequest | null;
  /** Epoch millis of the last write — lets a future sweep evict stale entries. */
  updatedAt: number;
}

/** The caller-supplied fields of a cache write (`id`/`updatedAt` are derived). */
export interface CacheWorkspaceInput {
  revision: number;
  document: TopologyDocument;
  pending: CommitRequest | null;
}

const DB_NAME = 'topology-dojo:workspace-cache';
const STORE = 'workspaces';
const DB_VERSION = 1;

/**
 * Resolve the IndexedDB factory to use. An explicit factory (tests) always
 * wins; otherwise probe `globalThis.indexedDB`. Returns `null` when the feature
 * is absent or even *reading* the global throws — the no-op fallback.
 */
function resolveFactory(explicit?: IDBFactory | null): IDBFactory | null {
  if (explicit !== undefined) return explicit;
  try {
    const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    return factory ?? null;
  } catch {
    return null;
  }
}

/** Promisify a single `IDBRequest`. */
function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error('indexeddb request failed'));
  });
}

/** Open (and, on first use, create the object store for) the cache database. */
function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexeddb open failed'));
    req.onblocked = () => reject(new Error('indexeddb open blocked'));
  });
}

/**
 * Run `fn` inside one transaction against the cache store, awaiting durable
 * completion (`tx.oncomplete`), and return its result. Any failure — feature
 * absent, open throws, transaction aborts, quota — resolves to `fallback`
 * instead of rejecting, so callers never have to guard the cache.
 */
async function withStore<T>(
  factory: IDBFactory | null,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!factory) return fallback;
  let db: IDBDatabase | null = null;
  try {
    db = await openDb(factory);
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('indexeddb tx failed'));
      tx.onabort = () => reject(tx.error ?? new Error('indexeddb tx aborted'));
    });
    const result = await fn(store);
    await done;
    return result;
  } catch {
    return fallback;
  } finally {
    try {
      db?.close();
    } catch {
      // already closing/closed — nothing to do
    }
  }
}

/**
 * Cache (put) the confirmed snapshot + unacked batch for one workspace. Returns
 * `true` when the write durably committed, `false` when it degraded to a no-op.
 * Never rejects — safe to fire-and-forget from the sync path.
 */
export function cacheWorkspace(
  id: string,
  input: CacheWorkspaceInput,
  factory?: IDBFactory | null,
): Promise<boolean> {
  const record: CachedWorkspaceRecord = {
    id,
    revision: input.revision,
    document: input.document,
    pending: input.pending,
    updatedAt: Date.now(),
  };
  return withStore(
    resolveFactory(factory),
    'readwrite',
    async (store) => {
      await promisifyRequest(store.put(record));
      return true;
    },
    false,
  );
}

/**
 * Read the cached record for one workspace id, or `null` when nothing is cached
 * / the cache is unavailable. Never rejects.
 */
export function readCachedWorkspace(
  id: string,
  factory?: IDBFactory | null,
): Promise<CachedWorkspaceRecord | null> {
  return withStore(
    resolveFactory(factory),
    'readonly',
    async (store) => {
      const value = await promisifyRequest(
        store.get(id) as IDBRequest<CachedWorkspaceRecord | undefined>,
      );
      return value ?? null;
    },
    null,
  );
}

/** Remove one workspace's cached record (on close/detach). Never rejects. */
export function clearCachedWorkspace(
  id: string,
  factory?: IDBFactory | null,
): Promise<boolean> {
  return withStore(
    resolveFactory(factory),
    'readwrite',
    async (store) => {
      await promisifyRequest(store.delete(id));
      return true;
    },
    false,
  );
}

/** List every cached workspace record (unordered). Empty when unavailable. */
export function listCachedWorkspaces(
  factory?: IDBFactory | null,
): Promise<CachedWorkspaceRecord[]> {
  return withStore(
    resolveFactory(factory),
    'readonly',
    async (store) => {
      const values = await promisifyRequest(
        store.getAll() as IDBRequest<CachedWorkspaceRecord[]>,
      );
      return values ?? [];
    },
    [],
  );
}
