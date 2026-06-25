/**
 * A.4 boundary-attachment acceptance — the EdgeHA fixtures.
 *
 * `EdgeHA_before.json` is the workaround a user had to build before A.4: ~10
 * hand-placed anchors wired anchor→anchor with `flow` links just to make
 * connections land on node edges. `EdgeHA_after.json` expresses the *same*
 * topology (dual internet → HA EC pair + an EC↔EC HA link) as 5 plain
 * node→node links with **zero anchors** — which boundary attachment makes
 * possible.
 *
 * These tests pin the acceptance criteria so the geometry can't silently
 * regress: every link endpoint attaches to the node's perimeter facing the
 * other end, never the centre, and the `before` workaround still renders.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { renderPageToSVG } from '../server/render.js';
import type { Page } from '../pages/model.js';

function load(name: string): Page {
  const doc = JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)),
      'utf8',
    ),
  ) as { pages: Page[] };
  return doc.pages[0]!;
}

/** First and last point of every rendered `<path d="M…">` (the link strokes). */
function pathEnds(
  svg: string,
): { sx: number; sy: number; ex: number; ey: number }[] {
  const out: { sx: number; sy: number; ex: number; ey: number }[] = [];
  for (const m of svg.matchAll(/<path[^>]*\bd="(M[^"]+)"/g)) {
    const n = [...m[1]!.matchAll(/-?\d+(?:\.\d+)?/g)].map((x) => +x[0]!);
    if (n.length >= 4)
      out.push({
        sx: n[0]!,
        sy: n[1]!,
        ex: n[n.length - 2]!,
        ey: n[n.length - 1]!,
      });
  }
  return out;
}

/** Endpoints of every short `<line>` (excludes the full-bleed backdrop grid). */
function lineEnds(
  svg: string,
): { x1: number; y1: number; x2: number; y2: number }[] {
  return [
    ...svg.matchAll(
      /<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/g,
    ),
  ]
    .map((m) => ({ x1: +m[1]!, y1: +m[2]!, x2: +m[3]!, y2: +m[4]! }))
    .filter((l) => l.x2 < 900 && l.y2 < 650); // drop the backdrop frame lines
}

const near = (a: number, b: number, tol = 1.5): boolean =>
  Math.abs(a - b) <= tol;

describe('A.4 boundary attachment — EdgeHA_after (no anchors)', () => {
  const page = load('EdgeHA_after.json');
  const svg = renderPageToSVG(page, []);
  const ends = pathEnds(svg);

  // Node geometry: EC half-extents 32×17; cloud half-height ≈ 36.
  const EC_TOP = 260 - 17; // 243
  const CLOUD_BOTTOM = 60 + 36; // 96

  it('expresses the topology with zero anchors', () => {
    expect(page.anchors).toHaveLength(0);
    expect(page.links).toHaveLength(5);
  });

  it('clouds emit from their bottom edge; ECs receive on their top edge', () => {
    // The four flow links each render as glow-layered paths; every one starts
    // at a cloud's bottom edge (y≈96, below centre 60) and ends at an EC's top
    // edge (y≈243, above centre 260).
    const flows = ends.filter((e) => near(e.sy, CLOUD_BOTTOM));
    expect(flows.length).toBeGreaterThanOrEqual(4);
    for (const f of flows) {
      expect(f.sy).toBeGreaterThan(60); // emitted downward from the cloud
      expect(near(f.ey, EC_TOP)).toBe(true); // landed on the EC top edge
    }
  });

  it('never attaches a flow endpoint at a node centre', () => {
    const centres = page.nodes.map((n) => ({ x: n.x, y: n.y }));
    for (const e of ends)
      for (const c of centres) {
        expect(near(e.sx, c.x) && near(e.sy, c.y)).toBe(false);
        expect(near(e.ex, c.x) && near(e.ey, c.y)).toBe(false);
      }
  });

  it('routes the HA link EC1-right-edge → EC2-left-edge', () => {
    // BR1-01 centre (220,260) right edge x=252; BR1-02 (400,260) left edge x=368.
    const ha = lineEnds(svg).find(
      (l) => near(l.y1, 260) && near(l.y2, 260) && Math.abs(l.x2 - l.x1) > 80,
    );
    expect(ha).toBeDefined();
    expect(near(ha!.x1, 252)).toBe(true); // EC1 right edge
    expect(near(ha!.x2, 368)).toBe(true); // EC2 left edge
  });

  it('separates the two flows converging on one EC top (A.8, both visible)', () => {
    // BR1-01 receives flows from both clouds; their landing x differ, so they
    // do not overlap on the EC top edge.
    const landings = ends
      .filter((e) => near(e.ey, EC_TOP) && near(e.ex, 220, 20))
      .map((e) => Math.round(e.ex));
    expect(new Set(landings).size).toBeGreaterThanOrEqual(2);
  });
});

describe('A.4 no-regression — EdgeHA_before (manual anchors)', () => {
  it('still renders the anchor workaround without error', () => {
    const page = load('EdgeHA_before.json');
    expect(page.anchors.length).toBeGreaterThanOrEqual(10);
    const svg = renderPageToSVG(page, []);
    expect(svg).toContain('<svg');
    // The anchor→anchor flow links still draw (paths present).
    expect(pathEnds(svg).length).toBeGreaterThan(0);
  });
});
