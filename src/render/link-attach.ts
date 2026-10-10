/**
 * Link endpoint attachment — the TypeScript mirror of the vendored engine's
 * `_linkGeometry` endpoint trimming (public/vendor/topology-ds.js), so
 * headless code (the `inspect_render` geometry, the editor's anchor-box
 * outline) measures the DRAWN link, not the centre→centre chord.
 *
 * Mirrored, step for step:
 *  - the classic behaviour: parallel-sibling fan-out (`_parallelOffset`), an
 *    explicit port pinned to the hit AABB side/corner, else the centre→next
 *    point ray clipped to the silhouette (circle / ellipse / rounded-rect)
 *    plus a 3px gap, and the "reversed" guard that falls back to
 *    centre→centre when the two trims cross (`_attachEndpoint`);
 *  - the EXPERIMENTAL link anchor box (`_attachEnd` and friends): when a
 *    page/node carries `linkAttach`, endpoints attach to the hit AABB
 *    inflated by `pad`, extended on the label side to clear the label block;
 *    `distribute` spreads a side's endpoints into even slots; port offsets
 *    shift an endpoint along its side; the degenerate guard shrinks pad → 0
 *    → classic → centre.
 *
 * The engine is the source of truth for pixels; `link-attach.test.ts`
 * renders fixtures through it and asserts this module agrees to 0.01px.
 * Pure and DOM-free.
 */
import type { CustomNodeSpec } from '../nodes/spec.js';
import { customHitBox } from '../nodes/render.js';
import { STOCK_NODE_SPECS } from '../nodes/stock.js';
import type {
  AnchorConfig,
  LinkAttachOptions,
  LinkConfig,
  NodeConfig,
} from '../vendor/topology-ds.js';
import { drawsOwnLabel, type BoundsRect } from '../api/geometry.js';
import { nodeLabelPos } from './label-placement.js';
import { engineNodeAABB } from './wire-labels.js';

export type Pt = { x: number; y: number };
export type Side = 'n' | 's' | 'e' | 'w';

/** `pad` used when a `linkAttach` object is present without one (engine: `_LINK_ATTACH_DEFAULT_PAD`). */
export const LINK_ATTACH_DEFAULT_PAD = 6;
/** The engine's classic clearance between a trimmed endpoint and the icon. */
const GAP = 3;
/** Sibling fan-out spacing (`_parallelOffset`). */
const PARALLEL_STEP = 9;

const PORT_DIRS: Readonly<Record<string, readonly [number, number]>> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [1, -1],
  nw: [-1, -1],
  se: [1, 1],
  sw: [-1, 1],
};
const SIDES: readonly Side[] = ['n', 's', 'e', 'w'];

export interface HitBox {
  rx: number;
  ry: number;
}
/** Plugin hit boxes by node type — what the engine's `_getNodeAABB` consults first. */
export type HitBoxes = ReadonlyMap<string, HitBox>;

/**
 * The hit boxes the render path registers with the engine: the stock cloud
 * pack plus a document's own custom node types (`registerCustomTypes` in
 * render/core). Pass the result as `hitBoxes` so custom-typed nodes attach
 * where the engine attaches them.
 */
export function engineHitBoxes(customNodes: CustomNodeSpec[] = []): HitBoxes {
  const m = new Map<string, HitBox>();
  for (const spec of [...STOCK_NODE_SPECS, ...customNodes])
    m.set(spec.typeName, customHitBox(spec));
  return m;
}

/** The engine's hit AABB for a node (`_getNodeAABB`: plugin hit box, else the type table). */
export function engineAABB(n: NodeConfig, hitBoxes?: HitBoxes): BoundsRect {
  const hb = hitBoxes?.get(n.type);
  if (hb) return { x: n.x - hb.rx, y: n.y - hb.ry, w: hb.rx * 2, h: hb.ry * 2 };
  return engineNodeAABB(n);
}

/** The engine's silhouette class for boundary attachment (`_nodeShape`). */
function nodeShape(n: NodeConfig): 'circle' | 'ellipse' | 'rect' {
  const sh = typeof n.shape === 'string' ? n.shape : '';
  if (sh === 'circle') return 'circle';
  if (sh === 'ellipse') return 'ellipse';
  if (sh) return 'rect';
  if (n.type === 'cloud' || n.type === 'overlayCloud') return 'ellipse';
  if (n.type === 'router' || n.type === 'ap') return 'circle';
  return 'rect';
}

/**
 * The classic below/beside-node label block (label line + optional sublabel)
 * as the engine's `_nodeLabelBlock` estimates it, in page coordinates: ~6px
 * per glyph at the 10px font, truncated at 24 chars (+ ellipsis), 12px tall
 * plus 13px for a sublabel, placed per `nodeLabelPos`. Null for nodes that
 * draw their own label (text / callout / cloud / idcard / shapes) or none.
 */
export function nodeLabelRect(n: NodeConfig): BoundsRect | null {
  const label = typeof n.label === 'string' ? n.label : '';
  if (!label) return null;
  if (drawsOwnLabel(n)) return null;
  const w = Math.min(label.length, 25) * 6;
  const h = 12 + (n.sublabel ? 13 : 0);
  const lp = nodeLabelPos(n);
  const x =
    lp.anchor === 'start'
      ? lp.x
      : lp.anchor === 'end'
        ? lp.x - w
        : lp.x - w / 2;
  return { x, y: lp.y - 10, w, h };
}

/** Resolved options for one node (`_linkAttachFor`). */
export interface ResolvedLinkAttach {
  pad: number;
  distribute: boolean;
}

/**
 * The effective link-attach options for a node — the node's object merged
 * over the page's — or null when the feature is inactive for it.
 */
export function effectiveLinkAttach(
  page: LinkAttachOptions | null | undefined,
  node: NodeConfig,
): ResolvedLinkAttach | null {
  const pg = page && typeof page === 'object' ? page : null;
  const own =
    node.linkAttach && typeof node.linkAttach === 'object'
      ? node.linkAttach
      : null;
  if (!pg && !own) return null;
  const pick = <K extends keyof LinkAttachOptions>(
    k: K,
  ): LinkAttachOptions[K] | undefined =>
    own && own[k] !== undefined ? own[k] : pg ? pg[k] : undefined;
  const padRaw = pick('pad');
  const pad =
    typeof padRaw === 'number' && Number.isFinite(padRaw)
      ? Math.max(0, padRaw)
      : LINK_ATTACH_DEFAULT_PAD;
  return { pad, distribute: pick('distribute') === true };
}

/** The anchor box relative to the node centre (`_anchorBox`). */
interface RelBox {
  l: number;
  r: number;
  t: number;
  b: number;
  labelSides: Side[];
}

function relBox(n: NodeConfig, pad: number, hitBoxes?: HitBoxes): RelBox {
  const ab = engineAABB(n, hitBoxes);
  const hw = ab.w / 2;
  const hh = ab.h / 2;
  const box: RelBox = {
    l: -(hw + pad),
    r: hw + pad,
    t: -(hh + pad),
    b: hh + pad,
    labelSides: [],
  };
  const abs = nodeLabelRect(n);
  if (!abs) return box;
  const lb = { x: abs.x - n.x, y: abs.y - n.y, w: abs.w, h: abs.h };
  // The engine reads the raw placement code here (unknown codes extend no side).
  const p = String(n.labelPlacement ?? 's').toLowerCase();
  const north = p === 'n' || p === 'ne' || p === 'nw';
  const south = p === 's' || p === 'se' || p === 'sw';
  const east = p === 'e' || p === 'ne' || p === 'se';
  const west = p === 'w' || p === 'nw' || p === 'sw';
  if (south) {
    box.b = Math.max(box.b, lb.y + lb.h + pad);
    box.labelSides.push('s');
  }
  if (north) {
    box.t = Math.min(box.t, lb.y - pad);
    box.labelSides.push('n');
  }
  if (east) {
    box.r = Math.max(box.r, lb.x + lb.w + pad);
    box.labelSides.push('e');
  }
  if (west) {
    box.l = Math.min(box.l, lb.x - pad);
    box.labelSides.push('w');
  }
  return box;
}

/**
 * The anchor box a node's links attach to, in page coordinates, with the
 * label-extended sides listed — for the editor's selection outline.
 */
export function anchorBox(
  n: NodeConfig,
  pad: number,
  hitBoxes?: HitBoxes,
): BoundsRect & { labelSides: Side[] } {
  const b = relBox(n, pad, hitBoxes);
  return {
    x: n.x + b.l,
    y: n.y + b.t,
    w: b.r - b.l,
    h: b.b - b.t,
    labelSides: b.labelSides,
  };
}

/** Where a unit ray from the box centre leaves it (`_boxExit`). */
function boxExit(
  box: RelBox,
  ux: number,
  uy: number,
): { t: number; side: Side } | null {
  let t = Infinity;
  let side: Side | null = null;
  if (ux > 0 && box.r / ux < t) {
    t = box.r / ux;
    side = 'e';
  }
  if (ux < 0 && box.l / ux < t) {
    t = box.l / ux;
    side = 'w';
  }
  if (uy > 0 && box.b / uy < t) {
    t = box.b / uy;
    side = 's';
  }
  if (uy < 0 && box.t / uy < t) {
    t = box.t / uy;
    side = 'n';
  }
  return side ? { t, side } : null;
}

/** A point on a side: `u` in [0,1] runs left→right (n/s) or top→bottom (e/w). */
function boxSidePoint(box: RelBox, side: Side, u: number): Pt {
  if (side === 'n' || side === 's')
    return { x: box.l + (box.r - box.l) * u, y: side === 'n' ? box.t : box.b };
  return { x: side === 'e' ? box.r : box.l, y: box.t + (box.b - box.t) * u };
}

/** A side-port pin: `frac` runs from the centre line (0) to the side's ends (±1). */
function boxSideAt(box: RelBox, side: Side, frac: number): Pt {
  const f = Math.max(-1, Math.min(1, frac || 0));
  if (side === 'n' || side === 's')
    return {
      x: f >= 0 ? f * box.r : -f * box.l,
      y: side === 'n' ? box.t : box.b,
    };
  return {
    x: side === 'e' ? box.r : box.l,
    y: f >= 0 ? f * box.b : -f * box.t,
  };
}

/** Shift a point along its side by `frac` of the half-length, clamped. */
function boxShift(box: RelBox, side: Side, pt: Pt, frac: number): Pt {
  if (!frac) return pt;
  if (side === 'n' || side === 's')
    return {
      x: Math.max(box.l, Math.min(box.r, pt.x + (frac * (box.r - box.l)) / 2)),
      y: pt.y,
    };
  return {
    x: pt.x,
    y: Math.max(box.t, Math.min(box.b, pt.y + (frac * (box.b - box.t)) / 2)),
  };
}

/**
 * The classic engine attachment (`_attachEndpoint`): a port pins to the hit
 * AABB side/corner; otherwise the centre→toward ray is clipped to the
 * silhouette and backed off by the 3px gap.
 */
export function attachEndpoint(
  node: NodeConfig,
  pos: Pt,
  toward: Pt,
  port: string | undefined,
  hitBoxes?: HitBoxes,
): Pt {
  const ab = engineAABB(node, hitBoxes);
  const hw = ab.w / 2;
  const hh = ab.h / 2;
  if (hw <= 0 || hh <= 0) return pos;
  const dir = port ? PORT_DIRS[port] : undefined;
  if (dir) return { x: pos.x + dir[0] * hw, y: pos.y + dir[1] * hh };
  const dx = toward.x - pos.x;
  const dy = toward.y - pos.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return pos;
  const ux = dx / len;
  const uy = dy / len;
  const shape = nodeShape(node);
  let s: number;
  if (shape === 'circle') s = Math.min(hw, hh);
  else if (shape === 'ellipse')
    s = 1 / Math.sqrt((ux / hw) ** 2 + (uy / hh) ** 2);
  else s = 1 / Math.max(Math.abs(ux) / hw, Math.abs(uy) / hh);
  return { x: pos.x + ux * (s + GAP), y: pos.y + uy * (s + GAP) };
}

/** Anchor-box attachment for one node end, no distribute (`_attachEndpointBox`). */
function attachEndpointBox(
  node: NodeConfig,
  pos: Pt,
  toward: Pt,
  port: string | undefined,
  pad: number,
  offset: number,
  hitBoxes?: HitBoxes,
): Pt {
  const box = relBox(node, pad, hitBoxes);
  const dir = port ? PORT_DIRS[port] : undefined;
  if (dir && port) {
    if (port.length === 2)
      return {
        x: pos.x + (dir[0] > 0 ? box.r : box.l),
        y: pos.y + (dir[1] > 0 ? box.b : box.t),
      };
    const pt = boxSideAt(box, port as Side, offset);
    return { x: pos.x + pt.x, y: pos.y + pt.y };
  }
  const dx = toward.x - pos.x;
  const dy = toward.y - pos.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return pos;
  const ux = dx / len;
  const uy = dy / len;
  const exit = boxExit(box, ux, uy);
  if (!exit) return pos;
  const shape = nodeShape(node);
  if (
    !offset &&
    !box.labelSides.includes(exit.side) &&
    (shape === 'circle' || shape === 'ellipse')
  ) {
    const ab = engineAABB(node, hitBoxes);
    const hw = ab.w / 2;
    const hh = ab.h / 2;
    const s =
      shape === 'circle'
        ? Math.min(hw, hh) + pad
        : 1 / Math.sqrt((ux / (hw + pad)) ** 2 + (uy / (hh + pad)) ** 2);
    return { x: pos.x + ux * s, y: pos.y + uy * s };
  }
  const pt = boxShift(
    box,
    exit.side,
    { x: ux * exit.t, y: uy * exit.t },
    offset,
  );
  return { x: pos.x + pt.x, y: pos.y + pt.y };
}

/** The page slice attachment reads. */
export interface AttachPage {
  nodes: NodeConfig[];
  links: LinkConfig[];
  anchors?: AnchorConfig[];
  linkAttach?: LinkAttachOptions;
}

export interface AttachContextOptions {
  /** Plugin hit boxes (see `engineHitBoxes`); absent = built-in table only. */
  hitBoxes?: HitBoxes;
}

type End = 'from' | 'to';
type Mode = 'box' | 'icon' | 'legacy';

interface EndContext {
  pos: Pt;
  toward: Pt;
  port: string | undefined;
  offset: number;
}
interface Slot {
  id: string;
  end: End;
  axis: number;
}
type Slots = Record<Side, Slot[]>;

/**
 * Per-page attachment context: resolves every link's drawn endpoints the way
 * the engine does, memoising the distribute slot scan per node like the
 * engine's per-render cache. Build one per page and reuse it.
 */
export interface AttachContext {
  /** The drawn endpoints of a link, or null when an endpoint id is unknown. */
  endpoints(link: LinkConfig): { from: Pt; to: Pt } | null;
  /** Effective options for a node (null = classic attachment). */
  optionsFor(node: NodeConfig): ResolvedLinkAttach | null;
}

export function createAttachContext(
  page: AttachPage,
  opts: AttachContextOptions = {},
): AttachContext {
  const hitBoxes = opts.hitBoxes;
  const nodes = new Map<string, NodeConfig>();
  for (const n of page.nodes) nodes.set(n.id, n);
  const anchors = new Map<string, AnchorConfig>();
  for (const a of page.anchors ?? []) anchors.set(a.id, a);
  const slotCache = new Map<string, Slots>();

  const pos = (id: string): Pt | undefined => {
    const n = nodes.get(id);
    if (n) return { x: n.x, y: n.y };
    const a = anchors.get(id);
    return a ? { x: a.x, y: a.y } : undefined;
  };
  const optionsFor = (node: NodeConfig): ResolvedLinkAttach | null =>
    effectiveLinkAttach(page.linkAttach, node);
  const distributes = (id: string): boolean => {
    const n = nodes.get(id);
    const o = n ? optionsFor(n) : null;
    return !!(o && o.distribute);
  };

  // `_parallelOffset`: siblings between the same pair (either direction,
  // none with waypoints) fan apart on a canonical axis in page order.
  const parallelOffset = (link: LinkConfig): { dx: number; dy: number } => {
    if (link.waypoints && link.waypoints.length) return { dx: 0, dy: 0 };
    const siblings = page.links.filter(
      (l) =>
        !(l.waypoints && l.waypoints.length) &&
        ((l.from === link.from && l.to === link.to) ||
          (l.from === link.to && l.to === link.from)),
    );
    if (siblings.length < 2) return { dx: 0, dy: 0 };
    const idx = siblings.findIndex((l) => l.id === link.id);
    const dist = (idx - (siblings.length - 1) / 2) * PARALLEL_STEP;
    if (!dist) return { dx: 0, dy: 0 };
    const lo = link.from < link.to ? link.from : link.to;
    const hi = link.from < link.to ? link.to : link.from;
    const pf = pos(lo);
    const pt = pos(hi);
    if (!pf || !pt) return { dx: 0, dy: 0 };
    const ang = Math.atan2(pt.y - pf.y, pt.x - pf.x);
    return { dx: Math.sin(ang) * dist, dy: -Math.cos(ang) * dist };
  };

  // `_endContext`: the centre (fanned unless the node distributes), the next
  // point on the path, the port and the clamped port offset for one end.
  const endContext = (link: LinkConfig, end: End): EndContext | null => {
    const id = link[end];
    const otherId = end === 'from' ? link.to : link.from;
    const base = pos(id);
    const other = pos(otherId);
    if (!base || !other) return null;
    const off = parallelOffset(link);
    const p = distributes(id)
      ? base
      : { x: base.x + off.dx, y: base.y + off.dy };
    const otherPos = distributes(otherId)
      ? other
      : { x: other.x + off.dx, y: other.y + off.dy };
    const wps = link.waypoints;
    const toward =
      wps && wps.length
        ? end === 'from'
          ? wps[0]!
          : wps[wps.length - 1]!
        : otherPos;
    const port = end === 'from' ? link.fromPort : link.toPort;
    const offRaw = end === 'from' ? link.fromPortOffset : link.toPortOffset;
    const offset =
      typeof offRaw === 'number' && Number.isFinite(offRaw)
        ? Math.max(-1, Math.min(1, offRaw))
        : 0;
    return { pos: p, toward, port, offset };
  };

  // `_distributeSlots`: per side, every endpoint attaching there, sorted by
  // the far end's coordinate along the side's axis, then link id, then end.
  const distributeSlots = (nodeId: string, pad: number): Slots => {
    const key = `${nodeId}|${pad}`;
    const hit = slotCache.get(key);
    if (hit) return hit;
    const node = nodes.get(nodeId)!;
    const box = relBox(node, pad, hitBoxes);
    const sides: Slots = { n: [], s: [], e: [], w: [] };
    for (const link of page.links) {
      for (const end of ['from', 'to'] as const) {
        if (link[end] !== nodeId) continue;
        const ctx = endContext(link, end);
        if (!ctx) continue;
        let side: Side | null = null;
        if (ctx.port) {
          if ((SIDES as readonly string[]).includes(ctx.port))
            side = ctx.port as Side;
        } else {
          const dx = ctx.toward.x - ctx.pos.x;
          const dy = ctx.toward.y - ctx.pos.y;
          const len = Math.hypot(dx, dy);
          const exit = len === 0 ? null : boxExit(box, dx / len, dy / len);
          side = exit ? exit.side : null;
        }
        if (!side) continue;
        sides[side].push({
          id: link.id,
          end,
          axis: side === 'n' || side === 's' ? ctx.toward.x : ctx.toward.y,
        });
      }
    }
    const cmp = (a: Slot, b: Slot): number =>
      a.axis - b.axis ||
      (a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : a.end < b.end
            ? -1
            : a.end > b.end
              ? 1
              : 0);
    for (const k of SIDES) sides[k].sort(cmp);
    slotCache.set(key, sides);
    return sides;
  };

  // `_attachEnd`: one end under the feature, at a degenerate-guard step.
  const attachEnd = (
    link: LinkConfig,
    end: End,
    ctx: EndContext,
    mode: Mode,
  ): Pt => {
    const id = link[end];
    if (anchors.has(id)) return ctx.pos;
    const node = nodes.get(id);
    if (!node) return ctx.pos;
    const opt = optionsFor(node);
    if (!opt || mode === 'legacy')
      return attachEndpoint(node, ctx.pos, ctx.toward, ctx.port, hitBoxes);
    const pad = mode === 'box' ? opt.pad : 0;
    if (opt.distribute) {
      const slots = distributeSlots(id, pad);
      for (const side of SIDES) {
        const list = slots[side];
        const i = list.findIndex((s) => s.id === link.id && s.end === end);
        if (i < 0) continue;
        const box = relBox(node, pad, hitBoxes);
        const at = boxSidePoint(box, side, (i + 1) / (list.length + 1));
        const pt = boxShift(box, side, at, ctx.offset);
        return { x: ctx.pos.x + pt.x, y: ctx.pos.y + pt.y };
      }
    }
    return attachEndpointBox(
      node,
      ctx.pos,
      ctx.toward,
      ctx.port,
      pad,
      ctx.offset,
      hitBoxes,
    );
  };

  const active = (link: LinkConfig): boolean => {
    const f = nodes.get(link.from);
    const t = nodes.get(link.to);
    return !!((f && optionsFor(f)) || (t && optionsFor(t)));
  };

  const endpoints = (link: LinkConfig): { from: Pt; to: Pt } | null => {
    const wps = link.waypoints;
    const hasWps = !!(wps && wps.length);
    if (active(link)) {
      const fromCtx = endContext(link, 'from');
      const toCtx = endContext(link, 'to');
      if (!fromCtx || !toCtx) return null;
      const fromC = fromCtx.pos;
      const toC = toCtx.pos;
      for (const mode of ['box', 'icon', 'legacy'] as const) {
        const fromA = attachEnd(link, 'from', fromCtx, mode);
        const toA = attachEnd(link, 'to', toCtx, mode);
        const reversed =
          !hasWps &&
          (toC.x - fromC.x) * (toA.x - fromA.x) +
            (toC.y - fromC.y) * (toA.y - fromA.y) <=
            0;
        if (!reversed) return { from: fromA, to: toA };
      }
      return { from: fromC, to: toC };
    }
    // The classic path, verbatim: fan-out, then trim, then the reversed guard.
    let from = pos(link.from);
    let to = pos(link.to);
    if (!from || !to) return null;
    const off = parallelOffset(link);
    if (off.dx || off.dy) {
      from = { x: from.x + off.dx, y: from.y + off.dy };
      to = { x: to.x + off.dx, y: to.y + off.dy };
    }
    const fromToward = hasWps ? wps![0]! : to;
    const toToward = hasWps ? wps![wps!.length - 1]! : from;
    const trim = (id: string, p: Pt, toward: Pt, port?: string): Pt => {
      if (anchors.has(id)) return p;
      const n = nodes.get(id);
      return n ? attachEndpoint(n, p, toward, port, hitBoxes) : p;
    };
    const fromA = trim(link.from, from, fromToward, link.fromPort);
    const toA = trim(link.to, to, toToward, link.toPort);
    const reversed =
      !hasWps &&
      (to.x - from.x) * (toA.x - fromA.x) +
        (to.y - from.y) * (toA.y - fromA.y) <=
        0;
    return reversed ? { from, to } : { from: fromA, to: toA };
  };

  return { endpoints, optionsFor };
}

/** One-shot convenience: the drawn endpoints of a link on a page. */
export function linkEndpoints(
  page: AttachPage,
  link: LinkConfig,
  opts: AttachContextOptions = {},
): { from: Pt; to: Pt } | null {
  return createAttachContext(page, opts).endpoints(link);
}
