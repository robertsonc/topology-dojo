/**
 * Durable persistence for the MCP `TopologyStore`.
 *
 * The Worker runs the MCP server inside a Durable Object that hibernates
 * between requests, dropping in-memory fields — so the registry must be mirrored
 * to durable storage or created topologies vanish non-deterministically. These
 * are pure functions over a minimal key/value interface (satisfied by
 * `DurableObjectStorage`), so the rehydrate/persist contract is unit-testable
 * without a Worker runtime.
 */
import type { TopologyStore } from './store.js';
import { parseDoc, serializeDoc } from '../pages/persist.js';

/** Storage key prefix for one persisted topology document. */
export const DOC_PREFIX = 'tdoc:';

/** The slice of `DurableObjectStorage` this module needs. */
export interface DocStorage {
  list<T = string>(options: { prefix: string }): Promise<Map<string, T>>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<unknown>;
}

/** Outcome of a rehydrate: which ids loaded, and which were present but
 * unparseable. `failed` ids must be preserved (not mirror-deleted) on the next
 * persist, so a single corrupt document can't cause the rest to be dropped. */
export interface RehydrateResult {
  loaded: string[];
  failed: string[];
}

/** Load every persisted document back into the registry under its known id. */
export async function rehydrateStore(
  store: TopologyStore,
  storage: DocStorage,
): Promise<RehydrateResult> {
  const entries = await storage.list<string>({ prefix: DOC_PREFIX });
  const loaded: string[] = [];
  const failed: string[] = [];
  for (const [key, json] of entries) {
    const id = key.slice(DOC_PREFIX.length);
    // Isolate each document: a single unparseable payload must not abort the
    // whole load (which would leave the registry empty and — with the delete
    // pass below — wipe every other stored topology).
    let doc = null;
    try {
      doc = parseDoc(json);
    } catch {
      doc = null;
    }
    if (doc) {
      store.load(id, doc);
      loaded.push(id);
    } else {
      failed.push(id);
    }
  }
  return { loaded, failed };
}

/**
 * Write the store back to durable storage: delete the keys for documents this
 * session explicitly removed, then (re)serialize every current document.
 *
 * Deletion is EXPLICIT — driven by `store.drainPendingDeletes()`, not a
 * set-difference against what's in storage. This matters because storage is
 * shared across all of a user's MCP sessions: a set-difference mirror would let
 * a session that only loaded a subset delete documents a concurrent session
 * just created, and would let an empty store (e.g. after a failed rehydrate)
 * wipe everything. Explicit deletion removes only what this session removed.
 * `put` is idempotent and only ever adds/updates, so it's safe under
 * concurrency. O(n) in the documents held this session (single-digit).
 */
export async function persistStore(
  store: TopologyStore,
  storage: DocStorage,
): Promise<void> {
  const current = new Set(store.list().map((e) => e.id));
  for (const id of store.drainPendingDeletes())
    if (!current.has(id)) await storage.delete(DOC_PREFIX + id);
  for (const id of current)
    await storage.put(DOC_PREFIX + id, serializeDoc(store.get(id)));
}
