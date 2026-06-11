import { describe, it, expect } from 'vitest';
import { layerRank, layerView, layerVisible, type LayerDef } from './layers.js';
import { createDocument, defineLayer } from './builder.js';
import { validateDocument } from './validate.js';
import { parseDoc, serializeDoc } from '../pages/persist.js';

const LAYERS: LayerDef[] = [
  { id: 'under', name: 'Underlay', kind: 'underlay' },
  { id: 'over', name: 'Overlay', kind: 'overlay' },
  { id: 'pol', name: 'Policy', kind: 'policy', defaultVisible: false },
];

describe('layers', () => {
  it('ranks base below declared layers, in declaration order', () => {
    expect(layerRank(LAYERS, undefined)).toBe(-1);
    expect(layerRank(LAYERS, 'under')).toBe(0);
    expect(layerRank(LAYERS, 'pol')).toBe(2);
    expect(layerRank(LAYERS, 'nope')).toBe(-1); // undeclared renders as base
  });

  it('orders a collection bottom → top, keeping authoring order within a layer', () => {
    const items = [
      { id: 'p1', layer: 'pol' },
      { id: 'o1', layer: 'over' },
      { id: 'base' },
      { id: 'u1', layer: 'under' },
      { id: 'o2', layer: 'over' },
    ];
    const all = ['under', 'over', 'pol'];
    expect(layerView(items, LAYERS, all).map((i) => i.id)).toEqual([
      'base',
      'u1',
      'o1',
      'o2',
      'p1',
    ]);
  });

  it('visibility: explicit set overrides, defaultVisible applies, base always draws', () => {
    // No visible set → defaultVisible governs (pol is hidden by default).
    expect(layerVisible(LAYERS, 'over')).toBe(true);
    expect(layerVisible(LAYERS, 'pol')).toBe(false);
    expect(layerVisible(LAYERS, undefined)).toBe(true);
    // Explicit set → only listed layers draw; base still always draws.
    expect(layerVisible(LAYERS, 'pol', ['pol'])).toBe(true);
    expect(layerVisible(LAYERS, 'over', ['pol'])).toBe(false);
    expect(layerVisible(LAYERS, undefined, ['pol'])).toBe(true);

    const items = [
      { id: 'b' },
      { id: 'o', layer: 'over' },
      { id: 'p', layer: 'pol' },
    ];
    expect(layerView(items, LAYERS).map((i) => i.id)).toEqual(['b', 'o']);
    expect(layerView(items, LAYERS, ['pol']).map((i) => i.id)).toEqual([
      'b',
      'p',
    ]);
  });

  it('defineLayer declares and updates by id (fluent + pure op)', () => {
    const doc = createDocument('Fabric')
      .layer({ id: 'under', name: 'Underlay', kind: 'underlay' })
      .layer({ id: 'over', name: 'Overlay', kind: 'overlay' })
      .page()
      .build();
    expect(doc.layers?.map((l) => l.id)).toEqual(['under', 'over']);
    // Update in place (same id) keeps z-order; new id appends on top.
    defineLayer(doc, { id: 'under', name: 'Transport', kind: 'underlay' });
    defineLayer(doc, { id: 'pol', kind: 'policy' });
    expect(doc.layers?.map((l) => l.id)).toEqual(['under', 'over', 'pol']);
    expect(doc.layers?.[0]?.name).toBe('Transport');
    // Generated id when none given.
    const gen = defineLayer(doc, { kind: 'service' });
    expect(gen.id).toBeTruthy();
  });

  it('validates duplicate layer ids and undeclared element layer refs', () => {
    const doc = createDocument()
      .layer({ id: 'over', kind: 'overlay' })
      .page()
      .node({ id: 'a', type: 'ec', x: 100, y: 100, layer: 'over' })
      .node({ id: 'b', type: 'ec', x: 300, y: 100, layer: 'ghost' })
      .build();
    doc.layers!.push({ id: 'over', kind: 'overlay' });
    const problems = validateDocument(doc);
    expect(
      problems.some(
        (p) =>
          p.level === 'error' && /duplicate layer id "over"/.test(p.message),
      ),
    ).toBe(true);
    expect(
      problems.some(
        (p) =>
          p.level === 'warning' &&
          /layer "ghost" is not declared/.test(p.message),
      ),
    ).toBe(true);
    // The well-formed reference raises nothing.
    expect(problems.some((p) => /"over" is not declared/.test(p.message))).toBe(
      false,
    );
  });

  it('round-trips layers through serialize → parse, dropping malformed entries', () => {
    const doc = createDocument('Fabric')
      .layer({ id: 'under', kind: 'underlay', color: '#888' })
      .page()
      .node({ id: 'a', type: 'ec', x: 100, y: 100, layer: 'under' })
      .build();
    const back = parseDoc(serializeDoc(doc))!;
    expect(back.layers).toEqual([
      { id: 'under', kind: 'underlay', color: '#888' },
    ]);
    expect(back.pages[0]!.nodes[0]!.layer).toBe('under');
    // Malformed layers (no string id) are dropped on parse.
    const dirty = parseDoc(
      JSON.stringify({
        title: 'X',
        pages: [{ nodes: [], links: [] }],
        customNodes: [],
        layers: [{ id: 'ok' }, { name: 'no-id' }, 'junk', null],
      }),
    )!;
    expect(dirty.layers).toEqual([{ id: 'ok' }]);
  });
});
