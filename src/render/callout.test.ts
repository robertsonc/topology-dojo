/**
 * Callout / sticky-note node (plan Phase 3.4) — a tinted note with wrapped
 * text and an optional dashed leader line to a target element; geometry
 * tracks the wrapped block; a dangling target warns; deleting the target
 * clears the pointer (cascade); annotation nodes are never flagged as
 * "unconnected".
 */
import { describe, it, expect } from 'vitest';
import { renderPageToSVG } from '../server/render.js';
import { nodeHalf } from '../api/geometry.js';
import { validateDocument } from '../api/validate.js';
import { cascadeEndpointRemoval } from '../pages/cascade.js';
import type { Page, TopologyDocument } from '../pages/model.js';

function page(callout: Record<string, unknown>): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 800 500',
    nodes: [
      { id: 'r1', type: 'router', x: 550, y: 250, label: 'R1' },
      { id: 'r2', type: 'router', x: 700, y: 250, label: 'R2' },
      {
        id: 'note1',
        type: 'callout',
        x: 200,
        y: 150,
        label: 'Replace this router during the maintenance window',
        ...callout,
      },
    ],
    links: [{ id: 'l1', type: 'line', from: 'r1', to: 'r2' }],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  } as unknown as Page;
}

function doc(callout: Record<string, unknown>): TopologyDocument {
  return {
    title: 'T',
    customNodes: [],
    pages: [page(callout)],
  } as unknown as TopologyDocument;
}

describe('callout rendering', () => {
  it('renders a tinted folded note with wrapped text', () => {
    const svg = renderPageToSVG(page({}), []);
    expect(svg).toContain('fill-opacity=".12"'); // the note card
    expect(svg).toContain('Replace this'); // wrapped text present
    // Wrapped over multiple <text> lines at the default 160 width.
    const lines = svg.match(/font-size="12" font-weight="600"/g) ?? [];
    expect(lines.length).toBeGreaterThan(1);
  });

  it('draws a dashed leader line + dot to the target element', () => {
    const svg = renderPageToSVG(page({ target: 'r1' }), []);
    expect(svg).toContain('stroke-dasharray="4 3"');
    expect(svg).toContain('cx="550" cy="250" r="2.5"');
  });

  it('renders no leader when the target is absent or unknown', () => {
    for (const p of [page({}), page({ target: 'ghost' })]) {
      const svg = renderPageToSVG(p, []);
      expect(svg).not.toContain('stroke-dasharray="4 3"');
    }
  });

  it('does not double-draw the generic below-node label', () => {
    const svg = renderPageToSVG(page({ label: 'UniqueNoteText' }), []);
    expect(svg.match(/UniqueNoteText/g)).toHaveLength(1);
  });
});

describe('callout geometry + contract', () => {
  it('nodeHalf tracks the declared width and the wrapped block', () => {
    const short = nodeHalf({
      id: 'c',
      type: 'callout',
      x: 0,
      y: 0,
      label: 'Hi',
    });
    expect(short.w).toBe(80); // 160 default width / 2
    const wide = nodeHalf({
      id: 'c',
      type: 'callout',
      x: 0,
      y: 0,
      width: 300,
      label: 'Hi',
    });
    expect(wide.w).toBe(150);
    const tall = nodeHalf({
      id: 'c',
      type: 'callout',
      x: 0,
      y: 0,
      label:
        'A much longer annotation that will definitely wrap onto several lines at the default width',
    });
    expect(tall.h).toBeGreaterThan(short.h);
  });

  it('warns on a dangling target, silent on a valid one', () => {
    const bad = validateDocument(doc({ target: 'ghost' }));
    expect(
      bad.some(
        (p) => p.level === 'warning' && p.message.includes('callout target'),
      ),
    ).toBe(true);
    const good = validateDocument(doc({ target: 'r1' }));
    expect(good.filter((p) => p.message.includes('callout target'))).toEqual(
      [],
    );
  });

  it('is never flagged as an unconnected node', () => {
    const problems = validateDocument(doc({}));
    expect(
      problems.filter(
        (p) =>
          p.message.includes('unconnected node') && p.where.includes('note1'),
      ),
    ).toEqual([]);
  });

  it('deleting the target clears the pointer (cascade)', () => {
    const pg = page({ target: 'r1' });
    const out = cascadeEndpointRemoval(pg, new Set(['r1']));
    expect(out.calloutTargets).toBe(1);
    expect(
      (pg.nodes.find((n) => n.id === 'note1') as { target?: string }).target,
    ).toBeUndefined();
    // The note itself survives.
    expect(pg.nodes.some((n) => n.id === 'note1')).toBe(true);
  });
});
