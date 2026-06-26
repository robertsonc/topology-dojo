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
