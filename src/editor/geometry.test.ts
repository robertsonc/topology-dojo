import { describe, it, expect } from 'vitest';
import { hitTestAnchor, resolvePos } from './geometry.js';
import type { Page } from '../pages/model.js';

/** Minimal page carrying just the anchors/nodes the geometry helpers read. */
function page(p: Partial<Page>): Page {
  return {
    id: 'p',
    name: 'P',
    viewBox: '0 0 1050 700',
    nodes: [],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
    ...p,
  };
}

describe('anchor geometry', () => {
  it('hit-tests an anchor within the radius and misses outside it', () => {
    const pg = page({ anchors: [{ id: 'a1', x: 100, y: 100 }] });
    expect(hitTestAnchor(pg, 103, 98)).toBe('a1'); // within default pad (8)
    expect(hitTestAnchor(pg, 100, 100)).toBe('a1'); // dead centre
    expect(hitTestAnchor(pg, 120, 100)).toBeNull(); // outside the pad
    expect(hitTestAnchor(pg, 100, 100, 2)).toBe('a1'); // tighter pad still hits centre
  });

  it('returns the topmost (last-drawn) anchor when two overlap', () => {
    const pg = page({
      anchors: [
        { id: 'under', x: 50, y: 50 },
        { id: 'over', x: 52, y: 51 },
      ],
    });
    expect(hitTestAnchor(pg, 51, 50)).toBe('over');
  });

  it('resolvePos resolves anchor ids as link endpoints', () => {
    const pg = page({ anchors: [{ id: 'a1', x: 240, y: 360 }] });
    expect(resolvePos(pg, 'a1')).toEqual({ x: 240, y: 360 });
    expect(resolvePos(pg, 'missing')).toBeNull();
  });
});
