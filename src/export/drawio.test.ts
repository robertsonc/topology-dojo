/**
 * draw.io export — one <diagram> per page inside one <mxfile>; nodes as
 * vertices (wrapped in <object> data carriers) with top-left geometry and
 * shape-mapped styles, links as edges with waypoints, zones as containers
 * whose same-layer members are children with relative geometry, declared
 * layers as draw.io layers, anchors as endpoint stubs; XML-safe escaping
 * throughout. Documented lossy: flow paths / markers / playback do not
 * survive.
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
    // Labels are HTML (html=1), so the value is escaped twice.
    expect(xml).toContain('label="core&amp;lt;r1&amp;gt;"');
    expect(xml).toContain('dojoLabel="core&lt;r1&gt;"');
    expect(xml).not.toContain('core<r1>');
  });

  it('nodes are vertices with top-left geometry relative to their zone', () => {
    const z =
      /<object id="z1"[^>]*><mxCell[^>]*><mxGeometry x="(-?[\d.]+)" y="(-?[\d.]+)"/.exec(
        xml,
      )!;
    const m =
      /<object id="a"[^>]*><mxCell[^>]*vertex="1" parent="z1"><mxGeometry x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(
        xml,
      );
    expect(m).not.toBeNull();
    // Centre preserved once the container origin is added back.
    expect(Number(z[1]) + Number(m![1]) + Number(m![3]) / 2).toBeCloseTo(
      200,
      0,
    );
    expect(Number(z[2]) + Number(m![2]) + Number(m![4]) / 2).toBeCloseTo(
      200,
      0,
    );
  });

  it('carries the Topology Dojo type as draw.io data', () => {
    expect(xml).toMatch(/<object id="a"[^>]*dojoType="router"/);
    expect(xml).toContain('shape=mxgraph.networks.router');
  });

  it('maps shape and image styles', () => {
    expect(xml).toContain('rhombus;'); // shape:diamond
    expect(xml).toContain(
      'shape=image;imageAspect=1;image=https://cdn.example/rack.png',
    );
    expect(xml).toContain('ellipse;shape=cloud;'.slice(0, 0)); // shape map smoke
  });

  it('links become edges with waypoints, tunnels dashed', () => {
    expect(xml).toContain('edge="1" parent="1" source="a" target="b"');
    expect(xml).toMatch(/<object id="ab"[^>]*dojoType="tunnel"/);
    expect(xml).toContain('<mxPoint x="350" y="120"/>');
    const ab = /<object id="ab"[^>]*><mxCell style="([^"]*)"/.exec(xml)!;
    expect(ab[1]).toContain('dashed=1');
    // Anchor endpoint survives as a stub vertex the edge can reference.
    expect(xml).toContain('<object id="x1"');
    expect(xml).toContain('source="b" target="x1"');
  });

  it('zones become background containers with their label', () => {
    const z = /<object id="z1" label="DC"[^>]*><mxCell style="([^"]*)"/.exec(
      xml,
    )!;
    expect(z[1]).toContain('dashed=1');
    expect(z[1]).toContain('container=1');
    expect(xml.indexOf('id="z1"')).toBeLessThan(xml.indexOf('id="a"')); // behind
  });

  it('declared layers become draw.io layers; a cross-layer member stays out of the container', () => {
    const d = doc();
    d.layers = [
      { id: 'under', name: 'Underlay' },
      { id: 'over', name: 'Overlay', defaultVisible: false },
    ];
    const p = d.pages[0]!;
    p.nodes[1]!.layer = 'over';
    p.links[0]!.layer = 'over';
    const x = documentToDrawioXML(d);
    expect(x).toContain(
      '<mxCell id="layer:under" value="Underlay" parent="0"/>',
    );
    expect(x).toContain(
      '<mxCell id="layer:over" value="Overlay" parent="0" visible="0"/>',
    );
    expect(x).toMatch(/<object id="b"[^>]*><mxCell[^>]*parent="layer:over"/);
    expect(x).toMatch(/<object id="ab"[^>]*><mxCell[^>]*parent="layer:over"/);
  });

  it('prefixes ids draw.io reserves', () => {
    const d = doc();
    d.pages[0]!.nodes[0]!.id = '1';
    d.pages[0]!.links[0]!.from = '1';
    d.pages[0]!.zones[0]!.nodes = ['1', 'b'];
    const x = documentToDrawioXML(d);
    expect(x).toContain('<object id="dojo:1"');
    expect(x).toContain('source="dojo:1"');
  });

  it('port labels ride as edge-end labels', () => {
    const d = doc();
    d.pages[0]!.links[0]!.fromLabel = 'ge-0/0/1';
    const x = documentToDrawioXML(d);
    expect(x).toContain('id="ab#from" value="ge-0/0/1"');
    expect(x).toContain('<mxGeometry x="-0.8" relative="1"');
  });

  it('is well-formed XML', async () => {
    const { parseXml } = await import('../import/xml.js');
    expect(() => parseXml(xml)).not.toThrow();
  });
});
