/**
 * hw-catalog Phase 4: wire-sheet layout and rendering.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { buildBundle, loadCatalogDir } from '../catalog/build.js';
import { Catalog, type CatalogBundle } from '../catalog/catalog.js';
import { renderDocumentToSVG } from '../server/render.js';
import { inspectPage } from './inspect.js';
import { branchWiresheetDoc } from './wiresheet-fixtures.js';
import { wiresheetLayout } from './wiresheet.js';
import { chooseScale, pxPerMm } from './wiresheet-scale.js';
import { parseDoc, serializeDoc } from '../pages/persist.js';
import { validateDocument } from '../api/validate.js';
import type { TopologyDocument } from '../pages/model.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const BUNDLE = buildBundle(loadCatalogDir(`${root}catalog/data`));
const catalog = new Catalog(BUNDLE);
const hardware = { catalog };
/** The first published bundle: no glyphs (built before Phase 4). */
const OLD = new Catalog(
  JSON.parse(
    readFileSync(`${root}public/catalog/catalog-f78a0ae494f4.json`, 'utf8'),
  ) as CatalogBundle,
);

const layout = (doc: TopologyDocument, cat = catalog) =>
  wiresheetLayout(doc, doc.pages[0]!, { catalog: cat })!;

describe('scale', () => {
  it('picks the largest standard drawing that fits, or the author’s', () => {
    // ANSI B is 1632 px wide; a 442 mm panel fits 45 % of it at 1:2.5.
    expect(chooseScale(1632, 442)).toBe(2.5);
    expect(chooseScale(1632, 100)).toBe(1);
    expect(chooseScale(1632, 442, 4)).toBe(4);
    expect(pxPerMm(1)).toBeCloseTo(96 / 25.4);
  });
});

describe('wiresheetLayout — the branch exit sheet', () => {
  const ws = layout(branchWiresheetDoc());

  it('draws every bound node as its panel at one page scale', () => {
    expect(ws.scale).toBe(2.5);
    const sw = ws.panels.find((p) => p.nodeId === 'sw')!;
    expect(sw.schematic).toBe(true);
    expect(sw.members).toBe(2);
    expect(sw.rect.w).toBeCloseTo(442 * pxPerMm(2.5));
    expect(sw.rect.h).toBeCloseTo(2 * 43.9 * pxPerMm(2.5) + sw.gap);
    const ec = ws.panels.find((p) => p.nodeId === 'ec1')!;
    // The 9004-class chassis only has rear art (and its ports are rear).
    expect(ec).toMatchObject({
      face: 'rear',
      faceFallback: true,
      schematic: false,
    });
  });

  it('puts each cable end on its port centre, members on their chassis', () => {
    const sw = ws.panels.find((p) => p.nodeId === 'sw')!;
    const p1 = catalog
      .platformFor(sw.model.id)
      .ports.find((p) => p.id === 'p1')!;
    const m1 = ws.ends.find((e) => e.interface === '1/1/1')!;
    const m2 = ws.ends.find((e) => e.interface === '2/1/1')!;
    expect(m1.port.x).toBeCloseTo(sw.rect.x + p1.x * sw.unit);
    expect(m1.port.y).toBeCloseTo(sw.rect.y + p1.y * sw.unit);
    expect(m2.port.x).toBeCloseTo(m1.port.x);
    expect(m2.port.y).toBeCloseTo(m1.port.y + sw.memberH + sw.gap);
    // Member 1 leaves the top, the last member the bottom.
    expect(m1.side).toBe('n');
    expect(m2.side).toBe('s');
    expect(m1.edge.y).toBeCloseTo(sw.rect.y);
    expect(m2.edge.y).toBeCloseTo(sw.rect.y + sw.rect.h);
    // A single-row EC port leaves toward its far end.
    expect(ws.ends.find((e) => e.linkId === 'w1')!.side).toBe('n');
    expect(
      ws.ends.find((e) => e.linkId === 'b1' && e.end === 'from')!.side,
    ).toBe('s');
  });

  it('pins the engine link to the port and hands it the lead', () => {
    const b1 = ws.page.links.find((l) => l.id === 'b1')!;
    const a = ws.ends.find((e) => e.linkId === 'b1' && e.end === 'from')!;
    expect(b1.fromPort).toBe('s');
    expect(b1.waypoints![0]).toEqual(a.lead);
    // Port chips are replaced by pills; the stored link keeps its interface.
    expect(b1.fromInterface).toBeUndefined();
    expect(ws.overlayPage.links.find((l) => l.id === 'b1')!.fromInterface).toBe(
      'lan0',
    );
    // Panels carry no engine label (the overlay draws the header).
    expect(ws.page.nodes.find((n) => n.id === 'sw')!.label).toBe('');
    expect(ws.page.nodes.find((n) => n.id === 'isp1')!.label).toBe('ISP A');
  });

  it('detours a cable that leaves away from its far end', () => {
    const route = ws.routes.get('b2')!;
    const sw = ws.panels.find((p) => p.nodeId === 'sw')!;
    // Some point lies beside the stack (left of it).
    expect(route.some((p) => p.x < sw.rect.x)).toBe(true);
  });

  it('notes the scale, schematic models and face fallbacks once each', () => {
    expect(ws.notes).toEqual([
      'Panels at 1:2.5',
      'SCHEMATIC (port positions approximate): CX 6300M 24-port 1GbE and 4-port SFP56 Switch',
      'EdgeConnect 10104: rear face shown (no front art)',
    ]);
    expect(ws.doc.sheet!.titleBlock!.notes).toEqual(ws.notes);
  });

  it('inspects clean: no cable over a panel, no pill overlap, no missing port', () => {
    const report = inspectPage(ws.page, { wiresheet: ws });
    const wsFindings = report.findings.filter((f) =>
      f.message.startsWith('wire sheet'),
    );
    expect(wsFindings).toEqual([]);
  });
});

describe('wire-sheet rendering', () => {
  const doc = branchWiresheetDoc();
  const svg = renderDocumentToSVG(doc, 0, { hardware });

  it('draws panels, pills, headers, the schematic badge and the notes', () => {
    expect((svg.match(/class="tds-panel"/g) ?? []).length).toBe(3);
    for (const name of ['wan0', 'lan1', '1/1/1', '2/1/23'])
      expect(svg).toContain(`>${name}</text>`);
    expect(svg).toContain('>BR-SW-01</text>');
    expect(svg).toContain('>SCHEMATIC</text>');
    expect(svg).toContain('Panels at 1:2.5');
    // Ids inside each panel are prefixed: no collisions across panels.
    expect(svg).not.toMatch(/ id="chassis"/);
    // Unused ports are muted.
    expect(svg).toMatch(/data-port="p5"[^>]*opacity="0.35"/);
  });

  it('draws the schematic badge in the light theme too', () => {
    expect(renderDocumentToSVG(doc, 0, { hardware, theme: 'light' })).toContain(
      '>SCHEMATIC</text>',
    );
  });

  it('is logical without a catalog, and logical pages ignore one', () => {
    const logical = structuredClone(doc);
    delete logical.pages[0]!.view;
    const asLogical = renderDocumentToSVG(logical, 0);
    expect(renderDocumentToSVG(doc, 0)).toBe(asLogical);
    expect(renderDocumentToSVG(logical, 0, { hardware })).toBe(asLogical);
  });

  it('falls back to catalog geometry when the pinned catalog has no art', () => {
    const ws = layout(branchWiresheetDoc(), OLD);
    expect(ws.panels.every((p) => p.geometryOnly)).toBe(true);
    expect(ws.notes.at(-1)).toMatch(
      /Drawn from catalog geometry .*f78a0ae494f4/,
    );
    const out = renderDocumentToSVG(branchWiresheetDoc(), 0, {
      hardware: { catalog: OLD },
    });
    expect(out).toContain('>GEOMETRY ONLY</text>');
    expect(out).toContain('>1/1/1</text>');
  });

  it('never draws an unsanitized glyph, even from a tampered bundle', () => {
    const evil = structuredClone(BUNDLE);
    const rel = Object.keys(evil.glyphs!).find((k) => k.includes('cx-6300m'))!;
    evil.glyphs![rel] = evil.glyphs![rel]!.replace(
      '<g',
      '<script>alert(1)</script><foreignObject/><g onload="alert(2)"><image href="https://x.example/a.png"/></g><g',
    );
    const out = renderDocumentToSVG(branchWiresheetDoc(), 0, {
      hardware: { catalog: new Catalog(evil) },
    });
    for (const bad of ['<script', 'alert(', '<foreignObject', 'x.example'])
      expect(out).not.toContain(bad);
  });
});

describe('wire-sheet edge cases', () => {
  const one = (
    hw: Record<string, unknown>,
    links: Record<string, unknown>[],
  ) => {
    const d = branchWiresheetDoc();
    const page = d.pages[0]!;
    page.nodes = [
      { id: 'n', type: 'switch', x: 800, y: 500, label: 'N', hw: hw as never },
      { id: 'h', type: 'host', x: 800, y: 150, label: 'H' },
    ];
    page.links = links.map((l, i) => ({
      id: `l${i}`,
      type: 'line',
      from: 'n',
      to: 'h',
      ...l,
    }));
    return d;
  };

  it('relative-unit panels are badged NOT TO SCALE', () => {
    const d = one({ model: 'edgeconnect-ec-xs' }, [{ fromInterface: 'wan0' }]);
    expect(layout(d).notes).toContain(
      'Not to scale (relative units): EdgeConnect EC-XS',
    );
    expect(renderDocumentToSVG(d, 0, { hardware })).toContain(
      '>NOT TO SCALE</text>',
    );
  });

  it('ends with no interface, or a member off the sheet, attach at the edge', () => {
    const d = one({ model: 'aruba-cx-6300m-jl664a' }, [
      {},
      { fromInterface: '2/1/1' },
      { fromInterface: '1/1/5' },
    ]);
    const ws = layout(d);
    expect(ws.findings.map((f) => f.kind)).toEqual([
      'unresolved',
      'unresolved',
    ]);
    expect(ws.ends.map((e) => e.interface)).toEqual(['1/1/5']);
  });

  it('a port the platform lacks is a problem (an impossible-after-validation assertion)', () => {
    const bad = structuredClone(BUNDLE);
    const cx = bad.models.find((m) => m.id === 'aruba-cx-6300m-jl664a')!;
    cx.interfaces[0]!.physical = 'p999';
    const d = one({ model: 'aruba-cx-6300m-jl664a' }, [
      { fromInterface: '1/1/1' },
    ]);
    const ws = layout(d, new Catalog(bad));
    expect(ws.findings).toEqual([
      expect.objectContaining({ kind: 'port-missing' }),
    ]);
    const r = inspectPage(ws.page, { wiresheet: ws });
    expect(r.findings).toContainEqual(
      expect.objectContaining({
        severity: 'problem',
        message: expect.stringMatching(/p999/),
      }),
    );
  });

  it('inspect flags overlapping pills and a cable crossing a panel', () => {
    // At 1:10 adjacent CX ports are ~5.5 px apart: their pills collide.
    const d = one({ model: 'aruba-cx-6300m-jl664a' }, [
      { fromInterface: '1/1/1' },
      { fromInterface: '1/1/3' },
    ]);
    d.pages[0]!.panelScale = 10;
    let ws = layout(d);
    expect(
      inspectPage(ws.page, { wiresheet: ws }).findings.some((f) =>
        /port pills .* overlap/.test(f.message),
      ),
    ).toBe(true);
    // A third panel between the switch and the host.
    const e = one({ model: 'aruba-cx-6300m-jl664a' }, [
      { fromInterface: '1/1/1' },
    ]);
    e.pages[0]!.nodes.push({
      id: 'mid',
      type: 'firewall',
      x: 700,
      y: 330,
      hw: { model: 'juniper-srx300' },
    });
    ws = layout(e);
    expect(
      inspectPage(ws.page, { wiresheet: ws }).findings.some((f) =>
        /cable "l0" crosses the SRX300 panel "mid"/.test(f.message),
      ),
    ).toBe(true);
  });
});

describe('page fields', () => {
  it('persist view and panelScale, dropping bad values', () => {
    const d = branchWiresheetDoc();
    d.pages[0]!.panelScale = 4;
    const back = parseDoc(serializeDoc(d))!;
    expect(back.pages[0]).toMatchObject({ view: 'wiresheet', panelScale: 4 });
    const raw = JSON.parse(serializeDoc(d));
    raw.pages[0].view = 'rack';
    raw.pages[0].panelScale = 999;
    const bad = parseDoc(raw)!;
    expect(bad.pages[0]!.view).toBeUndefined();
    expect(bad.pages[0]!.panelScale).toBeUndefined();
  });

  it('validation warns on a wire sheet with nothing bound', () => {
    const d = branchWiresheetDoc();
    for (const n of d.pages[0]!.nodes) delete n.hw;
    expect(validateDocument(d).map((p) => p.message)).toContainEqual(
      expect.stringMatching(/no node on the page is bound/),
    );
  });
});
