import { describe, it, expect } from 'vitest';
import { STOCK_NODE_SPECS, isStockNodeType } from './stock.js';
import { customHitBox, renderCustomNode } from './render.js';
import { shapeGeom } from './data.js';
import { getNodeType } from '../api/catalog.js';
import { createDocument } from '../api/builder.js';
import { renderDocumentToSVG } from '../server/render.js';
import { engineHitBoxes } from '../render/link-attach.js';

describe('chassis stock shape (W7)', () => {
  const spec = STOCK_NODE_SPECS.find((s) => s.typeName === 'chassis')!;

  it('is a stock type in the Network category with a wide, low hit box', () => {
    expect(isStockNodeType('chassis')).toBe(true);
    expect(getNodeType('chassis')!.category).toBe('Network');
    const hb = customHitBox(spec);
    expect(hb.rx).toBeGreaterThan(hb.ry * 4);
    expect(hb).toEqual({ rx: 78, ry: 14 });
    expect(engineHitBoxes().get('chassis')).toEqual(hb);
    const g = shapeGeom('chassis', 0, 0, 10, 2);
    expect(g.tag).toBe('rect');
  });

  it('renders a port row along the bottom edge and draws through the engine', () => {
    const svg = renderCustomNode(spec, 0, 0);
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThanOrEqual(
      spec.portCount + 1,
    );
    const doc = createDocument('C')
      .page()
      .node({
        id: 'sw',
        type: 'chassis',
        x: 300,
        y: 300,
        label: 'SW-VENUE-01',
        sublabel: '(HPE Juniper QFX5120-48Y)',
        labelPlacement: 'n',
      })
      .build();
    const out = renderDocumentToSVG(doc, 0);
    expect(out).toContain('SW-VENUE-01');
    expect(out).toContain('QFX5120-48Y');
  });
});
