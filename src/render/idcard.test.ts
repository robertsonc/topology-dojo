/**
 * An ID card is drawn where every model of it says it is: centred on the
 * node's position. (It used to be drawn with its top-left corner there, so its
 * selection frame and hit box sat up-left of the art and links stopped short.)
 */
import { describe, expect, it } from 'vitest';
import { renderDocumentToSVG } from '../server/render.js';
import { engineAABB, engineHitBoxes, linkEndpoints } from './link-attach.js';
import { nodeBounds } from '../api/geometry.js';
import type { Page, TopologyDocument } from '../pages/model.js';

const page: Page = {
  id: 'p',
  name: 'F',
  viewBox: '0 0 1000 700',
  nodes: [
    { id: 'id', type: 'idcard', x: 500, y: 300, user: 'alice', host: 'laptop' },
    { id: 'r', type: 'router', x: 850, y: 300, label: 'R' },
  ],
  links: [{ id: 'l', type: 'line', from: 'id', to: 'r' }],
  anchors: [],
  zones: [],
  flowPaths: [],
  policyMarkers: [],
} as unknown as Page;

const svg = renderDocumentToSVG({
  title: 't',
  customNodes: [],
  pages: [page],
} as TopologyDocument);

/** The card body the engine drew. */
function cardRect(): { x: number; y: number; w: number; h: number } {
  const m = /<rect x="([-\d.]+)" y="([-\d.]+)" width="194" height="73"/.exec(
    svg,
  )!;
  return { x: +m[1]!, y: +m[2]!, w: 194, h: 73 };
}

describe('ID card geometry', () => {
  it('is drawn centred on the node position', () => {
    const r = cardRect();
    expect(r.x + r.w / 2).toBeCloseTo(500, 5);
    expect(r.y + r.h / 2).toBeCloseTo(300, 5);
  });

  it('sits inside its hit box and matches its layout footprint', () => {
    const r = cardRect();
    const hit = engineAABB(page.nodes[0]!, engineHitBoxes());
    expect(hit.x).toBeLessThanOrEqual(r.x);
    expect(hit.y).toBeLessThanOrEqual(r.y);
    expect(hit.x + hit.w).toBeGreaterThanOrEqual(r.x + r.w);
    expect(hit.y + hit.h).toBeGreaterThanOrEqual(r.y + r.h);
    const footprint = nodeBounds(page.nodes[0]!);
    expect(footprint.x).toBeCloseTo(r.x, 0);
    expect(footprint.y).toBeCloseTo(r.y - 0.5, 0);
  });

  it('a link ends at the card edge, not a card-width away', () => {
    const ends = linkEndpoints(page, page.links[0]!, {
      hitBoxes: engineHitBoxes(),
    })!;
    const r = cardRect();
    // Leaves from the right edge of the card (within the attach clearance).
    expect(ends.from.x - (r.x + r.w)).toBeGreaterThanOrEqual(0);
    expect(ends.from.x - (r.x + r.w)).toBeLessThan(12);
    expect(ends.from.y).toBeCloseTo(300, 0);
  });
});
