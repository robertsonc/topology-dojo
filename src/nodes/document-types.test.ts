/**
 * Opening another document in the editor takes the previous document's
 * custom node types away (engine table and hit-box mirror). Real engine.
 */
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureShim } from '../render/core.js';
import { registeredHitBoxes } from '../render/hit-boxes.js';
import { defaultSpec, type CustomNodeSpec } from './spec.js';
import { registerCustomNodes } from './render.js';
import { STOCK_NODE_SPECS } from './stock.js';
import {
  markBaselineNodeTypes,
  useDocumentNodeTypes,
} from './document-types.js';

type Engine = { NODE_TYPES: Record<string, unknown> };
let engine: Engine;

beforeAll(() => {
  ensureShim();
  const require = createRequire(import.meta.url);
  const mod = require('../../public/vendor/topology-ds.js') as {
    default?: Engine;
  };
  engine = (mod.default ?? mod) as Engine;
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.TopologyDesigner = engine;
});

function spec(typeName: string): CustomNodeSpec {
  return { ...defaultSpec(), typeName, size: 48 };
}

const tableDump = (): string[] => Object.keys(engine.NODE_TYPES).sort();
const boxDump = (): string => JSON.stringify([...registeredHitBoxes()].sort());

describe('the editor swaps custom node types with the document', () => {
  it('loading the next document removes the previous document types', () => {
    registerCustomNodes(STOCK_NODE_SPECS);
    markBaselineNodeTypes(engine);
    const routerArt = engine.NODE_TYPES.router;
    const types = tableDump();
    const boxes = boxDump();

    useDocumentNodeTypes([spec('gadget'), spec('router')]);
    expect(engine.NODE_TYPES.gadget).toBeTypeOf('function');
    // A built-in name in a spec never replaces the built-in.
    expect(engine.NODE_TYPES.router).toBe(routerArt);

    useDocumentNodeTypes([]);
    expect(tableDump()).toEqual(types);
    expect(engine.NODE_TYPES.router).toBe(routerArt);
    expect(boxDump()).toBe(boxes);

    useDocumentNodeTypes([spec('widget')]);
    expect(engine.NODE_TYPES.gadget).toBeUndefined();
    expect(engine.NODE_TYPES.widget).toBeTypeOf('function');
  });
});
