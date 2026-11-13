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
      // Baseline = the document as THIS code serializes it, not the stored
      // bytes: an older stored shape that parses to the same document must not
      // read as "changed" and be written back by an unrelated persist.
      store.markPersisted(id, serializeDoc(doc));
      loaded.push(id);
    } else {
      failed.push(id);
    }
  }
  return { loaded, failed };
}

/**
 * Write the store back to durable storage: delete the keys for documents this
 * session explicitly removed, then write every document this session changed.
 *
 * Storage is shared across all of a user's MCP sessions, and each session
 * holds its own in-memory copy, so both halves are scoped to what THIS session
 * did:
 *
 * - Deletion is EXPLICIT — driven by `store.drainPendingDeletes()`, not a
 *   set-difference against what's in storage. A set-difference mirror would
 *   let a session that only loaded a subset delete documents a concurrent
 *   session just created, and would let an empty store (e.g. after a failed
 *   rehydrate) wipe everything.
 * - Writes are CHANGE-ONLY — a document is written only when its serialized
 *   form differs from the copy this session last saw in storage. Re-writing
 *   every held document would let a session that merely loaded a document
 *   put its stale copy back after another session deleted or edited it
 *   (#302). A session can still only clobber a document it actually changed.
 *
 * O(n) serializations in the documents held this session (single-digit), and
 * one storage write per changed document.
 */
export async function persistStore(
  store: TopologyStore,
  storage: DocStorage,
): Promise<void> {
  const current = new Set(store.list().map((e) => e.id));
  for (const id of store.drainPendingDeletes())
    if (!current.has(id)) await storage.delete(DOC_PREFIX + id);
  for (const id of current) {
    const json = serializeDoc(store.get(id));
    if (json === store.persistedJson(id)) continue;
    await storage.put(DOC_PREFIX + id, json);
    store.markPersisted(id, json);
  }
}
