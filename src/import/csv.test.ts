/**
 * CSV import (plan Phase 4.5) — sectioned nodes+links tables, bare edge
 * lists, quoting, meta.* columns, zone grouping, unknown-type fallbacks
 * with line-numbered warnings, and the layout decision (explicit x/y for
 * every node → no auto-layout).
 */
import { describe, expect, it } from 'vitest';
import { convertCsv, detectCsv } from './csv.js';
import { validateDocument } from '../api/validate.js';

const SECTIONED = `
[nodes]
id,label,type,zone,x,y,meta.location
core1,Core 1,switchEnterprise,DC,,,Building A
edge1,"Edge, one",ec,Branch,,,
srv1,App server,server,DC,,,
[links]
from,to,type,label,vlan
core1,edge1,tunnel,uplink,100
core1,srv1,line,,
`;

describe('detectCsv', () => {
  it('detects sectioned and edge-list CSVs, rejects JSON/mermaid', () => {
    expect(detectCsv(SECTIONED)).toBe(true);
    expect(detectCsv('from,to\na,b')).toBe(true);
    expect(detectCsv('{"pages": []}')).toBe(false);
    expect(detectCsv('flowchart TD\nA-->B')).toBe(false);
  });
});

describe('convertCsv — sectioned', () => {
  const r = convertCsv(SECTIONED, 'Site data');
  const page = r.document!.pages[0]!;

  it('builds nodes with types, quoted labels, and metadata', () => {
    expect(r.ok).toBe(true);
    const byId = new Map(page.nodes.map((n) => [n.id, n]));
    expect(byId.get('core1')).toMatchObject({
      type: 'switchEnterprise',
      label: 'Core 1',
      meta: { location: 'Building A' },
    });
    expect(byId.get('edge1')).toMatchObject({ label: 'Edge, one', type: 'ec' });
  });

  it('groups zone column values into zones', () => {
    expect(page.zones).toHaveLength(2);
    const dc = page.zones.find((z) => z.label === 'DC')!;
    expect([...dc.nodes].sort()).toEqual(['core1', 'srv1']);
  });

  it('builds links with types and link metadata', () => {
    expect(page.links).toHaveLength(2);
    expect(page.links[0]).toMatchObject({
      from: 'core1',
      to: 'edge1',
      type: 'tunnel',
      label: 'uplink',
      vlan: '100',
    });
  });

  it('lays out (no x/y given) and validates clean', () => {
    const spots = new Set(page.nodes.map((n) => `${n.x},${n.y}`));
    expect(spots.size).toBe(page.nodes.length);
    expect(
      validateDocument(r.document!).filter((p) => p.level === 'error'),
    ).toEqual([]);
  });
});

describe('convertCsv — edge list + edge cases', () => {
  it('a bare from,to list creates implicit hosts', () => {
    const r = convertCsv('from,to,label\nA,B,uplink\nB,C,');
    expect(r.ok).toBe(true);
    const page = r.document!.pages[0]!;
    expect(page.nodes.map((n) => n.type)).toEqual(['host', 'host', 'host']);
    expect(page.links).toHaveLength(2);
  });

  it('falls back on unknown types with line-numbered warnings', () => {
    const r = convertCsv(
      '[nodes]\nid,type\nA,quantumrouter\n[links]\nfrom,to,type\nA,A2,warp',
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('quantumrouter'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('warp'))).toBe(true);
    const page = r.document!.pages[0]!;
    expect(page.nodes.find((n) => n.id === 'A')!.type).toBe('host');
    expect(page.links[0]!.type).toBe('line');
  });

  it('keeps explicit coordinates when every node has them', () => {
    const r = convertCsv(
      '[nodes]\nid,x,y\nA,100,200\nB,400,200\n[links]\nfrom,to\nA,B',
    );
    const page = r.document!.pages[0]!;
    expect(page.nodes.find((n) => n.id === 'A')).toMatchObject({
      x: 100,
      y: 200,
    });
    expect(page.nodes.find((n) => n.id === 'B')).toMatchObject({
      x: 400,
      y: 200,
    });
  });

  it('errors clearly on a missing id header or empty input', () => {
    expect(convertCsv('[nodes]\nname\nA').error).toContain('"id"');
    expect(convertCsv('#only comments\n').ok).toBe(false);
  });
});
