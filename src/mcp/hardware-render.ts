/**
 * Catalog plumbing for render tools (hw-catalog Phase 4). Wire-sheet pages
 * need the hardware catalog to draw panels; the catalog loads
 * asynchronously. Documents without a wire-sheet page keep the synchronous
 * path and exactly today's output; the others are snapshotted (the store
 * may change while the catalog loads) and rendered once it arrives. A
 * catalog that cannot load renders the page logical — as the browser does.
 */
import type { TopologyDocument } from '../pages/model.js';
import type { CatalogLoader } from '../catalog/loader.js';
import {
  docNeedsHardware,
  type WiresheetHardware,
} from '../render/wiresheet.js';

export interface HardwareRender {
  hardware?: WiresheetHardware;
  /** Why wire-sheet pages drew logical, when they did. */
  unavailable?: string;
}

/**
 * Run `fn` with the document's hardware catalog when it needs one:
 * synchronously (no catalog) for every other document.
 */
export function withHardware<T>(
  doc: TopologyDocument,
  loader: CatalogLoader | undefined,
  fn: (doc: TopologyDocument, hw: HardwareRender) => T,
): T | Promise<T> {
  if (!docNeedsHardware(doc)) return fn(doc, {});
  const snapshot = structuredClone(doc);
  if (!loader)
    return fn(snapshot, {
      unavailable: 'this server has no hardware catalog',
    });
  return loader.get(snapshot.catalogVersion).then(
    (catalog) => fn(snapshot, { hardware: { catalog } }),
    (err: unknown) =>
      fn(snapshot, {
        unavailable: `catalog ${snapshot.catalogVersion ?? '(latest)'} could not be loaded: ${
          err instanceof Error ? err.message : String(err)
        }`,
      }),
  );
}
