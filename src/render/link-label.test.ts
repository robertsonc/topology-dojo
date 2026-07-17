/**
 * Line links must render their centre `label`.
 *
 * Every other link type (tunnel/flow/packet/wifi/…) renders its own label, but
 * the line/flow renderers were called with a null label, so a `line` link's
 * `label` silently never appeared. It now renders a centre chip, honouring
 * `labelOffset` so it can be repositioned.
 */
import { describe, it, expect } from 'vitest';
import { renderPageToSVG } from '../server/render.js';
import type { Page } from '../pages/model.js';

function linePage(extra: Record<string, unknown>): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 1050 700',
    nodes: [
      { id: 'a', type: 'ec', x: 200, y: 300 },
      { id: 'b', type: 'ec', x: 500, y: 300 },
    ],
    links: [{ id: 'L', type: 'line', from: 'a', to: 'b', ...extra }],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  } as unknown as Page;
}

/** The x of the label `<text>` whose content is `label`, else NaN. */
function labelX(svg: string, label: string): number {
  const m = svg.match(new RegExp(`<text x="([\\d.-]+)"[^>]*>${label}</text>`));
  return m ? +m[1]! : NaN;
}

/** The label scale transform `translate(cx cy) scale(s) …`, else null. */
function labelScaleXform(
  svg: string,
): { cx: number; cy: number; s: number } | null {
  const m = svg.match(
    /translate\(([\d.-]+) ([\d.-]+)\) scale\(([\d.]+)\) translate\(/,
  );
  return m ? { cx: +m[1]!, cy: +m[2]!, s: +m[3]! } : null;
}

describe('line link label', () => {
  it('renders the line link’s centre label', () => {
    const svg = renderPageToSVG(linePage({ label: 'EdgeHA123' }), []);
    expect(svg).toContain('>EdgeHA123</text>');
  });

  it('renders the label even with ports set (no waypoints)', () => {
    const svg = renderPageToSVG(
      linePage({ label: 'HA', fromPort: 'e', toPort: 'w' }),
      [],
    );
    expect(svg).toContain('>HA</text>');
  });

  it('shifts the label by labelOffset (moveable)', () => {
    const base = labelX(renderPageToSVG(linePage({ label: 'X' }), []), 'X');
    const shifted = labelX(
      renderPageToSVG(
        linePage({ label: 'X', labelOffset: { x: 40, y: 0 } }),
        [],
      ),
      'X',
    );
    expect(Number.isFinite(base)).toBe(true);
    expect(shifted - base).toBeCloseTo(40, 1);
  });

  it('adds the label text only when a label is set', () => {
    const count = (s: string): number => (s.match(/<text /g) ?? []).length;
    const without = count(renderPageToSVG(linePage({}), []));
    const withLabel = count(renderPageToSVG(linePage({ label: 'Zzz' }), []));
    expect(withLabel).toBe(without + 1);
  });
});

describe('line link labelScale', () => {
  it('leaves the label untransformed at the default (byte-identical to no scale)', () => {
    const plain = renderPageToSVG(linePage({ label: 'X' }), []);
    // Absent, an explicit 1, and an out-of-range≤0 (invalid → default) are all
    // the default: no scale wrapper is emitted, so old documents are unchanged.
    expect(labelScaleXform(plain)).toBeNull();
    expect(renderPageToSVG(linePage({ label: 'X', labelScale: 1 }), [])).toBe(
      plain,
    );
    expect(renderPageToSVG(linePage({ label: 'X', labelScale: 0 }), [])).toBe(
      plain,
    );
  });

  it('wraps the label in a uniform scale about its own anchor', () => {
    const x = labelX(renderPageToSVG(linePage({ label: 'X' }), []), 'X');
    const svg = renderPageToSVG(linePage({ label: 'X', labelScale: 2 }), []);
    const xform = labelScaleXform(svg);
    expect(xform).not.toBeNull();
    expect(xform!.s).toBe(2);
    // Scale is about the label's anchor, so the text x is unchanged and the
    // transform's centre equals it.
    expect(xform!.cx).toBeCloseTo(x, 1);
    expect(labelX(svg, 'X')).toBeCloseTo(x, 1);
  });

  it('clamps labelScale into [0.25, 4]', () => {
    expect(
      labelScaleXform(
        renderPageToSVG(linePage({ label: 'X', labelScale: 10 }), []),
      )!.s,
    ).toBe(4);
    expect(
      labelScaleXform(
        renderPageToSVG(linePage({ label: 'X', labelScale: 0.05 }), []),
      )!.s,
    ).toBe(0.25);
  });

  it('scales endpoint (from/to) labels too', () => {
    const svg = renderPageToSVG(
      linePage({ fromLabel: 'ge-0/0/1', labelScale: 1.5 }),
      [],
    );
    expect(svg).toContain('>ge-0/0/1</text>');
    expect(labelScaleXform(svg)!.s).toBe(1.5);
  });
});
