/**
 * Mermaid export — brackets per shape, subgraphs per zone, edge operators per
 * dash/weight, type classes, and the round-trip through the Mermaid importer.
 */
import { describe, expect, it } from 'vitest';
import { documentToMermaid, pageToMermaid } from './mermaid.js';
import { convertMermaid } from '../import/mermaid.js';
import { sampleDocument, type Page } from '../pages/model.js';

function page(): Page {
  return {
    id: 'p1',
    name: 'Core',
    viewBox: '0 0 1050 700',
    nodes: [
      {
        id: 'r-1',
        type: 'router',
        x: 100,
        y: 100,
        label: 'Core "A"',
        color: '#01a982',
      },
      {
        id: 'db',
        type: 'database',
        x: 400,
        y: 100,
        label: 'CMDB',
        sublabel: 'Postgres',
      },
      { id: 'end', type: 'shape:diamond', x: 700, y: 100, label: 'Q?' },
    ],
    links: [
      { id: 'l1', type: 'tunnel', from: 'r-1', to: 'db', label: 'IPsec' },
      { id: 'l2', type: 'line', from: 'db', to: 'end', strokeWidth: 4 },
    ],
    anchors: [],
    zones: [
      { id: 'dc', label: 'DC', nodes: ['r-1'] },
      { id: 'inner', label: 'Inner', nodes: ['db'], parentZone: 'dc' },
    ],
    flowPaths: [],
    policyMarkers: [],
  } as Page;
}

describe('pageToMermaid', () => {
  const text = pageToMermaid(page());

  it('writes a flowchart with sanitised ids and quoted labels', () => {
    expect(text.startsWith('flowchart LR\n')).toBe(true);
    expect(text).toContain('r_1("Core #quot;A#quot;")');
    expect(text).toContain('db[("CMDB<br/>Postgres")]');
    expect(text).toContain('end_{"Q?"}'); // keyword id escaped
  });

  it('nests subgraphs and maps edge styles', () => {
    expect(text).toMatch(
      /subgraph zone_dc \["DC"\][\s\S]*subgraph zone_inner \["Inner"\][\s\S]*end[\s\S]*end/,
    );
    expect(text).toContain('r_1 -.-|"IPsec"| db');
    expect(text).toContain('db === end_');
  });

  it('carries device types as classes with their colour', () => {
    expect(text).toContain('classDef router stroke:#01a982,stroke-width:2px');
    expect(text).toContain('class r_1 router');
  });

  it('round-trips through the importer', () => {
    const back = convertMermaid(text);
    expect(back.ok).toBe(true);
    expect(back.warnings).toEqual([]);
    const p = back.document!.pages[0]!;
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    expect(byId.get('r_1')).toMatchObject({
      type: 'router',
      label: 'Core "A"',
    });
    expect(byId.get('db')).toMatchObject({
      type: 'database',
      label: 'CMDB',
      sublabel: 'Postgres',
    });
    expect(byId.get('end_')!.type).toBe('shape:diamond');
    expect(p.links.map((l) => [l.from, l.to, !!l.dashed])).toEqual([
      ['r_1', 'db', true],
      ['db', 'end_', false],
    ]);
    expect(p.zones.find((z) => z.id === 'zone_inner')).toMatchObject({
      parentZone: 'zone_dc',
      nodes: ['db'],
    });
  });
});

describe('documentToMermaid', () => {
  it('separates multi-page documents and can pick one page', () => {
    const doc = sampleDocument();
    doc.pages.push({ ...doc.pages[0]!, id: 'p2', name: 'Two' });
    const all = documentToMermaid(doc);
    expect(all.match(/^flowchart /gm)).toHaveLength(2);
    expect(all).toContain('%% page: Two');
    expect(documentToMermaid(doc, 1).match(/^flowchart /gm)).toHaveLength(1);
    expect(() => documentToMermaid(doc, 5)).toThrow(/out of range/);
  });
});
