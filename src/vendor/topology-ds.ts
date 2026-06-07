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
  /** When true, the editor won't move the node (drag/marquee/nudge skip it). */
  locked?: boolean;
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
  waypoints?: { x: number; y: number }[];
  lineStyle?: 'orthogonal' | 'curved';
  /** When true, the editor won't move/edit the link via direct manipulation. */
  locked?: boolean;
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
}

/**
 * Marker types a policy marker can represent — enforcement actions plus host-OS
 * and SSE posture. The canonical list + default glyphs live in `api/markers`.
 */
export type { PolicyMarkerType } from '../api/markers.js';
import { withMarkerIcon, type PolicyMarkerType } from '../api/markers.js';

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

  for (const a of page.anchors ?? []) topo.anchor(a.id, { x: a.x, y: a.y });
  for (const n of page.nodes) {
    const { id, ...cfg } = n;
    topo.node(id, cfg);
  }
  for (const l of page.links) {
    const { id, ...cfg } = l;
    topo.link(id, cfg);
  }
  for (const z of page.zones ?? []) {
    const { id, ...cfg } = z;
    topo.zone(id, cfg);
  }
  for (const f of page.flowPaths ?? []) {
    const { id, ...cfg } = f;
    topo.flowPath(id, cfg);
  }
  for (const m of page.policyMarkers ?? []) {
    const { id, ...cfg } = m;
    topo.policyMarker(id, withMarkerIcon(cfg));
  }

  // One step that shows every element at once — a static frame, no choreography.
  const ids = [...page.nodes.map((n) => n.id), ...page.links.map((l) => l.id)];
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
