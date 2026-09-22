import { describe, it, expect } from 'vitest';
import {
  hitTestAnchor,
  hitTestLink,
  hitTestNode,
  hitTestNodeLabel,
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

describe('link hit-testing follows the drawn route', () => {
  const pg = page({
    nodes: [
      { id: 'a', type: 'router', x: 100, y: 100 },
      { id: 'b', type: 'router', x: 300, y: 300 },
    ],
    links: [{ id: 'ab', type: 'line', from: 'a', to: 'b' }],
  });
  // An orthogonal L-route: right along y=100, then down x=300.
  const ell = [
    [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ],
  ];

  it('without a rendered shape, only the centre-to-centre line hits', () => {
    expect(hitTestLink(pg, 200, 200)).toBe('ab'); // on the diagonal
    expect(hitTestLink(pg, 300, 150)).toBeNull(); // on the L's leg
  });

  it('with the rendered shape, the drawn route hits and the old diagonal misses', () => {
    const shapeOf = (id: string) => (id === 'ab' ? ell : undefined);
    expect(hitTestLink(pg, 300, 150, 7, shapeOf)).toBe('ab');
    expect(hitTestLink(pg, 200, 104, 7, shapeOf)).toBe('ab');
    expect(hitTestLink(pg, 200, 200, 7, shapeOf)).toBeNull();
  });

  it('picks the nearest link, not merely the topmost within tolerance', () => {
    const two = page({
      nodes: [
        { id: 'a', type: 'router', x: 0, y: 0 },
        { id: 'b', type: 'router', x: 200, y: 0 },
        { id: 'c', type: 'router', x: 0, y: 10 },
        { id: 'd', type: 'router', x: 200, y: 10 },
      ],
      links: [
        { id: 'near', type: 'line', from: 'a', to: 'b' },
        { id: 'top', type: 'line', from: 'c', to: 'd' },
      ],
    });
    expect(hitTestLink(two, 100, 3, 8)).toBe('near');
    expect(hitTestLink(two, 100, 7, 8)).toBe('top');
  });
});

describe('node caption hit-testing', () => {
  const pg = page({
    nodes: [{ id: 'sw', type: 'switch', x: 100, y: 100, label: 'Leaf-01' }],
  });

  it('a click on the label under a thin glyph resolves to the node', () => {
    expect(hitTestNode(pg, 100, 122)).toBeNull(); // below the ±8 glyph
    expect(hitTestNodeLabel(pg, 100, 122)).toBe('sw'); // default 's' caption
    expect(hitTestNodeLabel(pg, 100, 160)).toBeNull();
  });

  it('follows the label placement', () => {
    const east = page({
      nodes: [
        {
          id: 'r',
          type: 'router',
          x: 100,
          y: 100,
          label: 'R1',
          labelPlacement: 'e',
        },
      ],
    });
    expect(hitTestNodeLabel(east, 130, 102)).toBe('r');
    expect(hitTestNodeLabel(east, 100, 124)).toBeNull();
  });
});

describe('nested zone bounds', () => {
  it('a parent zone frames its child zones members (matches the engine)', () => {
    const pg = page({
      nodes: [
        { id: 'n1', type: 'router', x: 100, y: 100 },
        { id: 'n2', type: 'router', x: 500, y: 100 },
      ],
      zones: [
        { id: 'outer', nodes: ['n1'] },
        { id: 'inner', nodes: ['n2'], parentZone: 'outer' },
      ],
    });
    const b = zoneBounds(pg, pg.zones[0]!)!;
    expect(b.x + b.w).toBe(500 + 40 + 40);
    // Smallest wins inside the child; the parent owns the rest.
    expect(hitTestZone(pg, 500, 60)).toBe('inner');
    expect(hitTestZone(pg, 300, 100)).toBe('outer');
  });
});
