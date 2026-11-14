/**
 * Find (Ctrl / Cmd + F): what in the document matches a query.
 *
 * Nodes, links and zones on every frame, the current frame's first. A node
 * is found by its label, id, type, sublabel, or a metadata key or value (so
 * by the IP address, hostname or serial stored on it); a link by its label,
 * either port label, id, type or metadata; a zone by its label or id.
 *
 * Pure and DOM-free: `main.ts` draws the list and jumps to the chosen match.
 */
import type { Page } from '../pages/model.js';

export interface FindMatch {
  /** Index of the frame the element is on. */
  pageIndex: number;
  kind: 'node' | 'link' | 'zone';
  id: string;
  /** What the row is called: the element's label, else a stand-in. */
  label: string;
  /** What it is and, when the match was not in the label, why it matched. */
  detail: string;
}

/** Most matches listed. */
export const FIND_LIMIT = 50;

type FindPage = Pick<Page, 'nodes' | 'links'> & {
  zones?: Page['zones'];
};

const text = (v: unknown): string =>
  typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);

/** `text` on one line. */
const oneLine = (v: unknown): string => text(v).replace(/\s+/g, ' ').trim();

/** The first metadata entry whose key or value contains `q`, as "key: value". */
function metaHit(meta: unknown, q: string): string | null {
  if (!meta || typeof meta !== 'object') return null;
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (typeof v === 'object' && v !== null) continue;
    if (k.toLowerCase().includes(q) || text(v).toLowerCase().includes(q))
      return `${k}: ${oneLine(v)}`;
  }
  return null;
}

/**
 * The matches for `query`, the current frame's first, then the other frames
 * in order; on each frame nodes, then links, then zones, in document order.
 * At most `FIND_LIMIT`. An empty query lists the current frame's nodes, so
 * the box doubles as a jump list.
 */
export function findInDocument(
  pages: readonly FindPage[],
  query: string,
  currentPage: number,
): FindMatch[] {
  const q = query.trim().toLowerCase();
  const has = (v: unknown): boolean => text(v).toLowerCase().includes(q);
  const out: FindMatch[] = [];
  const order = [
    currentPage,
    ...pages.map((_, i) => i).filter((i) => i !== currentPage),
  ].filter((i) => i >= 0 && i < pages.length);

  for (const pageIndex of order) {
    const page = pages[pageIndex]!;
    const nameOf = (id: string): string =>
      oneLine(page.nodes.find((n) => n.id === id)?.label) || id;

    for (const n of page.nodes) {
      let detail: string | null = null;
      if (!q || has(n.label) || has(n.id) || has(n.type)) detail = n.type;
      else if (has(n.sublabel)) detail = `${n.type} · ${oneLine(n.sublabel)}`;
      else {
        const meta = metaHit(n.meta, q);
        if (meta) detail = `${n.type} · ${meta}`;
      }
      if (detail === null) continue;
      out.push({
        pageIndex,
        kind: 'node',
        id: n.id,
        label: oneLine(n.label) || '(no label)',
        detail,
      });
      if (out.length >= FIND_LIMIT) return out;
    }
    // An empty query is a jump list of the frame's nodes, nothing more.
    if (!q) return out;

    for (const l of page.links) {
      const link = l as typeof l & {
        fromLabel?: unknown;
        toLabel?: unknown;
        meta?: unknown;
      };
      let detail: string | null = null;
      if (has(l.label) || has(l.id) || has(l.type)) detail = `${l.type} link`;
      else if (has(link.fromLabel))
        detail = `${l.type} link · ${oneLine(link.fromLabel)}`;
      else if (has(link.toLabel))
        detail = `${l.type} link · ${oneLine(link.toLabel)}`;
      else {
        const meta = metaHit(link.meta, q);
        if (meta) detail = `${l.type} link · ${meta}`;
      }
      if (detail === null) continue;
      out.push({
        pageIndex,
        kind: 'link',
        id: l.id,
        // A link with no label of its own is named by its two ends.
        label: oneLine(l.label) || `${nameOf(l.from)} — ${nameOf(l.to)}`,
        detail,
      });
      if (out.length >= FIND_LIMIT) return out;
    }

    for (const z of page.zones ?? []) {
      if (!has(z.label) && !has(z.id)) continue;
      out.push({
        pageIndex,
        kind: 'zone',
        id: z.id,
        label: oneLine(z.label) || '(no label)',
        detail: 'zone',
      });
      if (out.length >= FIND_LIMIT) return out;
    }
  }
  return out;
}
