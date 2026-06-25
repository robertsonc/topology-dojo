/**
 * Engine-agnostic SVG rendering core — shared by every headless render path
 * (Node via `createRequire`, Cloudflare Workers via a bundled import). It takes
 * the vendored engine *class* and a page/document and returns a standalone SVG
 * string. No `node:` or DOM imports, so it bundles for any runtime.
 *
 * The engine's only non-render environment touch is `window.matchMedia` (+ a
 * `navigator`/`document` sniff) inside its constructor; `ensureShim()` provides
 * a minimal stub on `globalThis` before instantiation. `_renderSVG()` itself
 * only builds strings.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import type { CustomNodeSpec } from '../nodes/spec.js';
import { customHitBox, renderCustomNode } from '../nodes/render.js';
import { STOCK_NODE_SPECS } from '../nodes/stock.js';
import { glowForColor } from '../nodes/data.js';
import { withMarkerIcon } from '../api/markers.js';
import { layerView, type LayerDef } from '../api/layers.js';

export interface EngineInstance {
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
  _steps: unknown[];
  step: number;
  reducedMotion: boolean;
}
export interface EngineStatic {
  new (cfg: Record<string, unknown>): EngineInstance;
  registerNodeType(name: string, plugin: unknown): void;
}

export interface RenderOptions {
  /** Calm: suppress animation (flow particles, link dots) in the output. */
  calm?: boolean;
  /**
   * Declared document layers (bottom → top) — drives stacking order. The
   * document render path fills this from `doc.layers` automatically.
   */
  layers?: LayerDef[];
  /** Only draw these layer ids (untagged base elements always draw). */
  visibleLayers?: string[];
  /** Per-frame emphasis (2.2): node/link ids to spotlight; others dim to 25%. */
  emphasis?: string[];
}

/** Provide the minimal browser globals the engine constructor sniffs (idempotent). */
export function ensureShim(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window ??= { matchMedia: () => ({ matches: false }) };
  g.navigator ??= { userAgent: 'headless', maxTouchPoints: 0 };
  g.document ??= { getElementById: () => null };
}

function registerCustomTypes(E: EngineStatic, specs: CustomNodeSpec[]): void {
  for (const spec of specs) {
    E.registerNodeType(spec.typeName, {
      render: (x: number, y: number, cfg: { color?: string }) =>
        renderCustomNode(spec, x, y, cfg),
      defaults: { color: spec.colorStroke },
      hitBox: customHitBox(spec),
      haloColor: glowForColor(spec.colorStroke),
    });
  }
}

/** Render one page to a complete, standalone SVG string (with a dark backdrop). */
export function renderPageWithEngine(
  E: EngineStatic,
  page: Page,
  customNodes: CustomNodeSpec[] = [],
  opts: RenderOptions = {},
): string {
  ensureShim();
  // Stock cloud types ship with the app; the document's own custom types layer
  // on top (and override by name if a user redefines one).
  registerCustomTypes(E, [...STOCK_NODE_SPECS, ...customNodes]);

  const topo = new E({ viewBox: page.viewBox });
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

  // Fold per-layer opacity (B.3) and per-frame emphasis (2.2) into each
  // node/link's opacity — mirrors renderPageSVG so the headless/MCP path dims
  // the same way the editor and exports do.
  const layerOpacity = new Map<string, number>();
  for (const ly of layers)
    if (typeof ly.opacity === 'number' && ly.opacity < 1)
      layerOpacity.set(ly.id, Math.max(0, ly.opacity));
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

  for (const a of page.anchors) topo.anchor(a.id, { x: a.x, y: a.y });
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
    topo.zone(id, cfg);
  }
  for (const f of flows) {
    const { id, ...cfg } = f;
    topo.flowPath(id, cfg);
  }
  for (const m of markers) {
    const { id, ...cfg } = m;
    topo.policyMarker(id, withMarkerIcon(cfg));
  }

  // One all-showing step + a trailing step we sit on → every element renders
  // fully with no entrance animation (the validated static-frame trick).
  const ids = [...nodes.map((n) => n.id), ...links.map((l) => l.id)];
  topo.act('all', { label: 'All' });
  topo.addStep('all', {
    act: 'all',
    name: 'All',
    focus: [],
    phases: [{ show: ids, diff: '' }],
  });
  topo.addStep('end', {
    act: 'all',
    name: 'end',
    focus: [],
    phases: [{ show: [], diff: '' }],
  });
  topo._buildIndex();
  topo.step = topo._steps.length;

  const [vx, vy, vw, vh] = page.viewBox.split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${page.viewBox}" width="${vw}" height="${vh}">` +
    `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#1d1f27"/>` +
    topo._renderSVG() +
    `</svg>`
  );
}

/** Render a document's page (default the first) to a standalone SVG string. */
export function renderDocumentWithEngine(
  E: EngineStatic,
  doc: TopologyDocument,
  pageIndex = 0,
  opts: RenderOptions = {},
): string {
  const page = doc.pages[pageIndex];
  if (!page) throw new Error(`page index ${pageIndex} out of range`);
  return renderPageWithEngine(E, page, doc.customNodes, {
    ...opts,
    layers: opts.layers ?? doc.layers ?? [],
    emphasis: opts.emphasis ?? page.emphasis,
  });
}
