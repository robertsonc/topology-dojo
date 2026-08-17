import { describe, it, expect, vi } from 'vitest';
import { pageToSVG, selectionPage } from './export.js';
import type { Page } from '../pages/model.js';

// The wrapper/backdrop framing is what's under test — the art itself needs the
// browser-loaded engine, so stub it out.
vi.mock('../vendor/topology-ds.js', () => ({
  renderPageSVG: () => '<g data-art/>',
}));

function page(viewBox: string): Page {
  return {
    id: 'p1',
    name: 'Frame 1',
    viewBox,
    nodes: [{ id: 'a', type: 'ec', x: 200, y: 120, label: 'A' }],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  };
}

describe('pageToSVG backdrop framing', () => {
  it('covers a zero-origin viewBox from (0,0)', () => {
    const svg = pageToSVG(page('0 0 1050 700'));
    expect(svg).toContain('viewBox="0 0 1050 700"');
    expect(svg).toContain('<rect x="0" y="0" width="1050" height="700"');
  });

  it('positions the backdrop at a positive non-zero origin', () => {
    // fit-to-content can legitimately produce origins like this; the backdrop
    // must cover 82,40 → 982,660, not 0,0 → 900,620.
    const svg = pageToSVG(page('82 40 900 620'));
    expect(svg).toContain('<rect x="82" y="40" width="900" height="620"');
  });

  it('positions the backdrop at a negative origin', () => {
    const svg = pageToSVG(page('-120 -60 800 500'));
    expect(svg).toContain('<rect x="-120" y="-60" width="800" height="500"');
    // wrapper still rasterizes at the viewBox size
    expect(svg).toContain('width="800" height="500"><rect');
  });
});

describe('selectionPage (export selection only)', () => {
  const base = page('0 0 1050 700');
  const nodes = [
    { id: 'a', type: 'ec', x: 200, y: 200, label: 'A' },
    { id: 'b', type: 'ec', x: 600, y: 400, label: 'B' },
  ];
  const links = [
    {
      id: 'ab',
      type: 'line',
      from: 'a',
      to: 'b',
      waypoints: [{ x: 400, y: 100 }],
    },
  ];

  it('crops the viewBox to the selection bounds (+node allowance +pad)', () => {
    const sp = selectionPage(base, nodes, links);
    // minX = 200-56-48 = 96; minY = 100-8-48 = 44 (the waypoint reaches higher)
    const [x, y, w, h] = sp.viewBox.split(' ').map(Number);
    expect(x).toBe(96);
    expect(y).toBe(44);
    expect(w).toBe(400 + 56 * 2 + 48 * 2); // 200..600 span + allowances + pads
    expect(h).toBeGreaterThan(0);
    expect(sp.nodes).toHaveLength(2);
    expect(sp.links).toHaveLength(1);
    // Annotations never leak into a selection export.
    expect(sp.zones).toEqual([]);
    expect(sp.flowPaths).toEqual([]);
  });

  it('throws on an empty selection', () => {
    expect(() => selectionPage(base, [], [])).toThrow(/nothing selected/);
  });
});
