/**
 * Degenerate boundary-attachment guard.
 *
 * A.4 trims each node endpoint to the perimeter facing the other end (+ a 3px
 * gap). When two nodes sit closer than the sum of those insets, the trimmed
 * endpoints cross *past* each other and the link draws backwards — a wide tunnel
 * glow then collapses under the icons and looks like it vanished. The engine
 * detects the reversal and falls back to centre→centre so a short, correctly
 * oriented link still renders.
 */
import { describe, it, expect } from 'vitest';
import { renderPageToSVG } from '../server/render.js';
import type { Page } from '../pages/model.js';

function page(ax: number, bx: number, type = 'tunnel'): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 1050 700',
    nodes: [
      { id: 'a', type: 'ec', x: ax, y: 300 },
      { id: 'b', type: 'ec', x: bx, y: 300 },
    ],
    links: [{ id: 'L', type, from: 'a', to: 'b' }],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  } as unknown as Page;
}

/** First→last x of the tunnel's dashed-overlay stroke (its drawn path). */
function tunnelDx(svg: string): number {
  const m = svg.match(/<path\b[^>]*\bd="(M[^"]+)"[^>]*stroke-dasharray="6 5"/);
  if (!m) return NaN;
  const n = [...m[1]!.matchAll(/-?\d+(?:\.\d+)?/g)].map((x) => +x[0]!);
  return n[n.length - 2]! - n[0]!;
}

describe('link crossing guard (degenerate close nodes)', () => {
  it('keeps a normal-distance tunnel forward and edge-attached', () => {
    // a(300) → b(700): a right edge 335, b left edge 665 → Δx ≈ +330.
    const dx = tunnelDx(renderPageToSVG(page(300, 700), []));
    expect(dx).toBeGreaterThan(300);
  });

  it('does not draw a close-node tunnel backwards (it would vanish)', () => {
    // a(400) → b(430), only 30px apart: edge+gap insets (35 each) cross, which
    // pre-guard produced a reversed path (435→395, Δx ≈ −40). The guard falls
    // back to centre→centre (Δx = +30), so the tunnel stays visible + forward.
    const dx = tunnelDx(renderPageToSVG(page(400, 430), []));
    expect(dx).toBeGreaterThan(0);
  });

  it('handles fully overlapping nodes without reversing', () => {
    const dx = tunnelDx(renderPageToSVG(page(400, 408), []));
    expect(dx).toBeGreaterThanOrEqual(0);
  });
});
