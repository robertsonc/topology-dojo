/**
 * Port pills (proposal 0008, W4) + bundle outlines (W3).
 *
 * In pill mode an endpoint (port) label is drawn ON the node's edge where
 * the link attaches — a dark pill, rotated to the side's normal (vertical
 * text on north/south edges, horizontal on east/west), extending OUTWARD
 * from the attach point so the wire appears to leave the pill's far end
 * (the pill is opaque and sits over the wire's first few px). Pills take
 * the attachment point the engine draws — mirrored by render/link-attach —
 * so under `linkAttach.distribute` they sit in the node's even slots and
 * never overlap. Members of one (node, bundle) group get an outline around
 * the union of their pills: solid for a LAG, dashed for ECMP.
 *
 * Drawn as a document overlay (render/overlays) in page coordinates, above
 * the wires; the engine's own glass chips are suppressed for ends in pill
 * mode (render/core + the browser facade). Pure and DOM-free; the layout
 * analyzer and the inspector read the same rects.
 */
import { endPortLabel } from '../api/hardware.js';
import type { Page, TopologyDocument } from '../pages/model.js';
import type { CustomNodeSpec } from '../nodes/spec.js';
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';
import type { BoundsRect } from '../api/geometry.js';
import {
  anchorBox,
  createAttachContext,
  effectiveLinkAttach,
  engineAABB,
  engineHitBoxes,
  type Side,
} from './link-attach.js';
import { bundleKind, endBundle, type BundleKind } from '../api/bundles.js';

export type PortLabelMode = 'chip' | 'pill';
export const PORT_LABEL_MODES: readonly PortLabelMode[] = ['chip', 'pill'];

/** Pill metrics: a 7px label on a 12px-wide bar, padded 4px along its length. */
export const PORT_PILL = {
  fontSize: 7,
  charW: 4.4,
  /** Across the pill (perpendicular to the text). */
  width: 12,
  /** Padding at each end along the text. */
  padAlong: 4,
  minLength: 18,
  /** Clear space the analyzer wants between neighbouring pills. */
  gap: 2,
  /** Outline inset outside the union of a bundle's pills. */
  bundleInset: 2.5,
} as const;

export interface PortPill {
  linkId: string;
  end: 'from' | 'to';
  nodeId: string;
  label: string;
  side: Side;
  /** The pill rectangle, page coordinates. */
  rect: BoundsRect;
  /** The attach point the pill grows outward from. */
  at: { x: number; y: number };
  bundle?: string;
}

export interface BundleOutline {
  nodeId: string;
  bundle: string;
  kind: BundleKind;
  rect: BoundsRect;
  /** The pill width on this node's side (sets the outline's corner radius). */
  across: number;
}

/** The port-label mode for a node: its own setting over the page's (default chip). */
export function portLabelMode(page: Page, node: NodeConfig): PortLabelMode {
  const own = node.portLabels;
  if (own === 'chip' || own === 'pill') return own;
  const pg = (page as { portLabels?: unknown }).portLabels;
  return pg === 'pill' ? 'pill' : 'chip';
}

/** Whether any end on the page draws a pill (cheap guard for the overlay). */
export function pageHasPills(page: Page): boolean {
  if ((page as { portLabels?: unknown }).portLabels === 'pill') return true;
  return page.nodes.some((n) => n.portLabels === 'pill');
}

/** The pill's length along its text for a label. */
export function pillLength(label: string): number {
  return Math.max(
    PORT_PILL.minLength,
    Math.ceil(label.length * PORT_PILL.charW) + PORT_PILL.padAlong * 2,
  );
}

/** The side of a node's attach box the point lies on (nearest edge). */
function sideOf(box: BoundsRect, p: { x: number; y: number }): Side {
  const dists: [Side, number][] = [
    ['n', Math.abs(p.y - box.y)],
    ['s', Math.abs(p.y - (box.y + box.h))],
    ['w', Math.abs(p.x - box.x)],
    ['e', Math.abs(p.x - (box.x + box.w))],
  ];
  dists.sort((a, b) => a[1] - b[1]);
  return dists[0]![0];
}

/** The pill rect for a label growing outward from `at` on `side`. */
export function pillRect(
  at: { x: number; y: number },
  side: Side,
  label: string,
): BoundsRect {
  const len = pillLength(label);
  const w = PORT_PILL.width;
  switch (side) {
    case 'n':
      return { x: at.x - w / 2, y: at.y - len, w, h: len };
    case 's':
      return { x: at.x - w / 2, y: at.y, w, h: len };
    case 'w':
      return { x: at.x - len, y: at.y - w / 2, w: len, h: w };
    default:
      return { x: at.x, y: at.y - w / 2, w: len, h: w };
  }
}

/** Every port pill on a page (ends in pill mode with a label), in link order. */
export function portPills(
  page: Page,
  customNodes?: CustomNodeSpec[],
): PortPill[] {
  if (!pageHasPills(page)) return [];
  const hitBoxes = engineHitBoxes(customNodes);
  const attach = createAttachContext(page, { hitBoxes });
  const nodes = new Map(page.nodes.map((n) => [n.id, n]));
  const boxOf = (n: NodeConfig): BoundsRect => {
    const opt = effectiveLinkAttach(page.linkAttach, n);
    return opt ? anchorBox(n, opt.pad, hitBoxes) : engineAABB(n, hitBoxes);
  };
  const out: PortPill[] = [];
  for (const l of page.links) {
    let ends: {
      from: { x: number; y: number };
      to: { x: number; y: number };
    } | null = null;
    for (const end of ['from', 'to'] as const) {
      const label = endPortLabel(l, end);
      if (!label) continue;
      const node = nodes.get(l[end]);
      if (!node || portLabelMode(page, node) !== 'pill') continue;
      ends ??= attach.endpoints(l);
      if (!ends) break;
      const at = ends[end];
      const side = sideOf(boxOf(node), at);
      const bundle = endBundle(l, end);
      out.push({
        linkId: l.id,
        end,
        nodeId: node.id,
        label,
        side,
        rect: pillRect(at, side, label),
        at,
        ...(bundle ? { bundle } : {}),
      });
    }
  }
  return out;
}

/** Per-side pill band depth (px past the engine's hit box) per node. */
export interface PillBand {
  n: number;
  s: number;
  e: number;
  w: number;
}

/**
 * How far the pills (and bundle outlines) reach past each node's hit AABB
 * on each side — what the engine's `_zoneBox` grows a member by (passed as
 * the node's transient `pillBand`) and what the TypeScript zone-box mirror
 * adds, so a tier band's caption clears the pills.
 */
export function pillBands(
  page: Page,
  customNodes?: CustomNodeSpec[],
): Map<string, PillBand> {
  const out = new Map<string, PillBand>();
  const hitBoxes = engineHitBoxes(customNodes);
  const nodes = new Map(page.nodes.map((n) => [n.id, n]));
  for (const p of portPills(page, customNodes)) {
    const n = nodes.get(p.nodeId);
    if (!n) continue;
    const ab = engineAABB(n, hitBoxes);
    const band = out.get(p.nodeId) ?? { n: 0, s: 0, e: 0, w: 0 };
    const i = PORT_PILL.bundleInset;
    const r = p.rect;
    band.n = Math.max(band.n, ab.y - r.y + i);
    band.s = Math.max(band.s, r.y + r.h - (ab.y + ab.h) + i);
    band.w = Math.max(band.w, ab.x - r.x + i);
    band.e = Math.max(band.e, r.x + r.w - (ab.x + ab.w) + i);
    out.set(p.nodeId, band);
  }
  for (const b of out.values())
    for (const k of ['n', 's', 'e', 'w'] as const) b[k] = Math.max(0, b[k]);
  return out;
}

/** The outline around each (node, bundle) group of two or more pills. */
export function bundleOutlines(
  pills: readonly PortPill[],
  bundles: TopologyDocument['bundles'],
): BundleOutline[] {
  const groups = new Map<string, PortPill[]>();
  for (const p of pills) {
    if (!p.bundle) continue;
    const key = `${p.nodeId}\u0000${p.bundle}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }
  const out: BundleOutline[] = [];
  for (const [, members] of groups) {
    // A single-member group (one leg of an ESI-LAG on this switch) carries
    // its LAG in the port table; a ring around one pill is only noise.
    if (members.length < 2) continue;
    const first = members[0]!;
    const kind = bundleKind(bundles, first.bundle!);
    if (kind === 'icl') continue;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const m of members) {
      x0 = Math.min(x0, m.rect.x);
      y0 = Math.min(y0, m.rect.y);
      x1 = Math.max(x1, m.rect.x + m.rect.w);
      y1 = Math.max(y1, m.rect.y + m.rect.h);
    }
    const i = PORT_PILL.bundleInset;
    out.push({
      nodeId: first.nodeId,
      bundle: first.bundle!,
      kind,
      rect: { x: x0 - i, y: y0 - i, w: x1 - x0 + 2 * i, h: y1 - y0 + 2 * i },
      across: PORT_PILL.width,
    });
  }
  return out;
}

function escXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

/** Pill ink / paper: the engine's light text grey and dark panel colour, so the
 * light theme flips them (dark pill, white text) with the rest of the art. */
const PILL_FILL = '#e6e8e9';
const PILL_TEXT = '#141820';
const OUTLINE = '#7d8a92';

/** The pills + bundle outlines overlay `<g>` for a page, or '' when none. */
export function portPillsSVG(doc: TopologyDocument, page: Page): string {
  const pills = portPills(page, doc.customNodes);
  if (!pills.length) return '';
  let s = `<g class="tds-port-pills" font-family="ui-monospace,monospace">`;
  for (const o of bundleOutlines(pills, doc.bundles)) {
    const r = o.rect;
    const rx = o.across / 2 + PORT_PILL.bundleInset;
    s +=
      `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${rx}" fill="none" ` +
      `stroke="${OUTLINE}" stroke-width="1"${o.kind === 'ecmp' ? ' stroke-dasharray="3 2"' : ''} ` +
      `data-bundle="${escXml(o.bundle)}" data-node-id="${escXml(o.nodeId)}"/>`;
  }
  for (const p of pills) {
    const r = p.rect;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const vertical = p.side === 'n' || p.side === 's';
    const tf = vertical ? ` transform="rotate(-90 ${cx} ${cy})"` : '';
    s +=
      `<g data-link-id="${escXml(p.linkId)}" data-end="${p.end}">` +
      `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${PORT_PILL.width / 2}" fill="${PILL_FILL}"/>` +
      `<text x="${cx}" y="${cy + PORT_PILL.fontSize * 0.36}" text-anchor="middle" font-size="${PORT_PILL.fontSize}" ` +
      `font-weight="600" fill="${PILL_TEXT}"${tf}>${escXml(p.label)}</text></g>`;
  }
  return s + `</g>`;
}

/**
 * The link config handed to the engine: endpoint labels on ends in pill
 * mode are dropped (the overlay draws them), everything else untouched.
 * Returns the same object when nothing changes.
 */
export function stripPillLabels<T extends LinkConfig>(
  page: Page,
  link: T,
  nodes: ReadonlyMap<string, NodeConfig>,
): T {
  if (!pageHasPills(page)) return link;
  let out: T | null = null;
  for (const end of ['from', 'to'] as const) {
    const key = end === 'from' ? 'fromLabel' : 'toLabel';
    if (!link[key]) continue;
    const n = nodes.get(link[end]);
    if (!n || portLabelMode(page, n) !== 'pill') continue;
    out ??= { ...link };
    delete (out as Record<string, unknown>)[key];
  }
  return out ?? link;
}
