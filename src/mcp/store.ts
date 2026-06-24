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

  /** Create a new document seeded with one empty page (so adds work at once). */
  create(title?: string): StoreEntry {
    const document = emptyDocument(title);
    addPage(document, { name: 'Frame 1' });
    const id = newId();
    this.docs.set(id, document);
    return { id, document };
  }

  /** Load a document from JSON (the same shape `get_topology` returns). */
  import(json: string | unknown, title?: string): StoreEntry {
    const document = parseDoc(json);
    if (!document) throw new Error('invalid topology document JSON');
    if (title) document.title = title;
    const id = newId();
    this.docs.set(id, document);
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
  }

  list(): { id: string; title: string; pages: number }[] {
    return [...this.docs].map(([id, d]) => ({
      id,
      title: d.title,
      pages: d.pages.length,
    }));
  }

  remove(id: string): boolean {
    return this.docs.delete(id);
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
