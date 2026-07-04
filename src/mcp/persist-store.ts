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

export interface PersistOptions {
  /**
   * Whether the delete (mirror) pass may run. Defaults to true. The caller MUST
   * pass `false` when the preceding rehydrate did not complete successfully:
   * an empty/partial in-memory registry would otherwise delete every persisted
   * document as "not current" — turning one transient storage error into total
   * data loss.
   */
  allowDelete?: boolean;
  /** Ids present in storage that failed to load; never delete these. */
  preserve?: Set<string>;
}

/**
 * Write the registry back to storage: (re)serialize every current document and
 * (when `allowDelete`) delete keys for any that were removed since the last
 * write. Keys in `preserve` are never deleted. O(n) in the number of documents
 * held this session (single-digit in practice).
 */
export async function persistStore(
  store: TopologyStore,
  storage: DocStorage,
  opts: PersistOptions = {},
): Promise<void> {
  const current = new Set(store.list().map((e) => e.id));
  if (opts.allowDelete ?? true) {
    const preserve = opts.preserve ?? new Set<string>();
    const existing = await storage.list<string>({ prefix: DOC_PREFIX });
    for (const key of existing.keys()) {
      const id = key.slice(DOC_PREFIX.length);
      if (!current.has(id) && !preserve.has(id)) await storage.delete(key);
    }
  }
  for (const id of current)
    await storage.put(DOC_PREFIX + id, serializeDoc(store.get(id)));
}
