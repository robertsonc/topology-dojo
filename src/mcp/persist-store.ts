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

/** Load every persisted document back into the registry under its known id. */
export async function rehydrateStore(
  store: TopologyStore,
  storage: DocStorage,
): Promise<void> {
  const entries = await storage.list<string>({ prefix: DOC_PREFIX });
  for (const [key, json] of entries) {
    const doc = parseDoc(json);
    if (doc) store.load(key.slice(DOC_PREFIX.length), doc);
  }
}

/**
 * Write the registry back to storage: (re)serialize every current document and
 * delete keys for any that were removed since the last write. O(n) in the number
 * of documents held this session (single-digit in practice).
 */
export async function persistStore(
  store: TopologyStore,
  storage: DocStorage,
): Promise<void> {
  const current = new Set(store.list().map((e) => e.id));
  const existing = await storage.list<string>({ prefix: DOC_PREFIX });
  for (const key of existing.keys())
    if (!current.has(key.slice(DOC_PREFIX.length))) await storage.delete(key);
  for (const id of current)
    await storage.put(DOC_PREFIX + id, serializeDoc(store.get(id)));
}
