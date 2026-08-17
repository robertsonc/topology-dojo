/**
 * Line jumps at link crossings (plan Phase 5.1) — page-level `lineJumps`
 * ('arc' | 'gap'): a standard `line` link hops over links drawn earlier
 * where their straight segments cross; exactly one of a crossing pair hops;
 * off by default; persists through parse.
 */
import { describe, it, expect } from 'vitest';
import { renderPageToSVG } from '../server/render.js';
import { parseDoc, serializeDoc } from '../pages/persist.js';
import type { Page, TopologyDocument } from '../pages/model.js';

/** Two line links forming a clean X crossing at (300, 200). */
function crossingPage(lineJumps?: 'arc' | 'gap'): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 600 400',
    ...(lineJumps ? { lineJumps } : {}),
    nodes: [
      { id: 'a', type: 'shape:circle', x: 100, y: 100, shapeSize: 8 },
      { id: 'b', type: 'shape:circle', x: 500, y: 300, shapeSize: 8 },
      { id: 'c', type: 'shape:circle', x: 100, y: 300, shapeSize: 8 },
      { id: 'd', type: 'shape:circle', x: 500, y: 100, shapeSize: 8 },
    ],
    links: [
      { id: 'ab', type: 'line', from: 'a', to: 'b' },
      { id: 'cd', type: 'line', from: 'c', to: 'd' },
    ],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  } as unknown as Page;
}

describe('line jumps', () => {
  it('off by default — plain crossing, no arcs', () => {
    const svg = renderPageToSVG(crossingPage(), []);
    expect(svg).not.toContain(' A6,6 ');
  });

  it('arc mode hops the later-drawn link over the earlier one', () => {
    const svg = renderPageToSVG(crossingPage('arc'), []);
    // Exactly one hop arc: the cd link (drawn second) jumps once.
    const arcs = svg.match(/ A6,6 /g) ?? [];
    expect(arcs).toHaveLength(1);
  });

  it('gap mode breaks the later-drawn link instead', () => {
    const svg = renderPageToSVG(crossingPage('gap'), []);
    expect(svg).not.toContain(' A6,6 ');
    // The path restarts after the crossing: two M commands in one path d.
    const jumped = /d="(M[^"]*M[^"]*)"/.exec(svg);
    expect(jumped).not.toBeNull();
  });

  it('parallel links (no crossing) never hop', () => {
    const page = crossingPage('arc');
    // Re-point cd to run parallel under ab instead of crossing it.
    page.links[1] = { id: 'cd', type: 'line', from: 'c', to: 'b' };
    const svg = renderPageToSVG(page, []);
    expect(svg).not.toContain(' A6,6 ');
  });

  it('lineJumps round-trips through persistence', () => {
    const doc: TopologyDocument = {
      title: 'T',
      customNodes: [],
      pages: [crossingPage('arc')],
    };
    const back = parseDoc(serializeDoc(doc))!;
    expect(back.pages[0]!.lineJumps).toBe('arc');
    // Invalid values are dropped defensively.
    const dirty = JSON.parse(serializeDoc(doc)) as {
      pages: { lineJumps?: string }[];
    };
    dirty.pages[0]!.lineJumps = 'wiggle';
    expect(parseDoc(JSON.stringify(dirty))!.pages[0]!.lineJumps).toBe(
      undefined,
    );
  });
});
