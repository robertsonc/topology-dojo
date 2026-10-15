/**
 * Golden check for the reference wiring sheet (proposal 0008): the fixture
 * `fixtures/venue-distribution-leaf.json` is what
 * `scripts/build-wiring-sheet-fixture.ts` produces through the public
 * authoring API. The render must carry every convention — sheet frame, top
 * title, title block, tier bands captioned at the bottom, port pills, LAG
 * rings, link-style Key rows, derived port tables — and validate / layout /
 * inspect must all come back clean, in both themes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDoc, serializeDoc } from '../pages/persist.js';
import { validateDocument } from '../api/validate.js';
import { analyzeLayout } from '../api/layout.js';
import { layoutDocument } from '../api/autolayout.js';
import { inspectPage } from './inspect.js';
import { renderDocumentToSVG } from '../server/render.js';
import { portTables } from './port-table.js';
import { portPills, bundleOutlines } from './port-pills.js';

const fixture = fileURLToPath(
  new URL('../../fixtures/venue-distribution-leaf.json', import.meta.url),
);

describe('reference wiring sheet (proposal 0008 acceptance)', () => {
  const doc = parseDoc(readFileSync(fixture, 'utf8'))!;
  const page = doc.pages[0]!;

  it('round-trips through persist and keeps every wiring-sheet field', () => {
    expect(parseDoc(serializeDoc(doc))).toEqual(doc);
    expect(doc.sheet?.size).toBe('ansi-c');
    expect(page.viewBox).toBe('0 0 2112 1632');
    expect(doc.tiers?.map((t) => t.id)).toEqual(['gw', 'dist', 'core']);
    expect(doc.linkStyles?.length).toBe(11);
    expect(doc.bundles).toEqual([{ id: 'icl', kind: 'icl' }]);
    expect(page.portLabels).toBe('pill');
    expect(page.linkAttach).toEqual({ pad: 4, distribute: true });
  });

  it('validates, lays out and inspects clean', () => {
    expect(validateDocument(doc)).toEqual([]);
    expect(analyzeLayout(doc)).toEqual([]);
    const report = inspectPage(page, { customNodes: doc.customNodes });
    expect(report.counts.crop.problems).toBe(0);
    expect(report.counts.text.problems).toBe(0);
    expect(report.counts.routing.problems).toBe(0);
    expect(report.counts.density.problems).toBe(0);
  });

  it('the tiered layout is a fixed point of the fixture (deterministic)', () => {
    const again = structuredClone(doc);
    layoutDocument(again, {
      algorithm: 'tiered',
      mirror: true,
      spacing: 90,
      tierGap: 260,
    });
    expect(again.pages[0]!.nodes.map((n) => [n.id, n.x, n.y])).toEqual(
      page.nodes.map((n) => [n.id, n.x, n.y]),
    );
  });

  it('derives the port tables and pills the reference sheet shows', () => {
    const tables = portTables(doc, page);
    expect(tables.map((t) => `${t.nodeId}:${t.side}`)).toEqual([
      'sw-venue-01:w',
      'sw-venue-02:e',
      'rt-core-01:w',
      'rt-core-02:e',
    ]);
    const sw1 = tables[0]!;
    expect(sw1.rows).toHaveLength(12);
    expect(sw1.rows.find((r) => r.port === 'xe-0/0/8')).toEqual({
      linkId: expect.any(String),
      port: 'xe-0/0/8',
      bundle: 'ae8',
      phy: '10GBASE-DA (DAC)',
      peer: 'GW-WLAN-01 | 0/0/4',
    });
    expect(sw1.rows.find((r) => r.port === 'et-0/0/55')?.peer).toBe(
      'SW-VENUE-02 | et-0/0/55 (ICL)',
    );
    const pills = portPills(page, doc.customNodes);
    // Every link end carries a port name, so every end is a pill.
    expect(pills).toHaveLength(page.links.length * 2);
    // Gateway-side MC-LAGs ring two pills each; single ESI-LAG legs do not.
    const rings = bundleOutlines(pills, doc.bundles);
    expect(rings.map((r) => `${r.nodeId}:${r.bundle}`).sort()).toEqual([
      'gw-ubt-01:lacp0',
      'gw-ubt-02:lacp0',
      'gw-wlan-01:lacp0',
      'gw-wlan-02:lacp0',
      'me-wlan-01:ae0',
      'me-wlan-01:ae1',
      'me-wlan-02:ae0',
      'me-wlan-02:ae1',
    ]);
  });

  it.each(['light', 'dark'] as const)(
    'renders every convention (%s)',
    (theme) => {
      const svg = renderDocumentToSVG(doc, 0, { theme });
      for (const marker of [
        'class="tds-sheet"',
        'HPE Discover 2026 – Venue Distribution Leaf Details',
        'Venue Distribution Leaf Details', // title-block subtitle
        'Drawn by',
        '>Distribution<',
        '>Core<',
        '>AOS-10 Mobility<',
        'class="tds-port-pills"',
        'data-bundle="lacp0"',
        'class="tds-port-tables"',
        '>Peer | Port<',
        'class="tds-legend"',
        '>Key<',
        '>100GBASE-DA (DAC)<',
        '>LACP LAG<',
      ])
        expect(svg, marker).toContain(marker);
      // Pill mode: no engine glass chip carries a port name.
      expect(svg).not.toMatch(/opacity="\.9">xe-0\/0\/8</);
      // Light theme flips the pill ink: dark pill, white text.
      if (theme === 'light') {
        expect(svg).toContain('fill="#1d1f27"');
        expect(svg).not.toContain('fill="#141820"');
      }
    },
  );
});
