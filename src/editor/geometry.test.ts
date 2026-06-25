import { describe, it, expect } from 'vitest';
import {
  hitTestAnchor,
  hitTestZone,
  resolvePos,
  zoneBounds,
} from './geometry.js';
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

describe('zone geometry', () => {
  const pg = page({
    nodes: [
      { id: 'a', type: 'ec', x: 200, y: 200 },
      { id: 'b', type: 'ec', x: 400, y: 300 },
      { id: 'lonely', type: 'ec', x: 800, y: 600 },
    ],
    zones: [{ id: 'z1', label: 'LAN', nodes: ['a', 'b'] }],
  });

  it('frames member nodes by ±40×±30 + padding (default 40)', () => {
    // x:[200-40,400+40]=[160,440], y:[200-30,300+30]=[170,330]; +40 pad all sides.
    expect(zoneBounds(pg, pg.zones[0]!)).toEqual({
      x: 120,
      y: 130,
      w: 360,
      h: 240,
    });
  });

  it('honours a custom padding', () => {
    const z = { id: 'z', label: 'z', nodes: ['a'], padding: 10 };
    // single node (200,200): box [160,170]..[240,230] (±40×±30); +10 pad.
    expect(zoneBounds(page({ nodes: pg.nodes, zones: [z] }), z)).toEqual({
      x: 150,
      y: 160,
      w: 100,
      h: 80,
    });
  });

  it('returns null when no members are present on the page', () => {
    expect(
      zoneBounds(pg, { id: 'z', label: 'z', nodes: ['ghost'] }),
    ).toBeNull();
  });

  it('hit-tests a point inside the zone region, misses outside', () => {
    expect(hitTestZone(pg, 300, 250)).toBe('z1'); // inside the box
    expect(hitTestZone(pg, 120, 130)).toBe('z1'); // top-left corner
    expect(hitTestZone(pg, 700, 600)).toBeNull(); // outside
  });

  it('prefers the smaller (more specific) zone when regions overlap', () => {
    const nested = page({
      nodes: pg.nodes,
      zones: [
        { id: 'big', label: 'big', nodes: ['a', 'b'] },
        { id: 'small', label: 'small', nodes: ['a'] },
      ],
    });
    // (200,200) is inside both; the smaller 'small' zone wins.
    expect(hitTestZone(nested, 200, 200)).toBe('small');
  });
});
