import { describe, it, expect } from 'vitest';
import { STOCK_NODE_SPECS, isStockNodeType } from './stock.js';
import { createDocument } from '../api/builder.js';
import { validateDocument } from '../api/validate.js';
import { nodeCatalog, getNodeType } from '../api/catalog.js';

describe('stock cloud-native node types', () => {
  it('ships gateway types and reports them', () => {
    expect(isStockNodeType('tgw')).toBe(true);
    expect(isStockNodeType('vpngw')).toBe(true);
    expect(isStockNodeType('definitely-not-a-type')).toBe(false);
    // Containers stay on zones, not stock node types.
    expect(isStockNodeType('vpc')).toBe(false);
  });

  it('validation accepts stock types without a per-document definition', () => {
    const doc = createDocument('AWS hub')
      .page()
      .node({ id: 'gw', type: 'tgw', x: 200, y: 200, label: 'TGW' })
      .node({ id: 'igw', type: 'igw', x: 400, y: 200, label: 'IGW' })
      .build();
    const errors = validateDocument(doc).filter((p) => p.level === 'error');
    expect(errors).toEqual([]);
  });

  it('surfaces stock types in the catalog as built-in Cloud entries', () => {
    const types = new Set(nodeCatalog().map((n) => n.type));
    for (const s of STOCK_NODE_SPECS) expect(types.has(s.typeName)).toBe(true);
    const tgw = getNodeType('tgw')!;
    expect(tgw.category).toBe('Cloud');
    expect(tgw.custom).toBe(false);
    expect(tgw.label).toBe('Transit Gateway');
    // It carries the common editable fields (so the inspector + layers work).
    expect(tgw.fields.some((f) => f.key === 'x')).toBe(true);
    expect(tgw.fields.some((f) => f.key === 'layer')).toBe(true);
  });

  it('ships the generic IT/network pack with categories + search aliases', () => {
    // Every generic-pack type is a shipped built-in with a friendly label.
    for (const t of [
      'loadbalancer',
      'proxy',
      'wlc',
      'modem',
      'dns',
      'webserver',
      'mailserver',
      'nas',
      'ups',
      'printer',
      'camera',
      'voip',
      'iot',
      'vm',
      'containerNode',
      'k8s',
      'ids',
      'vpnconc',
      'usergroup',
    ]) {
      expect(isStockNodeType(t)).toBe(true);
      const info = getNodeType(t)!;
      expect(info.custom).toBe(false);
      expect(info.label).not.toBe(t); // has a human label
      expect(info.category).not.toBe('Cloud'); // categorized, not lumped
    }
    // Search aliases work through the same palette filter humans use.
    const lb = nodeCatalog().find((n) => n.type === 'loadbalancer')!;
    expect(lb.keywords).toContain('haproxy');
    expect(getNodeType('ids')?.category).toBe('Security');
    expect(getNodeType('vm')?.category).toBe('Compute');
  });

  it('ships place types as one Places family with search aliases', () => {
    const places = ['branchoffice', 'campus', 'datacenter', 'homeoffice'];
    for (const t of places) {
      const info = getNodeType(t)!;
      expect(info.custom).toBe(false);
      expect(info.category).toBe('Places');
    }
    // One family colour and shape, so a site never reads as an appliance.
    const specs = STOCK_NODE_SPECS.filter((s) => places.includes(s.typeName));
    expect(new Set(specs.map((s) => s.colorStroke)).size).toBe(1);
    expect(new Set(specs.map((s) => s.shape))).toEqual(new Set(['square']));
    const hit = (q: string) =>
      nodeCatalog()
        .filter((n) => n.keywords?.includes(q))
        .map((n) => n.type);
    expect(hit('remote worker')).toEqual(['homeoffice']);
    expect(hit('dc')).toContain('datacenter');
  });

  it('ships the tier 1 SASE / identity / SOC / management types', () => {
    const expected: Record<string, string> = {
      ssepop: 'Security',
      nac: 'Security',
      authserver: 'Security',
      waf: 'Security',
      siem: 'Security',
      directory: 'Security',
      orchestrator: 'Edge',
      l3switch: 'Network',
      mobile: 'Endpoint',
      managedendpoint: 'Endpoint',
    };
    for (const [t, category] of Object.entries(expected)) {
      const info = getNodeType(t)!;
      expect(info.custom, t).toBe(false);
      expect(info.category, t).toBe(category);
      expect(info.label, t).not.toBe(t);
    }
    const find = (q: string) =>
      nodeCatalog()
        .filter((n) => n.keywords?.includes(q))
        .map((n) => n.type);
    expect(find('clearpass')).toEqual(['nac']);
    expect(find('radius')).toEqual(['authserver']);
    expect(find('mist')).toEqual(['orchestrator']);
    // Shape encodes forwarding role: the L3 switch is a rounded square.
    const l3 = STOCK_NODE_SPECS.find((s) => s.typeName === 'l3switch')!;
    expect(l3.shape).toBe('square');
    expect(l3.radius).toBeGreaterThan(3);
  });

  it('generic-pack nodes validate and render without per-document definitions', () => {
    const doc = createDocument('Campus')
      .page()
      .node({ id: 'lb', type: 'loadbalancer', x: 200, y: 200, label: 'LB' })
      .node({ id: 'cam', type: 'camera', x: 400, y: 200, label: 'Cam-1' })
      .node({ id: 'k', type: 'k8s', x: 600, y: 200, label: 'Cluster' })
      .build();
    const errors = validateDocument(doc).filter((p) => p.level === 'error');
    expect(errors).toEqual([]);
  });
});
