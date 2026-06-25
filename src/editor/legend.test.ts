import { describe, it, expect } from 'vitest';
import { buildLegendItems, legendSVG } from './legend.js';
import { createDocument } from '../api/builder.js';
import type { TopologyDocument } from '../pages/model.js';

function docWith(): TopologyDocument {
  return createDocument('Net')
    .page()
    .node({ id: 'a', type: 'ec', x: 0, y: 0, color: '#05cc93' })
    .node({ id: 'b', type: 'ec', x: 50, y: 0, color: '#05cc93' }) // dup type+color
    .node({ id: 'c', type: 'firewall', x: 100, y: 0, color: '#fc6161' })
    .link({ id: 'l', type: 'line', from: 'a', to: 'b' })
    .policyMarker({ id: 'm', nodeId: 'a', type: 'inspect', color: '#65aef9' })
    .build();
}

describe('auto-legend (B.1)', () => {
  it('lists distinct in-use node types + markers, deduped', () => {
    const doc = docWith();
    const items = buildLegendItems(doc, doc.pages[0]!);
    // ec (once, deduped), firewall, and the marker — three entries.
    expect(items).toHaveLength(3);
    expect(items.filter((i) => i.shape === 'dot')).toHaveLength(3);
    expect(items.some((i) => /firewall/i.test(i.label))).toBe(true);
    expect(items.some((i) => i.color === '#fc6161')).toBe(true);
    expect(items.some((i) => /marker/.test(i.label))).toBe(true);
  });

  it('includes a declared layer only when an element uses it', () => {
    const doc = createDocument('L')
      .page()
      .node({ id: 'a', type: 'ec', x: 0, y: 0, layer: 'overlay' })
      .build();
    doc.layers = [{ id: 'overlay', name: 'Overlay', color: '#7764fc' }];
    const items = buildLegendItems(doc, doc.pages[0]!);
    const layerItem = items.find((i) => i.shape === 'bar');
    expect(layerItem?.label).toBe('Overlay');
    expect(layerItem?.color).toBe('#7764fc');
  });

  it('renders nothing unless the document opts in', () => {
    const doc = docWith();
    expect(legendSVG(doc, doc.pages[0]!)).toBe(''); // legend absent → off
    doc.legend = { show: true, position: 'br' };
    const svg = legendSVG(doc, doc.pages[0]!);
    expect(svg).toContain('class="tds-legend"');
    expect(svg).toContain('translate('); // positioned into a corner
    expect(svg).toMatch(/firewall/i);
  });

  it('positions the legend in the requested corner', () => {
    const doc = docWith();
    doc.legend = { show: true, position: 'tl' };
    const tl = legendSVG(doc, doc.pages[0]!);
    doc.legend = { show: true, position: 'br' };
    const br = legendSVG(doc, doc.pages[0]!);
    // Different corners → different translate offsets.
    expect(tl).not.toBe(br);
    expect(tl).toContain('translate(16,16)'); // top-left = page origin + margin
  });
});
