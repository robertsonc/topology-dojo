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
import { glowForColor } from '../nodes/data.js';
import { withMarkerIcon } from '../api/markers.js';

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
  registerCustomTypes(E, customNodes);

  const topo = new E({ viewBox: page.viewBox });
  if (opts.calm) topo.reducedMotion = true;
  for (const a of page.anchors) topo.anchor(a.id, { x: a.x, y: a.y });
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

  // One all-showing step + a trailing step we sit on → every element renders
  // fully with no entrance animation (the validated static-frame trick).
  const ids = [...page.nodes.map((n) => n.id), ...page.links.map((l) => l.id)];
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
  return renderPageWithEngine(E, page, doc.customNodes, opts);
}
