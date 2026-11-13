import { describe, expect, it } from 'vitest';
import { pageContentBounds, pageFramedForExport } from './content-bounds.js';
import { zoneBox } from './zone-box.js';
import type { Page } from '../pages/model.js';

function page(partial: Partial<Page>): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 1000 600',
    nodes: [],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
    ...partial,
  };
}

describe('pageContentBounds', () => {
  it('is null for an empty page', () => {
    expect(pageContentBounds(page({}))).toBeNull();
  });

  it('includes zone boxes, which extend past their member nodes', () => {
    const p = page({
      nodes: [
        { id: 'a', type: 'ec', x: 200, y: 200 },
        { id: 'b', type: 'ec', x: 600, y: 400 },
      ],
      zones: [
        { id: 'inner', label: 'Site', nodes: ['a'] },
        { id: 'outer', label: 'Region', nodes: ['b'], children: ['inner'] },
      ],
    } as Partial<Page>);
    const b = pageContentBounds(p)!;
    for (const zone of p.zones) {
      const z = zoneBox(p, zone)!;
      expect(b.x).toBeLessThanOrEqual(z.x);
      expect(b.y).toBeLessThanOrEqual(z.y);
      expect(b.x + b.w).toBeGreaterThanOrEqual(z.x + z.w);
      expect(b.y + b.h).toBeGreaterThanOrEqual(z.y + z.h);
    }
    // Well outside the nodes' own footprint (a zone pads its members by 40).
    expect(b.x).toBeLessThan(200 - 40);
  });

  it('includes a label placed outside its node', () => {
    const bare = pageContentBounds(
      page({ nodes: [{ id: 'a', type: 'ec', x: 300, y: 300 }] }),
    )!;
    const labelled = pageContentBounds(
      page({
        nodes: [
          {
            id: 'a',
            type: 'ec',
            x: 300,
            y: 300,
            label: 'LosAngeles-EC-01',
            labelPlacement: 'w',
          },
        ],
      } as Partial<Page>),
    )!;
    expect(labelled.x).toBeLessThan(bare.x - 40);
  });
});

describe('pageFramedForExport', () => {
  const nodes = [
    { id: 'a', type: 'ec', x: 240, y: 100 },
    { id: 'b', type: 'ec', x: 900, y: 500 },
  ];
  const zones = [{ id: 'z', label: 'Region', nodes: ['a', 'b'] }];

  it('returns the same page when the content is inside the frame', () => {
    const p = page({ viewBox: '0 0 1200 700', nodes } as Partial<Page>);
    expect(pageFramedForExport(p)).toBe(p);
  });

  it('widens a frame that crops a zone, and never narrows one', () => {
    // A frame fitted to the nodes alone: the zone box pokes out on all sides.
    const p = page({
      viewBox: '200 60 740 480',
      nodes,
      zones,
    } as Partial<Page>);
    const z = zoneBox(p, p.zones[0]!)!;
    const framed = pageFramedForExport(p, 24);
    expect(framed).not.toBe(p);
    expect(p.viewBox).toBe('200 60 740 480'); // the document is untouched
    const [x, y, w, h] = framed.viewBox.split(' ').map(Number) as number[];
    expect(x).toBeLessThanOrEqual(z.x - 24);
    expect(y).toBeLessThanOrEqual(z.y - 24);
    expect(x! + w!).toBeGreaterThanOrEqual(z.x + z.w + 24);
    expect(y! + h!).toBeGreaterThanOrEqual(z.y + z.h + 24);

    // A frame already larger on one side keeps that side.
    const roomy = pageFramedForExport(
      page({ viewBox: '-500 60 1440 480', nodes, zones } as Partial<Page>),
    );
    expect(roomy.viewBox.split(' ')[0]).toBe('-500');
  });
});
