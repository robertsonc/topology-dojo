/**
 * Where the engine draws a link's centre label when it is NOT a `line` link.
 *
 * A `line` link's label is a pill sized to its text and slid clear of
 * obstacles (see `wire-labels.ts`). Every other link type draws a FIXED chip:
 * a set size, beside the middle of the chord between the link's drawn
 * endpoints, never moved by the renderer. The inspector has to model each one
 * as drawn, or it reports a label as clear while it sits on a node.
 *
 * MIRROR of the label code in `public/vendor/topology-ds.js` (`_renderTunnel`,
 * `_renderWG`, `_renderFlow`, `_renderPacket`, `_renderWifi`, `_renderPoE`,
 * `_renderOptical`, `_renderBlocked`): a number changed there changes here.
 * `link-chips.test.ts` renders every type and compares.
 */
import type { BoundsRect } from '../api/geometry.js';

interface Pt {
  x: number;
  y: number;
}

/** A chip: how far off the wire its centre sits, and its size. */
interface Chip {
  perp: number;
  w: number;
  h: number;
}

const CHIPS: Readonly<Record<string, Chip>> = {
  tunnel: { perp: 16, w: 122, h: 20 },
  wireguard: { perp: 14, w: 94, h: 18 },
  flow: { perp: 14, w: 110, h: 20 },
  wifi: { perp: 28, w: 110, h: 20 },
  poe: { perp: 20, w: 90, h: 18 },
  optical: { perp: 22, w: 90, h: 18 },
};

/** The packet chip: wider, taller with a sublabel, and not centred on its anchor. */
const PACKET = { perp: 20, w: 138, h: 22, hSub: 32, top: 13, topSub: 19 };

export interface ChipLink {
  type: string;
  label?: string;
  sublabel?: string;
  waypoints?: readonly unknown[];
  labelOffset?: { x?: number; y?: number };
  labelScale?: number;
  /** `flow` links only: pins the label to a page point. */
  labelPos?: { x?: number; y?: number };
}

/** The engine's clamp on a label's scale. */
function scaleOf(link: ChipLink): number {
  const s = link.labelScale;
  return typeof s === 'number' && Number.isFinite(s)
    ? Math.min(4, Math.max(0.25, s))
    : 1;
}

/** `r` scaled by `s` about (cx, cy), as `_scaleLabel` does. */
function scaled(r: BoundsRect, cx: number, cy: number, s: number): BoundsRect {
  return s === 1
    ? r
    : {
        x: cx + (r.x - cx) * s,
        y: cy + (r.y - cy) * s,
        w: r.w * s,
        h: r.h * s,
      };
}

/**
 * The centre-label chip of a non-`line` link, as drawn, given the link's
 * drawn endpoints:
 * - a rect: the fixed chip;
 * - `null`: this link type draws no centre label (`blocked` shows a reason);
 * - `undefined`: not a chip type — the caller uses the `line` pill model.
 */
export function linkChipRect(
  link: ChipLink,
  from: Pt,
  to: Pt,
): BoundsRect | null | undefined {
  if (link.type === 'blocked') return null;
  const ox = link.labelOffset?.x || 0;
  const oy = link.labelOffset?.y || 0;
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const s = scaleOf(link);
  /** A chip's centre: `perp` px off the wire, on the engine's side. */
  const beside = (perp: number): Pt => ({
    x: mx + Math.sin(a) * perp + ox,
    y: my - Math.cos(a) * perp + oy,
  });

  if (link.type === 'packet') {
    const c = beside(PACKET.perp);
    const sub = Boolean(link.sublabel);
    return scaled(
      {
        x: c.x - PACKET.w / 2,
        y: c.y - (sub ? PACKET.topSub : PACKET.top),
        w: PACKET.w,
        h: sub ? PACKET.hSub : PACKET.h,
      },
      c.x,
      c.y,
      s,
    );
  }

  let chip = CHIPS[link.type];
  if (!chip) return undefined;
  let c = beside(chip.perp);
  if (link.type === 'wireguard' && link.waypoints?.length) {
    // A bent WireGuard link is drawn by the flow renderer: its chip, ON the
    // chord midpoint.
    chip = CHIPS.flow!;
    c = { x: mx + ox, y: my + oy };
  } else if (link.type === 'flow') {
    const px = link.labelPos?.x;
    const py = link.labelPos?.y;
    c = {
      x: typeof px === 'number' && Number.isFinite(px) ? px + ox : c.x,
      y: typeof py === 'number' && Number.isFinite(py) ? py + oy : c.y,
    };
  }
  return scaled(
    { x: c.x - chip.w / 2, y: c.y - chip.h / 2, w: chip.w, h: chip.h },
    c.x,
    c.y,
    s,
  );
}
