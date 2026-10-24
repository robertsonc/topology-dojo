/**
 * Visio (.vsdx) and PowerPoint (.pptx) exports — package integrity (every
 * content-type override and relationship target exists, every XML part is
 * well-formed), connectors glued to the shapes they join, layers carried
 * (Visio page layers / PowerPoint layer groups and per-layer slides), and
 * metadata as Visio Shape Data. Rendering fidelity is checked by hand in
 * LibreOffice (docs/EXPORTS.md); this guards the structure.
 */
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { documentToVsdx } from './vsdx.js';
import { documentToPptx, pptxSlideCount } from './pptx.js';
import { parseXml, type XmlElement } from '../import/xml.js';
import { sampleDocument, type TopologyDocument } from '../pages/model.js';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function doc(): TopologyDocument {
  const d = sampleDocument();
  d.layers = [
    { id: 'under', name: 'Underlay' },
    { id: 'over', name: 'Overlay', defaultVisible: false },
  ];
  const p = d.pages[0]!;
  p.links.find((l) => l.id === 'overlay')!.layer = 'over';
  p.nodes.find((n) => n.id === 'hub')!.layer = 'over';
  p.nodes.find((n) => n.id === 'ec')!.meta = {
    serial: 'EC-123',
    'mgmt ip': '10.0.0.1',
  };
  p.nodes.find((n) => n.id === 'app')!.href = 'https://example.com/app';
  p.links.find((l) => l.id === 'lan')!.fromLabel = 'eth0';
  p.nodes.push({
    id: 'pic',
    type: 'image',
    x: 900,
    y: 600,
    imageHref: PNG_1PX,
    label: 'Rack',
  });
  d.pages.push({ ...structuredClone(p), id: 'p2', name: 'Frame 1' }); // duplicate name
  return d;
}

type Parts = Record<string, Uint8Array>;
const xml = (parts: Parts, path: string): XmlElement =>
  parseXml(strFromU8(parts[path]!));

/** Every override exists, every internal relationship target exists. */
function checkPackage(parts: Parts): void {
  const types = xml(parts, '[Content_Types].xml');
  for (const o of types.children.filter((c) => c.name === 'Override'))
    expect(parts[o.attrs.PartName!.slice(1)], o.attrs.PartName).toBeDefined();
  const defaults = new Set(
    types.children
      .filter((c) => c.name === 'Default')
      .map((c) => c.attrs.Extension),
  );
  for (const path of Object.keys(parts)) {
    if (path.endsWith('.xml') || path.endsWith('.rels'))
      expect(() => xml(parts, path), path).not.toThrow();
    const ext = path.split('.').pop()!;
    const overridden = types.children.some(
      (c) => c.attrs.PartName === `/${path}`,
    );
    expect(overridden || defaults.has(ext), `content type for ${path}`).toBe(
      true,
    );
  }
  for (const relPath of Object.keys(parts).filter((p) => p.endsWith('.rels'))) {
    const dir = relPath.replace(/_rels\/[^/]*\.rels$/, '');
    for (const r of xml(parts, relPath).children) {
      if (r.attrs.TargetMode === 'External') continue;
      const segs = (dir + r.attrs.Target).split('/');
      const out: string[] = [];
      for (const s of segs) {
        if (s === '..') out.pop();
        else if (s && s !== '.') out.push(s);
      }
      expect(
        parts[out.join('/')],
        `${relPath} → ${r.attrs.Target}`,
      ).toBeDefined();
    }
  }
}

function all(
  el: XmlElement,
  name: string,
  out: XmlElement[] = [],
): XmlElement[] {
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    all(c, name, out);
  }
  return out;
}
const cellV = (shape: XmlElement, n: string): string | undefined =>
  shape.children.find((c) => c.name === 'Cell' && c.attrs.N === n)?.attrs.V;

describe('documentToVsdx', () => {
  const parts = unzipSync(documentToVsdx(doc()));

  it('is a complete OPC package', () => {
    checkPackage(parts);
    expect(parts['visio/document.xml']).toBeDefined();
    expect(parts['visio/pages/page2.xml']).toBeDefined();
  });

  it('names pages uniquely and declares their layers', () => {
    const pages = xml(parts, 'visio/pages/pages.xml');
    const names = pages.children.map((p) => p.attrs.Name);
    expect(names).toEqual(['Frame 1', 'Frame 1 (2)']);
    const layers = all(pages.children[0]!, 'Row').filter((r) =>
      r.children.some((c) => c.attrs.N === 'NameUniv'),
    );
    expect(layers.map((r) => cellV(r, 'Name'))).toEqual([
      'Base',
      'Underlay',
      'Overlay',
    ]);
    expect(layers.map((r) => cellV(r, 'Visible'))).toEqual(['1', '1', '0']);
  });

  it('glues every node-to-node connector at both ends', () => {
    const page = xml(parts, 'visio/pages/page1.xml');
    const shapes = all(page, 'Shape');
    const ids = new Set(shapes.map((s) => s.attrs.ID));
    const connectors = shapes.filter((s) =>
      s.attrs.NameU!.startsWith('Dynamic connector'),
    );
    expect(connectors).toHaveLength(5);
    const connects = all(page, 'Connect');
    expect(connects).toHaveLength(10);
    for (const c of connects) {
      expect(ids.has(c.attrs.FromSheet!)).toBe(true);
      expect(ids.has(c.attrs.ToSheet!)).toBe(true);
    }
    const overlay = connectors.find((s) => s.attrs.Name === 'IPsec Overlay')!;
    expect(cellV(overlay, 'LayerMember')).toBe('2');
    expect(cellV(overlay, 'LinePattern')).toBe('2'); // tunnels dash
    expect(
      overlay.children.find((c) => c.attrs.N === 'BeginX')!.attrs.F,
    ).toContain('_WALKGLUE');
  });

  it('carries metadata as Shape Data and links as hyperlinks', () => {
    const page = xml(parts, 'visio/pages/page1.xml');
    const ec = all(page, 'Shape').find((s) => s.attrs.Name === 'EC-Branch')!;
    const rows = all(ec, 'Row').filter((r) =>
      r.children.some((c) => c.attrs.N === 'Label'),
    );
    const data = Object.fromEntries(
      rows.map((r) => [cellV(r, 'Label'), cellV(r, 'Value')]),
    );
    expect(data).toMatchObject({
      DojoType: 'ec',
      serial: 'EC-123',
      'mgmt ip': '10.0.0.1',
    });
    expect(rows.map((r) => r.attrs.N)).toContain('mgmt_ip');
    const app = all(page, 'Shape').find((s) => s.attrs.Name === 'App')!;
    expect(all(app, 'Cell').find((c) => c.attrs.N === 'Address')!.attrs.V).toBe(
      'https://example.com/app',
    );
  });

  it('embeds data-URI images as foreign shapes', () => {
    const page = xml(parts, 'visio/pages/page1.xml');
    const pic = all(page, 'Shape').find((s) => s.attrs.Type === 'Foreign')!;
    expect(pic).toBeDefined();
    expect(all(pic, 'ForeignData')[0]!.attrs.CompressionType).toBe('PNG');
    expect(parts['visio/media/image1.png']).toBeDefined();
  });

  it('writes port labels as text shapes', () => {
    const page = xml(parts, 'visio/pages/page1.xml');
    const ports = all(page, 'Shape').filter((s) =>
      s.attrs.NameU!.startsWith('Port'),
    );
    expect(ports.map((s) => all(s, 'Text')[0]!.text)).toEqual(['eth0']);
  });
});

describe('documentToPptx', () => {
  it('is a complete OPC package with one slide per page', () => {
    const parts = unzipSync(documentToPptx(doc()));
    checkPackage(parts);
    const pres = xml(parts, 'ppt/presentation.xml');
    expect(all(pres, 'p:sldId')).toHaveLength(2);
  });

  it('glues straight connectors to their node shapes', () => {
    const parts = unzipSync(documentToPptx(doc()));
    const slide = xml(parts, 'ppt/slides/slide1.xml');
    const ids = new Set(all(slide, 'p:cNvPr').map((c) => c.attrs.id));
    const cxns = all(slide, 'p:cxnSp');
    expect(cxns.length).toBeGreaterThanOrEqual(4);
    // Clouds have no simple side sites, so the one link to Internet is
    // drawn unglued at that end; every other end glues to a real shape.
    let glued = 0;
    for (const c of cxns) {
      for (const end of [...all(c, 'a:stCxn'), ...all(c, 'a:endCxn')]) {
        expect(ids.has(end.attrs.id!)).toBe(true);
        glued++;
      }
    }
    expect(glued).toBe(cxns.length * 2 - 1);
    // Shape ids are unique on the slide.
    const list = all(slide, 'p:cNvPr').map((c) => c.attrs.id);
    expect(new Set(list).size).toBe(list.length);
  });

  it('groups shapes by layer, hidden when the layer is', () => {
    const parts = unzipSync(documentToPptx(doc()));
    const slide = xml(parts, 'ppt/slides/slide1.xml');
    const groups = all(slide, 'p:grpSp').map(
      (g) => all(g, 'p:cNvPr')[0]!.attrs,
    );
    expect(groups.map((g) => g.name)).toEqual([
      'Layer: Base',
      'Layer: Overlay',
    ]);
    expect(groups[1]!.hidden).toBe('1');
  });

  it('adds a slide per declared layer in layers mode', () => {
    expect(pptxSlideCount(doc(), 'layers')).toBe(2 * 3);
    const parts = unzipSync(documentToPptx(doc(), { slides: 'layers' }));
    checkPackage(parts);
    const titles = [1, 2, 3].map(
      (n) => all(xml(parts, `ppt/slides/slide${n}.xml`), 'a:t')[0]!.text,
    );
    expect(titles).toEqual([
      'Frame 1',
      'Frame 1 — Underlay',
      'Frame 1 — Overlay',
    ]);
    // The underlay slide leaves the overlay tunnel out.
    const under = strFromU8(parts['ppt/slides/slide2.xml']!);
    expect(under).not.toContain('IPsec Overlay');
  });

  it('image mode places one picture per slide', () => {
    const png = Uint8Array.from(atob(PNG_1PX.split(',')[1]!), (c) =>
      c.charCodeAt(0),
    );
    const parts = unzipSync(
      documentToPptx(doc(), {
        mode: 'image',
        renderImage: () => ({ png, width: 1, height: 1 }),
      }),
    );
    checkPackage(parts);
    expect(all(xml(parts, 'ppt/slides/slide1.xml'), 'p:pic')).toHaveLength(1);
    expect(() => documentToPptx(doc(), { mode: 'image' })).toThrow(/renderer/);
  });

  it('hyperlinks are external relationships', () => {
    const parts = unzipSync(documentToPptx(doc()));
    const rels = xml(parts, 'ppt/slides/_rels/slide1.xml.rels');
    const link = rels.children.find((r) => r.attrs.TargetMode === 'External')!;
    expect(link.attrs.Target).toBe('https://example.com/app');
  });
});
