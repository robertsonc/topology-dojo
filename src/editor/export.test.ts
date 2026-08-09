import { describe, it, expect, vi } from 'vitest';
import { pageToSVG } from './export.js';
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
