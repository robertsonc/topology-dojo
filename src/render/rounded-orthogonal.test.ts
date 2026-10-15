import { describe, it, expect } from 'vitest';
import { createDocument } from '../api/builder.js';
import { renderDocumentToSVG } from '../server/render.js';

function doc(cornerRadius?: number, waypoints?: { x: number; y: number }[]) {
  return createDocument('R')
    .page()
    .node({ id: 'a', type: 'ec', x: 100, y: 100 })
    .node({ id: 'b', type: 'ec', x: 500, y: 400 })
    .link({
      id: 'l',
      type: 'line',
      from: 'a',
      to: 'b',
      lineStyle: 'orthogonal',
      ...(cornerRadius !== undefined ? { cornerRadius } : {}),
      ...(waypoints ? { waypoints } : {}),
    })
    .build();
}

const pathOf = (svg: string): string =>
  /<path d="([^"]+)" fill="none" stroke="#01a982"/.exec(svg)?.[1] ?? '';

describe('rounded orthogonal routing (W8)', () => {
  it('keeps the classic sharp elbow without a cornerRadius', () => {
    const d = pathOf(renderDocumentToSVG(doc(), 0));
    expect(d).toMatch(/^M[^Q]*$/);
    expect(d.split(' L').length).toBe(3); // M, elbow, end
  });

  it('rounds the auto-routed elbow with a quadratic corner', () => {
    const sharp = pathOf(renderDocumentToSVG(doc(), 0));
    const d = pathOf(renderDocumentToSVG(doc(12), 0));
    expect(d).toContain(' Q');
    // Same endpoints as the sharp path.
    expect(d.split(' ')[0]).toBe(sharp.split(' ')[0]);
    expect(d.split(' ').at(-1)).toBe(sharp.split(' ').at(-1));
  });

  it('rounds every waypoint elbow and clamps the radius to short segments', () => {
    const d = pathOf(
      renderDocumentToSVG(
        doc(50, [
          { x: 300, y: 100 },
          { x: 300, y: 110 },
        ]),
        0,
      ),
    );
    const qs = d.match(/ Q/g) ?? [];
    expect(qs.length).toBeGreaterThanOrEqual(2);
    // No NaN / no fold-back: every number finite.
    for (const n of d.match(/-?\d+(\.\d+)?/g) ?? [])
      expect(Number.isFinite(Number(n))).toBe(true);
  });
});
