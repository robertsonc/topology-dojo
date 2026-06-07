/**
 * Headless SVG rendering in Node — loads the vendored engine through its
 * CommonJS export behind a `createRequire`, then delegates to the shared,
 * engine-agnostic render core. This is the render path the stdio MCP server /
 * a CLI uses; the Cloudflare Worker uses the same core with a bundled engine.
 */
import { createRequire } from 'node:module';
import type { Page, TopologyDocument } from '../pages/model.js';
import type { CustomNodeSpec } from '../nodes/spec.js';
import {
  ensureShim,
  renderDocumentWithEngine,
  renderPageWithEngine,
  type EngineStatic,
  type RenderOptions,
} from '../render/core.js';

let _Engine: EngineStatic | null = null;

/** Load (once) the vendored engine in Node behind a minimal browser-global shim. */
function engine(): EngineStatic {
  if (_Engine) return _Engine;
  ensureShim();
  const require = createRequire(import.meta.url);
  // public/vendor/package.json marks these as CommonJS; require returns the class.
  const mod = require('../../public/vendor/topology-ds.js') as unknown;
  _Engine = ((mod as { default?: EngineStatic }).default ??
    mod) as EngineStatic;
  return _Engine;
}

/** Render one page to a complete, standalone SVG string (with a dark backdrop). */
export function renderPageToSVG(
  page: Page,
  customNodes: CustomNodeSpec[] = [],
  opts: RenderOptions = {},
): string {
  return renderPageWithEngine(engine(), page, customNodes, opts);
}

/** Render a document's page (default the first) to a standalone SVG string. */
export function renderDocumentToSVG(
  doc: TopologyDocument,
  pageIndex = 0,
  opts: RenderOptions = {},
): string {
  return renderDocumentWithEngine(engine(), doc, pageIndex, opts);
}
