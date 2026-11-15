/**
 * A custom node type's spec is document data, so it is untrusted: it can come
 * from an opened file, an import, a share link, the headless builder or the
 * `define_node_type` agent tool. Every one of those paths rebuilds the spec
 * from the fields the designer can produce, with numbers in range; and the
 * renderer copes on its own with a spec that skipped them.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDoc, serializeDoc } from '../pages/persist.js';
import { sampleDocument } from '../pages/model.js';
import { createDocument, defineNodeType } from '../api/builder.js';
import { TopologyStore } from '../mcp/store.js';
import { createTools } from '../mcp/tools.js';
import { renderDocumentToSVG } from '../server/render.js';
import { defaultSpec, type CustomNodeSpec } from './spec.js';
import { renderCustomNode } from './render.js';
import { STOCK_NODE_SPECS } from './stock.js';

const KEYS = Object.keys(defaultSpec()).sort();

/** The spec a document keeps after the parse gate. */
function parsedSpec(raw: Record<string, unknown>): CustomNodeSpec | undefined {
  const doc = parseDoc({
    title: 't',
    customNodes: [raw],
    pages: [{ id: 'p1', name: 'F', nodes: [], links: [] }],
  });
  return doc?.customNodes[0];
}

describe('custom node specs are rebuilt from the fields the designer makes', () => {
  it('keeps exactly the spec fields, each of its own kind', () => {
    const spec = parsedSpec({
      ...defaultSpec(),
      typeName: 'probe',
      extra: 'dropped',
      onload: 'dropped',
      size: '30',
      strokeW: ['2'],
      radius: { v: 1 },
      ledCount: 2.6,
      portCount: '5',
      glow: 'yes',
      highlight: 1,
      innerRing: true,
      shape: 'blob',
      patternType: 'stripes',
      ledPos: 'middle',
      portPos: 'side',
      icon: 'constructor',
      badgeText: 7,
    })!;
    expect(Object.keys(spec).sort()).toEqual(KEYS);
    expect(spec).toMatchObject({
      typeName: 'probe',
      size: 30,
      strokeW: defaultSpec().strokeW,
      radius: defaultSpec().radius,
      ledCount: 3,
      portCount: 5,
      glow: false,
      highlight: false,
      innerRing: true,
      shape: 'circle',
      patternType: 'none',
      ledPos: 'bottom',
      portPos: 'bottom',
      icon: null,
      badgeText: '',
    });
  });

  it.each([
    ['size', -5, 12],
    ['size', 1e9, 96],
    ['size', 60, 60],
    ['strokeW', 0, 0.5],
    ['strokeW', 99, 4],
    ['radius', -1, 0],
    ['radius', 400, 20],
    ['ledCount', 0, 1],
    ['ledCount', 1e9, 4],
    ['portCount', 1, 2],
    ['portCount', 1e9, 48],
    ['portCount', 24, 24],
    ['size', Infinity, defaultSpec().size],
    ['ledCount', NaN, defaultSpec().ledCount],
  ])('clamps %s %s to %s', (key, value, expected) => {
    expect(
      parsedSpec({ typeName: 'probe', [key]: value })![key as 'size'],
    ).toBe(expected);
  });

  it('keeps a known icon and refuses any other', () => {
    expect(parsedSpec({ typeName: 'probe', icon: 'shield' })!.icon).toBe(
      'shield',
    );
    for (const icon of ['nope', 'toString', '__proto__', 3, ['shield']])
      expect(parsedSpec({ typeName: 'probe', icon })!.icon).toBeNull();
  });

  it('bounds the badge text', () => {
    const spec = parsedSpec({ typeName: 'probe', badgeText: 'B'.repeat(500) })!;
    expect(spec.badgeText.length).toBeLessThanOrEqual(32);
  });

  it('a spec with no usable type name is dropped', () => {
    expect(parsedSpec({ typeName: '<>' })).toBeUndefined();
    expect(parsedSpec({ typeName: ['x'] })).toBeUndefined();
  });

  it('leaves every spec the product makes unchanged', () => {
    const made: CustomNodeSpec[] = [
      defaultSpec(),
      ...STOCK_NODE_SPECS,
      ...sampleDocument().customNodes,
      // The reference wiring sheet, made through the public builder.
      ...(
        JSON.parse(
          readFileSync(
            new URL(
              '../../fixtures/venue-distribution-leaf.json',
              import.meta.url,
            ),
            'utf8',
          ),
        ) as { customNodes: CustomNodeSpec[] }
      ).customNodes,
    ];
    expect(made.length).toBeGreaterThan(STOCK_NODE_SPECS.length + 1);
    for (const spec of made)
      expect(parsedSpec({ ...spec }), spec.typeName).toEqual(spec);
    const sample = sampleDocument();
    expect(
      JSON.parse(serializeDoc(parseDoc(serializeDoc(sample))!)).customNodes,
    ).toEqual(JSON.parse(JSON.stringify(sample.customNodes)));
  });
});

describe('every other way in applies the same check', () => {
  const hostile = {
    typeName: 'probe',
    size: '24" data-x="1',
    ledCount: 1e9,
    junk: true,
  } as unknown as CustomNodeSpec;

  it('the headless builder', () => {
    const doc = createDocument('t').defineNodeType(hostile).build();
    expect(doc.customNodes[0]).toMatchObject({ size: 24, ledCount: 4 });
    expect(doc.customNodes[0]).not.toHaveProperty('junk');
    const plain = createDocument('t').build();
    const stored = defineNodeType(plain, hostile);
    expect(stored).toBe(plain.customNodes[0]);
    expect(stored.size).toBe(24);
    expect(() =>
      defineNodeType(plain, { typeName: '<>' } as CustomNodeSpec),
    ).toThrow(/typeName/);
  });

  it('the define_node_type agent tool', () => {
    const store = new TopologyStore();
    const tools = createTools(store, { renderDocument: renderDocumentToSVG });
    const call = (name: string, args: Record<string, unknown>): unknown =>
      tools.find((t) => t.name === name)!.handler(args);
    const { id } = call('create_topology', {}) as { id: string };
    call('define_node_type', { topologyId: id, spec: hostile });
    const spec = store.get(id).customNodes[0]!;
    expect(spec).toMatchObject({ size: 24, ledCount: 4 });
    expect(spec).not.toHaveProperty('junk');
  });
});

describe('the custom node renderer copes with a spec that skipped the check', () => {
  const raw = (over: Record<string, unknown>): CustomNodeSpec =>
    ({
      ...defaultSpec(),
      typeName: 'probe',
      shape: 'square',
      leds: true,
      ports: true,
      innerRing: true,
      ...over,
    }) as unknown as CustomNodeSpec;

  it('writes numbers, not strings, into the art', () => {
    for (const key of ['size', 'strokeW', 'radius', 'ledCount', 'portCount']) {
      const svg = renderCustomNode(raw({ [key]: '3"><pwn/><g x="' }), 0, 0);
      expect(svg, key).not.toContain('<pwn');
      const arr = renderCustomNode(raw({ [key]: ['3"><pwn/><g x="'] }), 0, 0);
      expect(arr, key).not.toContain('<pwn');
    }
  });

  it('draws a bounded number of LEDs and ports', () => {
    const svg = renderCustomNode(raw({ ledCount: 1e6, portCount: 1e6 }), 0, 0);
    expect(svg.match(/<circle /g)?.length ?? 0).toBeLessThanOrEqual(4);
    expect(svg.match(/opacity="\.45"/g)?.length ?? 0).toBeLessThanOrEqual(48);
  });

  it('draws only known icons', () => {
    const svg = renderCustomNode(raw({ icon: 'constructor' }), 0, 0);
    expect(svg).not.toContain('<path d="function');
  });
});
