/**
 * Regression test for the anchor-routing bug (Phase 0).
 *
 * Before the fix, any link with an anchor endpoint rendered as a malformed
 * quadratic "exit stub" — `M<anchor> Q<control> <mid> L<node>` — whose control
 * handle pointed *away* from the target, producing hooks/loops/zig-zags. The
 * cause: the smart-routing detour treated a node whose hit-box happens to touch
 * the anchor (here the INET clouds, whose padded AABB bottom edge sits on the
 * anchors at y=140) as an obstruction and bent the path backward around it.
 *
 * The fixture is the exact `blah.json` repro from the bug analysis.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { renderPageToSVG } from '../server/render.js';
import type { Page } from '../pages/model.js';

const doc = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('./__fixtures__/anchor-routing.json', import.meta.url),
    ),
    'utf8',
  ),
) as { pages: Page[] };
const page = doc.pages[0]!;

/** Resolve a node/anchor id to its point in the fixture. */
function pos(id: string): { x: number; y: number } {
  const a = page.anchors.find((p) => p.id === id);
  if (a) return { x: a.x, y: a.y };
  const n = page.nodes.find((p) => p.id === id)!;
  return { x: n.x, y: n.y };
}

describe('anchor routing (blah.json repro)', () => {
  const svg = renderPageToSVG(page, []);

  it('straight anchor→node lines render with no curve command', () => {
    // The two type:"line" anchor links must be straight — no Q/C anywhere that
    // belongs to them. We assert the rendered SVG contains a straight <line>
    // for each anchor and that no path's control point points backward.
    for (const id of ['lmqsr9b3t5', 'lmqsr9iqz6', 'lmqsr9s578']) {
      const link = page.links.find((l) => l.id === id)!;
      const a = pos(link.from);
      const t = pos(link.to);
      // A straight segment from the anchor to the node center exists.
      const lineRe = new RegExp(
        `<line x1="${a.x}" y1="${a.y}" x2="${t.x}" y2="${t.y}"`,
      );
      expect(lineRe.test(svg)).toBe(true);
    }
  });

  it('no rendered path has a control point pointing away from its target', () => {
    // For each anchor→node link, the vector (control − anchor) must not have a
    // negative dot product with (target − anchor): no backward exit handle.
    for (const link of page.links) {
      const a = pos(link.from);
      const t = pos(link.to);
      const vx = t.x - a.x;
      const vy = t.y - a.y;
      // Pull every Q/C control coordinate out of the whole SVG; check those near
      // this anchor (the curve starts at the anchor with `M<anchor>`).
      const startsHere = new RegExp(
        `M${a.x},${a.y} [QC]([\\d.eE+-]+),([\\d.eE+-]+)`,
      );
      const m = svg.match(startsHere);
      if (!m) continue;
      const cx = Number(m[1]) - a.x;
      const cy = Number(m[2]) - a.y;
      expect(cx * vx + cy * vy).toBeGreaterThanOrEqual(0);
    }
  });

  it('the curved tunnel is a single smooth curve toward the target (no detour)', () => {
    const link = page.links.find((l) => l.id === 'lmqsr9odv7')!;
    const a = pos(link.from);
    const t = pos(link.to);
    // A single quadratic from anchor straight to the node, no intermediate L.
    const re = new RegExp(
      `M${a.x},${a.y} Q[\\d.eE+-]+,[\\d.eE+-]+ ${t.x},${t.y}`,
    );
    expect(re.test(svg)).toBe(true);
  });

  it('still renders a node→node link as a clean straight line (no regression)', () => {
    const withCtrl: Page = {
      ...page,
      links: [
        ...page.links,
        { id: 'CTRL', type: 'line', from: 'nmqsmxeix0', to: 'nmqsmxgdl1' },
      ],
    };
    const out = renderPageToSVG(withCtrl, []);
    expect(/<line x1="280" y1="240" x2="571" y2="240"/.test(out)).toBe(true);
  });
});
