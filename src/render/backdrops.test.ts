import { describe, it, expect } from 'vitest';
import {
  BACKDROP_NAMES,
  backdropForRegion,
  composeBackdrop,
  isBackdropName,
} from './backdrops.js';
import { renderPageToSVG } from '../server/render.js';
import { validateDocument } from '../api/validate.js';
import { createDocument } from '../api/builder.js';
import { generateSdwan } from '../connect/generate.js';
import type { Page } from '../pages/model.js';

function zonePage(backdrop?: string): Page {
  const b = createDocument('Map')
    .page({ name: 'Map' })
    .node({ id: 'a', type: 'ec', x: 200, y: 200, label: 'A' })
    .node({ id: 'b', type: 'ec', x: 600, y: 450, label: 'B' })
    .zone({
      id: 'z',
      label: 'EMEA',
      nodes: ['a', 'b'],
      ...(backdrop ? { backdrop } : {}),
    });
  return b.build().pages[0]!;
}

describe('map backdrops', () => {
  it('composes every business region from shared pieces', () => {
    const world = composeBackdrop('world');
    for (const name of BACKDROP_NAMES) {
      const b = composeBackdrop(name);
      expect(b.d, name).toMatch(/^M[\d.]+ [\d.]+L/);
      expect(b.b.length, name).toBeGreaterThan(0);
      // Each crop sits inside the world frame…
      expect(b.x, name).toBeGreaterThanOrEqual(world.x);
      expect(b.x + b.w, name).toBeLessThanOrEqual(world.x + world.w);
      expect(b.y + b.h, name).toBeLessThanOrEqual(world.y + world.h);
    }
    // …and composites cover their parts.
    const amer = composeBackdrop('amer');
    for (const part of ['na', 'latam'] as const) {
      const p = composeBackdrop(part);
      expect(amer.x).toBeLessThanOrEqual(p.x);
      expect(amer.x + amer.w).toBeGreaterThanOrEqual(p.x + p.w);
    }
    // Europe stops at the Russia split (60°E), well short of APAC's east edge.
    const europe = composeBackdrop('europe');
    const apac = composeBackdrop('apac');
    expect(europe.x + europe.w).toBeLessThan(apac.x + apac.w - 200);
    // No antimeridian artefact: no coordinate leaves the world frame.
    for (const n of world.d.match(/-?[\d.]+/g)!.map(Number))
      expect(n).toBeGreaterThanOrEqual(-0.1);
  });

  it('maps region names and aliases, and nothing else', () => {
    expect(backdropForRegion('AMER')).toBe('amer');
    expect(backdropForRegion('North America')).toBe('na');
    expect(backdropForRegion(' Europe ')).toBe('europe');
    expect(backdropForRegion('Middle East')).toBe('emea');
    expect(backdropForRegion('Africa')).toBe('africa');
    expect(backdropForRegion('APJ')).toBe('apac');
    expect(backdropForRegion('South America')).toBe('latam');
    expect(backdropForRegion('West')).toBeUndefined();
    expect(isBackdropName('emea')).toBe(true);
    expect(isBackdropName('mars')).toBe(false);
  });

  it('draws inside the zone box only when the zone names a backdrop', () => {
    expect(renderPageToSVG(zonePage())).not.toContain('tds-backdrop');
    const svg = renderPageToSVG(zonePage('emea'));
    const m =
      /class="tds-backdrop" transform="translate\(([\d.-]+) ([\d.-]+)\) scale\(([\d.]+)\)"/.exec(
        svg,
      );
    expect(m).not.toBeNull();
    const [tx, ty, k] = [Number(m![1]), Number(m![2]), Number(m![3])];
    const b = composeBackdrop('emea');
    // The crop box lands inside the zone (nodes 200..600 × 200..450 + pad).
    const left = tx + b.x * k;
    const top = ty + b.y * k;
    expect(left).toBeGreaterThan(100);
    expect(top).toBeGreaterThan(100);
    expect(left + b.w * k).toBeLessThan(700);
    expect(top + b.h * k).toBeLessThan(560);
    // Fill, then a faint border stroke; the fill itself is never outlined.
    expect(svg).toMatch(
      /fill-opacity="\.08"\/><path d="[^"]+" fill="none" stroke=/,
    );
  });

  it('warns on an unknown backdrop name', () => {
    const doc = createDocument('x').page().build();
    doc.pages[0] = zonePage('mars');
    expect(
      validateDocument(doc).some(
        (p) => p.level === 'warning' && /backdrop "mars"/.test(p.message),
      ),
    ).toBe(true);
  });

  it('the SD-WAN generator puts each region continent behind its zone', () => {
    const { doc } = generateSdwan({
      vendor: 'edgeconnect',
      regions: 3,
      regionNames: ['AMER', 'Europe', 'Lab'],
      mapBackdrop: true,
    });
    const byId = new Map(doc.pages[0]!.zones.map((z) => [z.id, z.backdrop]));
    expect(byId.get('region_amer')).toBe('amer');
    expect(byId.get('region_europe')).toBe('europe');
    expect(byId.get('region_lab')).toBeUndefined();
    // Off by default.
    const off = generateSdwan({ vendor: 'edgeconnect' }).doc;
    expect(off.pages[0]!.zones.some((z) => z.backdrop)).toBe(false);
  });
});
