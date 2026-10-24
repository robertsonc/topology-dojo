/**
 * Export scene — the one format-neutral, page-local geometry model the
 * editable office exports (draw.io, Visio .vsdx, PowerPoint .pptx) are built
 * from, so the three never disagree about where a node sits, which zone holds
 * it, which layer it is on, or which way a wire runs.
 *
 * The scene is deliberately lossy and documented as such (docs/EXPORTS.md):
 * it keeps what an editable diagram in another tool can carry — boxes, labels,
 * colours, dashes, containers, layers, connectors with their waypoints and
 * port labels — and drops the Topology Dojo-only vocabulary (flow-path
 * animation, policy-marker glyphs, port pills, port tables, glow, the sheet
 * frame and the auto-legend). The SVG / PNG / PDF exports stay the
 * pixel-faithful path.
 *
 * DOM-free and pure: shared by the browser, the stdio MCP server and the
 * Worker.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import type {
  LinkConfig,
  NodeConfig,
  ZoneConfig,
} from '../vendor/topology-ds.js';
import { drawsOwnLabel, nodeHalf } from '../api/geometry.js';
import { layerVisible, type LayerDef } from '../api/layers.js';
import { findLinkStyle, resolveLinkStyle } from '../api/link-styles.js';
import { getNodeType } from '../api/catalog.js';
import { zoneBox } from '../render/zone-box.js';
import {
  engineAABB,
  engineHitBoxes,
  type HitBoxes,
} from '../render/link-attach.js';

/** A generic, editable outline every target format can draw natively. */
export type SceneShape =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'hexagon'
  | 'pentagon'
  | 'star'
  | 'cross'
  | 'arrow'
  | 'cloud'
  | 'cylinder'
  | 'text'
  | 'image';

export type SceneDash = 'solid' | 'dashed' | 'dotted';

/** A declared layer, plus the implicit base layer (id `''`) at index 0. */
export interface SceneLayer {
  id: string;
  name: string;
  /** Visible when the file opens (the layer's `defaultVisible`). */
  visible: boolean;
}

export interface SceneNode {
  id: string;
  /** The Topology Dojo node type (kept for format-specific stencils). */
  type: string;
  /** Catalog category (Network / Cloud / Compute / …), '' if unknown. */
  category: string;
  shape: SceneShape;
  /** Top-left box, page-local px. */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sublabel: string;
  /** Long-form text (text / callout nodes). */
  body: string;
  /** True when the label belongs inside the box (shapes, text, clouds). */
  labelInside: boolean;
  /** Outline / accent colour (#rrggbb). */
  stroke: string;
  /** Pale fill derived from the accent (#rrggbb). */
  fill: string;
  /** Layer id ('' = base). */
  layer: string;
  /** Innermost zone that lists this node, if any. */
  zone?: string;
  /** https / data:image URI for `image` nodes. */
  imageHref?: string;
  href?: string;
  tooltip?: string;
  meta?: Record<string, string | number | boolean>;
}

export interface SceneZone {
  id: string;
  label: string;
  sublabel: string;
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  fill: string;
  dash: SceneDash;
  labelPosition: 'top' | 'bottom';
  layer: string;
  /** Enclosing zone (nested containers). */
  parent?: string;
}

export interface ScenePoint {
  x: number;
  y: number;
}

export interface SceneLink {
  id: string;
  type: string;
  from: string;
  to: string;
  /** True when `from` / `to` name a node (false = an anchor, a free point). */
  fromIsNode: boolean;
  toIsNode: boolean;
  /**
   * The drawn polyline, page-local: the endpoint on the source box edge, any
   * waypoints (or a computed elbow for orthogonal links), the endpoint on
   * the target box edge. Always ≥ 2 points.
   */
  points: ScenePoint[];
  /** Interior waypoints only (what tools with their own router keep). */
  waypoints: ScenePoint[];
  routing: 'straight' | 'orthogonal' | 'curved';
  label: string;
  fromLabel: string;
  toLabel: string;
  color: string;
  width: number;
  dash: SceneDash;
  layer: string;
  /** Declared link-style id (wire class), when used. */
  style?: string;
}

export interface ScenePage {
  id: string;
  name: string;
  width: number;
  height: number;
  caption: string;
  layers: SceneLayer[];
  zones: SceneZone[];
  nodes: SceneNode[];
  links: SceneLink[];
  /** Topology Dojo elements this page carries that the scene drops. */
  dropped: { flowPaths: number; policyMarkers: number };
}

export interface SceneDocument {
  title: string;
  pages: ScenePage[];
}

export interface SceneOptions {
  /**
   * Restrict to these declared layer ids (base elements always kept). Omit
   * to keep every layer — office formats carry layers natively, so hiding
   * belongs to the viewer, not the export.
   */
  visibleLayers?: string[];
}

const NEUTRAL = '#5b6770';
const MIN_W = 40;
const MIN_H = 30;

/** Normalise a CSS colour to #rrggbb, or the fallback. */
export function hexColor(c: unknown, fallback = NEUTRAL): string {
  if (typeof c !== 'string') return fallback;
  const s = c.trim();
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m3)
    return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(s)) return s.slice(0, 7).toLowerCase();
  return fallback;
}

/** Mix a colour toward white (`t` = share of white, 0–1). */
export function tint(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): string =>
    Math.round(v + (255 - v) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** Darken a colour toward black (`t` = share of black, 0–1). */
export function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): string =>
    Math.round(v * (1 - t))
      .toString(16)
      .padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** The generic outline for a node type. */
export function sceneShapeFor(type: string): SceneShape {
  switch (type) {
    case 'text':
      return 'text';
    case 'image':
      return 'image';
    case 'shape:square':
    case 'shape:rectangle':
      return 'rect';
    case 'shape:circle':
    case 'shape:ellipse':
      return 'ellipse';
    case 'shape:diamond':
      return 'diamond';
    case 'shape:triangle':
      return 'triangle';
    case 'shape:hexagon':
      return 'hexagon';
    case 'shape:pentagon':
      return 'pentagon';
    case 'shape:star':
      return 'star';
    case 'shape:cross':
      return 'cross';
    case 'shape:arrow':
      return 'arrow';
    case 'cloud':
    case 'saas':
    case 'overlayCloud':
      return 'cloud';
    case 'database':
    case 'nas':
      return 'cylinder';
    case 'router':
    case 'host':
    case 'usergroup':
      return 'ellipse';
    case 'ids':
    case 'vpnconc':
      return 'hexagon';
    default:
      return 'roundRect';
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function dashOf(link: LinkConfig, styleDash: string | undefined): SceneDash {
  if (styleDash === 'dotted') return 'dotted';
  if (styleDash === 'dashed') return 'dashed';
  if (
    link.dashed === true ||
    link.type === 'tunnel' ||
    link.type === 'wireguard' ||
    link.type === 'wifi'
  )
    return 'dashed';
  if (link.type === 'blocked') return 'dotted';
  return 'solid';
}

/** Where the ray from a box centre toward `toward` leaves the box. */
export function clipToBox(
  box: { x: number; y: number; w: number; h: number },
  shape: SceneShape,
  toward: ScenePoint,
): ScenePoint {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = box.w / 2;
  const hh = box.h / 2;
  let t: number;
  if (shape === 'ellipse' || shape === 'cloud') {
    t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  } else if (shape === 'diamond') {
    t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  } else {
    t = Math.min(
      dx === 0 ? Infinity : hw / Math.abs(dx),
      dy === 0 ? Infinity : hh / Math.abs(dy),
    );
  }
  t = Math.min(t, 1);
  return { x: round1(cx + dx * t), y: round1(cy + dy * t) };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Index of each zone's innermost direct membership, per node. */
function innermostZones(zones: ZoneConfig[]): Map<string, string> {
  const depth = new Map<string, number>();
  const byId = new Map(zones.map((z) => [z.id, z]));
  const depthOf = (z: ZoneConfig, guard = 0): number => {
    if (depth.has(z.id)) return depth.get(z.id)!;
    const parent = z.parentZone ? byId.get(z.parentZone) : undefined;
    const d = parent && guard < 32 ? depthOf(parent, guard + 1) + 1 : 0;
    depth.set(z.id, d);
    return d;
  };
  const out = new Map<string, string>();
  for (const z of zones) {
    for (const id of z.nodes ?? []) {
      const prev = out.get(id);
      if (!prev || depthOf(z) > depthOf(byId.get(prev)!)) out.set(id, z.id);
    }
  }
  return out;
}

function sceneNode(
  n: NodeConfig,
  ox: number,
  oy: number,
  zone: string | undefined,
  hitBoxes: HitBoxes,
): SceneNode {
  // The engine's hit box is the drawn device footprint (wide for chassis);
  // text / callout / image / basic shapes size from their own metrics.
  const own = nodeHalf(n);
  const sized =
    n.type === 'text' ||
    n.type === 'callout' ||
    n.type === 'image' ||
    n.type.startsWith('shape:');
  const hit = sized ? null : engineAABB(n, hitBoxes);
  const half = hit
    ? { w: Math.max(own.w, hit.w / 2), h: Math.max(own.h, hit.h / 2) }
    : own;
  const shape = sceneShapeFor(n.type);
  const w = Math.max(MIN_W, Math.round(half.w * 2));
  const h = Math.max(MIN_H, Math.round(half.h * 2));
  const stroke = hexColor(n.color, NEUTRAL);
  const info = getNodeType(n.type);
  const out: SceneNode = {
    id: n.id,
    type: n.type,
    category: info?.category ?? '',
    shape,
    x: round1(n.x - w / 2 - ox),
    y: round1(n.y - h / 2 - oy),
    w,
    h,
    label: str(n.label),
    sublabel: str(n.sublabel),
    body: str(n.body),
    labelInside: drawsOwnLabel(n),
    stroke,
    fill: shape === 'text' ? '#ffffff' : tint(stroke, 0.85),
    layer: str(n.layer),
  };
  if (zone) out.zone = zone;
  if (n.type === 'image') {
    const src = str(n.imageHref).trim();
    if (
      /^https:\/\//i.test(src) ||
      /^data:image\/(png|jpeg|gif|svg\+xml)[;,]/i.test(src)
    )
      out.imageHref = src;
  }
  if (typeof n.href === 'string' && /^https?:\/\//i.test(n.href))
    out.href = n.href;
  if (typeof n.tooltip === 'string' && n.tooltip) out.tooltip = n.tooltip;
  if (n.meta && Object.keys(n.meta).length) out.meta = { ...n.meta };
  return out;
}

/** An orthogonal elbow between two points (H-V-H or V-H-V by the long axis). */
function elbow(a: ScenePoint, b: ScenePoint): ScenePoint[] {
  if (a.x === b.x || a.y === b.y) return [];
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
    const mx = round1((a.x + b.x) / 2);
    return [
      { x: mx, y: a.y },
      { x: mx, y: b.y },
    ];
  }
  const my = round1((a.y + b.y) / 2);
  return [
    { x: a.x, y: my },
    { x: b.x, y: my },
  ];
}

function scenePage(
  doc: TopologyDocument,
  page: Page,
  opts: SceneOptions,
): ScenePage {
  const [vx = 0, vy = 0, vw = 1050, vh = 700] = page.viewBox
    .trim()
    .split(/\s+/)
    .map(Number);
  const layers: LayerDef[] = doc.layers ?? [];
  const keep = (layer: string | undefined): boolean =>
    !layer ||
    !opts.visibleLayers ||
    layerVisible(layers, layer, opts.visibleLayers);

  const sceneLayers: SceneLayer[] = [
    { id: '', name: 'Base', visible: true },
    ...layers
      .filter((l) => keep(l.id))
      .map((l) => ({
        id: l.id,
        name: l.name?.trim() || l.id,
        visible: l.defaultVisible !== false,
      })),
  ];
  const knownLayer = new Set(sceneLayers.map((l) => l.id));
  const layerOf = (l: unknown): string => {
    const id = str(l);
    return knownLayer.has(id) ? id : '';
  };

  // Registers the stock + custom hit boxes `zoneBox` reads, so zones are
  // framed exactly as the engine frames them — keep this before zoneBox.
  const hitBoxes = engineHitBoxes(doc.customNodes);
  const zones = (page.zones ?? []).filter((z) => keep(z.layer));
  const zoneIds = new Set(zones.map((z) => z.id));
  const sceneZones: SceneZone[] = [];
  for (const z of zones) {
    const b = zoneBox(page, z);
    if (!b) continue;
    const stroke = hexColor(z.color, '#7d8a92');
    const sz: SceneZone = {
      id: z.id,
      label: str(z.label ?? z.id),
      sublabel: str(z.sublabel),
      x: round1(b.x - vx),
      y: round1(b.y - vy),
      w: round1(b.w),
      h: round1(b.h),
      stroke,
      fill: tint(stroke, 0.93),
      dash:
        z.borderStyle === 'solid'
          ? 'solid'
          : z.borderStyle === 'dotted'
            ? 'dotted'
            : 'dashed',
      labelPosition: z.labelPosition === 'bottom' ? 'bottom' : 'top',
      layer: layerOf(z.layer),
    };
    if (z.parentZone && zoneIds.has(z.parentZone)) sz.parent = z.parentZone;
    sceneZones.push(sz);
  }
  // Parents before children, so formats that nest containers can emit in order.
  const drawnZones = new Set(sceneZones.map((z) => z.id));
  for (const z of sceneZones)
    if (z.parent && !drawnZones.has(z.parent)) delete z.parent;
  sceneZones.sort(
    (a, b) => zoneDepth(sceneZones, a) - zoneDepth(sceneZones, b),
  );

  const zoneFor = innermostZones(zones.filter((z) => drawnZones.has(z.id)));
  const nodes = page.nodes
    .filter((n) => keep(n.layer))
    .map((n) => {
      const sn = sceneNode(n, vx, vy, zoneFor.get(n.id), hitBoxes);
      sn.layer = layerOf(n.layer);
      return sn;
    });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const anchorById = new Map(
    (page.anchors ?? []).map((a) => [a.id, { x: a.x - vx, y: a.y - vy }]),
  );

  const links: SceneLink[] = [];
  for (const raw of page.links) {
    if (!keep(raw.layer)) continue;
    const l = resolveLinkStyle(raw, doc.linkStyles);
    const fromNode = nodeById.get(l.from);
    const toNode = nodeById.get(l.to);
    const fromPt = fromNode
      ? { x: fromNode.x + fromNode.w / 2, y: fromNode.y + fromNode.h / 2 }
      : anchorById.get(l.from);
    const toPt = toNode
      ? { x: toNode.x + toNode.w / 2, y: toNode.y + toNode.h / 2 }
      : anchorById.get(l.to);
    if (!fromPt || !toPt) continue; // dangling endpoint (hidden layer / bad id)
    const routing: SceneLink['routing'] =
      l.lineStyle === 'orthogonal'
        ? 'orthogonal'
        : l.lineStyle === 'curved'
          ? 'curved'
          : 'straight';
    const waypoints = (l.waypoints ?? []).map((w) => ({
      x: round1(w.x - vx),
      y: round1(w.y - vy),
    }));
    let interior = waypoints;
    if (!interior.length && routing === 'orthogonal')
      interior = elbow(fromPt, toPt);
    const first = interior[0] ?? toPt;
    const last = interior[interior.length - 1] ?? fromPt;
    const a = fromNode ? clipToBox(fromNode, fromNode.shape, first) : fromPt;
    const b = toNode ? clipToBox(toNode, toNode.shape, last) : toPt;
    const def = findLinkStyle(doc.linkStyles, raw.style);
    const sl: SceneLink = {
      id: l.id,
      type: l.type,
      from: l.from,
      to: l.to,
      fromIsNode: !!fromNode,
      toIsNode: !!toNode,
      points: [a, ...interior, b],
      waypoints,
      routing,
      label: str(l.label),
      fromLabel: str(l.fromLabel),
      toLabel: str(l.toLabel),
      color: hexColor(l.color, '#7d8a92'),
      width: Math.max(0.5, Math.min(12, Number(l.strokeWidth) || 2)),
      dash: dashOf(l, def?.dash),
      layer: layerOf(l.layer),
    };
    if (def) sl.style = def.id;
    links.push(sl);
  }

  return {
    id: page.id,
    name: page.name || page.id,
    width: Math.max(1, Math.round(vw)),
    height: Math.max(1, Math.round(vh)),
    caption: str(page.caption),
    layers: sceneLayers,
    zones: sceneZones,
    nodes,
    links,
    dropped: {
      flowPaths: (page.flowPaths ?? []).length,
      policyMarkers: (page.policyMarkers ?? []).length,
    },
  };
}

function zoneDepth(zones: SceneZone[], z: SceneZone): number {
  let d = 0;
  let cur: SceneZone | undefined = z;
  while (cur?.parent && d < 32) {
    const parent: string = cur.parent;
    cur = zones.find((x) => x.id === parent);
    d++;
  }
  return d;
}

/** Build the export scene for every page of a document. */
export function buildScene(
  doc: TopologyDocument,
  opts: SceneOptions = {},
): SceneDocument {
  return {
    title: doc.title || 'Topology',
    pages: doc.pages.map((p) => scenePage(doc, p, opts)),
  };
}

/** One-line fidelity note per page — what the editable formats dropped. */
export function droppedSummary(scene: SceneDocument): string[] {
  const out: string[] = [];
  for (const p of scene.pages) {
    const parts: string[] = [];
    if (p.dropped.flowPaths) parts.push(`${p.dropped.flowPaths} flow path(s)`);
    if (p.dropped.policyMarkers)
      parts.push(`${p.dropped.policyMarkers} policy marker(s)`);
    if (parts.length) out.push(`${p.name}: ${parts.join(', ')} not exported`);
  }
  return out;
}
