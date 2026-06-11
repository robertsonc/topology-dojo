/**
 * Source references — stable external identity for elements that mirror
 * objects in another system (an SD-WAN orchestrator, a CMDB, …).
 *
 * An element carrying `source` says "I represent <id> of kind <kind> in
 * <system>". That makes live re-imports convergent: an importer matches on
 * the triple and updates the existing element (see `upsertBySource` in
 * api/edit) instead of appending a duplicate. `fetchedAt` records freshness.
 * The renderer ignores `source` entirely; it is contract data only.
 */

export interface SourceRef {
  /** The external system, e.g. "edgeconnect". */
  system: string;
  /** The object kind within that system, e.g. "appliance" | "tunnel" | "flow". */
  kind: string;
  /** The object's id in that system, e.g. an appliance nePk or tunnel id. */
  id: string;
  /** When this element was last refreshed from the source (ISO 8601). */
  fetchedAt?: string;
}

/** An element that may carry an external identity. */
export interface Sourced {
  source?: SourceRef;
}

/** True when two refs name the same external object (fetchedAt ignored). */
export function sameSource(a: SourceRef, b: SourceRef): boolean {
  return a.system === b.system && a.kind === b.kind && a.id === b.id;
}
