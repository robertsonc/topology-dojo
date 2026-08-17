/**
 * Node status LEDs (plan Phase 6.1) — `status` renders a coloured LED at
 * the node's corner in the shared engine path; the legend gains one LED
 * entry per distinct in-use status; the catalog exposes the enum so agents
 * discover it; validation flags out-of-range values.
 */
import { describe, it, expect } from 'vitest';
import { renderPageToSVG } from '../server/render.js';
import { buildLegendItems } from '../editor/legend.js';
import { getNodeType } from '../api/catalog.js';
import { validateDocument } from '../api/validate.js';
import type { Page, TopologyDocument } from '../pages/model.js';

function page(status?: string): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 600 400',
    nodes: [
      {
        id: 'a',
        type: 'router',
        x: 300,
        y: 200,
        label: 'R1',
        ...(status ? { status } : {}),
      },
    ],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  } as unknown as Page;
}

function doc(status?: string): TopologyDocument {
  return {
    title: 'T',
    customNodes: [],
    pages: [page(status)],
  } as unknown as TopologyDocument;
}

describe('status LED rendering', () => {
  it('renders no indicator by default', () => {
    expect(renderPageToSVG(page(), [])).not.toContain('data-tds-status');
  });

  it('renders a coloured LED per status', () => {
    for (const [st, color] of [
      ['ok', '#01a982'],
      ['warn', '#e0a44a'],
      ['down', '#fc6161'],
      ['maintenance', '#65aef9'],
      ['unknown', '#7d8a92'],
    ] as const) {
      const svg = renderPageToSVG(page(st), []);
      expect(svg).toContain(`data-tds-status="${st}"`);
      expect(svg).toContain(`fill="${color}"`);
    }
  });

  it('down gets the attention ring; ok does not', () => {
    const down = renderPageToSVG(page('down'), []);
    const ok = renderPageToSVG(page('ok'), []);
    expect(down).toContain('r="7" fill="none"');
    expect(ok).not.toContain('r="7" fill="none"');
  });
});

describe('status contract', () => {
  it('legend gains one LED entry per in-use status', () => {
    const d = doc('down');
    const items = buildLegendItems(d, d.pages[0]!);
    expect(items.some((i) => i.label === 'status: down')).toBe(true);
    const clean = doc();
    expect(
      buildLegendItems(clean, clean.pages[0]!).some((i) =>
        i.label.startsWith('status:'),
      ),
    ).toBe(false);
  });

  it('the catalog exposes the status enum on nodes', () => {
    const f = getNodeType('router')?.fields.find((x) => x.key === 'status');
    expect(f?.kind).toBe('enum');
    expect(f?.options).toContain('down');
  });

  it('validation flags an unknown status value', () => {
    const problems = validateDocument(doc('exploded'));
    expect(
      problems.some(
        (p) => p.level === 'warning' && p.message.includes('exploded'),
      ),
    ).toBe(true);
  });
});
