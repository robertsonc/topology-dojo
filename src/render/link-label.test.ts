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

/** The x of the data-llabel chip's text (which side: from/to/centre). */
function chipTextX(svg: string, which: string, text: string): number {
  const m = svg.match(
    new RegExp(
      `data-llabel="${which}"[^]*?<text x="([\\d.-]+)"[^>]*>${text}</text>`,
    ),
  );
  return m ? +m[1]! : NaN;
}

describe('line link label', () => {
  it('renders the line link’s centre label', () => {
    const svg = renderPageToSVG(linePage({ label: 'EdgeHA123' }), []);
    expect(svg).toContain('>EdgeHA123</text>');
  });

  it('tags labels as draggable chips (data-llabel) for the editor', () => {
    const svg = renderPageToSVG(
      linePage({ label: 'C', fromLabel: 'wan1', toLabel: 'wan2' }),
      [],
    );
    expect(svg).toContain('data-llabel="from"');
    expect(svg).toContain('data-llabel="to"');
    expect(svg).toContain('data-llabel="centre"');
  });

  it('shifts an interface label by its per-label offset (moveable)', () => {
    const baseX = chipTextX(
      renderPageToSVG(linePage({ fromLabel: 'wan1' }), []),
      'from',
      'wan1',
    );
    const movedX = chipTextX(
      renderPageToSVG(
        linePage({ fromLabel: 'wan1', fromLabelOffset: { x: 30, y: 0 } }),
        [],
      ),
      'from',
      'wan1',
    );
    expect(movedX - baseX).toBeCloseTo(30, 1);
  });

  it('scales label font size by labelScale (resizable)', () => {
    const fonts = (svg: string): number[] =>
      [...svg.matchAll(/font-size="([\d.]+)"/g)]
        .map((m) => +m[1]!)
        .filter((f) => f < 20);
    const big = Math.max(
      ...fonts(
        renderPageToSVG(linePage({ fromLabel: 'wan1', labelScale: 2 }), []),
      ),
    );
    const small = Math.max(
      ...fonts(renderPageToSVG(linePage({ fromLabel: 'wan1' }), [])),
    );
    expect(big).toBeGreaterThan(small);
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
