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

describe('callout body (#259)', () => {
  // ~770 chars: far past the 200-char label cap, wraps to many lines.
  const BODY = Array.from(
    { length: 10 },
    (_, i) =>
      `Step ${i + 1} drains traffic from the standby appliance and verifies every tunnel`,
  ).join(' ');
  // Baselines may be negative: the tall note is centred at y=150.
  const BODY_LINE =
    /<text x="[^"]+" y="(-?[\d.]+)" fill="[^"]+" font-size="12" font-weight="400"/g;

  /** Height of the note card path: M{x0},{y0} H… L… V{y0+h} H{x0} Z. */
  function cardHeight(svg: string): number {
    const m = svg.match(
      /<path d="M-?[\d.]+,(-?[\d.]+) H-?[\d.]+ L-?[\d.]+,-?[\d.]+ V(-?[\d.]+) H/,
    );
    expect(m).not.toBeNull();
    return Number(m![2]) - Number(m![1]);
  }

  it('renders every word of a long body, wrapped at the note width', () => {
    const svg = renderPageToSVG(page({ body: BODY }), []);
    expect(svg).not.toContain('…');
    expect(svg).not.toContain(`>${BODY}<`);
    for (const word of BODY.split(' ')) expect(svg).toContain(word);
    // Regular-weight body lines, distinct from the bold label lines.
    expect((svg.match(BODY_LINE) ?? []).length).toBeGreaterThan(5);
  });

  it('stacks label, body, sublabel and grows the card to fit the body', () => {
    const cfg = { body: BODY, sublabel: 'SubUniqueTail' };
    const withBody = renderPageToSVG(page(cfg), []);
    const without = renderPageToSVG(page({ sublabel: 'SubUniqueTail' }), []);
    const bodyYs = [...withBody.matchAll(BODY_LINE)].map((m) => Number(m[1]));
    const labelY = Number(
      withBody.match(
        /<text x="[^"]+" y="(-?[\d.]+)" fill="[^"]+" font-size="12" font-weight="600"/,
      )![1],
    );
    const subY = Number(
      withBody.match(/<text x="[^"]+" y="(-?[\d.]+)"[^>]*>SubUniqueTail</)![1],
    );
    expect(Math.min(...bodyYs)).toBeGreaterThan(labelY);
    expect(subY).toBeGreaterThan(Math.max(...bodyYs));
    expect(cardHeight(withBody)).toBeGreaterThan(cardHeight(without) + 100);
    // The geometry mirror (nodeHalf) must agree with the drawn card exactly,
    // otherwise validate_topology / inspect_render drift from the picture.
    const node = page(cfg).nodes.find((n) => n.id === 'note1')!;
    expect(cardHeight(withBody)).toBeCloseTo(nodeHalf(node).h * 2, 6);
    expect(cardHeight(without)).toBeCloseTo(
      nodeHalf(page({ sublabel: 'SubUniqueTail' }).nodes[2]!).h * 2,
      6,
    );
  });

  it('keeps explicit newlines in the body', () => {
    const svg = renderPageToSVG(
      page({ body: 'Alpha first line\n\nBeta second line' }),
      [],
    );
    expect(svg).toContain('>Alpha first line<');
    expect(svg).toContain('>Beta second line<');
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
