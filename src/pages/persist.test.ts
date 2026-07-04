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

  it('round-trips a brand palette and normalises hex colours (#7)', () => {
    const doc = parseDoc({
      title: 'Branded',
      pages: [blankPage('F1')],
      palette: {
        id: 'custom',
        name: 'Custom',
        accent: '#0A84FF',
        secondary: '#5ac8fa',
        chrome: '#102030',
      },
    });
    expect(doc!.palette).toEqual({
      id: 'custom',
      name: 'Custom',
      accent: '#0a84ff', // lower-cased
      secondary: '#5ac8fa',
      chrome: '#102030',
    });
    // Survives a full serialize → parse cycle.
    const back = parseDoc(serializeDoc(doc!));
    expect(back!.palette!.accent).toBe('#0a84ff');
  });

  it('drops an invalid palette (no valid accent) and invalid colour fields', () => {
    // Bad accent → whole palette dropped.
    const noAccent = parseDoc({
      pages: [blankPage('F1')],
      palette: { secondary: '#65aef9' },
    });
    expect(noAccent!.palette).toBeUndefined();
    // Valid accent, junk secondary → secondary dropped, accent kept.
    const partial = parseDoc({
      pages: [blankPage('F1')],
      palette: { accent: '#01a982', secondary: 'not-a-color' },
    });
    expect(partial!.palette).toEqual({ accent: '#01a982' });
  });

  it('omits the palette key entirely when there is none', () => {
    const doc = sampleDocument();
    expect(JSON.parse(serializeDoc(doc)).palette).toBeUndefined();
  });

  describe('untrusted-input sanitization (stored XSS)', () => {
    it('drops an attribute-breakout colour on import (node/link/zone/flow/marker)', () => {
      const evil = '#000"/><image href=x onerror=alert(1)/><rect fill="';
      const doc = parseDoc({
        pages: [
          {
            nodes: [{ id: 'n', type: 'ec', x: 1, y: 2, color: evil }],
            links: [{ id: 'l', type: 'line', from: 'n', to: 'n', color: evil }],
            zones: [{ id: 'z', label: 'Z', nodes: ['n'], color: evil }],
            flowPaths: [{ id: 'f', waypoints: ['n', 'n'], color: evil }],
            policyMarkers: [
              { id: 'm', nodeId: 'n', type: 'inspect', color: evil },
            ],
          },
        ],
      })!;
      const p = doc.pages[0]!;
      // The unsafe colour is stripped from every element that carried it.
      expect(
        (p.nodes[0] as unknown as Record<string, unknown>).color,
      ).toBeUndefined();
      expect(
        (p.links[0] as unknown as Record<string, unknown>).color,
      ).toBeUndefined();
      expect(
        (p.zones[0] as unknown as Record<string, unknown>).color,
      ).toBeUndefined();
      expect(
        (p.flowPaths[0] as unknown as Record<string, unknown>).color,
      ).toBeUndefined();
      expect(
        (p.policyMarkers[0] as unknown as Record<string, unknown>).color,
      ).toBeUndefined();
      // No serialized form still carries the payload.
      expect(serializeDoc(doc)).not.toContain('onerror');
    });

    it('keeps legitimate colours (hex, rgb/rgba, keyword) unchanged', () => {
      const doc = parseDoc({
        pages: [
          {
            nodes: [
              { id: 'a', type: 'ec', x: 0, y: 0, color: '#01a982' },
              { id: 'b', type: 'ec', x: 0, y: 0, color: 'rgba(1,2,3,.5)' },
              { id: 'c', type: 'ec', x: 0, y: 0, color: 'transparent' },
            ],
          },
        ],
      })!;
      const cols = doc.pages[0]!.nodes.map(
        (n) => (n as Record<string, unknown>).color,
      );
      expect(cols).toEqual(['#01a982', 'rgba(1,2,3,.5)', 'transparent']);
    });

    it('strips markup-unsafe characters from element types', () => {
      const doc = parseDoc({
        pages: [
          {
            nodes: [
              { id: 'n', type: '"><img src=x onerror=alert(1)>', x: 0, y: 0 },
            ],
          },
        ],
      })!;
      const type = String(
        (doc.pages[0]!.nodes[0] as Record<string, unknown>).type,
      );
      // Inert: the letters may survive but no attribute-breakout chars remain.
      expect(type).not.toMatch(/[<>"]/);
      expect(serializeDoc(doc)).not.toMatch(/[<>]/);
    });

    it('sanitizes custom node typeName + colours, dropping specs with no safe name', () => {
      const doc = parseDoc({
        pages: [blankPage('F1')],
        customNodes: [
          {
            typeName: 'x"/><image href=x onerror=alert(1) y="',
            colorStroke: '#65aef9',
            colorFill: 'red"/><script>',
          },
          { typeName: '<<<>>>', colorStroke: '#fff' }, // no safe chars → dropped
        ],
      })!;
      expect(doc.customNodes).toHaveLength(1);
      expect(doc.customNodes[0]!.typeName).not.toMatch(/[<>"]/);
      // Unsafe colorFill fell back to a safe default hex; safe stroke kept.
      expect(doc.customNodes[0]!.colorStroke).toBe('#65aef9');
      expect(doc.customNodes[0]!.colorFill).toMatch(/^#[0-9a-f]{3,8}$/i);
      // Inert: no attribute-breakout characters survive anywhere in the doc.
      expect(serializeDoc(doc)).not.toMatch(/[<>]/);
    });
  });

  it('normalizes a non-array zone.nodes instead of throwing (corrupt/rehydrate)', () => {
    // A null-patched zone membership must not crash the defensive self-heal.
    const doc = parseDoc({
      pages: [
        {
          nodes: [{ id: 'n', type: 'ec', x: 0, y: 0 }],
          zones: [{ id: 'z', label: 'Z', nodes: null }],
        },
      ],
    });
    expect(doc).not.toBeNull();
    expect(doc!.pages[0]!.zones[0]!.nodes).toEqual([]);
  });
});
