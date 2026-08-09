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
 * to 24 chars (~6px/char, baseline at y + labelOffset, default 24); link label
 * chips are `len × 5.6 + 14` wide × 20 tall at the segment midpoint, nudged
 * 12px perpendicular and scaled by labelScale; zone labels render at font-size
 * 9 (~5.4px/char) just inside the zone's top edge. Zone boxes pad the member
 * positions ±40x/±30y plus the zone padding, exactly as `_renderZoneRect` does.
 *
 * Pure and DOM-free: takes a Page, returns a typed report, moves nothing.
 */
import type { Page } from '../pages/model.js';
import type {
  LinkConfig,
  NodeConfig,
  ZoneConfig,
} from '../vendor/topology-ds.js';
import { nodeBounds, type BoundsRect } from '../api/geometry.js';
import { LAYOUT_RULES, parseViewBox, rectGap } from '../api/layout.js';

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

/* Engine label metrics (see module header). */
const NODE_LABEL_CHAR_W = 6; // ~0.6em at the 10px node-label font
const NODE_LABEL_MAX_CHARS = 24; // engine truncates longer labels with '…'
const NODE_LABEL_H = 12;
const NODE_SUBLABEL_H = 13;
const LINK_CHIP_CHAR_W = 5.6;
const LINK_CHIP_PAD = 14;
const LINK_CHIP_H = 20;
const ZONE_LABEL_CHAR_W = 5.4; // ~0.6em at the 9px zone-label font
const ZONE_LABEL_H = 14;
/** Below this endpoint distance the perimeter trims cross and the engine falls
 * back to a centre→centre line (see render/link-crossing.test.ts). */
const DEGENERATE_LINK_DIST = 40;

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
  const labels = new Map<string, BoundsRect>();
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of page.nodes) {
    glyphs.set(n.id, nodeBounds(n));
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
  checkText(page, glyphs, labels, pos, zones, zoneBoxes, add);
  checkRouting(page, pos, glyphs, add);
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
  labels: Map<string, BoundsRect>,
  pos: Map<string, { x: number; y: number }>,
  zones: ZoneConfig[],
  zoneBoxes: Map<string, BoundsRect>,
  add: (s: InspectSeverity, c: InspectCategory, m: string) => void,
): void {
  for (const n of page.nodes) {
    const label = typeof n.label === 'string' ? n.label : '';
    if (label.length > NODE_LABEL_MAX_CHARS)
      add(
        'note',
        'text',
        `label "${label}" on node "${n.id}" is ${label.length} chars — the renderer truncates it to ${NODE_LABEL_MAX_CHARS} with an ellipsis`,
      );
    const lr = labels.get(n.id);
    if (!lr) continue;
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

  // Link label chips vs each other and vs unrelated node glyphs.
  const chips: { link: LinkConfig; rect: BoundsRect }[] = [];
  for (const l of page.links) {
    const rect = linkChipRect(l, pos);
    if (rect) chips.push({ link: l, rect });
  }
  for (let i = 0; i < chips.length; i++) {
    const a = chips[i]!;
    for (let j = i + 1; j < chips.length; j++) {
      const b = chips[j]!;
      const gap = rectGap(a.rect, b.rect);
      if (gap < 0)
        add(
          'problem',
          'text',
          `labels of links "${a.link.id}" and "${b.link.id}" collide (~${round(-gap)}px overlap) — offset one with labelOffset`,
        );
    }
    for (const n of page.nodes) {
      if (n.id === a.link.from || n.id === a.link.to) continue;
      const gap = rectGap(a.rect, glyphs.get(n.id)!);
      if (gap < 0)
        add(
          'problem',
          'text',
          `label of link "${a.link.id}" sits on node "${n.id}" (~${round(-gap)}px overlap) — offset it with labelOffset`,
        );
    }
  }

  // Zone labels render just inside the zone's top edge — flag member/other
  // nodes drawn over that strip (the label becomes unreadable).
  for (const z of zones) {
    const box = zoneBoxes.get(z.id);
    if (!box) continue;
    const lr = zoneLabelRect(z, box);
    for (const n of page.nodes) {
      const gap = rectGap(lr, union(glyphs.get(n.id)!, labels.get(n.id)));
      if (gap < 0)
        add(
          'problem',
          'text',
          `label of zone "${z.id}" is overlapped by node "${n.id}" (~${round(-gap)}px) — enlarge the zone padding or move the node down`,
        );
    }
  }
}

/* ── routing quality ──────────────────────────────────────────────── */

function checkRouting(
  page: Page,
  pos: Map<string, { x: number; y: number }>,
  glyphs: Map<string, BoundsRect>,
  add: (s: InspectSeverity, c: InspectCategory, m: string) => void,
): void {
  interface Seg {
    link: LinkConfig;
    a: { x: number; y: number };
    b: { x: number; y: number };
  }
  const segs: Seg[] = [];
  for (const l of page.links) {
    const a = pos.get(l.from);
    const b = pos.get(l.to);
    if (a && b) segs.push({ link: l, a, b });
  }

  // Link/link crossings (straight centre-to-centre segments; shared endpoints
  // are a junction, not a crossing).
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]!,
        t = segs[j]!;
      const shared =
        s.link.from === t.link.from ||
        s.link.from === t.link.to ||
        s.link.to === t.link.from ||
        s.link.to === t.link.to;
      if (shared) continue;
      if (segmentsCross(s.a, s.b, t.a, t.b))
        add(
          'problem',
          'routing',
          `links "${s.link.id}" and "${t.link.id}" cross — reorder nodes or route one around`,
        );
    }
  }

  for (const s of segs) {
    // Links drawn through the box of a node that is not an endpoint.
    for (const n of page.nodes) {
      if (n.id === s.link.from || n.id === s.link.to) continue;
      if (segmentIntersectsRect(s.a, s.b, glyphs.get(n.id)!))
        add(
          'problem',
          'routing',
          `link "${s.link.id}" passes through unrelated node "${n.id}" — route around it or move the node`,
        );
    }
    // Degenerate geometry: endpoints so close the perimeter trims collapse.
    const dist = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    if (dist < 0.5)
      add(
        'problem',
        'routing',
        `link "${s.link.id}" has zero length — its endpoints share one position`,
      );
    else if (dist < DEGENERATE_LINK_DIST)
      add(
        'note',
        'routing',
        `link "${s.link.id}" spans only ~${round(dist)}px — too short to draw cleanly between the node boundaries`,
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

/** The classic below-node label rect, or null for types that draw their own
 * label (text/shape) or none at all (cloud/idcard/overlayCloud). */
function nodeLabelRect(n: NodeConfig): BoundsRect | null {
  const label = typeof n.label === 'string' ? n.label : '';
  if (!label) return null;
  const t = n.type;
  if (t === 'text' || t === 'cloud' || t === 'idcard' || t === 'overlayCloud')
    return null;
  if (t.startsWith('shape:') && n.labelOffset == null) return null;
  const chars = Math.min(label.length, NODE_LABEL_MAX_CHARS + 1);
  const w = chars * NODE_LABEL_CHAR_W;
  const offset = typeof n.labelOffset === 'number' ? n.labelOffset : 24;
  const h = NODE_LABEL_H + (n.sublabel ? NODE_SUBLABEL_H : 0);
  // Baseline sits at y + offset; the glyph box starts ~10px above it.
  return { x: n.x - w / 2, y: n.y + offset - 10, w, h };
}

/** The glass chip a link's centre label renders in, or null when unlabeled. */
function linkChipRect(
  l: LinkConfig,
  pos: Map<string, { x: number; y: number }>,
): BoundsRect | null {
  const label = typeof l.label === 'string' ? l.label : '';
  if (!label) return null;
  const a = pos.get(l.from);
  const b = pos.get(l.to);
  if (!a || !b) return null;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const lx = (a.x + b.x) / 2 - Math.sin(ang) * 12 + (l.labelOffset?.x ?? 0);
  const ly = (a.y + b.y) / 2 + Math.cos(ang) * 12 + (l.labelOffset?.y ?? 0);
  const s =
    typeof l.labelScale === 'number' && Number.isFinite(l.labelScale)
      ? Math.min(4, Math.max(0.25, l.labelScale))
      : 1;
  const w = (label.length * LINK_CHIP_CHAR_W + LINK_CHIP_PAD) * s;
  const h = LINK_CHIP_H * s;
  return { x: lx - w / 2, y: ly - h / 2, w, h };
}

/** The padded box the engine draws around a zone's (recursive) members. */
function zoneBox(page: Page, zone: ZoneConfig): BoundsRect | null {
  const ids = zoneMemberIds(page, zone.id);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const id of ids) {
    const n = page.nodes.find((m) => m.id === id);
    if (!n) continue;
    minX = Math.min(minX, n.x - 40);
    minY = Math.min(minY, n.y - 30);
    maxX = Math.max(maxX, n.x + 40);
    maxY = Math.max(maxY, n.y + 30);
  }
  if (!isFinite(minX)) return null;
  const pad = zone.padding ?? LAYOUT_RULES.zonePadding;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

/** Node ids of a zone and its descendant zones. */
function zoneMemberIds(page: Page, zoneId: string): string[] {
  const zones = page.zones ?? [];
  const zone = zones.find((z) => z.id === zoneId);
  if (!zone) return [];
  const ids = [...(zone.nodes ?? [])];
  for (const child of zones)
    if (child.parentZone === zoneId) ids.push(...zoneMemberIds(page, child.id));
  return ids;
}

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
