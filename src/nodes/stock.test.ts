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
});
