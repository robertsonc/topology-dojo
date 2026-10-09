/**
 * Wire labels (#261): link / flow-path / marker label pills wrap, size to
 * their text, honour `labelWidth`, sit on the longest drawn flow segment,
 * shift by `labelOffset`, and slide clear of nodes they would cover.
 */
import { describe, it, expect } from 'vitest';
import { renderPageToSVG } from '../server/render.js';
import type { Page } from '../pages/model.js';
import {
  WIRE_LABEL,
  engineNodeAABB,
  labelLines,
  nudgePill,
  pillSize,
  rectsOverlap,
  wrapAtChars,
} from './wire-labels.js';

function page(partial: Partial<Page>): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 1050 700',
    nodes: [],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
    ...partial,
  } as Page;
}

const ec = (id: string, x: number, y: number): Page['nodes'][number] => ({
  id,
  type: 'ec',
  x,
  y,
});

/** The markup of the `<g data-tds-…="id">` element up to the next data-tds
 * group (groups nest, so the first `</g>` is not its end). */
function group(svg: string, attr: string, id: string): string {
  const start = svg.indexOf(`<g data-tds-${attr}="${id}"`);
  expect(start, `group ${attr}=${id}`).toBeGreaterThanOrEqual(0);
  const next = svg.indexOf('<g data-tds-', start + 1);
  return svg.slice(start, next < 0 ? undefined : next);
}

const PILL_RE =
  /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" rx="5" fill="url\(#tds-labelGlass\)"/;

/** The first glass pill rect inside a markup fragment. */
function pill(frag: string): { x: number; y: number; w: number; h: number } {
  const m = frag.match(PILL_RE);
  expect(m, 'pill rect').not.toBeNull();
  return { x: +m![1]!, y: +m![2]!, w: +m![3]!, h: +m![4]! };
}

/** The pill's label `<text>` (the first text after the glass rect): its x,
 * font size and lines (tspans, or the single content). */
function labelText(frag: string): {
  x: number;
  fontSize: number;
  lines: string[];
} {
  const at = frag.search(PILL_RE);
  expect(at, 'pill rect').toBeGreaterThanOrEqual(0);
  const m = frag
    .slice(at)
    .match(
      /<text x="([\d.-]+)" y="[\d.-]+" text-anchor="middle" fill="[^"]*" font-size="([\d.]+)"[^>]*>(.*?)<\/text>/,
    );
  expect(m, 'label text').not.toBeNull();
  const inner = m![3]!;
  const spans = [...inner.matchAll(/<tspan[^>]*>(.*?)<\/tspan>/g)].map(
    (t) => t[1]!,
  );
  return {
    x: +m![1]!,
    fontSize: +m![2]!,
    lines: spans.length ? spans : [inner],
  };
}

const LONG65 =
  'Encrypted customer traffic from the branch to the regional data hub'; // 65+ chars

describe('wire-label metrics (shared module)', () => {
  it('wraps greedily at the char limit and honours explicit newlines', () => {
    expect(wrapAtChars('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrapAtChars('a\nb c', 10)).toEqual(['a', 'b c']);
    expect(wrapAtChars('supercalifragilistic', 5)).toEqual([
      'supercalifragilistic',
    ]);
  });

  it('caps marker labels at two lines with an ellipsis', () => {
    const lines = labelLines('marker', LONG65);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
    expect(labelLines('flow', LONG65).length).toBeGreaterThan(2);
  });

  it('sizes the pill from the longest wrapped line', () => {
    const lines = labelLines('link', LONG65);
    const longest = Math.max(...lines.map((l) => l.length));
    const { w, h } = pillSize('link', lines);
    expect(w).toBeCloseTo(longest * WIRE_LABEL.link.charW + 14, 5);
    expect(h).toBeCloseTo(lines.length * WIRE_LABEL.link.lineH + 10, 5);
    // A one-line link chip keeps the classic len × 5.6 + 14 × 20 footprint.
    expect(pillSize('link', ['HA'])).toEqual({ w: 2 * 5.6 + 14, h: 20 });
  });

  it('slides a colliding pill along its direction and reports a blocked one', () => {
    const node = { x: 400, y: 300, w: 64, h: 34 };
    const wide = { x: 380, y: 310, w: 100, h: 20 };
    const r = nudgePill(wide, { x: 1, y: 0 }, [node]);
    expect(r.blocked).toBe(false);
    expect(rectsOverlap(r.rect, node)).toBe(false);
    expect(r.dx).toBe(100); // +1 pill width was the first clear trial
    const tiny = { x: 420, y: 310, w: 20, h: 20 };
    const t = nudgePill(tiny, { x: 1, y: 0 }, [node]);
    expect(t.blocked).toBe(true);
    expect(t.rect).toEqual(tiny); // left where it was
    const clear = nudgePill({ x: 0, y: 0, w: 10, h: 10 }, { x: 1, y: 0 }, [
      node,
    ]);
    expect(clear.dx).toBe(0);
  });
});

describe('flow-path labels', () => {
  const two = (extra: Record<string, unknown> = {}): Page =>
    page({
      nodes: [ec('a', 200, 300), ec('b', 700, 300)],
      links: [{ id: 'l', type: 'line', from: 'a', to: 'b' }],
      flowPaths: [{ id: 'fp', waypoints: ['a', 'b'], label: LONG65, ...extra }],
    });

  it('wraps a 65-char label into a multi-line pill sized to its longest line', () => {
    const g = group(renderPageToSVG(two(), []), 'flowpath', 'fp');
    const text = labelText(g);
    const lines = labelLines('flow', LONG65);
    expect(lines.length).toBeGreaterThan(1);
    expect(text.lines).toEqual(lines);
    expect(text.fontSize).toBe(8);
    const r = pill(g);
    const expected = pillSize('flow', lines);
    expect(r.w).toBeCloseTo(expected.w, 5);
    expect(r.h).toBeCloseTo(expected.h, 5);
    expect(r.w).not.toBe(100);
    // The full label rides along for the editor's hit-testing.
    expect(g).toContain(`data-tds-label="${LONG65}"`);
  });

  it('honours labelWidth (narrower wrap → more, shorter lines)', () => {
    const g = group(
      renderPageToSVG(two({ labelWidth: 100 }), []),
      'flowpath',
      'fp',
    );
    const text = labelText(g);
    expect(text.lines).toEqual(labelLines('flow', LONG65, 100));
    expect(text.lines.length).toBeGreaterThan(
      labelLines('flow', LONG65).length,
    );
    // 100px / 6px per char = 16 chars per line → pill ≤ 16 × 6 + 14.
    expect(pill(g).w).toBeLessThanOrEqual(16 * 6 + 14);
    for (const l of text.lines) expect(l.length).toBeLessThanOrEqual(16);
  });

  it('places the label on the longest drawn segment, not the waypoint midpoint', () => {
    // Four waypoints: the classic "midpoint between the two middle waypoints"
    // lands on node b/c's hit box; the longest hop is c→d.
    const svg = renderPageToSVG(
      page({
        nodes: [
          ec('a', 100, 300),
          ec('b', 160, 300),
          ec('c', 220, 300),
          ec('d', 900, 300),
        ],
        flowPaths: [
          { id: 'fp', waypoints: ['a', 'b', 'c', 'd'], label: 'East' },
        ],
      }),
      [],
    );
    const x = labelText(group(svg, 'flowpath', 'fp')).x;
    expect(x).toBeGreaterThan(400);
    expect(x).toBeLessThan(800);
  });

  it('uses the straight hops when followLinks is false', () => {
    const svg = renderPageToSVG(
      page({
        nodes: [ec('a', 100, 300), ec('b', 300, 300), ec('c', 900, 300)],
        links: [
          {
            id: 'l',
            type: 'line',
            from: 'b',
            to: 'c',
            waypoints: [{ x: 600, y: 120 }],
          },
        ],
        flowPaths: [
          {
            id: 'fp',
            waypoints: ['a', 'b', 'c'],
            label: 'East',
            followLinks: false,
          },
        ],
      }),
      [],
    );
    const g = group(svg, 'flowpath', 'fp');
    // Straight b→c midpoint (600,300) nudged 12px perpendicular, not the
    // waypointed link's detour over (600,120).
    expect(labelText(g).x).toBeCloseTo(600, 0);
    expect(pill(g).y).toBeGreaterThan(290);
  });

  it('shifts the pill by labelOffset', () => {
    const base = labelText(
      group(renderPageToSVG(two({ label: 'East' }), []), 'flowpath', 'fp'),
    ).x;
    const moved = labelText(
      group(
        renderPageToSVG(
          two({ label: 'East', labelOffset: { x: 40, y: 0 } }),
          [],
        ),
        'flowpath',
        'fp',
      ),
    ).x;
    expect(moved - base).toBeCloseTo(40, 5);
  });
});

describe('policy-marker labels', () => {
  it('renders a 40-char label as two 8px lines in a pill', () => {
    const label = 'Inspect all outbound traffic for malware'; // 40 chars
    const svg = renderPageToSVG(
      page({
        nodes: [ec('a', 400, 300)],
        policyMarkers: [{ id: 'm', nodeId: 'a', type: 'inspect', label }],
      }),
      [],
    );
    const g = group(svg, 'marker', 'm');
    const text = labelText(g);
    expect(text.fontSize).toBe(8);
    expect(text.lines).toHaveLength(2);
    expect(text.lines.join(' ')).toBe(label);
    expect(g).toContain('fill="url(#tds-labelGlass)"');
    expect(g).not.toContain('font-size="6"');
  });

  it('truncates past two lines with an ellipsis', () => {
    const svg = renderPageToSVG(
      page({
        nodes: [ec('a', 400, 300)],
        policyMarkers: [
          { id: 'm', nodeId: 'a', type: 'inspect', label: LONG65 },
        ],
      }),
      [],
    );
    const text = labelText(group(svg, 'marker', 'm'));
    expect(text.lines).toHaveLength(2);
    expect(text.lines[1]!.endsWith('…')).toBe(true);
  });
});

describe('collision nudge', () => {
  it('slides a link label clear of a node it would cover, deterministically', () => {
    // A horizontal a→b link puts its label at (450, 312); node n's hit box
    // (418–482 × 318–352) overlaps it. One pill width to the right is clear.
    const doc = page({
      nodes: [ec('a', 200, 300), ec('b', 700, 300), ec('n', 450, 335)],
      links: [
        {
          id: 'l',
          type: 'line',
          from: 'a',
          to: 'b',
          label: 'Primary uplink 10G',
        },
      ],
    });
    const svg = renderPageToSVG(doc, []);
    const r = pill(group(svg, 'link', 'l'));
    const n = engineNodeAABB({ type: 'ec', x: 450, y: 335 });
    expect(rectsOverlap(r, n)).toBe(false);
    expect(r.x + r.w / 2).toBeGreaterThan(450); // slid along the wire
    expect(renderPageToSVG(doc, [])).toBe(svg);
  });

  it('leaves a label that cannot be cleared where it was', () => {
    const svg = renderPageToSVG(
      page({
        nodes: [ec('a', 200, 300), ec('b', 700, 300), ec('n', 450, 335)],
        links: [{ id: 'l', type: 'line', from: 'a', to: 'b', label: 'HA' }],
      }),
      [],
    );
    expect(labelText(group(svg, 'link', 'l')).x).toBeCloseTo(450, 5);
  });

  it('nudges a flow-path label off a node under its segment midpoint', () => {
    const svg = renderPageToSVG(
      page({
        nodes: [ec('a', 200, 300), ec('b', 700, 300), ec('n', 450, 335)],
        flowPaths: [
          { id: 'fp', waypoints: ['a', 'b'], label: 'Branch to hub traffic' },
        ],
      }),
      [],
    );
    const r = pill(group(svg, 'flowpath', 'fp'));
    expect(
      rectsOverlap(r, engineNodeAABB({ type: 'ec', x: 450, y: 335 })),
    ).toBe(false);
  });

  it('nudges a corner marker label off its own node, and leaves a clear one alone', () => {
    const marker = (align: 'NE' | 'S'): Page =>
      page({
        nodes: [ec('a', 400, 300)],
        policyMarkers: [
          {
            id: 'm',
            nodeId: 'a',
            type: 'inspect',
            label: 'Deep packet inspection',
            align,
          },
        ],
      });
    const n = engineNodeAABB({ type: 'ec', x: 400, y: 300 });
    // NE: the badge sits at the node's top-right corner, so a 22-char label
    // hanging under it would cover the node — it slides right (outward).
    const ne = pill(group(renderPageToSVG(marker('NE'), []), 'marker', 'm'));
    expect(rectsOverlap(ne, n)).toBe(false);
    expect(ne.x + ne.w / 2).toBeGreaterThan(400 + 32 + 14);
    // S: the badge is below the node and its label is already clear — it
    // stays centred under the badge.
    const s = pill(group(renderPageToSVG(marker('S'), []), 'marker', 'm'));
    expect(rectsOverlap(s, n)).toBe(false);
    expect(s.x + s.w / 2).toBeCloseTo(400, 5);
  });
});
