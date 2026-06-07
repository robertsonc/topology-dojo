/**
 * Headless SVG rendering — document/page → a standalone SVG string in Node,
 * with no browser. This is the render path an MCP server or CLI uses.
 *
 * It loads the vendored engine through its CommonJS export behind a tiny global
 * shim: the engine's only non-render DOM touch is `window.matchMedia` (+ a
 * `navigator` UA sniff) in the constructor; `_renderSVG()` itself builds strings.
 * Custom node types are registered via the same pure interpreter the browser uses.
 */
import { createRequire } from 'node:module';
import type { Page, TopologyDocument } from '../pages/model.js';
import type { CustomNodeSpec } from '../nodes/spec.js';
import { customHitBox, renderCustomNode } from '../nodes/render.js';
import { glowForColor } from '../nodes/data.js';

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
  registerNodeType(name: string, plugin: unknown): void;
}

let _Engine: EngineStatic | null = null;

/** Load (once) the vendored engine in Node behind a minimal browser-global shim. */
function engine(): EngineStatic {
  if (_Engine) return _Engine;
  const g = globalThis as unknown as Record<string, unknown>;
  g.window ??= { matchMedia: () => ({ matches: false }) };
  g.navigator ??= { userAgent: 'node', maxTouchPoints: 0 };
  g.document ??= { getElementById: () => null };
  const require = createRequire(import.meta.url);
  // public/vendor/package.json marks these as CommonJS; require returns the class.
  const mod = require('../../public/vendor/topology-ds.js') as unknown;
  _Engine = ((mod as { default?: EngineStatic }).default ??
    mod) as EngineStatic;
  return _Engine;
}

function registerCustomTypes(specs: CustomNodeSpec[]): void {
  const E = engine();
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
export function renderPageToSVG(
  page: Page,
  customNodes: CustomNodeSpec[] = [],
): string {
  const E = engine();
  registerCustomTypes(customNodes);

  const topo = new E({ viewBox: page.viewBox });
  for (const a of page.anchors) topo.anchor(a.id, { x: a.x, y: a.y });
  for (const n of page.nodes) {
    const { id, ...cfg } = n;
    topo.node(id, cfg);
  }
  for (const l of page.links) {
    const { id, ...cfg } = l;
    topo.link(id, cfg);
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
export function renderDocumentToSVG(
  doc: TopologyDocument,
  pageIndex = 0,
): string {
  const page = doc.pages[pageIndex];
  if (!page) throw new Error(`page index ${pageIndex} out of range`);
  return renderPageToSVG(page, doc.customNodes);
}
