import { describe, it, expect } from 'vitest';
import { BACKDROPS } from './backdrops.generated.js';
import {
  BACKDROP_NAMES,
  backdropForRegion,
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
  it('ships one normalised outline per name', () => {
    expect(Object.keys(BACKDROPS).sort()).toEqual([...BACKDROP_NAMES].sort());
    for (const name of BACKDROP_NAMES) {
      const b = BACKDROPS[name];
      expect(b.w, name).toBe(1000);
      expect(b.h, name).toBeGreaterThan(100);
      expect(b.d, name).toMatch(/^M[\d.]+ [\d.]+L/);
      // No antimeridian artefact: no coordinate leaves the w × h box.
      for (const n of b.d.match(/-?[\d.]+/g)!.map(Number))
        expect(n, name).toBeGreaterThanOrEqual(-0.1);
    }
  });

  it('maps region names and aliases, and nothing else', () => {
    expect(backdropForRegion('AMER')).toBe('amer');
    expect(backdropForRegion(' Europe ')).toBe('emea');
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
      /class="tds-backdrop"[^>]*transform="translate\(([\d.-]+) ([\d.-]+)\) scale\(([\d.]+)\)"/.exec(
        svg,
      );
    expect(m).not.toBeNull();
    const [tx, ty, k] = [Number(m![1]), Number(m![2]), Number(m![3])];
    const b = BACKDROPS.emea;
    // Fits within the zone (nodes 200..600 × 200..450 plus padding).
    expect(tx).toBeGreaterThan(100);
    expect(ty).toBeGreaterThan(100);
    expect(tx + b.w * k).toBeLessThan(700);
    expect(ty + b.h * k).toBeLessThan(560);
    // Fill only: clipped region edges must never be outlined.
    expect(svg).not.toMatch(/class="tds-backdrop"[^>]*stroke=/);
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
    expect(byId.get('region_europe')).toBe('emea');
    expect(byId.get('region_lab')).toBeUndefined();
    // Off by default.
    const off = generateSdwan({ vendor: 'edgeconnect' }).doc;
    expect(off.pages[0]!.zones.some((z) => z.backdrop)).toBe(false);
  });
});
