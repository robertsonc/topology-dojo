import { describe, it, expect } from 'vitest';
import { serializeDoc, parseDoc } from './persist.js';
import { sampleDocument, blankPage } from './model.js';

describe('persist', () => {
  it('round-trips a document through serialize → parse', () => {
    const doc = sampleDocument();
    const back = parseDoc(serializeDoc(doc));
    expect(back).not.toBeNull();
    expect(back!.pages).toHaveLength(doc.pages.length);
    expect(back!.pages[0]!.nodes).toHaveLength(doc.pages[0]!.nodes.length);
    expect(back!.pages[0]!.name).toBe(doc.pages[0]!.name);
  });

  it('rejects non-document input', () => {
    expect(parseDoc('not json')).toBeNull();
    expect(parseDoc('{}')).toBeNull();
    expect(parseDoc('{"pages":[]}')).toBeNull();
    expect(parseDoc(null)).toBeNull();
    expect(parseDoc(42)).toBeNull();
  });

  it('fills in missing fields defensively (corrupt/hand-edited)', () => {
    const doc = parseDoc(
      '{"pages":[{"nodes":[{"id":"a","type":"ec","x":1,"y":2}]}]}',
    );
    expect(doc).not.toBeNull();
    const page = doc!.pages[0]!;
    expect(page.id).toBeTypeOf('string');
    expect(page.name).toBeTypeOf('string');
    expect(page.viewBox).toBe('0 0 1050 700');
    expect(page.links).toEqual([]);
    expect(page.anchors).toEqual([]);
    expect(page.nodes).toHaveLength(1);
    expect(page.zones).toEqual([]);
    expect(page.flowPaths).toEqual([]);
    expect(page.policyMarkers).toEqual([]);
  });

  it('round-trips the annotation layer (zones / flow paths / markers)', () => {
    const doc = sampleDocument();
    const page0 = doc.pages[0]!;
    const back = parseDoc(serializeDoc(doc));
    const back0 = back!.pages[0]!;
    expect(back0.zones).toHaveLength(page0.zones.length);
    expect(back0.zones[0]!.nodes).toEqual(page0.zones[0]!.nodes);
    expect(back0.flowPaths[0]!.waypoints).toEqual(
      page0.flowPaths[0]!.waypoints,
    );
    expect(back0.policyMarkers[0]!.type).toBe(page0.policyMarkers[0]!.type);
  });

  it('round-trips node metadata', () => {
    const back = parseDoc(
      JSON.stringify({
        pages: [
          {
            nodes: [
              {
                id: 'a',
                type: 'ec',
                x: 1,
                y: 2,
                meta: { serial: 'SN1', ports: 48 },
              },
            ],
          },
        ],
      }),
    );
    expect(back!.pages[0]!.nodes[0]!.meta).toMatchObject({
      serial: 'SN1',
      ports: 48,
    });
  });

  it('round-trips reusable stencils (C.3) and drops malformed ones', () => {
    const doc = parseDoc({
      title: 'X',
      pages: [blankPage('F1')],
      stencils: [
        {
          id: 'st1',
          name: 'Branch',
          nodes: [{ id: 'a', type: 'ec', x: -100, y: 0 }],
          links: [{ id: 'l', type: 'line', from: 'a', to: 'a' }],
        },
        { id: 'bad', name: 'Empty', nodes: [] }, // dropped: no nodes
        { name: 'NoId', nodes: [{ id: 'z', type: 'ec', x: 0, y: 0 }] }, // dropped: no id
      ],
    });
    expect(doc!.stencils).toHaveLength(1);
    expect(doc!.stencils![0]!.name).toBe('Branch');
    // Survives a full serialize → parse cycle unchanged.
    const back = parseDoc(serializeDoc(doc!));
    expect(back!.stencils).toHaveLength(1);
    expect(back!.stencils![0]!.nodes[0]!.x).toBe(-100);
    expect(back!.stencils![0]!.links).toHaveLength(1);
  });

  it('omits the stencils key entirely when there are none', () => {
    const doc = sampleDocument();
    expect(JSON.parse(serializeDoc(doc)).stencils).toBeUndefined();
  });

  it('accepts an already-parsed object', () => {
    const doc = parseDoc({ title: 'X', pages: [blankPage('F1')] });
    expect(doc?.title).toBe('X');
    expect(doc?.pages[0]!.name).toBe('F1');
  });
});
