/**
 * Wire-label pill metrics and placement rules — the ONE place the sizes of a
 * link centre label, a flow-path label and a policy-marker label live on the
 * TypeScript side. The vendored engine (public/vendor/topology-ds.js, search
 * "mirror of src/render/wire-labels.ts") keeps a byte-for-byte copy of the
 * constants and the same algorithms, because it must stay a dependency-free
 * script; the inspector (`src/render/inspect.ts`) imports this module so its
 * estimated pill rects match what the engine draws. Keep the two in lockstep.
 *
 * A pill is the glass chip behind a label: the label is word-wrapped (greedy,
 * honouring explicit newlines) at `labelWidth` px — or, absent that, at
 * `WRAP_CHARS` characters — and the pill is sized from the wrapped block
 * (longest line × char width + padding, lines × line height + padding).
 * After placement a pill that overlaps a node footprint, a zone title strip or
 * a pill already placed this render is slid along its segment by a fixed
 * sequence of fractions of its own width until a clear spot is found (or left
 * where it was). Everything here is pure and DOM-free.
 */
import type { BoundsRect } from '../api/geometry.js';

export type WireLabelKind = 'link' | 'flow' | 'marker';

export interface PillMetrics {
  fontSize: number;
  /** Estimated advance per character at `fontSize`. */
  charW: number;
  lineH: number;
  padX: number;
  padY: number;
  /** Lines beyond this are dropped and the last kept line gets an ellipsis. */
  maxLines?: number;
}

/* mirror: public/vendor/topology-ds.js `WIRE_LABEL` (keep in lockstep) */
export const WIRE_LABEL: Readonly<Record<WireLabelKind, PillMetrics>> = {
  link: { fontSize: 7.5, charW: 5.6, lineH: 10, padX: 7, padY: 5 },
  flow: { fontSize: 8, charW: 6, lineH: 11, padX: 7, padY: 4.5 },
  marker: { fontSize: 8, charW: 6, lineH: 11, padX: 6, padY: 3, maxLines: 2 },
};
/** Auto-wrap width in characters when no `labelWidth` is set. */
export const WRAP_CHARS = 26;
/** Bounds for an explicit `labelWidth` (px). */
export const LABEL_WIDTH_MIN = 40;
export const LABEL_WIDTH_MAX = 600;
/** Perpendicular nudge of a link / flow label off its wire. */
export const PERP_NUDGE = 12;
/** Gap between a marker badge's circle (r=10) and the top of its label pill. */
export const MARKER_LABEL_GAP = 13;
/** Collision-nudge trial offsets, as fractions of the pill's own width. */
export const NUDGE_STEPS: readonly number[] = [0.25, -0.25, 0.5, -0.5, 1, -1];
/** Marker labels longer than this are worth a note (they wrap to 2 lines). */
export const MARKER_LABEL_NOTE_CHARS = 24;

/** The clamped `labelWidth`, or undefined for an unset / invalid value. */
export function clampLabelWidth(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) return undefined;
  return Math.min(LABEL_WIDTH_MAX, Math.max(LABEL_WIDTH_MIN, n));
}

/** Characters per line a label wraps at, from `labelWidth` or the default. */
export function wrapChars(kind: WireLabelKind, labelWidth?: unknown): number {
  const w = clampLabelWidth(labelWidth);
  return w === undefined
    ? WRAP_CHARS
    : Math.max(1, Math.floor(w / WIRE_LABEL[kind].charW));
}

/**
 * Greedy word-wrap at `maxChars` per line. Explicit newlines are respected; a
 * single word longer than the width overflows rather than being broken. The
 * engine's `_wrapChars` is this exact algorithm.
 */
export function wrapAtChars(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? line + ' ' + word : word;
      if (cand.length <= maxChars || !line) line = cand;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** The lines a label renders as: wrapped, then capped at the kind's maxLines
 * with an ellipsis on the last kept line. */
export function labelLines(
  kind: WireLabelKind,
  label: string,
  labelWidth?: unknown,
): string[] {
  const maxChars = wrapChars(kind, labelWidth);
  const lines = wrapAtChars(label, maxChars);
  const max = WIRE_LABEL[kind].maxLines;
  if (!max || lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  const last = kept[max - 1]!;
  kept[max - 1] = last.slice(0, Math.max(1, maxChars - 1)) + '…';
  return kept;
}

/** Pill width × height for a wrapped block, at a uniform scale. */
export function pillSize(
  kind: WireLabelKind,
  lines: string[],
  scale = 1,
): { w: number; h: number } {
  const m = WIRE_LABEL[kind];
  const longest = lines.reduce((n, l) => Math.max(n, l.length), 0);
  return {
    w: (longest * m.charW + m.padX * 2) * scale,
    h: (lines.length * m.lineH + m.padY * 2) * scale,
  };
}

/** The pill rect centred on (cx, cy). */
export function pillRectAt(
  cx: number,
  cy: number,
  size: { w: number; h: number },
): BoundsRect {
  return { x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h };
}

/** Strict rectangle overlap (touching edges do not count). */
export function rectsOverlap(a: BoundsRect, b: BoundsRect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

export interface NudgeResult {
  rect: BoundsRect;
  /** Shift applied (0,0 when the pill was clear, or nothing cleared it). */
  dx: number;
  dy: number;
  /** True when the pill still overlaps an obstacle after the trials. */
  blocked: boolean;
}

/**
 * Collision nudge: when `rect` overlaps any obstacle, try sliding it along
 * `dir` (a unit vector) by each of NUDGE_STEPS × its own width and take the
 * first clear position; otherwise leave it where it is (and report blocked).
 * Deterministic. The engine's `_nudgePill` is this exact rule.
 */
export function nudgePill(
  rect: BoundsRect,
  dir: { x: number; y: number },
  obstacles: readonly BoundsRect[],
): NudgeResult {
  const hits = (r: BoundsRect): boolean =>
    obstacles.some((o) => rectsOverlap(r, o));
  if (!hits(rect)) return { rect, dx: 0, dy: 0, blocked: false };
  for (const f of NUDGE_STEPS) {
    const dx = dir.x * f * rect.w,
      dy = dir.y * f * rect.w;
    const cand = { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
    if (!hits(cand)) return { rect: cand, dx, dy, blocked: false };
  }
  return { rect, dx: 0, dy: 0, blocked: true };
}

export type Pt = { x: number; y: number };

/** A straight (or chord-of-a-curve) piece of a drawn path, as a label site. */
export interface PathSegment {
  a: Pt;
  b: Pt;
  /** Where a label anchors before its perpendicular nudge (the curve midpoint
   * for a Bézier piece, else the segment midpoint). */
  mid: Pt;
  len: number;
}

/** Straight segments of a polyline. */
export function polylineSegments(pts: readonly Pt[]): PathSegment[] {
  const out: PathSegment[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!,
      b = pts[i + 1]!;
    out.push({
      a,
      b,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      len: Math.hypot(b.x - a.x, b.y - a.y),
    });
  }
  return out;
}

/** The longest segment (first wins a tie), or null for none. */
export function longestSegment(
  segs: readonly PathSegment[],
): PathSegment | null {
  let best: PathSegment | null = null;
  for (const s of segs) if (!best || s.len > best.len) best = s;
  return best;
}

/**
 * The default anchor of a link / flow label on a segment: its midpoint nudged
 * PERP_NUDGE px perpendicular (the same side the engine picks), plus the
 * segment's unit direction for the collision nudge.
 */
export function segmentLabelAnchor(seg: PathSegment): {
  x: number;
  y: number;
  dir: Pt;
} {
  const ang = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x);
  return {
    x: seg.mid.x - Math.sin(ang) * PERP_NUDGE,
    y: seg.mid.y + Math.cos(ang) * PERP_NUDGE,
    dir: { x: Math.cos(ang), y: Math.sin(ang) },
  };
}

export type MarkerAlign =
  | 'N'
  | 'NE'
  | 'E'
  | 'SE'
  | 'S'
  | 'SW'
  | 'W'
  | 'NW'
  | 'C';

/**
 * Badge centre of the idx-th marker stacked at `align` on a node with the
 * given hit box, and the stacking direction (which doubles as the label's
 * nudge direction). Mirror of the engine's `_markerPos`.
 */
export function markerBadgeCenter(
  node: BoundsRect,
  align: MarkerAlign | undefined,
  idx: number,
): { x: number; y: number; dir: Pt } {
  const cx0 = node.x + node.w / 2,
    cy0 = node.y + node.h / 2;
  const hw = node.w / 2,
    hh = node.h / 2;
  const margin = 14,
    gap = 22;
  let cx: number, cy: number;
  let sdx = 1,
    sdy = 0;
  switch (align ?? 'NE') {
    case 'N':
      cx = cx0;
      cy = cy0 - hh - margin;
      break;
    case 'E':
      cx = cx0 + hw + margin;
      cy = cy0;
      sdx = 0;
      sdy = 1;
      break;
    case 'SE':
      cx = cx0 + hw + margin;
      cy = cy0 + hh + margin;
      break;
    case 'S':
      cx = cx0;
      cy = cy0 + hh + margin;
      break;
    case 'SW':
      cx = cx0 - hw - margin;
      cy = cy0 + hh + margin;
      sdx = -1;
      break;
    case 'W':
      cx = cx0 - hw - margin;
      cy = cy0;
      sdx = 0;
      sdy = 1;
      break;
    case 'NW':
      cx = cx0 - hw - margin;
      cy = cy0 - hh - margin;
      sdx = -1;
      break;
    case 'C':
      cx = cx0;
      cy = cy0;
      break;
    default: // 'NE'
      cx = cx0 + hw + margin;
      cy = cy0 - hh - margin;
  }
  return {
    x: cx + sdx * gap * idx,
    y: cy + sdy * gap * idx,
    dir: { x: sdx, y: sdy },
  };
}

/* mirror: public/vendor/topology-ds.js `_getNodeAABB` default table */
const ENGINE_AABB: Readonly<Record<string, { rx: number; ry: number }>> = {
  ec: { rx: 32, ry: 17 },
  switch: { rx: 34, ry: 15 },
  switchEnterprise: { rx: 46, ry: 18 },
  cloud: { rx: 64, ry: 36 },
  host: { rx: 22, ry: 17 },
  connector: { rx: 24, ry: 17 },
  apps: { rx: 20, ry: 24 },
  saas: { rx: 36, ry: 22 },
  server: { rx: 22, ry: 22 },
  router: { rx: 20, ry: 20 },
  firewall: { rx: 24, ry: 18 },
  database: { rx: 20, ry: 22 },
  ap: { rx: 20, ry: 22 },
  idcard: { rx: 99, ry: 39 },
};

/**
 * The hit box the ENGINE uses for a node when nudging labels (its
 * `_getNodeAABB`: a per-type table, 20×20 half-extents otherwise). This is
 * what label placement must mirror; the inspector's finer `nodeBounds` is
 * for drawing-accurate overlap reports.
 */
export function engineNodeAABB(n: {
  type: string;
  x: number;
  y: number;
}): BoundsRect {
  const b = ENGINE_AABB[n.type] ?? { rx: 20, ry: 20 };
  return { x: n.x - b.rx, y: n.y - b.ry, w: b.rx * 2, h: b.ry * 2 };
}
