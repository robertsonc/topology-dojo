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
