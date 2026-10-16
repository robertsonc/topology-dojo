import { describe, it, expect } from 'vitest';
import { createDocument } from '../api/builder.js';
import {
  naturalCompare,
  portTableRows,
  portTables,
  portTableReserve,
  portTablesSVG,
} from './port-table.js';
import { defineBundle } from '../api/bundles.js';
import { ETHERNET_MEDIA_STYLES } from '../api/link-styles.js';
import { analyzeLayout } from '../api/layout.js';
import { layoutDocument } from '../api/autolayout.js';
import { renderDocumentToSVG } from '../server/render.js';
import { getNodeType } from '../api/catalog.js';

function fabric() {
  const doc = createDocument('T')
    .page({ viewBox: '0 0 1600 1000' })
    .node({
      id: 'sw1',
      type: 'chassis',
      x: 500,
      y: 500,
      label: 'SW-VENUE-01',
      portTable: {},
    })
    .node({
      id: 'sw2',
      type: 'chassis',
      x: 1100,
      y: 500,
      label: 'SW-VENUE-02',
      portTable: { side: 'e' },
    })
    .node({ id: 'gw', type: 'chassis', x: 800, y: 200, label: 'GW-WLAN-01' })
    .node({ id: 'rt', type: 'chassis', x: 800, y: 800, label: 'RT-CORE-01' })
    .link({
      id: 'l1',
      type: 'line',
      from: 'gw',
      to: 'sw1',
      fromLabel: '0/0/4',
      toLabel: 'xe-0/0/10',
      fromBundle: 'ae0',
      toBundle: 'ae10',
      style: '10g-dac',
    })
    .link({
      id: 'l2',
      type: 'line',
      from: 'sw1',
      to: 'rt',
      fromLabel: 'xe-0/0/48',
      toLabel: 'et-0/0/8',
      style: '100g-dac',
    })
    .link({
      id: 'l3',
      type: 'line',
      from: 'sw1',
      to: 'sw2',
      fromLabel: 'et-0/0/55',
      toLabel: 'et-0/0/55',
      fromBundle: 'icl',
      toBundle: 'icl',
      bandwidth: '100G',
    })
    .link({
      id: 'l4',
      type: 'line',
      from: 'gw',
      to: 'sw1',
      fromLabel: '0/0/5',
      toLabel: 'xe-0/0/8',
      fromBundle: 'ae0',
      toBundle: 'ae8',
    })
    .build();
  doc.linkStyles = [...ETHERNET_MEDIA_STYLES];
  defineBundle(doc, { id: 'icl', kind: 'icl' });
  return doc;
}

describe('derived port tables (W5)', () => {
  it('sorts naturally', () => {
    const ports = [
      'xe-0/0/10',
      'xe-0/0/8',
      'et-0/0/0:1',
      'et-0/0/0:0',
      'ae2',
      'ae10',
    ];
    expect([...ports].sort(naturalCompare)).toEqual([
      'ae2',
      'ae10',
      'et-0/0/0:0',
      'et-0/0/0:1',
      'xe-0/0/8',
      'xe-0/0/10',
    ]);
  });

  it('derives Port | LAG | PHY | Peer rows from the links touching a node', () => {
    const doc = fabric();
    const page = doc.pages[0]!;
    const rows = portTableRows(doc, page, page.nodes[0]!);
    expect(rows.map((r) => [r.port, r.bundle, r.phy, r.peer])).toEqual([
      ['et-0/0/55', '-', '100G', 'SW-VENUE-02 | et-0/0/55 (ICL)'],
      ['xe-0/0/8', 'ae8', '-', 'GW-WLAN-01 | 0/0/5'],
      ['xe-0/0/10', 'ae10', '10GBASE-DA (DAC)', 'GW-WLAN-01 | 0/0/4'],
      ['xe-0/0/48', '-', '100GBASE-DA (DAC)', 'RT-CORE-01 | et-0/0/8'],
    ]);
  });

  it('places tables in the margins, stacked and inside the frame', () => {
    const doc = fabric();
    const page = doc.pages[0]!;
    const tables = portTables(doc, page);
    expect(tables.map((t) => `${t.nodeId}:${t.side}`)).toEqual([
      'sw1:w',
      'sw2:e',
    ]);
    const [w, e] = tables;
    expect(w!.rect.x).toBe(16);
    expect(e!.rect.x + e!.rect.w).toBe(1600 - 16);
    // Centred on the node unless pushed.
    expect(w!.rect.y + w!.rect.h / 2).toBeCloseTo(500, 5);
    // Two tables on one side never overlap.
    page.nodes[2]!.portTable = { side: 'w' };
    page.nodes[2]!.y = 480;
    const stacked = portTables(doc, page).filter((t) => t.side === 'w');
    expect(stacked).toHaveLength(2);
    const [a, b] = stacked.sort((p, q) => p.rect.y - q.rect.y);
    expect(b!.rect.y).toBeGreaterThanOrEqual(a!.rect.y + a!.rect.h + 10);
    // Reserve covers the widest table per side.
    const reserve = portTableReserve(doc, page);
    expect(reserve.left).toBeGreaterThan(Math.max(a!.rect.w, b!.rect.w));
    expect(reserve.right).toBeGreaterThan(e!.rect.w);
  });

  it('renders the table, is catalogued, and the analyzer / tiered layout respect it', () => {
    const doc = fabric();
    const page = doc.pages[0]!;
    const svg = portTablesSVG(doc, page);
    expect(svg).toContain('class="tds-port-tables"');
    expect(svg).toContain('>SW-VENUE-01<');
    expect(svg).toContain('>Peer | Port<');
    expect(svg).toContain('>xe-0/0/48<');
    expect(renderDocumentToSVG(doc, 0)).toContain('tds-port-tables');
    expect(
      getNodeType('chassis')!.fields.some(
        (f) => f.key === 'portTable' && f.kind === 'object',
      ),
    ).toBe(true);
    expect(
      analyzeLayout(doc).filter((p) => /port table/.test(p.message)),
    ).toEqual([]);
    // A node sitting in the margin collides with the table.
    page.nodes[3]!.x = 60;
    page.nodes[3]!.y = 500;
    expect(
      analyzeLayout(doc).some((p) =>
        /port table of "sw1" overlaps node "rt"/.test(p.message),
      ),
    ).toBe(true);
    // The tiered layout keeps the rows clear of the reserved margins.
    doc.tiers = [{ id: 'gw' }, { id: 'dist' }, { id: 'core' }];
    page.nodes[2]!.tier = 'gw';
    page.nodes[0]!.tier = 'dist';
    page.nodes[1]!.tier = 'dist';
    page.nodes[3]!.tier = 'core';
    layoutDocument(doc, { algorithm: 'tiered', mirror: true });
    expect(
      analyzeLayout(doc).filter((p) => /port table/.test(p.message)),
    ).toEqual([]);
  });

  it('keeps clear of the legend and title block in its corner', () => {
    const doc = fabric();
    const page = doc.pages[0]!;
    doc.sheet = { titleBlock: { fields: [{ label: 'Revision', value: '1' }] } };
    doc.legend = { show: true, position: 'bl', columns: 3 };
    page.nodes[0]!.y = 980;
    page.nodes[1]!.y = 980;
    const [w, e] = portTables(doc, page);
    expect(w!.rect.y + w!.rect.h).toBeLessThan(1000 - 32);
    expect(e!.rect.y + e!.rect.h).toBeLessThan(1000 - 32);
    expect(w!.rect.x).toBe(32); // inside the sheet border
  });
});
