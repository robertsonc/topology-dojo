import { describe, it, expect } from 'vitest';
import { createDocument } from './builder.js';
import { defineTier, mirrorPairKey, nonAdjacentTierLinks } from './tiers.js';
import { layoutDocument } from './autolayout.js';
import { validateDocument } from './validate.js';
import { analyzeLayout } from './layout.js';
import { parseDoc, serializeDoc } from '../pages/persist.js';
import { getNodeType, getAnnotationType } from './catalog.js';
import { renderDocumentToSVG } from '../server/render.js';

/** The reference sheet's shape: 6 gateways, 2 distribution, 2 core, dual-homed. */
function venue() {
  const b = createDocument('Venue').page({ viewBox: '0 0 2112 1632' });
  const gws = [
    'gw-wlan-01',
    'gw-wlan-02',
    'gw-ubt-01',
    'gw-ubt-02',
    'me-wlan-01',
    'me-wlan-02',
  ];
  // Pile everything up so the layout has to do all the work.
  for (const id of gws)
    b.node({
      id,
      type: 'router',
      x: 0,
      y: 0,
      label: id.toUpperCase(),
      tier: 'gw',
    });
  for (const id of ['sw-venue-02', 'sw-venue-01'])
    b.node({
      id,
      type: 'switch',
      x: 0,
      y: 0,
      label: id.toUpperCase(),
      tier: 'dist',
    });
  for (const id of ['rt-core-01', 'rt-core-02'])
    b.node({
      id,
      type: 'router',
      x: 0,
      y: 0,
      label: id.toUpperCase(),
      tier: 'core',
    });
  let i = 0;
  for (const g of gws)
    for (const s of ['sw-venue-01', 'sw-venue-02'])
      b.link({ id: `l${i++}`, type: 'line', from: g, to: s });
  for (const s of ['sw-venue-01', 'sw-venue-02'])
    for (const c of ['rt-core-01', 'rt-core-02'])
      b.link({ id: `l${i++}`, type: 'line', from: s, to: c });
  b.link({ id: 'icl', type: 'line', from: 'sw-venue-01', to: 'sw-venue-02' });
  const doc = b.build();
  defineTier(doc, { id: 'gw', name: 'Gateways' });
  defineTier(doc, { id: 'dist', name: 'Distribution' });
  defineTier(doc, { id: 'core', name: 'Core' });
  return doc;
}

describe('tiers (W2)', () => {
  it('defineTier upserts, orders, and inserts before', () => {
    const d: { tiers?: { id: string; name?: string }[] } = {};
    defineTier(d, { id: 'b' });
    defineTier(d, { id: 'c' });
    defineTier(d, { id: 'a' }, 'b');
    defineTier(d, { id: 'c', name: 'Core' });
    expect(d.tiers).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c', name: 'Core' },
    ]);
  });

  it('pairs -01/-02, -1/-2 and a/b names', () => {
    expect(mirrorPairKey('SW-VENUE-01')).toEqual({
      prefix: 'sw-venue',
      side: 0,
    });
    expect(mirrorPairKey('sw-venue-02')).toEqual({
      prefix: 'sw-venue',
      side: 1,
    });
    expect(mirrorPairKey('rt-core-2')).toEqual({ prefix: 'rt-core', side: 1 });
    expect(mirrorPairKey('gw-b')).toEqual({ prefix: 'gw', side: 1 });
    expect(mirrorPairKey('internet')).toBeNull();
  });

  it('is a catalog field on nodes and zones carry labelPosition', () => {
    expect(getNodeType('switch')!.fields.some((f) => f.key === 'tier')).toBe(
      true,
    );
    expect(
      getNodeType('shape:rectangle')!.fields.some((f) => f.key === 'tier'),
    ).toBe(true);
    expect(
      getAnnotationType('zone')!.fields.find((f) => f.key === 'labelPosition')
        ?.options,
    ).toEqual(['top', 'bottom']);
  });

  it('tiered layout rows by tier, mirrors pairs, emits tier zones, no overlaps', () => {
    const doc = venue();
    const r = layoutDocument(doc, {
      algorithm: 'tiered',
      mirror: true,
      tierZones: true,
    });
    expect(r.movedNodes).toBe(10);
    const page = doc.pages[0]!;
    const at = (id: string) => page.nodes.find((n) => n.id === id)!;
    const rowY = (ids: string[]) => new Set(ids.map((id) => at(id).y));
    expect(rowY(['sw-venue-01', 'sw-venue-02']).size).toBe(1);
    expect(rowY(['rt-core-01', 'rt-core-02']).size).toBe(1);
    expect(at('gw-wlan-01').y).toBeLessThan(at('sw-venue-01').y);
    expect(at('sw-venue-01').y).toBeLessThan(at('rt-core-01').y);
    // Mirrored about the centre line: -01 left of -02 and equidistant.
    const cx = 2112 / 2;
    expect(at('sw-venue-01').x).toBeLessThan(at('sw-venue-02').x);
    expect(cx - at('sw-venue-01').x).toBeCloseTo(at('sw-venue-02').x - cx, 0);
    expect(cx - at('rt-core-01').x).toBeCloseTo(at('rt-core-02').x - cx, 0);
    expect(cx - at('gw-wlan-01').x).toBeCloseTo(at('gw-wlan-02').x - cx, 0);
    // One zone per tier, captioned at the bottom.
    const zones = page.zones.map((z) => z.id).sort();
    expect(zones).toEqual(['tier:core', 'tier:dist', 'tier:gw']);
    expect(page.zones.find((z) => z.id === 'tier:dist')!.labelPosition).toBe(
      'bottom',
    );
    expect(page.zones.find((z) => z.id === 'tier:dist')!.label).toBe(
      'Distribution',
    );
    const overlaps = analyzeLayout(doc).filter((p) =>
      /overlap|too close/.test(p.message),
    );
    expect(overlaps).toEqual([]);
    // Re-running keeps the tier zones (refreshes membership, no duplicates).
    layoutDocument(doc, { algorithm: 'tiered', tierZones: true });
    expect(page.zones).toHaveLength(3);
    // The engine draws the bottom caption.
    const svg = renderDocumentToSVG(doc, 0);
    expect(svg).toContain('>Distribution<');
  });

  it('leaves untiered nodes alone and warns on undeclared / skipped tiers', () => {
    const doc = createDocument('T')
      .page()
      .node({ id: 'a', type: 'ec', x: 100, y: 100, tier: 'top' })
      .node({ id: 'b', type: 'ec', x: 300, y: 100, tier: 'mid' })
      .node({ id: 'c', type: 'ec', x: 500, y: 100, tier: 'low' })
      .node({ id: 'free', type: 'host', x: 900, y: 600 })
      .node({ id: 'ghost', type: 'host', x: 700, y: 600, tier: 'nope' })
      .link({ id: 'ac', type: 'line', from: 'a', to: 'c' })
      .link({ id: 'ab', type: 'line', from: 'a', to: 'b' })
      .build();
    doc.tiers = [{ id: 'top' }, { id: 'mid' }, { id: 'low' }];
    expect(
      nonAdjacentTierLinks(
        doc.tiers,
        doc.pages[0]!.nodes,
        doc.pages[0]!.links,
      ).map((x) => x.link.id),
    ).toEqual(['ac']);
    const p = validateDocument(doc);
    expect(p.some((x) => /tier "nope" is not declared/.test(x.message))).toBe(
      true,
    );
    expect(
      p.some((x) => /link "ac".*non-adjacent/.test(x.where + x.message)),
    ).toBe(true);
    layoutDocument(doc, { algorithm: 'tiered', tidy: false });
    const free = doc.pages[0]!.nodes.find((n) => n.id === 'free')!;
    expect([free.x, free.y]).toEqual([900, 600]);
  });

  it('round-trips tiers through persist and drops junk', () => {
    const doc = venue();
    const back = parseDoc(serializeDoc(doc))!;
    expect(back.tiers).toEqual(doc.tiers);
    const junk = parseDoc({
      pages: [{ nodes: [], links: [] }],
      tiers: [{ id: 'a', name: 'A' }, { id: 'a' }, { name: 'noid' }, 'x'],
    })!;
    expect(junk.tiers).toEqual([{ id: 'a', name: 'A' }]);
  });
});
