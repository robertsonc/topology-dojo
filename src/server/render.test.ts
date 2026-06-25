import { describe, it, expect } from 'vitest';
import { renderDocumentToSVG } from './render.js';
import { createDocument } from '../api/builder.js';
import { defaultSpec } from '../nodes/spec.js';

describe('headless render (Node, no browser)', () => {
  it('renders a document to a standalone SVG string', () => {
    const doc = createDocument('Net')
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 200, label: 'EC-Branch' })
      .node({ id: 'b', type: 'cloud', x: 600, y: 200, label: 'Internet' })
      .link({ id: 'l', type: 'tunnel', from: 'a', to: 'b' })
      .build();
    const svg = renderDocumentToSVG(doc);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 1050 700"');
    expect(svg).toContain('EC-Branch'); // built-in node label rendered
    expect(svg).toContain('Internet');
    expect(svg).toContain('<defs'); // engine filter defs present
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('renders custom node types headlessly', () => {
    const doc = createDocument()
      .defineNodeType({
        ...defaultSpec(),
        typeName: 'sensor',
        colorStroke: '#65aef9',
      })
      .page()
      .node({ id: 'n', type: 'sensor', x: 100, y: 100, label: 'S' })
      .build();
    const svg = renderDocumentToSVG(doc);
    expect(svg).toContain('#65aef9'); // custom interpreter ran in Node
  });

  it('renders the annotation layer (zone, flow path, policy marker)', () => {
    const doc = createDocument('Net')
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 200 })
      .node({ id: 'b', type: 'cloud', x: 600, y: 200 })
      .zone({ id: 'z', label: 'Edge', nodes: ['a', 'b'], color: '#65aef9' })
      .flowPath({
        id: 'f',
        label: 'App',
        waypoints: ['a', 'b'],
        color: '#01a982',
      })
      .policyMarker({ id: 'm', nodeId: 'a', type: 'inspect', color: '#fc6161' })
      .build();
    const svg = renderDocumentToSVG(doc);
    expect(svg).toContain('tds-zone'); // zone rectangle group
    expect(svg).toContain('data-zone-id="z"');
    expect(svg).toContain('data-tds-flowpath="f"'); // animated overlay route
    expect(svg).toContain('data-tds-marker="m"'); // enforcement badge
  });

  it('auto-routes an orthogonal link as an L-path without waypoints', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 200 })
      .node({ id: 'b', type: 'ec', x: 600, y: 400 })
      .link({
        id: 'l',
        type: 'line',
        from: 'a',
        to: 'b',
        lineStyle: 'orthogonal',
      })
      .build();
    const svg = renderDocumentToSVG(doc);
    // L-route turns at a right angle. With A.4 boundary attachment the endpoints
    // sit on the node edges (a→(232,216), b→(568,384)), so the corner is at
    // (to_edge.x, from_edge.y) = (568,216); a straight diagonal never visits it.
    expect(svg).toContain('L568,216 L568,384');
  });

  it('orthogonal auto-route detours around a node between the endpoints (A.7)', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 300 })
      .node({ id: 'b', type: 'ec', x: 700, y: 300 })
      .node({ id: 'c', type: 'ec', x: 450, y: 300 }) // squarely between a and b
      .link({
        id: 'l',
        type: 'line',
        from: 'a',
        to: 'b',
        lineStyle: 'orthogonal',
      })
      .build();
    const svg = renderDocumentToSVG(doc);
    // The naive elbow runs straight along y=300 through c; the router instead
    // detours to a clear lane (y=263, above c's padded box) with right angles.
    const path = svg.match(/d="(M232,300[^"]*)"/);
    expect(path).toBeTruthy();
    const d = path![1]!;
    // It leaves the y=300 row to clear c, and every turn is axis-aligned (no
    // diagonal L would share an x or y with its predecessor at each corner).
    expect(d).toContain('L232,263');
    expect(d).toContain('L668,263');
    expect(/[QC]/.test(d)).toBe(false); // right angles only, no curves
  });

  it('renders link metadata on the wire only when showMeta is set (B.2)', () => {
    const build = (meta: Record<string, unknown>) =>
      renderDocumentToSVG(
        createDocument()
          .page()
          .node({ id: 'a', type: 'ec', x: 200, y: 300 })
          .node({ id: 'b', type: 'ec', x: 700, y: 300 })
          .link({ id: 'l', type: 'line', from: 'a', to: 'b', ...meta })
          .build(),
      );
    const fields = {
      vlan: '10',
      subnet: '10.0.0.0/24',
      bandwidth: '1G',
      transport: 'MPLS',
    };
    // Metadata present but not toggled on → nothing on the wire.
    const off = build(fields);
    expect(off).not.toContain('tds-wire-meta');
    // Toggled on → a compact chip listing the populated fields.
    const on = build({ ...fields, showMeta: true });
    expect(on).toContain('tds-wire-meta');
    expect(on).toContain('VLAN 10 · 10.0.0.0/24 · 1G · MPLS');
    // showMeta on but no fields populated → still nothing (non-destructive).
    expect(build({ showMeta: true })).not.toContain('tds-wire-meta');
  });

  it('fans out parallel links between the same node pair', () => {
    const pair = (ids: string[]) => {
      const d = createDocument()
        .page()
        .node({ id: 'a', type: 'ec', x: 200, y: 200 })
        .node({ id: 'b', type: 'ec', x: 600, y: 200 });
      for (const id of ids) d.link({ id, type: 'line', from: 'a', to: 'b' });
      return renderDocumentToSVG(d.build());
    };
    const one = pair(['solo']);
    const two = pair(['vpnA', 'vpnB']);
    // A single link stays on the shared axis (y=200); two parallel links are
    // offset off it so they don't draw coincident.
    expect(two).not.toBe(one);
    expect(two).toMatch(/204\.5|195\.5/);
  });

  it('renders stock cloud-native types (e.g. a Transit Gateway) headlessly', () => {
    const doc = createDocument('AWS hub')
      .page()
      .node({ id: 'tgw', type: 'tgw', x: 300, y: 200, label: 'us-east-1 TGW' })
      .build();
    const svg = renderDocumentToSVG(doc);
    expect(svg).toContain('TGW'); // the stock glyph's badge text
    expect(svg).toContain('us-east-1 TGW'); // the node label
  });

  it('calm mode suppresses animation in the output', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 200 })
      .node({ id: 'b', type: 'cloud', x: 600, y: 200 })
      .flowPath({ id: 'f', waypoints: ['a', 'b'], animation: 'particles' })
      .build();
    const lively = renderDocumentToSVG(doc, 0);
    const calm = renderDocumentToSVG(doc, 0, { calm: true });
    expect(lively).toContain('<animateMotion'); // particles animate by default
    expect(calm).not.toContain('<animateMotion'); // calm = static frame
    expect(calm).toContain('data-tds-flowpath="f"'); // route still drawn
  });

  it('renders SASE marker glyphs (host OS) via the per-marker icon path', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'h', type: 'host', x: 200, y: 200, label: 'Laptop' })
      .node({ id: 'g', type: 'ec', x: 400, y: 200 })
      .policyMarker({ id: 'm1', nodeId: 'h', type: 'windows' })
      .policyMarker({ id: 'm2', nodeId: 'g', type: 'inspect', icon: '★' })
      .build();
    const svg = renderDocumentToSVG(doc);
    expect(svg).toContain('🪟'); // host-OS glyph from the type default
    expect(svg).toContain('★'); // explicit per-marker icon override
  });

  it('honors per-link flow controls (count / speed / reverse)', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 150, y: 200 })
      .node({ id: 'b', type: 'cloud', x: 650, y: 200 })
      .link({
        id: 't',
        type: 'tunnel',
        from: 'a',
        to: 'b',
        flowParticles: 6,
        flowSpeed: 1.2,
        reverseFlow: true,
      })
      .build();
    const svg = renderDocumentToSVG(doc);
    const particles = (svg.match(/<animateMotion/g) ?? []).length;
    expect(particles).toBe(6); // the requested particle count
    expect(svg).toContain('keyPoints="1;0"'); // reversed direction
    expect(svg).toContain('dur="1.20s"'); // first particle at the requested speed
  });

  it('honors common node fields (opacity / label color / label offset)', () => {
    const doc = createDocument('Net')
      .page()
      .node({
        id: 'a',
        type: 'ec',
        x: 200,
        y: 200,
        label: 'Dimmed',
        opacity: 0.5,
        labelColor: '#fc6161',
        labelOffset: 40,
      })
      .build();
    const svg = renderDocumentToSVG(doc);
    expect(/opacity:0?\.5\b/.test(svg)).toBe(true); // node opacity applied
    expect(svg).toContain('#fc6161'); // label colour
    expect(svg).toContain('y="240"'); // label offset (y = 200 + 40)
  });

  it('throws on an out-of-range page index', () => {
    const doc = createDocument().page().build();
    expect(() => renderDocumentToSVG(doc, 5)).toThrow();
  });

  it('stacks declared layers bottom → top (underlay paints before overlay)', () => {
    const doc = createDocument('Fabric')
      .layer({ id: 'under', kind: 'underlay' })
      .layer({ id: 'over', kind: 'overlay' })
      .page()
      .node({ id: 'a', type: 'ec', x: 150, y: 200 })
      .node({ id: 'b', type: 'ec', x: 650, y: 200 })
      // Authored overlay-first: layer rank, not authoring order, must win.
      .link({ id: 'tun', type: 'tunnel', from: 'a', to: 'b', layer: 'over' })
      .link({ id: 'wan', type: 'line', from: 'a', to: 'b', layer: 'under' })
      .build();
    const svg = renderDocumentToSVG(doc);
    const wanAt = svg.indexOf('data-tds-link="wan"');
    const tunAt = svg.indexOf('data-tds-link="tun"');
    expect(wanAt).toBeGreaterThan(-1);
    expect(tunAt).toBeGreaterThan(-1);
    expect(wanAt).toBeLessThan(tunAt); // underlay below, overlay on top
  });

  it('visibleLayers filters the output; base elements always draw', () => {
    const doc = createDocument('Fabric')
      .layer({ id: 'under', kind: 'underlay' })
      .layer({ id: 'over', kind: 'overlay' })
      .page()
      .node({ id: 'a', type: 'ec', x: 150, y: 200, label: 'Site-A' })
      .node({ id: 'b', type: 'ec', x: 650, y: 200, label: 'Site-B' })
      .link({ id: 'wan', type: 'line', from: 'a', to: 'b', layer: 'under' })
      .link({ id: 'tun', type: 'tunnel', from: 'a', to: 'b', layer: 'over' })
      .build();
    const underOnly = renderDocumentToSVG(doc, 0, { visibleLayers: ['under'] });
    expect(underOnly).toContain('data-tds-link="wan"');
    expect(underOnly).not.toContain('data-tds-link="tun"');
    expect(underOnly).toContain('Site-A'); // untagged base nodes still draw
  });

  it('honors a layer’s defaultVisible:false when no visible set is given', () => {
    const doc = createDocument('Fabric')
      .layer({ id: 'pol', kind: 'policy', defaultVisible: false })
      .page()
      .node({ id: 'a', type: 'ec', x: 150, y: 200 })
      .node({ id: 'b', type: 'ec', x: 650, y: 200 })
      .link({ id: 'tun', type: 'tunnel', from: 'a', to: 'b', layer: 'pol' })
      .build();
    expect(renderDocumentToSVG(doc)).not.toContain('data-tds-link="tun"');
    expect(renderDocumentToSVG(doc, 0, { visibleLayers: ['pol'] })).toContain(
      'data-tds-link="tun"',
    );
  });
});
