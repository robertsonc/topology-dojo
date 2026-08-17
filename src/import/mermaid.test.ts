/**
 * Mermaid flowchart import (plan Phase 4.4) — the dependency-free parser:
 * detection, node shapes → vocabulary mapping, edge variants + labels,
 * chains and `&` fan-out, subgraphs → zones, warnings for skipped syntax,
 * and the auto-layout finish (no nodes left stacked at 0,0).
 */
import { describe, expect, it } from 'vitest';
import { convertMermaid, detectMermaid } from './mermaid.js';
import { validateDocument } from '../api/validate.js';

const FLOW = `
%% comment
flowchart LR
  user[User] --> fw{Allowed?}
  fw -->|yes| web(Web tier)
  fw -->|no| deny[Blocked]
  web --> db[(Orders DB)]
  subgraph dmz [DMZ]
    fw
    web
  end
`;

describe('detectMermaid', () => {
  it('detects flowchart/graph headers past comments', () => {
    expect(detectMermaid(FLOW)).toBe(true);
    expect(detectMermaid('graph TD\nA-->B')).toBe(true);
    expect(detectMermaid('{"pages": []}')).toBe(false);
    expect(detectMermaid('from,to\na,b')).toBe(false);
  });
});

describe('convertMermaid', () => {
  const result = convertMermaid(FLOW, 'Order flow');
  const page = result.document!.pages[0]!;

  it('parses all nodes with shape-mapped types', () => {
    expect(result.ok).toBe(true);
    const byId = new Map(page.nodes.map((n) => [n.id, n]));
    expect(byId.get('user')).toMatchObject({
      type: 'shape:rectangle',
      label: 'User',
    });
    expect(byId.get('fw')).toMatchObject({
      type: 'shape:diamond',
      label: 'Allowed?',
    });
    expect(byId.get('web')).toMatchObject({
      type: 'shape:ellipse',
      label: 'Web tier',
    });
    expect(byId.get('db')).toMatchObject({
      type: 'database',
      label: 'Orders DB',
    });
  });

  it('parses edges with pipe labels', () => {
    expect(page.links).toHaveLength(4);
    const yes = page.links.find((l) => l.label === 'yes');
    expect(yes).toMatchObject({ from: 'fw', to: 'web' });
  });

  it('maps subgraphs to zones', () => {
    expect(page.zones).toHaveLength(1);
    expect(page.zones[0]).toMatchObject({ label: 'DMZ' });
    expect([...page.zones[0]!.nodes].sort()).toEqual(['fw', 'web']);
  });

  it('lays the page out (nothing left stacked at the origin)', () => {
    const spots = new Set(page.nodes.map((n) => `${n.x},${n.y}`));
    expect(spots.size).toBe(page.nodes.length);
  });

  it('produces a document that validates without errors', () => {
    const errors = validateDocument(result.document!).filter(
      (p) => p.level === 'error',
    );
    expect(errors).toEqual([]);
  });

  it('handles chains, fan-out, dashed and thick edges', () => {
    const r = convertMermaid(
      'graph TD\nA --> B --> C\nA & B -.-> D\nC == heavy ==> E\nB -- note --> F',
    );
    expect(r.ok).toBe(true);
    const links = r.document!.pages[0]!.links;
    // A→B, B→C, A→D, B→D, C→E, B→F
    expect(links).toHaveLength(6);
    expect(links.filter((l) => l.dashed)).toHaveLength(2);
    expect(links.find((l) => l.label === 'heavy')).toMatchObject({
      from: 'C',
      to: 'E',
      strokeWidth: 3,
    });
    expect(links.find((l) => l.label === 'note')).toMatchObject({
      from: 'B',
      to: 'F',
    });
  });

  it('warns on skipped directives and unparsable lines', () => {
    const r = convertMermaid(
      'flowchart TD\nA --> B\nclassDef red fill:#f00\nstyle A fill:#00f\n@@nonsense',
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('classDef'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('style'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('nonsense'))).toBe(true);
  });

  it('rejects non-flowchart text with a clear error', () => {
    const r = convertMermaid('sequenceDiagram\nA->>B: hi');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('flowchart');
  });
});
