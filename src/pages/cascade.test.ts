import { describe, expect, it } from 'vitest';
import { cascadeEndpointRemoval } from './cascade.js';
import { blankPage, pageHasContent, type Page } from './model.js';

function page(): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 1000 700',
    nodes: [
      { id: 'a', type: 'ec', x: 0, y: 0 },
      { id: 'b', type: 'ec', x: 100, y: 0 },
      { id: 'c', type: 'ec', x: 200, y: 0 },
    ],
    links: [
      { id: 'ab', type: 'line', from: 'a', to: 'b' },
      { id: 'bc', type: 'line', from: 'b', to: 'c' },
    ],
    anchors: [{ id: 'an1', x: 50, y: 50 }],
    zones: [{ id: 'z1', nodes: ['a', 'b', 'c'] }],
    flowPaths: [
      {
        id: 'f1',
        waypoints: ['a', 'b', 'c'],
        hops: [
          { ref: 'b', linkId: 'ab' },
          { ref: 'c', linkId: 'bc' },
        ],
      },
      { id: 'f2', waypoints: ['b', 'an1'] },
    ],
    policyMarkers: [
      { id: 'm1', nodeId: 'a', type: 'inspect', flowPathId: 'f2' },
      { id: 'm2', nodeId: 'b', type: 'encrypt' },
    ],
  };
}

describe('cascadeEndpointRemoval', () => {
  it('is a no-op for an empty removal set', () => {
    const p = page();
    const before = structuredClone(p);
    const out = cascadeEndpointRemoval(p, new Set());
    expect(p).toEqual(before);
    expect(out.droppedFlowPathIds).toEqual([]);
  });

  it('cascades a removed node through every dependent collection', () => {
    const p = page();
    p.nodes = p.nodes.filter((n) => n.id !== 'b');
    const out = cascadeEndpointRemoval(p, new Set(['b']));

    expect(p.links).toEqual([]);
    expect(p.zones[0]!.nodes).toEqual(['a', 'c']);
    // f1 keeps 2 waypoints; f2 falls under 2 (it was touched) and is dropped.
    expect(p.flowPaths.map((f) => f.id)).toEqual(['f1']);
    expect(p.flowPaths[0]!.waypoints).toEqual(['a', 'c']);
    // The hop arriving at b is gone; the survivor loses its removed linkId.
    expect(p.flowPaths[0]!.hops).toEqual([{ ref: 'c' }]);
    // Marker on the removed node is dropped; the marker whose flow path was
    // dropped loses the pointer only.
    expect(p.policyMarkers).toEqual([
      { id: 'm1', nodeId: 'a', type: 'inspect' },
    ]);
    expect(out).toMatchObject({
      links: 2,
      policyMarkers: 1,
      flowPaths: 1,
      zoneMemberships: 1,
      waypoints: 2,
      hops: 1,
      droppedFlowPathIds: ['f2'],
    });
  });

  it('cascades a removed anchor (waypoint + link endpoint)', () => {
    const p = page();
    p.anchors = [];
    cascadeEndpointRemoval(p, new Set(['an1']));
    // f2 was b→an1; touched and left with one waypoint → dropped.
    expect(p.flowPaths.map((f) => f.id)).toEqual(['f1']);
    expect(p.policyMarkers[0]!.flowPathId).toBeUndefined();
    expect(p.links.map((l) => l.id)).toEqual(['ab', 'bc']);
  });

  it('leaves untouched flow paths alone (no drop without a removed waypoint)', () => {
    const p = page();
    p.flowPaths[1]!.waypoints = ['x', 'y']; // already dangling, but untouched
    cascadeEndpointRemoval(p, new Set(['c']));
    expect(p.flowPaths.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(p.flowPaths[1]!.waypoints).toEqual(['x', 'y']);
  });

  it('deletes an emptied hops array outright', () => {
    const p = page();
    p.flowPaths[0]!.waypoints = ['a', 'b', 'c', 'an1'];
    p.flowPaths[0]!.hops = [{ ref: 'b' }];
    cascadeEndpointRemoval(p, new Set(['b']));
    expect(p.flowPaths[0]!.waypoints).toEqual(['a', 'c', 'an1']);
    expect('hops' in p.flowPaths[0]!).toBe(false);
  });
});

describe('pageHasContent (frame-delete confirmation gate)', () => {
  it('a blank page has no content', () => {
    expect(pageHasContent(blankPage('F1'))).toBe(false);
  });

  it('counts every element collection, not just nodes/links', () => {
    const patches: Partial<Page>[] = [
      { nodes: [{ id: 'n', type: 'ec', x: 0, y: 0 }] },
      { links: [{ id: 'l', type: 'line', from: 'a', to: 'b' }] },
      { anchors: [{ id: 'a', x: 0, y: 0 }] },
      { zones: [{ id: 'z', nodes: [] }] },
      { flowPaths: [{ id: 'f', waypoints: ['a', 'b'] }] },
      { policyMarkers: [{ id: 'm', nodeId: 'a', type: 'inspect' }] },
    ];
    for (const patch of patches) {
      expect(pageHasContent({ ...blankPage('F'), ...patch })).toBe(true);
    }
  });

  it('counts page-level storytelling (caption / emphasis)', () => {
    expect(pageHasContent({ ...blankPage('F'), caption: 'A step' })).toBe(true);
    expect(pageHasContent({ ...blankPage('F'), caption: '   ' })).toBe(false);
    expect(pageHasContent({ ...blankPage('F'), emphasis: ['n1'] })).toBe(true);
    expect(pageHasContent({ ...blankPage('F'), emphasis: [] })).toBe(false);
  });
});
