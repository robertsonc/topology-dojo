/**
 * Visual-quality inspection of a page — the compact QA report behind the
 * `inspect_render` MCP tool. `render_svg` output is 20–300KB and opaque to an
 * agent; `validate_topology` checks semantics + layout rules but not what the
 * rendered result *looks* like. This module estimates the drawn geometry
 * (glyphs, labels, link chips, zone boxes) from the same metrics the vendored
 * engine bakes into its SVG, and reports crop, text-legibility, routing, and
 * density findings as a few KB of actionable text instead of the SVG payload.
 *
 * Label sizes are heuristic ESTIMATES mirroring the engine's conventions
 * (public/vendor/topology-ds.js): node labels render at font-size 10 truncated
 * to 24 chars (~6px/char, baseline at y + labelOffset, default 24); zone labels
 * render at font-size 9 (~5.4px/char) just inside the zone's top edge. Zone
 * boxes pad the member positions ±40x/±30y plus the zone padding, exactly as
 * `_renderZoneRect` does.
 *
 * Wire labels (link centre labels, flow-path labels, policy-marker labels)
 * are glass PILLS whose metrics live in `./wire-labels` (the engine keeps a
 * mirrored copy): the label word-wraps at `labelWidth` px or ~26 characters,
 * the pill sizes to the wrapped block, and after placement a pill that
 * overlaps a node hit box, a zone title strip or an earlier pill slides along
 * its segment by fixed fractions of its width (the engine's collision nudge).
 * Placement: a link label sits at the chord midpoint nudged 12px
 * perpendicular (+ labelOffset, × labelScale; only `line` links are nudged
 * for collisions, the other link types draw fixed chips); a flow-path label
 * sits on the longest drawn segment of its route (each hop follows its
 * link's polyline, or the straight hop with `followLinks: false`); a marker
 * label hangs under its badge. Pill/node and the nudge use the engine's hit
 * AABB (`engineNodeAABB`), so a pill the renderer slid clear is never
 * reported, and one it could not clear is.
 *
 * Routing checks measure the DRAWN link geometry, not the centre-to-centre
 * chord: each link is a polyline centre → `waypoints` → centre, with the
 * engine's `_buildLinkPath` elbows (`{x: p[i].x, y: p[i-1].y}` between
 * consecutive points) inserted for `lineStyle: 'orthogonal'`, and the control
 * polygon used for `lineStyle: 'curved'` (a 2-point curve bulges ≤20px, so the
 * chord is close enough). Link/link crossings are classified: a crossing whose
 * four endpoints are closed into a 4-cycle by other links of the SAME kind
 * (type, layer, dashed) is an unavoidable dual-homed mesh (K2,2 / K2,4 drawn
 * as rows) and is reported as a `note`; every other crossing, including a
 * tunnel or OOB cable over a WAN link, stays a `problem`. Crossing points within 20px
 * of each other collapse into one finding (a bused crossover), while
 * `crossings` keeps the per-pair totals.
 *
 * Pure and DOM-free: takes a Page, returns a typed report, moves nothing.
 */
import { nodeLabelRect } from './label-placement.js';
import { NODE_LABEL, nodeLabelLines } from './node-labels.js';
import { zoneBox } from './zone-box.js';
import type { Page } from '../pages/model.js';
import type {
  FlowPathConfig,
  LinkConfig,
  PolicyMarkerConfig,
  ZoneConfig,
} from '../vendor/topology-ds.js';
import { nodeBounds, type BoundsRect } from '../api/geometry.js';
import { LAYOUT_RULES, parseViewBox, rectGap } from '../api/layout.js';
import {
  MARKER_LABEL_GAP,
  MARKER_LABEL_NOTE_CHARS,
  engineNodeAABB,
  labelLines,
  longestSegment,
  markerBadgeCenter,
  nudgePill,
  pillRectAt,
  pillSize,
  polylineSegments,
  segmentLabelAnchor,
  type PathSegment,
} from './wire-labels.js';

export type InspectSeverity = 'problem' | 'note';
export type InspectCategory = 'crop' | 'text' | 'routing' | 'density';

export interface InspectFinding {
  severity: InspectSeverity;
  category: InspectCategory;
  message: string;
}

export interface InspectReport {
  page: { viewBox: string; width: number; height: number };
  /** Union of node footprints + zone boxes; null for an empty page. */
  contentBounds: BoundsRect | null;
  /** Clear space between the content bounds and each page edge. */
  margins: { left: number; right: number; top: number; bottom: number } | null;
  /** True totals per category — never reduced by the findings cap. */
  counts: Record<InspectCategory, { problems: number; notes: number }>;
  /**
   * Link/link crossing PAIRS (before co-located crossings are collapsed into
   * one finding). `unavoidable` pairs are forced by a dual-homed mesh on the
   * page and are reported as notes; `avoidable` ones are routing problems.
   */
  crossings: { total: number; unavoidable: number; avoidable: number };
  /** Capped per category (problems kept first); `counts` holds the totals. */
  findings: InspectFinding[];
  /** Findings dropped by the per-category cap. */
  omitted: number;
  /** No problems in any category (notes allowed). */
  clean: boolean;
}

export interface InspectOptions {
  /** Max findings reported per category (default 8); totals stay accurate. */
  maxPerCategory?: number;
}

const DEFAULT_MAX_PER_CATEGORY = 8;

/* Engine label metrics (see module header; node labels: render/node-labels). */
const ZONE_LABEL_CHAR_W = 5.4; // ~0.6em at the 9px zone-label font
const ZONE_LABEL_H = 14;
/** Below this endpoint distance the perimeter trims cross and the engine falls
 * back to a centre→centre line (see render/link-crossing.test.ts). */
const DEGENERATE_LINK_DIST = 40;
/** Crossing points closer than this collapse into one "bused" finding. */
const CROSSING_CLUSTER_RADIUS = 20;

/** Inspect one page and return the bounded visual-quality report. */
export function inspectPage(
  page: Page,
  opts: InspectOptions = {},
): InspectReport {
  const cap = Math.max(1, opts.maxPerCategory ?? DEFAULT_MAX_PER_CATEGORY);
  const all: InspectFinding[] = [];
  const add = (
    severity: InspectSeverity,
    category: InspectCategory,
    message: string,
  ): void => {
    all.push({ severity, category, message });
  };

  const [vx, vy, vw, vh] = parseViewBox(page.viewBox);
  const pageRect: BoundsRect = { x: vx, y: vy, w: vw, h: vh };

  // Estimated drawn geometry, computed once and shared by every check.
  const glyphs = new Map<string, BoundsRect>();
  // The engine's coarser hit AABB per node — what wire-label placement avoids.
  const hit = new Map<string, BoundsRect>();
  const labels = new Map<string, BoundsRect>();
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of page.nodes) {
    glyphs.set(n.id, nodeBounds(n));
    hit.set(n.id, engineNodeAABB(n));
    const lr = nodeLabelRect(n);
    if (lr) labels.set(n.id, lr);
    pos.set(n.id, { x: n.x, y: n.y });
  }
  for (const a of page.anchors) pos.set(a.id, { x: a.x, y: a.y });
  const zones = page.zones ?? [];
  const zoneBoxes = new Map<string, BoundsRect>();
  for (const z of zones) {
    const box = zoneBox(page, z);
    if (box) zoneBoxes.set(z.id, box);
  }

  checkCrop(page, pageRect, glyphs, labels, zoneBoxes, add);
  checkText(page, glyphs, hit, labels, pos, zones, zoneBoxes, add);
  const crossings = checkRouting(page, pos, glyphs, add);
  checkDensity(page, glyphs, labels, add);

  // Content bounds + margins (also feeds the whitespace-balance check below).
  const content = contentBounds(glyphs, labels, zoneBoxes);
  let margins: InspectReport['margins'] = null;
  if (content) {
    margins = {
      left: round(content.x - vx),
      right: round(vx + vw - (content.x + content.w)),
      top: round(content.y - vy),
      bottom: round(vy + vh - (content.y + content.h)),
    };
    checkWhitespace(content, pageRect, margins, page.nodes.length, add);
  }

  // Bound the output: per category, keep problems first, then cap.
  const counts: InspectReport['counts'] = {
    crop: { problems: 0, notes: 0 },
    text: { problems: 0, notes: 0 },
    routing: { problems: 0, notes: 0 },
    density: { problems: 0, notes: 0 },
  };
  for (const f of all)
    counts[f.category][f.severity === 'problem' ? 'problems' : 'notes']++;
  const findings: InspectFinding[] = [];
  for (const category of ['crop', 'text', 'routing', 'density'] as const) {
    const inCat = all.filter((f) => f.category === category);
    inCat.sort(
      (a, b) =>
        Number(b.severity === 'problem') - Number(a.severity === 'problem'),
    );
    findings.push(...inCat.slice(0, cap));
  }

  return {
    page: { viewBox: page.viewBox, width: vw, height: vh },
    contentBounds: content ? roundRect(content) : null,
    margins,
    counts,
    crossings,
    findings,
    omitted: all.length - findings.length,
    clean: !all.some((f) => f.severity === 'problem'),
  };
}

/* ── crop / overflow ──────────────────────────────────────────────── */

function checkCrop(
  page: Page,
  pageRect: BoundsRect,
  glyphs: Map<string, BoundsRect>,
  labels: Map<string, BoundsRect>,
  zoneBoxes: Map<string, BoundsRect>,
  add: (s: InspectSeverity, c: InspectCategory, m: string) => void,
): void {
  const m = LAYOUT_RULES.edgeMargin;
  for (const n of page.nodes) {
    const f = union(glyphs.get(n.id)!, labels.get(n.id));
    const over = overhang(f, pageRect);
    if (over.amount > 0.5)
      add(
        'problem',
        'crop',
        `node "${n.id}" is clipped — it extends ~${round(over.amount)}px past the ${over.side} page edge; move it inside the viewBox or enlarge the page`,
      );
    else if (edgeDistance(f, pageRect) < m)
      add(
        'note',
        'crop',
        `node "${n.id}" hugs the page edge (<${m}px clear) — leave a ${m}px margin`,
      );
  }
  for (const [zid, box] of zoneBoxes) {
    const over = overhang(box, pageRect);
    if (over.amount > 0.5)
      add(
        'problem',
        'crop',
        `zone "${zid}" is clipped — its box extends ~${round(over.amount)}px past the ${over.side} page edge`,
      );
  }
}

function checkWhitespace(
  content: BoundsRect,
  pageRect: BoundsRect,
  margins: { left: number; right: number; top: number; bottom: number },
  nodeCount: number,
  add: (s: InspectSeverity, c: InspectCategory, m: string) => void,
): void {
  // Wasted margin: a real diagram squeezed into a corner of the page reads as
  // an empty slide. Small diagrams (a handful of nodes) are naturally compact,
  // so only flag from 4 nodes up, and only when BOTH spans are under 40%.
  if (
    nodeCount >= 4 &&
    content.w < pageRect.w * 0.4 &&
    content.h < pageRect.h * 0.4
  ) {
    const areaPct = (content.w * content.h) / (pageRect.w * pageRect.h);
    add(
      'note',
      'crop',
      `content occupies only ~${Math.round(areaPct * 100)}% of the page — spread the layout or shrink the viewBox`,
    );
  }
  // Whitespace balance: a strongly one-sided margin looks off-centre.
  const hSkew = Math.abs(margins.left - margins.right);
  const vSkew = Math.abs(margins.top - margins.bottom);
  if (hSkew > pageRect.w * 0.25 && margins.left >= 0 && margins.right >= 0)
    add(
      'note',
      'density',
      `horizontal whitespace is unbalanced (~${margins.left}px left vs ~${margins.right}px right) — run balance_topology to centre the layout`,
    );
  if (vSkew > pageRect.h * 0.25 && margins.top >= 0 && margins.bottom >= 0)
    add(
      'note',
      'density',
      `vertical whitespace is unbalanced (~${margins.top}px top vs ~${margins.bottom}px bottom) — run balance_topology to centre the layout`,
    );
}

/* ── text legibility ──────────────────────────────────────────────── */

function checkText(
  page: Page,
  glyphs: Map<string, BoundsRect>,
  hit: Map<string, BoundsRect>,
  labels: Map<string, BoundsRect>,
  pos: Map<string, { x: number; y: number }>,
  zones: ZoneConfig[],
  zoneBoxes: Map<string, BoundsRect>,
  add: (s: InspectSeverity, c: InspectCategory, m: string) => void,
): void {
  for (const n of page.nodes) {
    const label = typeof n.label === 'string' ? n.label : '';
    // Only the classic below-node label is truncated; text boxes, callouts
    // and shapes word-wrap theirs in full, so they never get a label rect.
    const lr = labels.get(n.id);
    if (!lr) continue;
    const lines = nodeLabelLines(n);
    if (lines.labelCut)
      add(
        'note',
        'text',
        `label "${label}" on node "${n.id}" is ${label.length} chars — it wraps to ${NODE_LABEL.label.maxLines} lines at labelWidth ${String(n.labelWidth)} and is cut with an ellipsis; widen labelWidth or shorten it`,
      );
    else if (
      n.labelWidth == null &&
      label.length > NODE_LABEL.label.truncateChars
    )
      add(
        'note',
        'text',
        `label "${label}" on node "${n.id}" is ${label.length} chars — the renderer truncates it to ${NODE_LABEL.label.truncateChars} with an ellipsis; set labelWidth to wrap it instead`,
      );
    if (lines.sublabelCut)
      add(
        'note',
        'text',
        `sublabel on node "${n.id}" is ${String(n.sublabel).length} chars — it wraps to ${NODE_LABEL.sublabel.maxLines} lines and is cut with an ellipsis; set labelWidth or shorten it`,
      );
    const glyph = glyphs.get(n.id)!;
    const overflow = lr.w - glyph.w;
    if (overflow > 96)
      add(
        'note',
        'text',
        `label "${label}" on node "${n.id}" overflows its node width by ~${round(overflow / 2)}px each side — it widens the footprint into neighbours`,
      );
    // Label vs neighbouring node glyphs and labels.
    for (const other of page.nodes) {
      if (other.id === n.id) continue;
      const og = glyphs.get(other.id)!;
      const gGap = rectGap(lr, og);
      if (gGap < 0)
        add(
          'problem',
          'text',
          `label "${label}" on node "${n.id}" collides with node "${other.id}" (~${round(-gGap)}px overlap) — shorten the label or add spacing`,
        );
      // Only check each label pair once (i < j by id ordering in the map).
      const ol = labels.get(other.id);
      if (ol && n.id < other.id) {
        const lGap = rectGap(lr, ol);
        if (lGap < 0)
          add(
            'problem',
            'text',
            `labels of nodes "${n.id}" and "${other.id}" collide (~${round(-lGap)}px overlap)`,
          );
      }
    }
  }

  // Wire-label pills (link / flow path / marker), placed in the engine's
  // paint order with its collision nudge, then checked against each other,
  // node hit boxes + below-node labels, and zone title strips.
  const zoneTitles = new Map<string, BoundsRect>();
  for (const z of zones) {
    const box = zoneBoxes.get(z.id);
    if (box) zoneTitles.set(z.id, zoneLabelRect(z, box));
  }
  const pills = placePills(page, pos, hit, zoneTitles);
  const describe = (p: Pill): string =>
    `label of ${p.kind === 'link' ? 'link' : p.kind === 'flow' ? 'flow path' : 'marker'} "${p.id}"`;
  for (let i = 0; i < pills.length; i++) {
    const a = pills[i]!;
    for (let j = i + 1; j < pills.length; j++) {
      const b = pills[j]!;
      const gap = rectGap(a.rect, b.rect);
      if (gap >= 0) continue;
      if (a.kind === 'link' && b.kind === 'link')
        add(
          'problem',
          'text',
          `labels of links "${a.id}" and "${b.id}" collide (~${round(-gap)}px overlap) — offset one with labelOffset`,
        );
      else
        add(
          'problem',
          'text',
          `${describe(a)} collides with ${describe(b)} (~${round(-gap)}px overlap) — offset one with labelOffset`,
        );
    }
    for (const n of page.nodes) {
      if (a.skipNodes.has(n.id)) continue;
      const gap = rectGap(a.rect, hit.get(n.id)!);
      if (gap < 0)
        add(
          'problem',
          'text',
          `${describe(a)} sits on node "${n.id}" (~${round(-gap)}px overlap) — offset it with labelOffset`,
        );
      const lr = labels.get(n.id);
      if (lr) {
        const lGap = rectGap(a.rect, lr);
        if (lGap < 0)
          add(
            'problem',
            'text',
            `${describe(a)} overlaps the label of node "${n.id}" (~${round(-lGap)}px) — offset it with labelOffset`,
          );
      }
    }
    for (const [zid, strip] of zoneTitles) {
      const gap = rectGap(a.rect, strip);
      if (gap < 0)
        add(
          'problem',
          'text',
          `${describe(a)} sits on the title of zone "${zid}" (~${round(-gap)}px overlap) — offset it with labelOffset`,
        );
    }
  }
  for (const m of page.policyMarkers ?? []) {
    const label = typeof m.label === 'string' ? m.label : '';
    if (label.length > MARKER_LABEL_NOTE_CHARS)
      add(
        'note',
        'text',
        `label "${label}" on marker "${m.id}" is ${label.length} chars — it wraps to 2 lines under the badge (and is cut with an ellipsis past that); shorten it or set labelWidth`,
      );
  }

  // Zone labels render just inside the zone's top edge — flag member/other
  // nodes drawn over that strip (the label becomes unreadable), and links
  // whose drawn polyline runs through it.
  for (const z of zones) {
    const lr = zoneTitles.get(z.id);
    if (!lr) continue;
    for (const n of page.nodes) {
      const gap = rectGap(lr, union(glyphs.get(n.id)!, labels.get(n.id)));
      if (gap < 0)
        add(
          'problem',
          'text',
          `label of zone "${z.id}" is overlapped by node "${n.id}" (~${round(-gap)}px) — enlarge the zone padding or move the node down`,
        );
    }
    for (const l of page.links) {
      const a = pos.get(l.from),
        b = pos.get(l.to);
      if (!a || !b) continue;
      if (polylineIntersectsRect(linkPolyline(l, a, b), lr))
        add(
          'problem',
          'text',
          `link "${l.id}" runs through the title of zone "${z.id}" — route it around the title strip (waypoints) or move the zone label (labelAlign)`,
        );
    }
  }
}

/* ── wire-label pills (engine placement mirror) ────────────────────── */

interface Pill {
  kind: 'link' | 'flow' | 'marker';
  id: string;
  rect: BoundsRect;
  /** Still overlapping an obstacle after the nudge trials. */
  blocked: boolean;
  /** Nodes not reported as collisions (a link's own endpoints). */
  skipNodes: Set<string>;
}

/**
 * Every wire-label pill on the page, placed the way the engine does it: links
 * in page order, then flow paths, then markers; each slid clear of node hit
 * boxes, zone title strips and the pills before it when it collides.
 */
function placePills(
  page: Page,
  pos: Map<string, { x: number; y: number }>,
  hit: Map<string, BoundsRect>,
  zoneTitles: Map<string, BoundsRect>,
): Pill[] {
  const fixed = [...hit.values(), ...zoneTitles.values()];
  const pills: Pill[] = [];
  const place = (
    kind: Pill['kind'],
    id: string,
    rect: BoundsRect,
    dir: { x: number; y: number } | null,
    skipNodes: Set<string>,
  ): void => {
    const obstacles = [...fixed, ...pills.map((p) => p.rect)];
    const r = dir
      ? nudgePill(rect, dir, obstacles)
      : { rect, blocked: obstacles.some((o) => rectGap(rect, o) < 0) };
    pills.push({ kind, id, rect: r.rect, blocked: r.blocked, skipNodes });
  };

  for (const l of page.links) {
    const label = typeof l.label === 'string' ? l.label : '';
    const a = pos.get(l.from),
      b = pos.get(l.to);
    if (!label || !a || !b) continue;
    const seg = polylineSegments([a, b])[0]!;
    const anchor = segmentLabelAnchor(seg);
    const s =
      typeof l.labelScale === 'number' && Number.isFinite(l.labelScale)
        ? Math.min(4, Math.max(0.25, l.labelScale))
        : 1;
    const size = pillSize('link', labelLines('link', label, l.labelWidth), s);
    const rect = pillRectAt(
      anchor.x + (l.labelOffset?.x ?? 0),
      anchor.y + (l.labelOffset?.y ?? 0),
      size,
    );
    // Only `line` links go through the engine's nudging label renderer.
    place(
      'link',
      l.id,
      rect,
      l.type === 'line' ? anchor.dir : null,
      new Set([l.from, l.to]),
    );
  }

  for (const f of page.flowPaths ?? []) {
    const label = typeof f.label === 'string' ? f.label : '';
    if (!label) continue;
    const seg = longestSegment(flowSegments(page, f, pos));
    if (!seg) continue;
    const anchor = segmentLabelAnchor(seg);
    const size = pillSize('flow', labelLines('flow', label, f.labelWidth));
    const rect = pillRectAt(
      anchor.x + (f.labelOffset?.x ?? 0),
      anchor.y + (f.labelOffset?.y ?? 0),
      size,
    );
    place('flow', f.id, rect, anchor.dir, new Set());
  }

  // Markers stack per (node, align) in declaration order, like the engine.
  const groups = new Map<string, PolicyMarkerConfig[]>();
  for (const m of page.policyMarkers ?? []) {
    const key = `${m.nodeId}|${m.align ?? 'NE'}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
  }
  for (const markers of groups.values()) {
    markers.forEach((m, idx) => {
      const label = typeof m.label === 'string' ? m.label : '';
      const box = hit.get(m.nodeId);
      if (!label || !box) return;
      const c = markerBadgeCenter(box, m.align, idx);
      const size = pillSize(
        'marker',
        labelLines('marker', label, m.labelWidth),
      );
      const rect = pillRectAt(c.x, c.y + MARKER_LABEL_GAP + size.h / 2, size);
      place('marker', m.id, rect, c.dir, new Set());
    });
  }
  return pills;
}

/**
 * The label-site segments of a flow path as drawn: each hop rides the
 * polyline of the link joining its two waypoints (the flow's own layer
 * preferred, else the first declared; reversed when declared the other way),
 * or is the straight centre→centre hop when no link joins them or
 * `followLinks` is false.
 */
function flowSegments(
  page: Page,
  f: FlowPathConfig,
  pos: Map<string, { x: number; y: number }>,
): PathSegment[] {
  const wps = f.waypoints ?? [];
  const segs: PathSegment[] = [];
  for (let i = 0; i + 1 < wps.length; i++) {
    const aId = wps[i]!,
      bId = wps[i + 1]!;
    const a = pos.get(aId),
      b = pos.get(bId);
    if (!a || !b) continue;
    let pts: Pt[] = [a, b];
    if (f.followLinks !== false) {
      let best: { link: LinkConfig; reversed: boolean } | null = null;
      for (const l of page.links) {
        const fwd = l.from === aId && l.to === bId;
        const back = l.from === bId && l.to === aId;
        if (!fwd && !back) continue;
        const cand = { link: l, reversed: back };
        if (f.layer && l.layer === f.layer) {
          best = cand;
          break;
        }
        if (!best) best = cand;
      }
      if (best) {
        const from = pos.get(best.link.from)!,
          to = pos.get(best.link.to)!;
        pts = linkPolyline(best.link, from, to);
        if (best.reversed) pts = [...pts].reverse();
      }
    }
    segs.push(...polylineSegments(pts));
  }
  return segs;
}

/* ── routing quality ──────────────────────────────────────────────── */

function checkRouting(
  page: Page,
  pos: Map<string, { x: number; y: number }>,
  glyphs: Map<string, BoundsRect>,
  add: (s: InspectSeverity, c: InspectCategory, m: string) => void,
): InspectReport['crossings'] {
  interface Route {
    link: LinkConfig;
    /** Centre → waypoints (+ orthogonal elbows) → centre, as drawn. */
    pts: Pt[];
  }
  const routes: Route[] = [];
  for (const l of page.links) {
    const a = pos.get(l.from);
    const b = pos.get(l.to);
    if (a && b) routes.push({ link: l, pts: linkPolyline(l, a, b) });
  }

  // Undirected adjacency keyed by link KIND (type + layer + dashed), for
  // recognising crossings a dual-homed mesh forces. A 4-cycle made of unlike
  // links (a WAN line, a tunnel on the overlay layer, an OOB dashed cable) is
  // two planes sharing endpoints, not a mesh: that crossing stays avoidable
  // (#265).
  const linkKind = (l: LinkConfig): string =>
    `${l.type}\u0000${l.layer ?? ''}\u0000${l.dashed ? 1 : 0}`;
  const adjacent = new Map<string, Set<string>>();
  const pairKey = (u: string, v: string): string =>
    u < v ? `${u}\u0000${v}` : `${v}\u0000${u}`;
  for (const l of page.links) {
    const k = pairKey(l.from, l.to);
    let kinds = adjacent.get(k);
    if (!kinds) adjacent.set(k, (kinds = new Set()));
    kinds.add(linkKind(l));
  }
  const linked = (u: string, v: string, kind: string): boolean =>
    adjacent.get(pairKey(u, v))?.has(kind) ?? false;

  // Link/link crossings on the drawn polylines (shared endpoints are a
  // junction, not a crossing; one crossing per link pair).
  interface Crossing {
    at: Pt;
    links: [LinkConfig, LinkConfig];
    /** The forcing mesh's description, or null when the crossing is avoidable. */
    mesh: string | null;
  }
  const crossings: Crossing[] = [];
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const s = routes[i]!,
        t = routes[j]!;
      const shared =
        s.link.from === t.link.from ||
        s.link.from === t.link.to ||
        s.link.to === t.link.from ||
        s.link.to === t.link.to;
      if (shared) continue;
      const at = polylinesCross(s.pts, t.pts);
      if (!at) continue;
      // L1 = a1–b1, L2 = a2–b2. The crossing is forced when other links close
      // a 4-cycle through the four endpoints: either a1–b2 + a2–b1 (mesh
      // between {a1,a2} and {b1,b2}) or a1–a2 + b1–b2 ({a1,b2} vs {a2,b1}).
      const a1 = s.link.from,
        b1 = s.link.to,
        a2 = t.link.from,
        b2 = t.link.to;
      const kind = linkKind(s.link);
      const mesh =
        kind !== linkKind(t.link)
          ? null
          : linked(a1, b2, kind) && linked(a2, b1, kind)
            ? meshDesc([a1, a2], [b1, b2])
            : linked(a1, a2, kind) && linked(b1, b2, kind)
              ? meshDesc([a1, b2], [a2, b1])
              : null;
      crossings.push({ at, links: [s.link, t.link], mesh });
    }
  }

  // Collapse co-located crossings (a bused crossover) into one finding each:
  // greedy clustering, a crossing joins the first cluster whose centroid is
  // within CROSSING_CLUSTER_RADIUS.
  interface Cluster {
    sumX: number;
    sumY: number;
    members: Crossing[];
  }
  const clusters: Cluster[] = [];
  for (const c of crossings) {
    const home = clusters.find((k) => {
      const n = k.members.length;
      return (
        Math.hypot(k.sumX / n - c.at.x, k.sumY / n - c.at.y) <=
        CROSSING_CLUSTER_RADIUS
      );
    });
    if (home) {
      home.sumX += c.at.x;
      home.sumY += c.at.y;
      home.members.push(c);
    } else clusters.push({ sumX: c.at.x, sumY: c.at.y, members: [c] });
  }
  for (const k of clusters) {
    const avoidable = k.members.some((c) => c.mesh === null);
    const meshes = [
      ...new Set(k.members.flatMap((c) => (c.mesh === null ? [] : [c.mesh]))),
    ];
    const suffix = avoidable
      ? '— reorder nodes or route one around'
      : `— expected (dual-homed mesh ${meshes.join('; ')})`;
    const severity: InspectSeverity = avoidable ? 'problem' : 'note';
    if (k.members.length === 1) {
      const [l1, l2] = k.members[0]!.links;
      add(
        severity,
        'routing',
        `links "${l1.id}" and "${l2.id}" cross ${suffix}`,
      );
      continue;
    }
    const ids: string[] = [];
    for (const r of routes)
      if (k.members.some((c) => c.links.includes(r.link))) ids.push(r.link.id);
    const n = k.members.length;
    const cx = round(k.sumX / n),
      cy = round(k.sumY / n);
    add(
      severity,
      'routing',
      `${ids.length} links cross at (${cx},${cy}): ${ids.join(', ')} ${suffix}`,
    );
  }

  for (const r of routes) {
    // Links drawn through the box of a node that is not an endpoint — every
    // segment of the drawn polyline is tested, so a waypointed detour that
    // misses the node is not flagged and an orthogonal elbow that hits it is.
    for (const n of page.nodes) {
      if (n.id === r.link.from || n.id === r.link.to) continue;
      if (polylineIntersectsRect(r.pts, glyphs.get(n.id)!))
        add(
          'problem',
          'routing',
          `link "${r.link.id}" passes through unrelated node "${n.id}" — route around it or move the node`,
        );
    }
    // Degenerate geometry: endpoints so close the perimeter trims collapse.
    const a = r.pts[0]!,
      b = r.pts[r.pts.length - 1]!;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist < 0.5)
      add(
        'problem',
        'routing',
        `link "${r.link.id}" has zero length — its endpoints share one position`,
      );
    else if (dist < DEGENERATE_LINK_DIST)
      add(
        'note',
        'routing',
        `link "${r.link.id}" spans only ~${round(dist)}px — too short to draw cleanly between the node boundaries`,
      );
  }

  // Flow paths: zero-length hops and immediate back-tracks read as glitches.
  for (const f of page.flowPaths ?? []) {
    const wps = f.waypoints ?? [];
    for (let i = 0; i + 1 < wps.length; i++) {
      if (wps[i] === wps[i + 1]) {
        add(
          'problem',
          'routing',
          `flow path "${f.id}" repeats waypoint "${wps[i]}" back to back (zero-length segment)`,
        );
        continue;
      }
      const a = pos.get(wps[i]!),
        b = pos.get(wps[i + 1]!);
      if (a && b && Math.hypot(b.x - a.x, b.y - a.y) < 0.5)
        add(
          'problem',
          'routing',
          `flow path "${f.id}" has a zero-length segment between "${wps[i]}" and "${wps[i + 1]}"`,
        );
    }
    for (let i = 0; i + 2 < wps.length; i++)
      if (wps[i] === wps[i + 2])
        add(
          'note',
          'routing',
          `flow path "${f.id}" doubles back over "${wps[i + 1]}" (…${wps[i]} → ${wps[i + 1]} → ${wps[i + 2]}…)`,
        );
  }

  const unavoidable = crossings.filter((c) => c.mesh !== null).length;
  return {
    total: crossings.length,
    unavoidable,
    avoidable: crossings.length - unavoidable,
  };
}

/* ── density / balance ────────────────────────────────────────────── */

function checkDensity(
  page: Page,
  glyphs: Map<string, BoundsRect>,
  labels: Map<string, BoundsRect>,
  add: (s: InspectSeverity, c: InspectCategory, m: string) => void,
): void {
  // Footprint = glyph + label, the same union validate's layout checks use.
  const fps = page.nodes.map((n) => ({
    id: n.id,
    x: n.x,
    y: n.y,
    rect: union(glyphs.get(n.id)!, labels.get(n.id)),
  }));
  const crowded = new Map<string, Set<string>>(); // crowding adjacency
  for (let i = 0; i < fps.length; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      const a = fps[i]!,
        b = fps[j]!;
      const gap = rectGap(a.rect, b.rect);
      if (gap < 0)
        add(
          'problem',
          'density',
          `nodes "${a.id}" and "${b.id}" overlap (~${round(-gap)}px) — run tidy_topology`,
        );
      if (gap < LAYOUT_RULES.minNodeGap) {
        (crowded.get(a.id) ?? crowded.set(a.id, new Set()).get(a.id)!).add(
          b.id,
        );
        (crowded.get(b.id) ?? crowded.set(b.id, new Set()).get(b.id)!).add(
          a.id,
        );
      }
    }
  }
  // Crowding clusters: connected components of the "too close" graph. Pairs are
  // routine (validate reports them); 4+ mutually-crowded nodes read as a knot.
  const seen = new Set<string>();
  for (const f of fps) {
    if (seen.has(f.id) || !crowded.has(f.id)) continue;
    const cluster: typeof fps = [];
    const stack = [f.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      cluster.push(fps.find((c) => c.id === id)!);
      for (const nb of crowded.get(id) ?? []) stack.push(nb);
    }
    if (cluster.length >= 4) {
      const cx = round(cluster.reduce((s, c) => s + c.x, 0) / cluster.length);
      const cy = round(cluster.reduce((s, c) => s + c.y, 0) / cluster.length);
      add(
        'note',
        'density',
        `${cluster.length} nodes crowd together around (${cx}, ${cy}) — spread them or use layout_topology`,
      );
    }
  }
}

/* ── estimated drawn geometry (engine metric mirrors) ─────────────── */

/** The strip the zone label occupies just inside the zone's top edge. */
function zoneLabelRect(zone: ZoneConfig, box: BoundsRect): BoundsRect {
  const label = zone.label ?? zone.id;
  const w = label.length * ZONE_LABEL_CHAR_W;
  const align = zone.labelAlign ?? 'left';
  const x =
    align === 'center'
      ? box.x + box.w / 2 - w / 2
      : align === 'right'
        ? box.x + box.w - 8 - w
        : box.x + 8;
  return { x, y: box.y + 5, w, h: ZONE_LABEL_H };
}

/* ── geometry primitives ──────────────────────────────────────────── */

function union(a: BoundsRect, b?: BoundsRect): BoundsRect {
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

function contentBounds(
  ...groups: Map<string, BoundsRect>[]
): BoundsRect | null {
  let acc: BoundsRect | null = null;
  for (const g of groups)
    for (const r of g.values()) acc = acc ? union(acc, r) : r;
  return acc;
}

/** Largest distance a rect pokes past the page, and which edge it crosses. */
function overhang(
  r: BoundsRect,
  page: BoundsRect,
): { amount: number; side: string } {
  const sides = [
    { amount: page.x - r.x, side: 'left' },
    { amount: r.x + r.w - (page.x + page.w), side: 'right' },
    { amount: page.y - r.y, side: 'top' },
    { amount: r.y + r.h - (page.y + page.h), side: 'bottom' },
  ];
  return sides.reduce((a, b) => (b.amount > a.amount ? b : a));
}

/** Smallest clear distance from a rect (fully inside) to any page edge. */
function edgeDistance(r: BoundsRect, page: BoundsRect): number {
  return Math.min(
    r.x - page.x,
    page.x + page.w - (r.x + r.w),
    r.y - page.y,
    page.y + page.h - (r.y + r.h),
  );
}

type Pt = { x: number; y: number };

function orient(a: Pt, b: Pt, c: Pt): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

/** Proper segment crossing (touching endpoints/collinear grazing excluded). */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** The point where segments a→b and c→d properly cross, or null. */
function segmentIntersection(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  if (!segmentsCross(a, b, c, d)) return null;
  const denom = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (denom === 0) return null; // parallel — segmentsCross already excludes it
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denom;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/**
 * The polyline a link is drawn along: centre → waypoints → centre, with the
 * engine's `_buildLinkPath` orthogonal elbows inserted, or the control polygon
 * for a curved link (its 2-point bulge is ≤20px, so the chord stands in).
 */
function linkPolyline(l: LinkConfig, from: Pt, to: Pt): Pt[] {
  const wps = (l.waypoints ?? []).filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  const pts: Pt[] = [from, ...wps.map((p) => ({ x: p.x, y: p.y })), to];
  if (l.lineStyle !== 'orthogonal') return pts;
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    out.push({ x: pts[i]!.x, y: pts[i - 1]!.y }, pts[i]!);
  }
  return out;
}

/** "between a1,a2 and b1,b2" — each side sorted so link direction and
 * discovery order never change the wording. */
function meshDesc(sideA: string[], sideB: string[]): string {
  const [x, y] = [sideA, sideB].map((side) => [...side].sort().join(','));
  return `between ${x} and ${y}`;
}

/** First point where two polylines properly cross, or null. */
function polylinesCross(p: Pt[], q: Pt[]): Pt | null {
  for (let i = 0; i + 1 < p.length; i++)
    for (let j = 0; j + 1 < q.length; j++) {
      const at = segmentIntersection(p[i]!, p[i + 1]!, q[j]!, q[j + 1]!);
      if (at) return at;
    }
  return null;
}

/** True when any segment of the polyline intersects the rect. */
function polylineIntersectsRect(p: Pt[], r: BoundsRect): boolean {
  for (let i = 0; i + 1 < p.length; i++)
    if (segmentIntersectsRect(p[i]!, p[i + 1]!, r)) return true;
  return false;
}

/** True when segment a→b intersects the rect (endpoint inside or edge cross). */
function segmentIntersectsRect(a: Pt, b: Pt, r: BoundsRect): boolean {
  const inside = (p: Pt): boolean =>
    p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  if (inside(a) || inside(b)) return true;
  const tl = { x: r.x, y: r.y };
  const tr = { x: r.x + r.w, y: r.y };
  const bl = { x: r.x, y: r.y + r.h };
  const br = { x: r.x + r.w, y: r.y + r.h };
  return (
    segmentsCross(a, b, tl, tr) ||
    segmentsCross(a, b, tr, br) ||
    segmentsCross(a, b, br, bl) ||
    segmentsCross(a, b, bl, tl)
  );
}

function round(n: number): number {
  return Math.round(n);
}

function roundRect(r: BoundsRect): BoundsRect {
  return { x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) };
}
