/**
 * Worker render path — the same engine-agnostic core as Node, but the vendored
 * engine is bundled (imported) rather than loaded via `node:module`.
 */
// The vendored engine is CommonJS (`module.exports = TopologyDesigner`); the
// bundler gives us that class as the default import. (Declared in types.d.ts.)
import EngineImport from '../public/vendor/topology-ds.js';
import {
  renderDocumentWithEngine,
  type EngineStatic,
  type RenderOptions,
} from '../src/render/core.js';
import type { TopologyDocument } from '../src/pages/model.js';

const Engine = ((EngineImport as { default?: EngineStatic }).default ??
  (EngineImport as unknown)) as EngineStatic;

export function renderDocument(
  doc: TopologyDocument,
  pageIndex = 0,
  opts: RenderOptions = {},
): string {
  return renderDocumentWithEngine(Engine, doc, pageIndex, opts);
}
