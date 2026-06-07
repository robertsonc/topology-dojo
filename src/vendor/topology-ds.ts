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
  [key: string]: unknown;
}

/** A free-floating position marker usable as a link endpoint. */
export interface AnchorConfig {
  id: string;
  x: number;
  y: number;
}

/** The minimal slice of the vendored engine instance we drive. */
interface EngineInstance {
  node(id: string, cfg: Record<string, unknown>): void;
  link(id: string, cfg: Record<string, unknown>): void;
  anchor(id: string, pos: { x: number; y: number }): void;
  act(id: string, cfg: Record<string, unknown>): void;
  addStep(id: string, cfg: Record<string, unknown>): void;
  _buildIndex(): void;
  _renderSVG(): string;
  _steps: unknown[];
  step: number;
}

interface EngineStatic {
  new (cfg: Record<string, unknown>): EngineInstance;
  NODE_TYPES: Record<string, (x: number, y: number, cfg: unknown) => string>;
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

/** A renderable page: a complete, standalone topology frame. */
export interface RenderablePage {
  viewBox: string;
  nodes: NodeConfig[];
  links: LinkConfig[];
  anchors?: AnchorConfig[];
}

/**
 * Render a page to an SVG inner-markup string (defs + ambient + elements),
 * meant to be injected into an `<svg viewBox=…>` inside a `.tds-canvas`.
 */
export function renderPageSVG(page: RenderablePage): string {
  const Engine = engine();
  const topo = new Engine({ viewBox: page.viewBox });

  for (const a of page.anchors ?? []) topo.anchor(a.id, { x: a.x, y: a.y });
  for (const n of page.nodes) {
    const { id, ...cfg } = n;
    topo.node(id, cfg);
  }
  for (const l of page.links) {
    const { id, ...cfg } = l;
    topo.link(id, cfg);
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
export function renderPageInto(svg: SVGSVGElement, page: RenderablePage): void {
  svg.setAttribute('viewBox', page.viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = renderPageSVG(page);
}
