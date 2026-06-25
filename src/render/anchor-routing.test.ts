/**
 * Regression test for the anchor-routing bug (Phase 0) — kept boundary-aware
 * after PR-A2 (A.4 boundary attachment).
 *
 * Phase 0: any link with an anchor endpoint used to render a malformed quadratic
 * "exit stub" — `M<anchor> Q<control> <mid> L<node>` — whose control handle
 * pointed *away* from the target (hooks/loops/zig-zags), because the smart-route
 * detour treated the INET clouds (whose padded AABB sits on the anchors at
 * y=140) as obstructions. The fix skips smart routing for anchor endpoints.
 *
 * A.4: a link's *node* endpoint now attaches to the node's perimeter facing the
 * other end, not its centre — so the node ends below land on the EC edge, while
 * the anchor ends (dimensionless) stay exactly on the anchor.
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

/** Every `ec` node in the fixture; the engine's AABB half-extents are 32×17. */
const EC = { hw: 32, hh: 17 };

/**
 * Mirror the engine's `_attachEndpoint` for a rounded-rect node: clip the
 * centre→toward ray to the box, then back off the 3px gap along the direction.
 */
const GAP = 3;
function attach(
  node: { x: number; y: number },
  toward: { x: number; y: number },
): { x: number; y: number } {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: node.x, y: node.y };
  const ux = dx / len;
  const uy = dy / len;
  const s = 1 / Math.max(Math.abs(ux) / EC.hw, Math.abs(uy) / EC.hh);
  return { x: node.x + ux * (s + GAP), y: node.y + uy * (s + GAP) };
}

/** Parse `<line>` endpoints out of the rendered SVG. */
function lines(
  svg: string,
): { x1: number; y1: number; x2: number; y2: number }[] {
  return [
    ...svg.matchAll(
      /<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/g,
    ),
  ].map((m) => ({
    x1: +m[1]!,
    y1: +m[2]!,
    x2: +m[3]!,
    y2: +m[4]!,
  }));
}

const near = (a: number, b: number, tol = 0.6): boolean =>
  Math.abs(a - b) <= tol;

describe('anchor routing (blah.json repro)', () => {
  const svg = renderPageToSVG(page, []);

  it('straight anchor→node lines are a single segment, anchor→edge, no curve', () => {
    for (const id of ['lmqsr9b3t5', 'lmqsr9iqz6', 'lmqsr9s578']) {
      const link = page.links.find((l) => l.id === id)!;
      const a = pos(link.from); // anchor end — exact
      const n = pos(link.to); // node centre
      const edge = attach(n, a); // node end — trimmed to the EC perimeter
      // A straight <line> from the anchor to the node's edge exists.
      const hit = lines(svg).some(
        (l) =>
          near(l.x1, a.x) &&
          near(l.y1, a.y) &&
          near(l.x2, edge.x) &&
          near(l.y2, edge.y),
      );
      expect(hit).toBe(true);
      // It terminates on the icon edge, not the centre (proves A.4 trims it).
      expect(near(edge.y, n.y)).toBe(false);
    }
  });

  it('no rendered path has a control point pointing away from its target', () => {
    for (const link of page.links) {
      const a = pos(link.from);
      const t = pos(link.to);
      const vx = t.x - a.x;
      const vy = t.y - a.y;
      // The curve still starts exactly at the anchor (`M<anchor>`); its first
      // control point must not head backward (negative dot with anchor→target).
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

  it('the curved tunnel is a single smooth curve from the anchor to the node edge', () => {
    const link = page.links.find((l) => l.id === 'lmqsr9odv7')!;
    const a = pos(link.from); // anchor
    const n = pos(link.to); // node centre
    const edge = attach(n, a); // node end on the EC perimeter
    // One quadratic from the anchor straight to the edge — no intermediate L.
    const re = new RegExp(
      `M${a.x},${a.y} Q[\\d.eE+-]+,[\\d.eE+-]+ ${edge.x.toFixed(0)}[\\d.]*,${edge.y.toFixed(0)}[\\d.]*`,
    );
    // Be tolerant of formatting: assert the path starts at the anchor with a
    // single Q and contains no `L`.
    const path = [...svg.matchAll(/d="([^"]*)"/g)]
      .map((mm) => mm[1]!)
      .find((d) => d.startsWith(`M${a.x},${a.y} Q`));
    expect(path).toBeTruthy();
    expect(/L/.test(path!)).toBe(false);
    // Endpoint sits on the EC edge toward the anchor (east side here).
    const end = path!.match(/Q[\d.eE+-]+,[\d.eE+-]+ ([\d.eE+-]+),([\d.eE+-]+)/);
    expect(near(+end![1]!, edge.x)).toBe(true);
    expect(near(+end![2]!, edge.y)).toBe(true);
    void re;
  });

  it('node→node link trims both ends to their facing edges (no regression)', () => {
    const withCtrl: Page = {
      ...page,
      links: [
        ...page.links,
        { id: 'CTRL', type: 'line', from: 'nmqsmxeix0', to: 'nmqsmxgdl1' },
      ],
    };
    const out = renderPageToSVG(withCtrl, []);
    const a = pos('nmqsmxeix0'); // (280,240)
    const b = pos('nmqsmxgdl1'); // (571,240)
    const ea = attach(a, b); // east edge of a
    const eb = attach(b, a); // west edge of b
    const hit = lines(out).some(
      (l) =>
        near(l.x1, ea.x) &&
        near(l.y1, ea.y) &&
        near(l.x2, eb.x) &&
        near(l.y2, eb.y),
    );
    expect(hit).toBe(true);
  });

  it('an explicit port pins the endpoint to that side of the node', () => {
    const ported: Page = {
      ...page,
      links: [
        {
          id: 'P',
          type: 'line',
          from: 'nmqsmxeix0',
          to: 'nmqsmxgdl1',
          fromPort: 'n',
          toPort: 's',
        } as Page['links'][number],
      ],
    };
    const out = renderPageToSVG(ported, []);
    const a = pos('nmqsmxeix0');
    const b = pos('nmqsmxgdl1');
    const hit = lines(out).some(
      (l) =>
        near(l.x1, a.x) && // north port keeps centre-x
        near(l.y1, a.y - EC.hh) && // …on the top edge
        near(l.x2, b.x) &&
        near(l.y2, b.y + EC.hh), // south port: bottom edge
    );
    expect(hit).toBe(true);
  });
});
