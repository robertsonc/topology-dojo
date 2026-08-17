/**
 * Dependency cascade for removed link endpoints (nodes / anchors) — the single
 * implementation behind both editor gestures (`Editor.deleteSelected`) and the
 * headless edit API (`removeElement` in api/edit), so on-canvas deletes and
 * `remove_element` enforce identical semantics:
 *
 *   - links touching a removed endpoint are removed;
 *   - policy markers targeting a removed node are removed;
 *   - removed ids leave zone memberships and flow-path waypoints;
 *   - a flow path the removal touched that is left with fewer than two
 *     waypoints is removed, and markers pointing at it lose their `flowPathId`;
 *   - hop annotations arriving at a removed waypoint are removed, and a
 *     surviving hop whose `linkId` rode a cascade-removed link loses that
 *     pointer.
 *
 * DOM-free, and all mutation is in place — collections are never reassigned,
 * so references into the page stay valid (the api/edit contract).
 */
import type { Page } from './model.js';
import type { FlowPathConfig } from '../vendor/topology-ds.js';

export interface EndpointCascade {
  /** Dependents removed or cleaned (counts mirror api/edit's RemoveResult). */
  links: number;
  policyMarkers: number;
  flowPaths: number;
  zoneMemberships: number;
  waypoints: number;
  hops: number;
  /** Callout notes whose leader-line `target` pointed at a removed element. */
  calloutTargets: number;
  /** Flow paths dropped for falling under two waypoints. */
  droppedFlowPathIds: string[];
}

/** Drop entries failing `keep` without reassigning the array; returns count. */
export function pruneInPlace<T>(arr: T[], keep: (item: T) => boolean): number {
  let dropped = 0;
  for (let i = arr.length - 1; i >= 0; i--)
    if (!keep(arr[i]!)) {
      arr.splice(i, 1);
      dropped++;
    }
  return dropped;
}

/** Cascade the disappearance of the `removed` node/anchor ids through `page`. */
export function cascadeEndpointRemoval(
  page: Page,
  removed: ReadonlySet<string>,
): EndpointCascade {
  const out: EndpointCascade = {
    links: 0,
    policyMarkers: 0,
    flowPaths: 0,
    zoneMemberships: 0,
    waypoints: 0,
    hops: 0,
    calloutTargets: 0,
    droppedFlowPathIds: [],
  };
  if (removed.size === 0) return out;

  // A callout whose leader-line target disappears keeps the note but loses
  // the pointer (same spirit as a marker losing its flowPathId).
  for (const n of page.nodes) {
    const cfg = n as { type?: string; target?: string };
    if (cfg.type === 'callout' && cfg.target && removed.has(cfg.target)) {
      delete cfg.target;
      out.calloutTargets++;
    }
  }

  const droppedLinkIds = new Set<string>();
  out.links = pruneInPlace(page.links, (l) => {
    const keep = !removed.has(l.from) && !removed.has(l.to);
    if (!keep) droppedLinkIds.add(l.id);
    return keep;
  });
  out.policyMarkers = pruneInPlace(
    page.policyMarkers,
    (m) => !removed.has(m.nodeId),
  );
  for (const z of page.zones)
    out.zoneMemberships += pruneInPlace(z.nodes, (n) => !removed.has(n));
  out.flowPaths = pruneInPlace(page.flowPaths, (f) => {
    const removedCount = pruneInPlace(f.waypoints, (w) => !removed.has(w));
    out.waypoints += removedCount;
    // Only a path the removal actually touched can be dropped for shortness.
    if (removedCount > 0 && f.waypoints.length < 2) {
      out.droppedFlowPathIds.push(f.id);
      return false;
    }
    out.hops += cleanHops(f, removed, droppedLinkIds);
    return true;
  });
  // Markers pointing at a flow path that no longer exists lose the pointer.
  for (const fpId of out.droppedFlowPathIds)
    for (const m of page.policyMarkers)
      if (m.flowPathId === fpId) delete m.flowPathId;

  return out;
}

/** Prune a surviving path's hop annotations of removed refs/links; returns the
 * number of hops dropped. An emptied `hops` array is deleted outright. */
function cleanHops(
  f: FlowPathConfig,
  removed: ReadonlySet<string>,
  droppedLinks: ReadonlySet<string>,
): number {
  if (!f.hops?.length) return 0;
  const dropped = pruneInPlace(f.hops, (h) => !removed.has(h.ref));
  for (const h of f.hops)
    if (h.linkId !== undefined && droppedLinks.has(h.linkId)) delete h.linkId;
  if (f.hops.length === 0) delete f.hops;
  return dropped;
}
