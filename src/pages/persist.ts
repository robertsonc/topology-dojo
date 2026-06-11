/**
 * Document persistence — autosave to localStorage + JSON import/export.
 *
 * Pages are already plain JSON, so persistence is just (de)serialization with
 * defensive normalization on the way in (a corrupt or hand-edited file must
 * never crash the editor — it falls back to a valid shape or null).
 */
import type { TopologyDocument, Page } from './model.js';
import { newPageId } from './model.js';
import type { CustomNodeSpec } from '../nodes/spec.js';
import type { LayerDef } from '../api/layers.js';

const KEY = 'topology-dojo:doc';

export function serializeDoc(doc: TopologyDocument): string {
  return JSON.stringify(
    {
      title: doc.title,
      pages: doc.pages,
      customNodes: doc.customNodes,
      ...(doc.layers?.length ? { layers: doc.layers } : {}),
    },
    null,
    2,
  );
}

/** Parse + normalize an unknown value into a valid document, or null if hopeless. */
export function parseDoc(input: unknown): TopologyDocument | null {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.pages) || d.pages.length === 0) return null;

  const pages: Page[] = [];
  for (const raw of d.pages) {
    if (typeof raw !== 'object' || raw === null) continue;
    const p = raw as Record<string, unknown>;
    pages.push({
      id: typeof p.id === 'string' ? p.id : newPageId(),
      name: typeof p.name === 'string' ? p.name : `Frame ${pages.length + 1}`,
      viewBox: typeof p.viewBox === 'string' ? p.viewBox : '0 0 1050 700',
      nodes: Array.isArray(p.nodes) ? (p.nodes as Page['nodes']) : [],
      links: Array.isArray(p.links) ? (p.links as Page['links']) : [],
      anchors: Array.isArray(p.anchors) ? (p.anchors as Page['anchors']) : [],
      zones: Array.isArray(p.zones) ? (p.zones as Page['zones']) : [],
      flowPaths: Array.isArray(p.flowPaths)
        ? (p.flowPaths as Page['flowPaths'])
        : [],
      policyMarkers: Array.isArray(p.policyMarkers)
        ? (p.policyMarkers as Page['policyMarkers'])
        : [],
    });
  }
  if (pages.length === 0) return null;
  const customNodes = Array.isArray(d.customNodes)
    ? (d.customNodes as CustomNodeSpec[])
    : [];
  // Layers: keep only well-formed entries (a string id); drop the rest.
  const layers = Array.isArray(d.layers)
    ? (d.layers as unknown[]).filter(
        (l): l is LayerDef =>
          typeof l === 'object' &&
          l !== null &&
          typeof (l as { id?: unknown }).id === 'string',
      )
    : [];
  return {
    title: typeof d.title === 'string' ? d.title : 'Untitled',
    pages,
    customNodes,
    ...(layers.length ? { layers } : {}),
  };
}

export function saveLocal(doc: TopologyDocument): void {
  try {
    localStorage.setItem(KEY, serializeDoc(doc));
  } catch {
    // Storage unavailable / quota exceeded — non-fatal.
  }
}

export function loadLocal(): TopologyDocument | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? parseDoc(s) : null;
  } catch {
    return null;
  }
}

export function clearLocal(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
