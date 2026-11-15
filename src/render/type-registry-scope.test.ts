/**
 * Custom node types belong to the document that declares them.
 *
 * The engine's node-type table and the headless hit-box table are
 * process-wide. These tests prove that rendering (and validating, laying
 * out, inspecting) one document leaves both tables as they were, so a
 * later, unrelated document renders exactly as it would have on its own;
 * and that parseDoc / validateDocument refuse a custom type named after a
 * built-in or stock type. Uses the real vendored engine.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { TopologyDocument } from '../pages/model.js';
import { blankPage } from '../pages/model.js';
import { parseDoc } from '../pages/persist.js';
import { defaultSpec, type CustomNodeSpec } from '../nodes/spec.js';
import { STOCK_NODE_SPECS } from '../nodes/stock.js';
import { renderDocumentToSVG } from '../server/render.js';
import { validateDocument } from '../api/validate.js';
import { analyzeLayout } from '../api/layout.js';
import { tidyDocument } from '../api/tidy.js';
import { layoutDocument } from '../api/autolayout.js';
import { registeredHitBoxes } from './hit-boxes.js';
import { defineNodeType } from '../api/builder.js';

const STOCK = STOCK_NODE_SPECS[0]!.typeName;

/** A plain document using a built-in, a stock type and a type it never defines. */
function benign(): TopologyDocument {
  const p = blankPage('P');
  p.nodes.push(
    { id: 'r', type: 'router', x: 200, y: 200, label: 'R' },
    { id: 's', type: STOCK, x: 420, y: 200, label: 'S' },
    { id: 'w', type: 'widget', x: 470, y: 200, label: 'W' },
  );
  p.links.push({ id: 'l', type: 'line', from: 'r', to: 's' });
  return { title: 'A', pages: [p], customNodes: [] };
}

function spec(typeName: string, over: Partial<CustomNodeSpec> = {}) {
  return { ...defaultSpec(), typeName, size: 48, ...over } as CustomNodeSpec;
}

/** A document declaring custom types named after a built-in, a stock type,
 * and a name the benign document uses without defining. Built directly (not
 * through parseDoc) so the render path is tested on its own. */
function declaring(): TopologyDocument {
  const p = blankPage('P');
  p.nodes.push(
    { id: 'x', type: 'router', x: 200, y: 200, label: 'X' },
    { id: 'y', type: 'widget', x: 420, y: 200, label: 'Y' },
  );
  return {
    title: 'B',
    pages: [p],
    customNodes: [
      spec('router', { shape: 'circle', colorStroke: '#ff00ff' }),
      spec(STOCK, { shape: 'hexagon', colorStroke: '#00ffff' }),
      spec('widget', { shape: 'diamond', colorStroke: '#ffff00' }),
    ],
  };
}

function hitBoxDump(): string {
  return JSON.stringify([...registeredHitBoxes()].sort());
}

// Taken before any test touches the tables.
const PRISTINE_HIT_BOXES = hitBoxDump();
const PRISTINE_LAYOUT = JSON.stringify(analyzeLayout(benign()));

describe('custom type registrations are scoped to one document', () => {
  it('rendering another document does not change how a document renders', () => {
    const before = renderDocumentToSVG(benign());
    renderDocumentToSVG(declaring());
    const after = renderDocumentToSVG(benign());
    expect(after).toBe(before);
    expect(after.length).toBeGreaterThan(0);
  });

  it('a document still renders its own custom types', () => {
    const p = blankPage('P');
    p.nodes.push({ id: 'g', type: 'gadget', x: 200, y: 200, label: 'G' });
    const doc: TopologyDocument = {
      title: 'C',
      pages: [p],
      customNodes: [spec('gadget', { colorStroke: '#ab12cd' })],
    };
    expect(renderDocumentToSVG(doc).toLowerCase()).toContain('#ab12cd');
  });

  it('the engine node-type table is the same before and after a render', () => {
    const require = createRequire(import.meta.url);
    renderDocumentToSVG(benign()); // loads the engine
    const mod = require('../../public/vendor/topology-ds.js') as {
      default?: { NODE_TYPES: Record<string, unknown> };
      NODE_TYPES?: Record<string, unknown>;
    };
    const table = (mod.default ?? mod).NODE_TYPES!;
    const snap = { ...table };
    renderDocumentToSVG(declaring());
    expect(Object.keys(table).sort()).toEqual(Object.keys(snap).sort());
    for (const k of Object.keys(snap)) expect(table[k]).toBe(snap[k]);
  });

  it('validate, layout analysis, tidy, auto-layout leave the hit-box table unchanged', () => {
    expect(hitBoxDump()).toBe(PRISTINE_HIT_BOXES);
    renderDocumentToSVG(declaring());
    validateDocument(declaring());
    analyzeLayout(declaring());
    tidyDocument(declaring());
    layoutDocument(declaring(), { algorithm: 'grid' });
    expect(hitBoxDump()).toBe(PRISTINE_HIT_BOXES);
  });

  it('validation of a document is unaffected by an earlier document', () => {
    validateDocument(declaring());
    renderDocumentToSVG(declaring());
    expect(JSON.stringify(analyzeLayout(benign()))).toBe(PRISTINE_LAYOUT);
  });
});

describe('custom type names may not reuse built-in or stock names', () => {
  it('parseDoc drops custom types named after a built-in or stock type', () => {
    const doc = parseDoc({
      title: 'B',
      pages: [blankPage('P')],
      customNodes: [spec('router'), spec(STOCK), spec('gadget')],
    });
    expect(doc?.customNodes.map((c) => c.typeName)).toEqual(['gadget']);
  });

  it('validateDocument reports a custom type named after a built-in or stock type', () => {
    const problems = validateDocument(declaring()).filter(
      (p) => p.level === 'error' && p.where.startsWith('customNodes'),
    );
    expect(problems.map((p) => p.where)).toEqual([
      'customNodes[0]',
      'customNodes[1]',
    ]);
  });

  it('defineNodeType refuses a built-in or stock name', () => {
    expect(() => defineNodeType(benign(), spec('router'))).toThrow();
    expect(() => defineNodeType(benign(), spec(STOCK))).toThrow();
    const doc = benign();
    defineNodeType(doc, spec('gadget'));
    expect(doc.customNodes.map((c) => c.typeName)).toEqual(['gadget']);
  });
});
