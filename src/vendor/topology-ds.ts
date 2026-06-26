/**
 * Typed facade over the vendored legacy rendering engine (`public/vendor/
 * topology-ds.js`, loaded as a classic script that sets `window.TopologyDesigner`).
 *
 * We reuse the legacy engine purely as a RENDERER. A "page" is rendered by
 * building a throwaway TopologyDesigner from the page's elements plus a single
 * step that shows everything, then asking the engine for its SVG. None of the
 * choreography (Acts/Steps/Phases) is exposed upward — pages replace it.
 *
 * The seam (validated against the engine): wrap output in
 *   `.tds-root > .tds-canvas > svg[viewBox]`
 * set `step` to the last (1-based) index so every element's show-phase is
 * satisfied, then read `_renderSVG()`.
 */

/** A node on a page — the legacy node config shape (permissive by design). */
export interface NodeConfig {
  id: string;
  type: string;
  x: number;
  y: number;
  label?: string;
  sublabel?: string;
  color?: string;
  /** Node opacity, 0–1 (defaults to 1). */
  opacity?: number;
  /** Colour of the node's label text. */
  labelColor?: string;
  /** Vertical distance of the label below the node centre (defaults to 24). */
  labelOffset?: number;
  /** When true, the editor won't move the node (drag/marquee/nudge skip it). */
  locked?: boolean;
  /**
   * Free-form key/value metadata for real-network attributes — serial numbers,
   * software versions, hostnames, site/cluster names, etc. Flat primitives only;
   * ignored by the renderer, carried in the document, editable via API/MCP/GUI.
   */
  meta?: Record<string, string | number | boolean>;
  /** Id of a declared document layer (see api/layers); absent = base layer. */
  layer?: string;
  /** External identity in a source system (see api/source); enables upsert. */
  source?: SourceRef;
  [key: string]: unknown;
}

/** A link on a page — the legacy link config shape. */
export interface LinkConfig {
  id: string;
  type: string;
  from: string;
  to: string;
  color?: string;
  label?: string;
  /** Endpoint (interface/port) labels near the link's source and destination. */
  fromLabel?: string;
  toLabel?: string;
  /**
   * Moveable label offsets, doc-space {x,y}, set by dragging the chip in the
   * editor. `labelOffset` shifts the centre label (honoured by every link type);
   * `from`/`toLabelOffset` shift the endpoint (port) labels. All optional and
   * backward-compatible (absent = the default auto-placement).
   */
  labelOffset?: { x: number; y: number };
  fromLabelOffset?: { x: number; y: number };
  toLabelOffset?: { x: number; y: number };
  waypoints?: { x: number; y: number }[];
  lineStyle?: 'orthogonal' | 'curved';
  /**
   * A.5 connection ports — pin an endpoint to a node side/corner. Absent = the
   * A.4 auto-boundary (attach to the perimeter facing the other end).
   */
  fromPort?: 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
  toPort?: 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
  /**
   * B.2 first-class link metadata — renderable on the wire when `showMeta` is
   * set. Endpoint interface names reuse `fromLabel`/`toLabel`. All optional and
   * machine-populatable (north-star data feed).
   */
  vlan?: string | number;
  subnet?: string;
  bandwidth?: string;
  transport?: string;
  showMeta?: boolean;
  /** When true, the editor won't move/edit the link via direct manipulation. */
  locked?: boolean;
  /** Per-link animated-flow controls (tunnel / wireguard / flow types). */
  flowSpeed?: number;
  flowParticles?: number;
  reverseFlow?: boolean;
  /** Id of a declared document layer (see api/layers); absent = base layer. */
  layer?: string;
  /** External identity in a source system (see api/source); enables upsert. */
  source?: SourceRef;
  [key: string]: unknown;
}

/** A free-floating position marker usable as a link endpoint. */
export interface AnchorConfig {
  id: string;
  x: number;
  y: number;
}

/**
 * A zone — a labeled region that visually groups member nodes. The engine
 * auto-sizes a dashed/solid border around the members (+ padding); there is no
 * explicit rectangle to draw, so a zone is defined purely by its membership.
 */
export interface ZoneConfig {
  id: string;
  /** Ids of member nodes the region encompasses. */
  nodes: string[];
  label?: string;
  sublabel?: string;
  description?: string;
  color?: string;
  borderStyle?: 'dashed' | 'solid' | 'dotted';
  padding?: number;
  labelAlign?: 'left' | 'center' | 'right';
  /** Id of an enclosing zone (zones may nest). */
  parentZone?: string;
  /** Id of a declared document layer (see api/layers); absent = base layer. */
  layer?: string;
  /** External identity in a source system (see api/source); enables upsert. */
  source?: SourceRef;
}

/**
 * Per-hop annotation paired with a flow path's waypoint sequence — which
 * link/tunnel a segment rode and its measurements. Machine-authored (by the
 * flow compiler); ignored by the renderer, carried in the document.
 */
export interface FlowHop {
  /** The waypoint id (node/anchor) this hop arrives at. */
  ref: string;
  /** Id of the page link (e.g. the tunnel) the segment traversed. */
  linkId?: string;
  /** Layer the segment belongs to (underlay/overlay plane). */
  layer?: string;
  /** Flat measurements/facts: tunnel id, latency ms, bytes, overlay name… */
  meta?: Record<string, string | number | boolean>;
}

/**
 * A flow path — an animated overlay route that threads through an ordered list
 * of node/anchor ids, drawn on top of the topology (particles / dashes / pulse).
 */
export interface FlowPathConfig {
  id: string;
  /** Ordered node/anchor ids the path passes through (≥2). */
  waypoints: string[];
  label?: string;
  name?: string;
  color?: string;
  animation?: 'particles' | 'dashed' | 'pulse';
  speed?: 'slow' | 'medium' | 'fast' | number;
  direction?: 'forward' | 'reverse' | 'bidirectional';
  width?: number;
  opacity?: number;
  /** Per-hop annotations (one per segment arrival, machine-authored). */
  hops?: FlowHop[];
  /** Id of a declared document layer (see api/layers); absent = base layer. */
  layer?: string;
  /** External identity in a source system (see api/source); enables upsert. */
  source?: SourceRef;
}

/**
 * Marker types a policy marker can represent — enforcement actions plus host-OS
 * and SSE posture. The canonical list + default glyphs live in `api/markers`.
 */
export type { PolicyMarkerType } from '../api/markers.js';
import { withMarkerIcon, type PolicyMarkerType } from '../api/markers.js';
import { layerView, type LayerDef } from '../api/layers.js';
import type { SourceRef } from '../api/source.js';

/** A policy marker — an enforcement / posture badge pinned to a node. */
export interface PolicyMarkerConfig {
  id: string;
  /** Id of the node the badge attaches to. */
  nodeId: string;
  type: PolicyMarkerType;
  label?: string;
  color?: string;
  /** Glyph override; defaults to the type's glyph (see api/markers). */
  icon?: string;
  /** Placement relative to the node centre. */
  align?: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'C';
  /** Optional association with a flow path. */
  flowPathId?: string;
  /** Id of a declared document layer (see api/layers); absent = base layer. */
  layer?: string;
  /** External identity in a source system (see api/source); enables upsert. */
  source?: SourceRef;
}

/** The minimal slice of the vendored engine instance we drive. */
interface EngineInstance {
  node(id: string, cfg: Record<string, unknown>): void;
  link(id: string, cfg: Record<string, unknown>): void;
  anchor(id: string, pos: { x: number; y: number }): void;
  zone(id: string, cfg: Record<string, unknown>): void;
  flowPath(id: string, cfg: Record<string, unknown>): void;
  policyMarker(id: string, cfg: Record<string, unknown>): void;
  act(id: string, cfg: Record<string, unknown>): void;
  addStep(id: string, cfg: Record<string, unknown>): void;
  _buildIndex(): void;
  _renderSVG(): string;
  _svgDefs(): string;
  _steps: unknown[];
  step: number;
  /** When true, the engine omits animations (particles, pulses, glints). */
  reducedMotion: boolean;
}

/** Render options shared by the page renderers. */
export interface RenderOptions {
  /** Calm canvas: suppress motion (animated flow particles, link dots, glints). */
  calm?: boolean;
  /** Declared document layers (bottom → top) — drives stacking order. */
  layers?: LayerDef[];
  /** Only draw these layer ids (untagged base elements always draw). */
  visibleLayers?: string[];
  /** Per-frame emphasis (2.2): node/link ids to spotlight; others dim to 25%. */
  emphasis?: string[];
}

/** Plugin shape accepted by the engine's static registerNodeType. */
export interface NodePlugin {
  render: (x: number, y: number, cfg: { color?: string }) => string;
  defaults?: Record<string, unknown>;
  hitBox?: { rx: number; ry: number };
  haloColor?: string;
}

interface EngineStatic {
  new (cfg: Record<string, unknown>): EngineInstance;
  NODE_TYPES: Record<string, (x: number, y: number, cfg: unknown) => string>;
  registerNodeType(name: string, plugin: NodePlugin): void;
}

declare global {
  interface Window {
    TopologyDesigner?: EngineStatic;
    TopologyGraph?: unknown;
  }
}

function engine(): EngineStatic {
  const e = window.TopologyDesigner;
  if (!e) {
    throw new Error(
      'TopologyDesigner not loaded — ensure public/vendor/topology-ds.js is included before the app script.',
    );
  }
  return e;
}

/** The set of node types the vendored engine knows how to draw. */
export function nodeTypes(): string[] {
  return Object.keys(engine().NODE_TYPES);
}

/** The engine's shared SVG `<defs>` (glow/bloom/gradient filters) — for previews. */
export function engineDefs(): string {
  return new (engine())({})._svgDefs();
}

/** A renderable page: a complete, standalone topology frame. */
export interface RenderablePage {
  viewBox: string;
  nodes: NodeConfig[];
  links: LinkConfig[];
  anchors?: AnchorConfig[];
  /** Region groupings drawn behind the nodes. */
  zones?: ZoneConfig[];
  /** Animated overlay routes drawn on top of the topology. */
  flowPaths?: FlowPathConfig[];
  /** Enforcement badges pinned to nodes. */
  policyMarkers?: PolicyMarkerConfig[];
}

/**
 * Render a page to an SVG inner-markup string (defs + ambient + elements),
 * meant to be injected into an `<svg viewBox=…>` inside a `.tds-canvas`.
 */
export function renderPageSVG(
  page: RenderablePage,
  opts: RenderOptions = {},
): string {
  const Engine = engine();
  const topo = new Engine({ viewBox: page.viewBox });
  if (opts.calm) topo.reducedMotion = true;

  // The layer view: hidden layers dropped, the rest stacked bottom → top
  // (insertion order is the engine's paint order within each collection).
  const layers = opts.layers ?? [];
  const nodes = layerView(page.nodes, layers, opts.visibleLayers);
  const links = layerView(page.links, layers, opts.visibleLayers);
  const zones = layerView(page.zones ?? [], layers, opts.visibleLayers);
  const flows = layerView(page.flowPaths ?? [], layers, opts.visibleLayers);
  const markers = layerView(
    page.policyMarkers ?? [],
    layers,
    opts.visibleLayers,
  );

  // Per-layer opacity (B.3): fade every element on a dimmed layer by folding the
  // layer's opacity into each member's own opacity (1 = no change).
  const layerOpacity = new Map<string, number>();
  for (const ly of layers)
    if (typeof ly.opacity === 'number' && ly.opacity < 1)
      layerOpacity.set(ly.id, Math.max(0, ly.opacity));
  const faded = <T extends { layer?: string; opacity?: number }>(cfg: T): T => {
    const lo = cfg.layer ? layerOpacity.get(cfg.layer) : undefined;
    if (lo === undefined) return cfg;
    return { ...cfg, opacity: (cfg.opacity ?? 1) * lo };
  };
  // Per-frame emphasis (2.2): when a non-empty set is given, dim every node/link
  // that isn't in it to 25%. Combines with layer opacity above.
  const emphasis =
    opts.emphasis && opts.emphasis.length ? new Set(opts.emphasis) : null;
  const fadedEmph = <T extends { layer?: string; opacity?: number }>(
    id: string,
    cfg: T,
  ): T => {
    let m = cfg.layer ? (layerOpacity.get(cfg.layer) ?? 1) : 1;
    if (emphasis && !emphasis.has(id)) m *= 0.25;
    return m === 1 ? cfg : { ...cfg, opacity: (cfg.opacity ?? 1) * m };
  };

  for (const a of page.anchors ?? []) topo.anchor(a.id, { x: a.x, y: a.y });
  for (const n of nodes) {
    const { id, ...cfg } = n;
    topo.node(id, fadedEmph(id, cfg));
  }
  for (const l of links) {
    const { id, ...cfg } = l;
    topo.link(id, fadedEmph(id, cfg));
  }
  for (const z of zones) {
    const { id, ...cfg } = z;
    topo.zone(id, faded(cfg));
  }
  for (const f of flows) {
    const { id, ...cfg } = f;
    topo.flowPath(id, faded(cfg));
  }
  for (const m of markers) {
    const { id, ...cfg } = m;
    topo.policyMarker(id, withMarkerIcon(cfg));
  }

  // One step that shows every element at once — a static frame, no choreography.
  const ids = [...nodes.map((n) => n.id), ...links.map((l) => l.id)];
  topo.act('all', { label: 'All' });
  topo.addStep('all', {
    act: 'all',
    name: 'All',
    focus: [],
    phases: [{ show: ids, diff: '' }],
  });
  // A trailing empty step we sit ON, so the all-showing step is in the PAST.
  // The engine then renders every element fully with no entrance animation
  // (anim only plays for the *current* step) — a static frame that won't replay
  // fades/draw-ins on each re-render. Important for smooth editing.
  topo.addStep('end', {
    act: 'all',
    name: 'end',
    focus: [],
    phases: [{ show: [], diff: '' }],
  });
  topo._buildIndex();
  topo.step = topo._steps.length; // sit on the trailing step (within range)

  return topo._renderSVG();
}

/** Render a page directly into a host `<svg>` element, syncing its viewBox. */
export function renderPageInto(
  svg: SVGSVGElement,
  page: RenderablePage,
  opts: RenderOptions = {},
): void {
  svg.setAttribute('viewBox', page.viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = renderPageSVG(page, opts);
}
