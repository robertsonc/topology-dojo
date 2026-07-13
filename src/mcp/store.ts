/**
 * In-memory topology registry for the MCP server.
 *
 * The server is stateful for ergonomics: an agent calls `create_topology` once,
 * gets back an id, then issues a sequence of small mutations against it (add a
 * node, a link, a zone…) before validating and rendering. The full document JSON
 * is always exportable (`get_topology`) and importable (`import_topology`), so
 * the document contract — not server state — remains the source of truth.
 */
import { addPage, emptyDocument } from '../api/builder.js';
import type { Page, TopologyDocument } from '../pages/model.js';
import { parseDoc } from '../pages/persist.js';

let _seq = 0;
function newId(): string {
  return `t${Date.now().toString(36)}${(_seq++).toString(36)}`;
}

export interface StoreEntry {
  id: string;
  document: TopologyDocument;
}

export class TopologyStore {
  private docs = new Map<string, TopologyDocument>();
  /**
   * Ids explicitly removed since the last persist. Persistence deletes exactly
   * these keys rather than mirroring by set-difference — so with storage shared
   * across a user's sessions, one session can never delete a document another
   * session created (it only ever deletes what it itself removed).
   */
  private pendingDeletes = new Set<string>();

  /** Create a new document seeded with one empty page (so adds work at once). */
  create(title?: string): StoreEntry {
    const document = emptyDocument(title);
    addPage(document, { name: 'Frame 1' });
    const id = newId();
    this.docs.set(id, document);
    this.pendingDeletes.delete(id);
    return { id, document };
  }

  /** Load a document from JSON (the same shape `get_topology` returns). */
  import(json: string | unknown, title?: string): StoreEntry {
    const document = parseDoc(json);
    if (!document) throw new Error('invalid topology document JSON');
    return this.importDocument(document, title);
  }

  /**
   * Insert an already-built document under a fresh id — used by
   * `import_topology`'s `format: 'legacy-studio' | 'auto'` path, where the
   * document comes from `convertLegacyStudio` rather than `parseDoc`.
   */
  importDocument(document: TopologyDocument, title?: string): StoreEntry {
    if (title) document.title = title;
    const id = newId();
    this.docs.set(id, document);
    this.pendingDeletes.delete(id);
    return { id, document };
  }

  get(id: string): TopologyDocument {
    const d = this.docs.get(id);
    if (!d) throw new Error(`unknown topology "${id}"`);
    return d;
  }

  /**
   * Insert a document under a known id — used to rehydrate the registry from a
   * durable backing store (e.g. Durable Object storage) on a cold start, so ids
   * handed out earlier keep resolving. Overwrites any existing entry.
   */
  load(id: string, document: TopologyDocument): void {
    this.docs.set(id, document);
    this.pendingDeletes.delete(id);
  }

  /** Drop a local cache entry without recording a durable deletion. Used when
   * a legacy document has been handed to its canonical workspace coordinator. */
  unload(id: string): boolean {
    const removed = this.docs.delete(id);
    this.pendingDeletes.delete(id);
    return removed;
  }

  list(): { id: string; title: string; pages: number }[] {
    return [...this.docs].map(([id, d]) => ({
      id,
      title: d.title,
      pages: d.pages.length,
    }));
  }

  remove(id: string): boolean {
    const removed = this.docs.delete(id);
    if (removed) this.pendingDeletes.add(id);
    return removed;
  }

  /**
   * Return and clear the ids removed since the last call — the exact set of
   * keys a durable backing store should delete. Draining keeps the next persist
   * from re-issuing deletes it already applied.
   */
  drainPendingDeletes(): string[] {
    const ids = [...this.pendingDeletes];
    this.pendingDeletes.clear();
    return ids;
  }

  /**
   * Resolve a page within a document. `pageIndex` defaults to the LAST page —
   * the one most recently added, i.e. the frame an agent is currently building.
   */
  page(id: string, pageIndex?: number): Page {
    const doc = this.get(id);
    const idx = pageIndex ?? doc.pages.length - 1;
    const page = doc.pages[idx];
    if (!page)
      throw new Error(
        `page index ${idx} out of range (0..${doc.pages.length - 1})`,
      );
    return page;
  }
}
