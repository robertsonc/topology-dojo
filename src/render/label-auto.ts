/**
 * Automatic node-label placement — choose, for each node, the compass slot
 * (`labelPlacement`) whose label block is crossed by the fewest links.
 *
 * The classic label sits below its node, so a hub whose links fan downward
 * gets every tunnel drawn through its name. This pass scores all eight
 * placements per node against the links as the engine draws them (the same
 * attachment mirror `inspect` uses), other nodes' glyphs, labels already
 * placed, and the page edge, with a mild preference for staying below — and
 * writes the winner as an ordinary `labelPlacement`. The result is document
 * data: deterministic, editable, and identical in every renderer and export.
 *
 * Labels a person positioned by hand (absolute `labelOffset` /
 * `labelOffsetX` / `labelY`) are left alone, as are nodes without a classic
 * label (text boxes, callouts, shapes).
 */
import type { CustomNodeSpec } from '../nodes/spec.js';
import type { Page } from '../pages/model.js';
import type { BoundsRect } from '../api/geometry.js';
import type { NodeConfig } from '../vendor/topology-ds.js';
import { LAYOUT_RULES, parseViewBox } from '../api/layout.js';
import { zoneBox } from './zone-box.js';
import { nodeLabelRect, type LabelPlacement } from './label-placement.js';
import {
  createAttachContext,
  engineAABB,
  engineHitBoxes,
} from './link-attach.js';
import { linkPolyline, polylineIntersectsRect } from './inspect.js';

/** Candidate order doubles as the tie-break: below, above, sides, corners. */
const CANDIDATES: readonly [LabelPlacement, number][] = [
  ['s', 0],
  ['n', 1],
  ['e', 2],
  ['w', 2],
  ['se', 3],
  ['sw', 3],
  ['ne', 3],
  ['nw', 3],
];

/** A crossed link outweighs any preference between slots. Layout-rule
 * breaches (crowding a node or label, growing into a foreign zone, leaving
 * the page) are not weighed at all: such a slot is never chosen. */
const LINK_COST = 10;

export interface AutoLabelOptions {
  /** The document's custom node types (their hit boxes are obstacles). */
  customNodes?: CustomNodeSpec[];
  /** Restrict the pass to these node ids (default: every eligible node). */
  nodeIds?: readonly string[];
}

export interface AutoLabelResult {
  /** Nodes whose placement changed. */
  changed: number;
  /** The chosen placement of every node the pass considered. */
  placements: Record<string, LabelPlacement>;
}

function overlaps(a: BoundsRect, b: BoundsRect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** Overlap test that counts touching edges (a flat or vertical box). */
function touches(a: BoundsRect, b: BoundsRect): boolean {
  return (
    a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
  );
}

function inflate(r: BoundsRect, by: number): BoundsRect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

function within(inner: BoundsRect, outer: BoundsRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** A node whose label a person placed by hand (absolute offsets). */
function handPlaced(n: NodeConfig): boolean {
  const r = n as {
    labelOffset?: unknown;
    labelOffsetX?: unknown;
    labelY?: unknown;
  };
  return (
    r.labelOffset !== undefined ||
    r.labelOffsetX !== undefined ||
    r.labelY !== undefined
  );
}

/**
 * Place node labels away from links on one page (mutates the page). Returns
 * how many placements changed and what was chosen.
 */
export function autoPlaceLabels(
  page: Page,
  opts: AutoLabelOptions = {},
): AutoLabelResult {
  const hitBoxes = engineHitBoxes(opts.customNodes);
  const attach = createAttachContext(page, { hitBoxes });
  const [vx, vy, vw, vh] = parseViewBox(page.viewBox);
  const pageRect: BoundsRect = { x: vx, y: vy, w: vw, h: vh };

  // Links as drawn (endpoints from the engine's attachment mirror).
  // Each with its bounding box, so a candidate only tests nearby links.
  const polylines = page.links.flatMap((l) => {
    const e = attach.endpoints(l);
    if (!e) return [];
    const pts = linkPolyline(l, e.from, e.to);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const box = { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    return [{ pts, box }];
  });
  const glyphs = new Map(
    page.nodes.map((n) => [n.id, engineAABB(n, hitBoxes)] as const),
  );
  const only = opts.nodeIds ? new Set(opts.nodeIds) : null;
  const eligible = page.nodes.filter(
    (n) =>
      (!only || only.has(n.id)) && !handPlaced(n) && nodeLabelRect(n) !== null,
  );

  // Every node's label as it stands; updated as the pass places each one,
  // so later nodes see earlier choices.
  const labels = new Map<string, BoundsRect | null>(
    page.nodes.map((n) => [n.id, nodeLabelRect(n)] as const),
  );
  // Zones a node does NOT belong to (its own zones and their ancestors may
  // grow around the label; any other zone is an obstacle — growing into it
  // would make two zones overlap).
  const zones = (page.zones ?? []).flatMap((z) => {
    const box = zoneBox(page, z);
    return box ? [{ zone: z, box }] : [];
  });
  const parentOf = new Map(
    (page.zones ?? []).map((z) => [z.id, z.parentZone] as const),
  );
  const zonesOf = (id: string): Set<string> => {
    const out = new Set<string>();
    for (const z of page.zones ?? [])
      if (z.nodes.includes(id)) {
        let cur: string | undefined = z.id;
        while (cur && !out.has(cur)) {
          out.add(cur);
          cur = parentOf.get(cur);
        }
      }
    return out;
  };
  const gap = LAYOUT_RULES.minNodeGap;
  const zonePad = LAYOUT_RULES.zonePadding + LAYOUT_RULES.minZoneGap;

  // Busiest nodes first: they have the fewest free slots.
  const degree = new Map<string, number>();
  for (const l of page.links)
    for (const id of [l.from, l.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const order = [...eligible].sort(
    (a, b) =>
      (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
      a.id.localeCompare(b.id),
  );

  const result: AutoLabelResult = { changed: 0, placements: {} };
  for (const n of order) {
    const before = n.labelPlacement;
    const own = zonesOf(n.id);
    let best: { p: LabelPlacement; cost: number; rect: BoundsRect } | null =
      null;
    for (const [p, preference] of CANDIDATES) {
      const rect = nodeLabelRect({ ...n, labelPlacement: p });
      if (!rect) continue;
      // Layout rules first: a slot that crowds another node's glyph or
      // label (minNodeGap), pushes into a zone the node is not in, or leaves
      // the page is out.
      if (!within(rect, pageRect)) continue;
      const spaced = inflate(rect, gap);
      let breach = false;
      for (const [id, g] of glyphs) {
        if (id === n.id) continue;
        const other = labels.get(id);
        if (overlaps(spaced, g) || (other && overlaps(spaced, other))) {
          breach = true;
          break;
        }
      }
      if (breach) continue;
      const padded = inflate(rect, zonePad);
      if (zones.some((z) => !own.has(z.zone.id) && overlaps(padded, z.box)))
        continue;
      let cost = preference;
      for (const { pts, box } of polylines)
        if (touches(box, rect) && polylineIntersectsRect(pts, rect))
          cost += LINK_COST;
      if (!best || cost < best.cost) best = { p, cost, rect };
    }
    // No slot keeps the layout valid: leave this label where it is.
    if (!best) continue;
    // `s` is the default: store it as absent so documents stay minimal.
    if (best.p === 's') delete n.labelPlacement;
    else n.labelPlacement = best.p;
    if ((before ?? 's') !== best.p) result.changed++;
    result.placements[n.id] = best.p;
    labels.set(n.id, best.rect);
    // The node's own zones may have grown around the new label: refresh
    // their boxes so later nodes treat the grown zones as obstacles.
    for (const z of zones)
      if (own.has(z.zone.id)) z.box = zoneBox(page, z.zone) ?? z.box;
  }
  return result;
}
