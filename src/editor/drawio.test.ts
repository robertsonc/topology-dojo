/**
 * draw.io export (plan Phase 4.6) — one <diagram> per page inside one
 * <mxfile>; nodes as vertices with top-left geometry and shape-mapped
 * styles, links as edges with waypoints, zones as background containers,
 * anchors as endpoint stubs; XML-safe escaping throughout. Documented
 * lossy: flow paths / markers / playback do not survive.
 */
import { describe, expect, it } from 'vitest';
import { documentToDrawioXML } from './drawio.js';
import type { Page, TopologyDocument } from '../pages/model.js';

function doc(): TopologyDocument {
  const page: Page = {
    id: 'p1',
    name: 'Frame "one" & two',
    viewBox: '0 0 1050 700',
    nodes: [
      { id: 'a', type: 'router', x: 200, y: 200, label: 'core<r1>' },
      { id: 'b', type: 'shape:diamond', x: 500, y: 200, label: 'Decision' },
      {
        id: 'img',
        type: 'image',
        x: 800,
        y: 200,
        imageHref: 'https://cdn.example/rack.png',
        imageW: 120,
        imageH: 80,
      },
    ],
    links: [
      {
        id: 'ab',
        type: 'tunnel',
        from: 'a',
        to: 'b',
        label: 'IPsec',
        waypoints: [{ x: 350, y: 120 }],
      },
      { id: 'bx', type: 'line', from: 'b', to: 'x1' },
    ],
    anchors: [{ id: 'x1', x: 500, y: 400 }],
    zones: [{ id: 'z1', label: 'DC', nodes: ['a', 'b'] }],
    flowPaths: [],
    policyMarkers: [],
  } as unknown as Page;
  return {
    title: 'T',
    customNodes: [],
    pages: [page, { ...page, id: 'p2', name: 'Frame 2' }],
  } as unknown as TopologyDocument;
}

describe('documentToDrawioXML', () => {
  const xml = documentToDrawioXML(doc());

  it('emits one diagram per page inside one mxfile', () => {
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml.match(/<diagram /g)).toHaveLength(2);
    expect(xml).toContain('pageWidth="1050"');
  });

  it('escapes labels and page names for XML', () => {
    expect(xml).toContain('name="Frame &quot;one&quot; &amp; two"');
    expect(xml).toContain('value="core&lt;r1&gt;"');
    expect(xml).not.toContain('core<r1>');
  });

  it('nodes are vertices with top-left geometry', () => {
    // router: nodeHalf 18×18 → 40×36 min-clamped box at (200-20, 200-18).
    const m =
      /<mxCell id="a"[^>]*vertex="1"[^>]*>\s*<mxGeometry x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"/.exec(
        xml,
      );
    expect(m).not.toBeNull();
    expect(Number(m![1]) + Number(m![3]) / 2).toBe(200); // centre x preserved
    expect(Number(m![2]) + Number(m![4]) / 2).toBe(200); // centre y preserved
  });

  it('maps shape and image styles', () => {
    expect(xml).toContain('rhombus;'); // shape:diamond
    expect(xml).toContain(
      'shape=image;imageAspect=1;image=https://cdn.example/rack.png',
    );
  });

  it('links become edges with waypoints, tunnels dashed', () => {
    expect(xml).toContain('edge="1" parent="1" source="a" target="b"');
    expect(xml).toContain('<mxPoint x="350" y="120"/>');
    const ab = /<mxCell id="ab"[^>]*style="([^"]*)"/.exec(xml)!;
    expect(ab[1]).toContain('dashed=1');
    // Anchor endpoint survives as a stub vertex the edge can reference.
    expect(xml).toContain('<mxCell id="x1"');
    expect(xml).toContain('source="b" target="x1"');
  });

  it('zones become background containers with their label', () => {
    const z = /<mxCell id="z1" value="DC" style="([^"]*)"/.exec(xml)!;
    expect(z[1]).toContain('dashed=1');
    expect(xml.indexOf('id="z1"')).toBeLessThan(xml.indexOf('id="a"')); // behind
  });
});
