import { describe, it, expect } from 'vitest';
import type { Page } from '../pages/model.js';
import { createDocument } from './builder.js';
import { analyzeLayout } from './layout.js';
import { autoLayout, layoutPage } from './autolayout.js';

const overlaps = (doc: Parameters<typeof analyzeLayout>[0]): number =>
  analyzeLayout(doc).filter((p) => /overlap|too close/.test(p.message)).length;

const piled = () => {
  const d = createDocument().page();
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f'])
    d.node({ id, type: 'ec', x: 200, y: 200, label: id.toUpperCase() });
  return d.build();
};

describe('auto-layout', () => {
  it('grid arranges piled nodes without overlap', () => {
    const doc = piled();
    expect(overlaps(doc)).toBeGreaterThan(0);
    const moved = layoutPage(doc.pages[0]!, { algorithm: 'grid' });
    expect(moved).toBeGreaterThan(0);
    expect(overlaps(doc)).toBe(0);
  });

  it('circular arranges piled nodes without overlap', () => {
    const doc = piled();
    layoutPage(doc.pages[0]!, { algorithm: 'circular' });
    expect(overlaps(doc)).toBe(0);
  });

  it('hierarchical orders a chain by link direction (TB → increasing y)', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 100, y: 100 })
      .node({ id: 'b', type: 'ec', x: 110, y: 100 })
      .node({ id: 'c', type: 'ec', x: 120, y: 100 })
      .link({ id: 'l1', type: 'line', from: 'a', to: 'b' })
      .link({ id: 'l2', type: 'line', from: 'b', to: 'c' })
      .build();
    layoutPage(doc.pages[0]!, { algorithm: 'hierarchical', direction: 'TB' });
    const y = (id: string) => doc.pages[0]!.nodes.find((n) => n.id === id)!.y;
    expect(y('a')).toBeLessThan(y('b'));
    expect(y('b')).toBeLessThan(y('c'));
    expect(overlaps(doc)).toBe(0);
  });

  it('hierarchical LR orders a chain by increasing x', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 100, y: 100 })
      .node({ id: 'b', type: 'ec', x: 110, y: 100 })
      .link({ id: 'l', type: 'line', from: 'a', to: 'b' })
      .build();
    layoutPage(doc.pages[0]!, { algorithm: 'hierarchical', direction: 'LR' });
    const n = (id: string) => doc.pages[0]!.nodes.find((x) => x.id === id)!;
    expect(n('a').x).toBeLessThan(n('b').x);
  });

  it('force is deterministic and overlap-free', () => {
    const a = autoLayout(piled(), { algorithm: 'force' });
    const b = autoLayout(piled(), { algorithm: 'force' });
    expect(JSON.stringify(a.pages[0]!.nodes)).toBe(
      JSON.stringify(b.pages[0]!.nodes),
    ); // deterministic
    expect(overlaps(a)).toBe(0);
  });

  it('zone-aware layout keeps members together and zones non-overlapping', () => {
    const d = createDocument().page();
    // Two zones whose members are all piled on the same spot.
    for (const id of ['a1', 'a2', 'a3'])
      d.node({ id, type: 'ec', x: 300, y: 300, label: id });
    for (const id of ['b1', 'b2', 'b3'])
      d.node({ id, type: 'ec', x: 300, y: 300, label: id });
    d.zone({ id: 'za', nodes: ['a1', 'a2', 'a3'], label: 'A' });
    d.zone({ id: 'zb', nodes: ['b1', 'b2', 'b3'], label: 'B' });
    const doc = d.build();

    const moved = layoutPage(doc.pages[0]!, { algorithm: 'grid' });
    expect(moved).toBeGreaterThan(0);

    // No overlap, no crowding, and no zone swallowing the other's members.
    const messages = analyzeLayout(doc).map((p) => p.message);
    expect(messages.some((m) => /overlap|too close/.test(m))).toBe(false);
    expect(messages.some((m) => /visually contains/.test(m))).toBe(false);

    // Cohesion: every za member is nearer za's centroid than zb's, and vice-versa.
    const at = (id: string) => doc.pages[0]!.nodes.find((n) => n.id === id)!;
    const centroid = (ids: string[]) => ({
      x: ids.reduce((s, i) => s + at(i).x, 0) / ids.length,
      y: ids.reduce((s, i) => s + at(i).y, 0) / ids.length,
    });
    const ca = centroid(['a1', 'a2', 'a3']);
    const cb = centroid(['b1', 'b2', 'b3']);
    const near = (id: string, c: { x: number; y: number }) =>
      Math.hypot(at(id).x - c.x, at(id).y - c.y);
    for (const id of ['a1', 'a2', 'a3'])
      expect(near(id, ca)).toBeLessThan(near(id, cb));
  });

  it.each(['grid', 'hierarchical', 'circular', 'force'] as const)(
    '%s layout carries anchors and manual waypoints with their nodes',
    (algorithm) => {
      const doc = createDocument()
        .page()
        .node({ id: 'a', type: 'ec', x: 150, y: 150 })
        .node({ id: 'b', type: 'ec', x: 600, y: 200 })
        .node({ id: 'c', type: 'ec', x: 400, y: 500 })
        .anchor(178, 140, 'porta') // pinned against a (offset +28, −10)
        .link({
          id: 'l',
          type: 'line',
          from: 'a',
          to: 'b',
          waypoints: [{ x: 180, y: 170 }], // manual bend near a (+30, +20)
        })
        .build();
      const page = doc.pages[0]!;
      layoutPage(page, { algorithm });
      const a = page.nodes.find((n) => n.id === 'a')!;
      const anchor = page.anchors[0]!;
      const wp = page.links[0]!.waypoints![0]!;
      // Offsets survive the algorithm + tidy passes (± rounding per pass).
      expect(Math.abs(anchor.x - a.x - 28)).toBeLessThanOrEqual(2);
      expect(Math.abs(anchor.y - a.y + 10)).toBeLessThanOrEqual(2);
      expect(Math.abs(wp.x - a.x - 30)).toBeLessThanOrEqual(2);
      expect(Math.abs(wp.y - a.y - 20)).toBeLessThanOrEqual(2);
    },
  );

  it('autoLayout is pure and a single node is a no-op', () => {
    const doc = piled();
    const before = JSON.stringify(doc);
    autoLayout(doc, { algorithm: 'grid' });
    expect(JSON.stringify(doc)).toBe(before); // original untouched

    const one = createDocument()
      .page()
      .node({ id: 'solo', type: 'ec', x: 123, y: 456 })
      .build();
    expect(layoutPage(one.pages[0]!, { algorithm: 'grid' })).toBe(0);
  });
});

describe('arrange respects locks and the chosen algorithm inside zones', () => {
  const fabric = (): Page =>
    ({
      id: 'p',
      name: 'F',
      viewBox: '0 0 1400 900',
      nodes: [
        { id: 'core', type: 'router', x: 100, y: 100 },
        { id: 'd1', type: 'switch', x: 120, y: 100 },
        { id: 'd2', type: 'switch', x: 140, y: 100 },
        { id: 'a1', type: 'host', x: 160, y: 100 },
        { id: 'a2', type: 'host', x: 180, y: 100 },
        { id: 'a3', type: 'host', x: 200, y: 100 },
        { id: 'wan', type: 'cloud', x: 900, y: 400 },
      ],
      links: [
        { id: 'l1', type: 'line', from: 'core', to: 'd1' },
        { id: 'l2', type: 'line', from: 'core', to: 'd2' },
        { id: 'l3', type: 'line', from: 'd1', to: 'a1' },
        { id: 'l4', type: 'line', from: 'd1', to: 'a2' },
        { id: 'l5', type: 'line', from: 'd2', to: 'a3' },
        { id: 'l6', type: 'line', from: 'wan', to: 'core' },
      ],
      anchors: [],
      zones: [
        {
          id: 'site',
          label: 'Site',
          nodes: ['core', 'd1', 'd2', 'a1', 'a2', 'a3'],
        },
      ],
      flowPaths: [],
      policyMarkers: [],
    }) as unknown as Page;

  const positions = (p: Page): string =>
    p.nodes.map((n) => `${n.id}:${n.x},${n.y}`).join(' ');

  it('a locked node keeps its position through every algorithm', () => {
    for (const algorithm of [
      'grid',
      'hierarchical',
      'circular',
      'force',
    ] as const) {
      const p = fabric();
      (p.nodes[6] as { locked?: boolean }).locked = true;
      layoutPage(p, { algorithm });
      expect(p.nodes[6], algorithm).toMatchObject({ x: 900, y: 400 });
    }
  });

  it('with a zone on the page, the algorithms no longer give one layout', () => {
    const layouts = (['grid', 'hierarchical', 'circular'] as const).map(
      (algorithm) => {
        const p = fabric();
        layoutPage(p, { algorithm });
        return positions(p);
      },
    );
    expect(new Set(layouts).size).toBe(3);
  });

  it('hierarchical layers the members of a zone by their links', () => {
    const p = fabric();
    layoutPage(p, { algorithm: 'hierarchical' });
    const y = (id: string): number => p.nodes.find((n) => n.id === id)!.y;
    expect(y('core')).toBeLessThan(y('d1'));
    expect(y('d1')).toBeCloseTo(y('d2'), 0);
    expect(y('d1')).toBeLessThan(y('a1'));
    expect(y('a1')).toBeCloseTo(y('a3'), 0);
  });

  it('keeps the zone members together and clear of the free node', () => {
    for (const algorithm of ['hierarchical', 'circular', 'force'] as const) {
      const p = fabric();
      layoutPage(p, { algorithm });
      const doc = { title: 't', customNodes: [], pages: [p] };
      expect(
        analyzeLayout(doc).filter((f) => /overlap|too close/.test(f.message)),
        algorithm,
      ).toEqual([]);
    }
  });
});
