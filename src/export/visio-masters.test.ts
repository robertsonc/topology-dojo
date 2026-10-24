/**
 * Native Visio masters (hw-catalog Phase 5): one master per catalog model,
 * a named connection point per port (prompt = OS-native interface name),
 * Shape Data for the hardware binding; `.vsdx` wire-sheet pages instance
 * the masters and glue each cable end to its port's connection point; the
 * `.vssx` stencil carries every GA-eligible model. Structure only — the
 * LibreOffice render check is `visio-render.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { fileURLToPath } from 'node:url';
import { buildBundle, loadCatalogDir } from '../catalog/build.js';
import { Catalog, gaEligible } from '../catalog/catalog.js';
import { parseXml, type XmlElement } from '../import/xml.js';
import { branchWiresheetDoc } from '../render/wiresheet-fixtures.js';
import { wiresheetLayout } from '../render/wiresheet.js';
import {
  buildMaster,
  connectionRowName,
  masterFace,
  masterMembers,
} from './visio-masters.js';
import { documentToVsdx } from './vsdx.js';
import { catalogToVssx } from './vssx.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = new Catalog(buildBundle(loadCatalogDir(`${root}catalog/data`)));

type Parts = Record<string, Uint8Array>;
const xml = (parts: Parts, p: string): XmlElement =>
  parseXml(strFromU8(parts[p]!));
const all = (el: XmlElement, name: string): XmlElement[] => [
  ...(el.name === name ? [el] : []),
  ...el.children.flatMap((c) => all(c, name)),
];
const cell = (el: XmlElement, n: string): XmlElement | undefined =>
  el.children.find((c) => c.name === 'Cell' && c.attrs.N === n);

/** Every override exists, every internal relationship target exists. */
function checkPackage(parts: Parts): void {
  const types = xml(parts, '[Content_Types].xml');
  for (const o of types.children.filter((c) => c.name === 'Override'))
    expect(parts[o.attrs.PartName!.slice(1)], o.attrs.PartName).toBeDefined();
  for (const p of Object.keys(parts)) {
    if (p.endsWith('.xml') || p.endsWith('.rels')) xml(parts, p);
    if (!p.endsWith('.rels')) continue;
    const dir = p.replace(/_rels\/[^/]*\.rels$/, '');
    for (const r of xml(parts, p).children) {
      if (r.attrs.TargetMode === 'External') continue;
      const t = r.attrs.Target!;
      const abs = t.startsWith('/')
        ? t.slice(1)
        : new URL(t, `http://x/${dir}`).pathname.slice(1);
      expect(parts[abs], `${p} → ${t}`).toBeDefined();
    }
  }
}

describe('model masters', () => {
  const ids = [...catalog.models.keys()].sort();

  it('connection row names are valid and unique', () => {
    const used = new Set<string>();
    expect(connectionRowName('1/1/1', used)).toBe('P_1_1_1');
    expect(connectionRowName('1-1-1', used)).toBe('P_1_1_1_2');
    expect(connectionRowName('wan0', used)).toBe('wan0');
    expect(connectionRowName('WAN0', used)).toBe('WAN0_2');
  });

  it.each(ids)('%s: one connection per port, named by interface', (id) => {
    const model = catalog.model(id);
    const platform = catalog.platformFor(id);
    const face = masterFace(catalog, platform, 'front');
    const m = buildMaster(catalog, id, face, 1, 2);
    const faceOf = new Map(
      platform.ports.map((p) => [p.id, p.face ?? 'front']),
    );
    const onFace = model.interfaces.filter(
      (i) => faceOf.get(i.physical) === face,
    );
    expect(m.connections.length).toBeGreaterThan(0);
    expect(m.connections.length).toBe(onFace.length);
    const names = m.connections.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const c of m.connections) {
      expect(c.name).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
      expect(c.fx).toBeGreaterThanOrEqual(0);
      expect(c.fx).toBeLessThanOrEqual(1);
      expect(c.fy).toBeGreaterThanOrEqual(0);
      expect(c.fy).toBeLessThanOrEqual(1);
      expect(m.connectionIndex.get(c.prompt)).toBe(m.connections.indexOf(c));
    }
    // Real size: panel mm in inches.
    expect(m.widthIn).toBeCloseTo(platform.panel.width / 25.4, 4);
    expect(m.heightIn).toBeCloseTo(platform.panel.height / 25.4, 4);

    const shape = parseXml(m.shapeXml);
    const props = all(shape, 'Row').filter((r) =>
      [
        'Vendor',
        'Model',
        'SKU',
        'CatalogVersion',
        'Hostname',
        'Confidence',
      ].includes(r.attrs.N ?? ''),
    );
    expect(props.map((r) => r.attrs.N).sort()).toEqual([
      'CatalogVersion',
      'Confidence',
      'Hostname',
      'Model',
      'SKU',
      'Vendor',
    ]);
    const cv = props.find((r) => r.attrs.N === 'CatalogVersion')!;
    expect(cell(cv, 'Value')!.attrs.V).toBe(catalog.version);
    const ga = all(shape, 'Row').find((r) => r.attrs.N === 'GAEligible')!;
    expect(cell(ga, 'Value')!.attrs.V).toBe(gaEligible(model) ? 'yes' : 'no');
    // Connection rows carry the interface name as the prompt.
    const conn = all(shape, 'Section').find((s) => s.attrs.N === 'Connection')!;
    expect(conn.children.map((r) => cell(r, 'Prompt')?.attrs.V)).toEqual(
      m.connections.map((c) => c.prompt),
    );
  });

  it('is deterministic', () => {
    const a = buildMaster(catalog, ids[0]!, 'front', 1, 2);
    const b = buildMaster(catalog, ids[0]!, 'front', 1, 2);
    expect(a.shapeXml).toBe(b.shapeXml);
    expect(a.uniqueId).toMatch(/^\{[0-9A-F-]{36}\}$/);
  });

  it('a stack master holds one chassis per member', () => {
    const cx = ids.find((id) => masterMembers(catalog.model(id), 2) === 2)!;
    const one = buildMaster(catalog, cx, 'front', 1, 2);
    const two = buildMaster(catalog, cx, 'front', 2, 3);
    // Per-member ports repeat; chassis-wide ones (no {member}) do not.
    const perMember = one.connections.filter((c) => c.prompt.startsWith('1/'));
    expect(perMember.length).toBeGreaterThan(20);
    expect(two.connections.length).toBe(
      one.connections.length + perMember.length,
    );
    expect(two.connectionIndex.has('2/1/1')).toBe(true);
    const a = two.connections[two.connectionIndex.get('1/1/1')!]!;
    const b = two.connections[two.connectionIndex.get('2/1/1')!]!;
    expect(a.fx).toBeCloseTo(b.fx, 6);
    expect(a.fy).toBeGreaterThan(b.fy); // member 1 above member 2 (y up)
    expect(two.heightIn).toBeGreaterThan(one.heightIn * 2);
  });

  it('instances scale geometry and connection values to the page size', () => {
    const id = 'juniper-srx300';
    const m = buildMaster(
      catalog,
      id,
      masterFace(catalog, catalog.platformFor(id), 'front'),
      1,
      2,
    );
    const inst = parseXml(
      `<Shape>${m.instanceXml(m.widthIn / 2, m.heightIn / 2)}</Shape>`,
    );
    const conn = all(inst, 'Section').find((s) => s.attrs.N === 'Connection')!;
    const c0 = m.connections[0]!;
    const x = cell(conn.children[0]!, 'X')!;
    expect(Number(x.attrs.V)).toBeCloseTo((c0.fx * m.widthIn) / 2, 3);
    expect(x.attrs.F).toBe('Inh');
  });
});

describe('.vsdx wire sheet', () => {
  const doc = branchWiresheetDoc();
  const parts = unzipSync(documentToVsdx(doc, { hardware: { catalog } }));
  const page = xml(parts, 'visio/pages/page1.xml');
  const shapes = all(page, 'Shape');
  const ws = wiresheetLayout(doc, doc.pages[0]!, { catalog })!;

  it('is a valid package with masters', () => {
    checkPackage(parts);
    const types = strFromU8(parts['[Content_Types].xml']!);
    expect(types).toContain('application/vnd.ms-visio.masters+xml');
    expect(types).toContain('application/vnd.ms-visio.master+xml');
    const masters = xml(parts, 'visio/masters/masters.xml');
    // EC-10104 (shared by both edges) + the CX VSF pair.
    expect(masters.children.filter((c) => c.name === 'Master')).toHaveLength(2);
    expect(strFromU8(parts['visio/pages/_rels/page1.xml.rels']!)).toContain(
      'relationships/master',
    );
  });

  it('bound nodes are master instances with their binding as Shape Data', () => {
    const inst = shapes.filter((s) => s.attrs.Master);
    expect(inst).toHaveLength(3);
    const ec1 = inst.find((s) =>
      all(s, 'Row').some(
        (r) => r.attrs.N === 'DojoId' && cell(r, 'Value')?.attrs.V === 'ec1',
      ),
    )!;
    const sku = all(ec1, 'Row').find((r) => r.attrs.N === 'SKU')!;
    expect(cell(sku, 'Value')!.attrs.V).toBe('S3N69A');
  });

  it('every pinned cable end glues to its port connection point', () => {
    const connects = all(page, 'Connect');
    const point = connects.filter((c) =>
      c.attrs.ToCell?.startsWith('Connections.'),
    );
    const pinned = ws.ends.filter((e) => e.interface);
    expect(pinned.length).toBeGreaterThanOrEqual(10);
    expect(point).toHaveLength(pinned.length);
    const mastersById = new Map(
      all(xml(parts, 'visio/masters/masters.xml'), 'Master').map((m) => [
        m.attrs.ID!,
        m,
      ]),
    );
    for (const c of point) {
      const ix = Number(/^Connections\.X(\d+)$/.exec(c.attrs.ToCell!)![1]) - 1;
      expect(c.attrs.ToPart).toBe(String(100 + ix));
      const to = shapes.find((s) => s.attrs.ID === c.attrs.ToSheet)!;
      expect(to.attrs.Master).toBeDefined();
      expect(mastersById.has(to.attrs.Master!)).toBe(true);
      // The connector's begin/end cell uses the PAR(PNT()) point glue.
      const from = shapes.find((s) => s.attrs.ID === c.attrs.FromSheet)!;
      const f = cell(from, c.attrs.FromCell!)!.attrs.F!;
      expect(f).toBe(
        `PAR(PNT(Sheet.${to.attrs.ID}!Connections.X${ix + 1},Sheet.${to.attrs.ID}!Connections.Y${ix + 1}))`,
      );
    }
    // ...and the right port: the prompt at that row is the end's interface.
    const ends = new Set(pinned.map((e) => e.interface));
    for (const c of point) {
      const to = shapes.find((s) => s.attrs.ID === c.attrs.ToSheet)!;
      const ix = Number(/X(\d+)$/.exec(c.attrs.ToCell!)![1]) - 1;
      const m = mastersById.get(to.attrs.Master!)!;
      const rel = strFromU8(parts['visio/masters/_rels/masters.xml.rels']!);
      const rid = all(m, 'Rel')[0]!.attrs['r:id']!;
      const target =
        new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rel)?.[1] ??
        new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(rel)![1]!;
      const mx = xml(parts, `visio/masters/${target}`);
      const sec = all(mx, 'Section').find((s) => s.attrs.N === 'Connection')!;
      const prompt = cell(sec.children[ix]!, 'Prompt')!.attrs.V!;
      expect(ends.has(prompt), prompt).toBe(true);
    }
  });

  it('the document without hardware exports logical, as before', () => {
    const plain = unzipSync(documentToVsdx(doc));
    checkPackage(plain);
    expect(plain['visio/masters/masters.xml']).toBeUndefined();
  });
});

describe('.vssx stencil', () => {
  it('holds every GA-eligible model by default, all with --all', () => {
    const ga = catalogToVssx(catalog);
    const ids = [...catalog.models.keys()].sort();
    const want = ids.filter((id) => gaEligible(catalog.model(id)));
    expect(ga.models).toEqual(want);
    expect(ga.skipped).toEqual(ids.filter((id) => !want.includes(id)));
    const parts = unzipSync(ga.bytes);
    checkPackage(parts);
    expect(strFromU8(parts['[Content_Types].xml']!)).toContain(
      'application/vnd.ms-visio.stencil.main+xml',
    );
    expect(all(xml(parts, 'visio/masters/masters.xml'), 'Master')).toHaveLength(
      want.length,
    );
    expect(Object.keys(parts).some((p) => p.startsWith('visio/pages/'))).toBe(
      false,
    );

    const every = catalogToVssx(catalog, { all: true });
    expect(every.models).toEqual(ids);
    expect(every.skipped).toEqual([]);
  });
});
