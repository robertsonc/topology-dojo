/**
 * draw.io import — plain and compressed diagrams, layers, containers → zones,
 * stencil type inference, edges with waypoints / port labels / free ends, and
 * the round-trip of this app's own `.drawio` export.
 */
import { describe, expect, it } from 'vitest';
import { deflateSync, strToU8 } from 'fflate';
import { convertDrawio, detectDrawio, htmlToText } from './drawio.js';
import { documentToDrawioXML } from '../export/drawio.js';
import { sampleDocument } from '../pages/model.js';
import { classifyOpenedFile } from './open.js';

const PLAIN = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram id="d1" name="Campus">
    <mxGraphModel pageWidth="1100" pageHeight="850">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="L2" value="Overlay" parent="0" visible="0"/>
        <mxCell id="dc" value="Data Center" style="swimlane;startSize=24;strokeColor=#6c8ebf;" vertex="1" parent="1">
          <mxGeometry x="100" y="100" width="400" height="200" as="geometry"/>
        </mxCell>
        <mxCell id="r1" value="Core-1&lt;br&gt;MX204" style="html=1;shape=mxgraph.cisco.routers.router;strokeColor=#ff0000;" vertex="1" parent="dc">
          <mxGeometry x="40" y="60" width="60" height="40" as="geometry"/>
        </mxCell>
        <UserObject id="fw" label="Edge FW" serial="ABC123" link="https://example.com/fw">
          <mxCell style="shape=mxgraph.networks.firewall;" vertex="1" parent="1">
            <mxGeometry x="700" y="120" width="50" height="50" as="geometry"/>
          </mxCell>
        </UserObject>
        <mxCell id="db" value="CMDB" style="shape=cylinder3;" vertex="1" parent="1">
          <mxGeometry x="700" y="400" width="60" height="80" as="geometry"/>
        </mxCell>
        <mxCell id="note" value="hello" style="text;html=1;" vertex="1" parent="L2">
          <mxGeometry x="100" y="500" width="120" height="30" as="geometry"/>
        </mxCell>
        <mxCell id="e1" value="10G" style="edgeStyle=orthogonalEdgeStyle;dashed=1;strokeColor=#00aa00;strokeWidth=3;" edge="1" parent="1" source="r1" target="fw">
          <mxGeometry relative="1" as="geometry">
            <Array as="points"><mxPoint x="400" y="140"/></Array>
          </mxGeometry>
        </mxCell>
        <mxCell id="e1a" value="xe-0/0/1" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="e1">
          <mxGeometry x="-0.8" relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e2" style="endArrow=classic;" edge="1" parent="1" source="fw">
          <mxGeometry relative="1" as="geometry">
            <mxPoint x="900" y="300" as="targetPoint"/>
          </mxGeometry>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

describe('detectDrawio', () => {
  it('recognises mxfile and bare mxGraphModel roots', () => {
    expect(detectDrawio(PLAIN)).toBe(true);
    expect(detectDrawio('<mxGraphModel><root/></mxGraphModel>')).toBe(true);
    expect(detectDrawio('flowchart LR\n a-->b')).toBe(false);
    expect(detectDrawio('<svg></svg>')).toBe(false);
  });

  it('is what the GUI open flow classifies', () => {
    expect(classifyOpenedFile(PLAIN).kind).toBe('drawio');
  });
});

describe('convertDrawio', () => {
  const r = convertDrawio(PLAIN);
  const page = r.document!.pages[0]!;

  it('converts a plain diagram', () => {
    expect(r.ok).toBe(true);
    expect(page.name).toBe('Campus');
    expect(page.nodes.map((n) => n.id).sort()).toEqual([
      'db',
      'fw',
      'note',
      'r1',
    ]);
  });

  it('resolves container-relative geometry to node centres', () => {
    const r1 = page.nodes.find((n) => n.id === 'r1')!;
    expect(r1.x).toBe(100 + 40 + 30);
    expect(r1.y).toBe(100 + 60 + 20);
  });

  it('infers types from stencils and styles', () => {
    const t = Object.fromEntries(page.nodes.map((n) => [n.id, n.type]));
    expect(t).toEqual({
      r1: 'router',
      fw: 'firewall',
      db: 'database',
      note: 'text',
    });
  });

  it('splits HTML labels into label + sublabel', () => {
    const r1 = page.nodes.find((n) => n.id === 'r1')!;
    expect(r1.label).toBe('Core-1');
    expect(r1.sublabel).toBe('MX204');
    expect(r1.color).toBe('#ff0000');
  });

  it('maps object data to metadata and link to href', () => {
    const fw = page.nodes.find((n) => n.id === 'fw')!;
    expect(fw.meta).toEqual({ serial: 'ABC123' });
    expect(fw.href).toBe('https://example.com/fw');
  });

  it('maps containers to zones and extra layers to declared layers', () => {
    expect(page.zones).toEqual([
      expect.objectContaining({
        id: 'dc',
        label: 'Data Center',
        nodes: ['r1'],
        color: '#6c8ebf',
      }),
    ]);
    expect(r.document!.layers).toEqual([
      { id: 'L2', name: 'Overlay', defaultVisible: false },
    ]);
    expect(page.nodes.find((n) => n.id === 'note')!.layer).toBe('L2');
  });

  it('converts edges with routing, style, waypoints and port labels', () => {
    const e1 = page.links.find((l) => l.id === 'e1')!;
    expect(e1).toMatchObject({
      from: 'r1',
      to: 'fw',
      label: '10G',
      fromLabel: 'xe-0/0/1',
      color: '#00aa00',
      strokeWidth: 3,
      dashed: true,
      lineStyle: 'orthogonal',
      waypoints: [{ x: 400, y: 140 }],
    });
  });

  it('turns a dangling edge end into an anchor', () => {
    const e2 = page.links.find((l) => l.id === 'e2')!;
    const a = page.anchors.find((x) => x.id === e2.to)!;
    expect(a).toEqual({ id: e2.to, x: 900, y: 300 });
  });

  it('reads compressed diagrams', () => {
    const model = /<mxGraphModel[\s\S]*<\/mxGraphModel>/.exec(PLAIN)![0];
    const packed = Buffer.from(
      deflateSync(strToU8(encodeURIComponent(model)), { level: 9 }),
    ).toString('base64');
    const file = `<mxfile><diagram name="Packed">${packed}</diagram></mxfile>`;
    const out = convertDrawio(file);
    expect(out.ok).toBe(true);
    expect(out.document!.pages[0]!.nodes).toHaveLength(4);
  });

  it('rejects DTDs and non-draw.io input', () => {
    expect(convertDrawio('<!DOCTYPE x [<!ENTITY a "b">]><mxfile/>').ok).toBe(
      false,
    );
    expect(convertDrawio('<mxfile><diagram/></mxfile>').ok).toBe(false);
    expect(convertDrawio('hello').ok).toBe(false);
  });
});

describe('draw.io round-trip', () => {
  it('re-imports this app’s own export with types, zones, layers and labels intact', () => {
    const doc = sampleDocument();
    doc.layers = [{ id: 'over', name: 'Overlay' }];
    const page = doc.pages[0]!;
    page.links.find((l) => l.id === 'overlay')!.layer = 'over';
    page.links.find((l) => l.id === 'lan')!.fromLabel = 'eth0';
    page.nodes.find((n) => n.id === 'ec')!.meta = { serial: 'EC-1' };

    const back = convertDrawio(documentToDrawioXML(doc));
    expect(back.ok).toBe(true);
    const p = back.document!.pages[0]!;
    for (const n of page.nodes) {
      const m = p.nodes.find((x) => x.id === n.id)!;
      expect(m, n.id).toBeDefined();
      // The custom (Node Designer) sensor type is not carried by the file.
      if (n.type !== 'sensor') expect(m.type).toBe(n.type);
      expect(m.label).toBe(n.label);
      expect(Math.abs(m.x - n.x)).toBeLessThan(1);
      expect(Math.abs(m.y - n.y)).toBeLessThan(1);
    }
    expect(p.nodes.find((n) => n.id === 'ec')!.meta).toEqual({
      serial: 'EC-1',
    });
    expect(p.zones[0]).toMatchObject({ id: 'zone_branch', label: 'Branch' });
    expect([...p.zones[0]!.nodes].sort()).toEqual(['ec', 'sensor1', 'user']);
    expect(back.document!.layers).toEqual([{ id: 'over', name: 'Overlay' }]);
    const overlay = p.links.find((l) => l.id === 'overlay')!;
    expect(overlay).toMatchObject({
      type: 'tunnel',
      layer: 'over',
      label: 'IPsec Overlay',
    });
    expect(p.links.find((l) => l.id === 'lan')!.fromLabel).toBe('eth0');
  });
});

describe('htmlToText', () => {
  it('turns breaks into lines and strips tags', () => {
    expect(htmlToText('<b>A</b><br>B &amp; C<div>D</div>', true)).toBe(
      'A\nB & C\nD',
    );
    expect(htmlToText('<b>A</b>', false)).toBe('<b>A</b>');
  });
});
