/**
 * hw-catalog Phase 2: hardware bindings on the document model — binding,
 * the interface-as-port-label fallback in every port-label renderer,
 * persistence, and shape checks.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createDocument } from './builder.js';
import {
  bindHardware,
  bundleLacp,
  docHasBindings,
  endPortLabel,
  hardwareShapeProblems,
  withInterfaceLabels,
} from './hardware.js';
import { validateDocument } from './validate.js';
import { buildBundle, loadCatalogDir } from '../catalog/build.js';
import { Catalog } from '../catalog/catalog.js';
import { parseDoc, serializeDoc } from '../pages/persist.js';
import { portTableRows } from '../render/port-table.js';
import { portPillsSVG } from '../render/port-pills.js';
import { renderDocumentToSVG } from '../server/render.js';
import type { TopologyDocument } from '../pages/model.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = new Catalog(buildBundle(loadCatalogDir(`${root}catalog/data`)));

function doc(): TopologyDocument {
  return createDocument('HW')
    .page({ viewBox: '0 0 1050 700' })
    .node({
      id: 'sw',
      type: 'chassis',
      x: 300,
      y: 350,
      label: 'SW',
      portTable: {},
    })
    .node({ id: 'fw', type: 'router', x: 750, y: 350, label: 'FW' })
    .link({
      id: 'l1',
      type: 'line',
      from: 'sw',
      to: 'fw',
      fromInterface: '1/1/1',
      toInterface: 'ge-0/0/1',
    })
    .build();
}

describe('bindHardware', () => {
  it('binds, pins the catalog version once, and sets the type from category', () => {
    const d = doc();
    const [sw, fw] = d.pages[0]!.nodes;
    const r1 = bindHardware(
      d,
      sw!,
      { model: 'aruba-cx-6300m-jl664a', sku: 'JL664A', stackMembers: 2 },
      catalog,
    );
    expect(r1).toMatchObject({ pinned: true, previousType: 'chassis' });
    expect(sw!.type).toBe('switch');
    expect(sw!.hw).toEqual({
      model: 'aruba-cx-6300m-jl664a',
      sku: 'JL664A',
      stackMembers: 2,
    });
    expect(d.catalogVersion).toBe(catalog.version);
    const r2 = bindHardware(d, fw!, { model: 'juniper-srx300' }, catalog);
    expect(r2.pinned).toBe(false);
    expect(fw!.type).toBe('firewall');
    expect(docHasBindings(d)).toBe(true);
  });

  it('keeps a custom (Node Designer) type', () => {
    const d = doc();
    d.customNodes.push({
      typeName: 'my-sw',
    } as TopologyDocument['customNodes'][number]);
    const sw = d.pages[0]!.nodes[0]!;
    sw.type = 'my-sw';
    const r = bindHardware(d, sw, { model: 'aruba-cx-6300m-jl664a' }, catalog);
    expect(sw.type).toBe('my-sw');
    expect(r.previousType).toBeUndefined();
  });

  it('refuses what the catalog does not say', () => {
    const d = doc();
    const sw = d.pages[0]!.nodes[0]!;
    const bind = (hw: Parameters<typeof bindHardware>[2]) => () =>
      bindHardware(d, sw, hw, catalog);
    expect(bind({ model: 'no-such-model' })).toThrow(/unknown hardware model/);
    expect(bind({ model: 'aruba-cx-6300m-jl664a', sku: 'JL000A' })).toThrow(
      /no SKU/,
    );
    expect(bind({ model: 'aruba-cx-6300m-jl664a', stackMembers: 11 })).toThrow(
      /at most 10/,
    );
    expect(bind({ model: 'aruba-cx-6300m-jl664a', stackMembers: 0 })).toThrow(
      /positive/,
    );
    expect(bind({ model: 'juniper-srx300', stackMembers: 2 })).toThrow(
      /not stackable/,
    );
    expect(bind({ model: 'juniper-srx300', face: 'top' as 'front' })).toThrow(
      /face/,
    );
    // Nothing was written by the refused binds.
    expect(sw.hw).toBeUndefined();
    expect(d.catalogVersion).toBeUndefined();
  });
});

describe('interface names as port labels', () => {
  it('fills only empty labels, and returns the same link when nothing changes', () => {
    const l = doc().pages[0]!.links[0]!;
    expect(endPortLabel(l, 'from')).toBe('1/1/1');
    expect(withInterfaceLabels(l)).toMatchObject({
      fromLabel: '1/1/1',
      toLabel: 'ge-0/0/1',
    });
    l.fromLabel = 'uplink';
    expect(endPortLabel(l, 'from')).toBe('uplink');
    const plain = { id: 'x', type: 'line', from: 'a', to: 'b' };
    expect(withInterfaceLabels(plain)).toBe(plain);
  });

  it('draws in chips, pills and port tables', () => {
    const d = doc();
    expect(renderDocumentToSVG(d, 0)).toContain('>1/1/1<');
    const page = d.pages[0]!;
    expect(portTableRows(d, page, page.nodes[0]!)[0]).toMatchObject({
      port: '1/1/1',
    });
    page.portLabels = 'pill';
    expect(portPillsSVG(d, page)).toContain('>ge-0/0/1<');
  });

  it('an author label wins over the interface in every renderer', () => {
    const d = doc();
    const page = d.pages[0]!;
    page.links[0]!.fromLabel = 'uplink';
    const svg = renderDocumentToSVG(d, 0);
    expect(svg).toContain('>uplink<');
    expect(svg).not.toContain('>1/1/1<');
    expect(portTableRows(d, page, page.nodes[0]!)[0]).toMatchObject({
      port: 'uplink',
    });
  });
});

describe('persistence and shape checks', () => {
  it('round-trips hw, interface + optic fields, lacp and catalogVersion', () => {
    const d = doc();
    bindHardware(
      d,
      d.pages[0]!.nodes[0]!,
      { model: 'aruba-cx-6300m-jl664a', stackMembers: 2, face: 'rear' },
      catalog,
    );
    d.pages[0]!.links[0]!.fromOptic = '10GBASE-SR';
    d.pages[0]!.links[0]!.fromBundle = 'lag1';
    d.bundles = [{ id: 'lag1', lacp: { sw: true } }];
    const back = parseDoc(serializeDoc(d))!;
    expect(back.catalogVersion).toBe(catalog.version);
    expect(back.pages[0]!.nodes[0]!.hw).toEqual({
      model: 'aruba-cx-6300m-jl664a',
      stackMembers: 2,
      face: 'rear',
    });
    expect(back.pages[0]!.links[0]).toMatchObject({
      fromInterface: '1/1/1',
      toInterface: 'ge-0/0/1',
      fromOptic: '10GBASE-SR',
    });
    expect(back.bundles).toEqual([{ id: 'lag1', lacp: { sw: true } }]);
    expect(bundleLacp(back.bundles![0], 'sw')).toBe(true);
    expect(bundleLacp(back.bundles![0], 'fw')).toBe(false);
  });

  it('drops a malformed catalogVersion and lacp on load', () => {
    const raw = JSON.parse(serializeDoc(doc()));
    raw.catalogVersion = '../etc';
    raw.bundles = [{ id: 'lag1', lacp: 'yes' }];
    const back = parseDoc(raw)!;
    expect(back.catalogVersion).toBeUndefined();
    expect(back.bundles).toEqual([{ id: 'lag1' }]);
  });

  it('reports malformed hardware fields as semantic errors', () => {
    const d = doc();
    const [sw, fw] = d.pages[0]!.nodes;
    (sw as unknown as Record<string, unknown>).hw = {
      model: 'BAD MODEL',
      stackMembers: 1.5,
    };
    (fw as unknown as Record<string, unknown>).hw = 'srx300';
    (d.pages[0]!.links[0] as unknown as Record<string, unknown>).toOptic = 7;
    const msgs = hardwareShapeProblems(d).map((p) => p.message);
    expect(msgs).toEqual([
      'hw.model must be a catalog model id',
      'hw.stackMembers must be a positive integer',
      'hw must be an object { model, sku?, stackMembers?, face? }',
      'toOptic must be a string',
    ]);
    const errors = validateDocument(d).filter((p) => p.level === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });

  it('adds nothing for an unbound document', () => {
    const d = doc();
    for (const l of d.pages[0]!.links) {
      delete l.fromInterface;
      delete l.toInterface;
    }
    expect(docHasBindings(d)).toBe(false);
    expect(hardwareShapeProblems(d)).toEqual([]);
  });
});
