/**
 * The mutation half of the headless authoring API — update / remove / upsert
 * existing elements, complementing the add-only construction ops in builder.
 * DOM-free, like everything in api/.
 *
 * Element ids are unique across a whole page (validate enforces this), so an
 * element is addressed by bare id and these ops locate its collection. All
 * mutation is in place — collections are never reassigned, so references into
 * the page stay valid.
 *
 * Patch semantics: shallow merge of the given keys; a `null` value deletes the
 * key; `id` can never be changed. This is what lets a live importer refresh a
 * document in place instead of rebuilding it.
 */
import type { Page } from '../pages/model.js';
import { cascadeEndpointRemoval } from '../pages/cascade.js';
import { sameSource, type SourceRef } from './source.js';
import {
  addFlowPath,
  addLink,
  addNode,
  addPolicyMarker,
  addZone,
  type FlowPathInput,
  type LinkInput,
  type NodeInput,
  type PolicyMarkerInput,
  type ZoneInput,
} from './builder.js';

export type ElementKind =
  | 'node'
  | 'link'
  | 'anchor'
  | 'zone'
  | 'flowPath'
  | 'policyMarker';

/** The element kinds an upsert can target (anchors carry no source). */
export type SourcedKind = Exclude<ElementKind, 'anchor'>;

interface Located {
  kind: ElementKind;
  element: Record<string, unknown>;
  collection: Record<string, unknown>[];
  index: number;
}

/** Locate an element (any kind) by its page-unique id. */
function locate(page: Page, id: string): Located | null {
  const collections: [ElementKind, unknown[]][] = [
    ['node', page.nodes],
    ['link', page.links],
    ['anchor', page.anchors],
    ['zone', page.zones],
    ['flowPath', page.flowPaths],
    ['policyMarker', page.policyMarkers],
  ];
  for (const [kind, raw] of collections) {
    const collection = raw as Record<string, unknown>[];
    const index = collection.findIndex((e) => e.id === id);
    if (index >= 0)
      return { kind, element: collection[index]!, collection, index };
  }
  return null;
}

export interface UpdateResult {
  kind: ElementKind;
  element: Record<string, unknown>;
}

/**
 * Structurally-required fields per element kind — a patch may never delete
 * these (null) or set them to the wrong shape, because doing so produces a
 * document that later crashes the cascade/renderer/`parseDoc` (e.g. a zone
 * whose `nodes` array is gone). `id` is guarded separately.
 */
const REQUIRED_FIELDS: Record<ElementKind, string[]> = {
  node: ['type', 'x', 'y'],
  link: ['type', 'from', 'to'],
  anchor: ['x', 'y'],
  zone: ['nodes'],
  flowPath: ['waypoints'],
  policyMarker: ['nodeId', 'type'],
};

/**
 * Patch an element in place: merge the given keys, delete keys set to `null`.
 * Throws on an unknown id, an attempt to change `id`, or a patch that would
 * delete or malform a structurally-required field.
 */
export function updateElement(
  page: Page,
  id: string,
  patch: Record<string, unknown>,
): UpdateResult {
  const found = locate(page, id);
  if (!found) throw new Error(`unknown element "${id}"`);
  const required = REQUIRED_FIELDS[found.kind];
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id') {
      if (v !== undefined && v !== id)
        throw new Error('element id cannot be changed');
      continue;
    }
    if (v === null) {
      if (required.includes(k))
        throw new Error(`cannot delete required ${found.kind} field "${k}"`);
      delete found.element[k];
      continue;
    }
    if (v === undefined) continue;
    // Type-guard the fields whose shape the rest of the system relies on.
    if ((k === 'nodes' || k === 'waypoints') && !Array.isArray(v))
      throw new Error(`${found.kind} field "${k}" must be an array`);
    if ((k === 'x' || k === 'y') && !Number.isFinite(v as number))
      throw new Error(`${found.kind} field "${k}" must be a finite number`);
    found.element[k] = v;
  }
  return { kind: found.kind, element: found.element };
}

export interface RemoveResult {
  removed: ElementKind;
  /** Dependents removed or cleaned alongside (zeros when cascade is off). */
  cascaded: {
    links: number;
    policyMarkers: number;
    flowPaths: number;
    zoneMemberships: number;
    waypoints: number;
    childZones: number;
  };
}

/**
 * Remove an element by id. With `cascade` (the default), dependents are
 * removed or cleaned too: links on a removed endpoint, markers on a removed
 * node, zone memberships, flow-path waypoints (a path left with <2 waypoints
 * is removed), hop annotations on removed waypoints/links, `parentZone` of
 * child zones, and `flowPathId` on markers whose flow path went away. Without
 * cascade the dangling references are left for `validate` to flag.
 */
export function removeElement(
  page: Page,
  id: string,
  opts: { cascade?: boolean } = {},
): RemoveResult {
  const cascade = opts.cascade ?? true;
  const found = locate(page, id);
  if (!found) throw new Error(`unknown element "${id}"`);
  found.collection.splice(found.index, 1);

  const cascaded = {
    links: 0,
    policyMarkers: 0,
    flowPaths: 0,
    zoneMemberships: 0,
    waypoints: 0,
    childZones: 0,
  };
  if (!cascade) return { removed: found.kind, cascaded };

  const droppedFlowPaths: string[] = found.kind === 'flowPath' ? [id] : [];

  if (found.kind === 'node' || found.kind === 'anchor') {
    // Shared with the editor's deleteSelected — one cascade implementation
    // (pages/cascade.ts) keeps gesture and headless semantics identical.
    const c = cascadeEndpointRemoval(page, new Set([id]));
    cascaded.links = c.links;
    cascaded.policyMarkers = c.policyMarkers;
    cascaded.zoneMemberships = c.zoneMemberships;
    cascaded.flowPaths = c.flowPaths;
    cascaded.waypoints = c.waypoints;
    // The helper already cleared flowPathId pointers for the paths it dropped.
  }

  if (found.kind === 'zone') {
    for (const z of page.zones)
      if (z.parentZone === id) {
        delete z.parentZone;
        cascaded.childZones += 1;
      }
  }

  // Markers pointing at a flow path that no longer exists lose the pointer.
  for (const fpId of droppedFlowPaths)
    for (const m of page.policyMarkers)
      if (m.flowPathId === fpId) delete m.flowPathId;

  return { removed: found.kind, cascaded };
}

export interface UpsertResult {
  created: boolean;
  kind: SourcedKind;
  element: Record<string, unknown>;
}

/** Per-kind create requirements an upsert must satisfy when nothing matches. */
const CREATE_REQUIRED: Record<SourcedKind, string[]> = {
  node: ['type', 'x', 'y'],
  link: ['type', 'from', 'to'],
  zone: [],
  flowPath: ['waypoints'],
  policyMarker: ['nodeId', 'type'],
};

/**
 * Converge an element onto external data: if some element of `kind` carries
 * the same source (system + kind + id), patch it with `props` and refresh the
 * source ref; otherwise create it (props must then include the kind's
 * required fields). This is the idempotent write a live importer repeats —
 * re-running never duplicates.
 */
export function upsertBySource(
  page: Page,
  kind: SourcedKind,
  source: SourceRef,
  props: Record<string, unknown> = {},
): UpsertResult {
  const collection = {
    node: page.nodes,
    link: page.links,
    zone: page.zones,
    flowPath: page.flowPaths,
    policyMarker: page.policyMarkers,
  }[kind] as { id: string; source?: SourceRef }[];

  const existing = collection.find(
    (e) => e.source && sameSource(e.source, source),
  );
  if (existing) {
    const { element } = updateElement(page, existing.id, {
      ...props,
      source,
    });
    return { created: false, kind, element };
  }

  const missing = CREATE_REQUIRED[kind].filter(
    (k) => props[k] === undefined || props[k] === null,
  );
  if (missing.length)
    throw new Error(
      `creating a ${kind} via upsert requires: ${missing.join(', ')}`,
    );

  const input = { ...props, source } as Record<string, unknown>;
  const created = {
    node: () => addNode(page, input as unknown as NodeInput),
    link: () => addLink(page, input as unknown as LinkInput),
    zone: () => addZone(page, input as unknown as ZoneInput),
    flowPath: () => addFlowPath(page, input as unknown as FlowPathInput),
    policyMarker: () =>
      addPolicyMarker(page, input as unknown as PolicyMarkerInput),
  }[kind]();
  return {
    created: true,
    kind,
    element: created as unknown as Record<string, unknown>,
  };
}
