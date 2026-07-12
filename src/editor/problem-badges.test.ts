import { describe, it, expect } from 'vitest';
import {
  computeBadgePlacements,
  type ProblemLocator,
} from './problem-badges.js';
import type { Page } from '../pages/model.js';
import type { Problem } from '../api/validate.js';

/** Minimal page carrying just the elements the placement math reads. */
function page(p: Partial<Page>): Page {
  return {
    id: 'p',
    name: 'P',
    viewBox: '0 0 1050 700',
    nodes: [],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
    ...p,
  };
}

function problem(
  message: string,
  level: Problem['level'] = 'warning',
): Problem {
  return { level, message, where: message };
}

/** A locator in the shape of `problemLocate` — matches `"id"` in the message. */
const locateByQuotedId: ProblemLocator = (p) => {
  const m = /"([^"]+)"/.exec(p.message);
  return m ? { kind: 'node', id: m[1]! } : undefined;
};

describe('computeBadgePlacements', () => {
  it('anchors a node badge at the AABB top-right corner', () => {
    const pg = page({
      nodes: [{ id: 'n1', type: 'router', x: 100, y: 100, label: 'R1' }],
    });
    const placements = computeBadgePlacements(
      [problem('node "n1" overlaps another node')],
      pg,
      locateByQuotedId,
    );
    expect(placements).toHaveLength(1);
    // router half-extent is {w:18, h:18} per api/geometry.ts — top-right corner
    // of the AABB is (x + 2*halfW, y - halfH) relative to nodeBounds' origin.
    expect(placements[0]).toMatchObject({
      kind: 'node',
      id: 'n1',
      level: 'warning',
      count: 1,
      x: 118,
      y: 82,
    });
  });

  it('anchors a zone badge at the AABB top-right corner', () => {
    const pg = page({
      nodes: [{ id: 'n1', type: 'router', x: 0, y: 0, label: 'R1' }],
      zones: [{ id: 'z1', label: 'DMZ', nodes: ['n1'] }],
    });
    const locate: ProblemLocator = () => ({ kind: 'zone', id: 'z1' });
    const placements = computeBadgePlacements(
      [problem('zone "z1" overlaps another zone')],
      pg,
      locate,
    );
    expect(placements).toHaveLength(1);
    expect(placements[0]!.kind).toBe('zone');
    // zoneBounds: member box ±40×±30 around (0,0), then padded by 40 (default).
    expect(placements[0]!.x).toBe(80);
    expect(placements[0]!.y).toBe(-70);
  });

  it('anchors a link badge at the from/to midpoint, ignoring waypoints', () => {
    const pg = page({
      nodes: [
        { id: 'a', type: 'router', x: 0, y: 0, label: 'A' },
        { id: 'b', type: 'router', x: 100, y: 200, label: 'B' },
      ],
      links: [
        {
          id: 'l1',
          type: 'line',
          from: 'a',
          to: 'b',
          waypoints: [{ x: 9999, y: 9999 }],
        },
      ],
    });
    const locate: ProblemLocator = () => ({ kind: 'link', id: 'l1' });
    const placements = computeBadgePlacements(
      [problem('link "l1" crosses another link')],
      pg,
      locate,
    );
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({
      kind: 'link',
      id: 'l1',
      x: 50,
      y: 100,
    });
  });

  it('folds overlapping problems on one element into a single badge with a count', () => {
    const pg = page({
      nodes: [{ id: 'n1', type: 'router', x: 0, y: 0, label: 'R1' }],
    });
    const placements = computeBadgePlacements(
      [
        problem('node "n1" is off-page', 'warning'),
        problem('node "n1" overlaps another node', 'warning'),
        problem('node "n1" has an unknown field', 'error'),
      ],
      pg,
      locateByQuotedId,
    );
    expect(placements).toHaveLength(1);
    // Error anywhere in the fold wins over warning, regardless of order.
    expect(placements[0]).toMatchObject({
      kind: 'node',
      id: 'n1',
      level: 'error',
      count: 3,
    });
  });

  it('an error-then-warning fold still reports level "error" (order independence)', () => {
    const pg = page({
      nodes: [{ id: 'n1', type: 'router', x: 0, y: 0, label: 'R1' }],
    });
    const placements = computeBadgePlacements(
      [
        problem('node "n1" has an unknown field', 'error'),
        problem('node "n1" is off-page', 'warning'),
      ],
      pg,
      locateByQuotedId,
    );
    expect(placements[0]!.level).toBe('error');
    expect(placements[0]!.count).toBe(2);
  });

  it('skips problems whose element is missing from the page (deleted, or on another page)', () => {
    const pg = page({
      nodes: [{ id: 'n1', type: 'router', x: 0, y: 0, label: 'R1' }],
    });
    const placements = computeBadgePlacements(
      [problem('node "gone" overlaps another node')],
      pg,
      locateByQuotedId,
    );
    expect(placements).toHaveLength(0);
  });

  it('skips problems the locator cannot map to an element', () => {
    const pg = page({
      nodes: [{ id: 'n1', type: 'router', x: 0, y: 0, label: 'R1' }],
    });
    const unlocatable: ProblemLocator = () => undefined;
    const placements = computeBadgePlacements(
      [problem('document has no pages', 'error')],
      pg,
      unlocatable,
    );
    expect(placements).toHaveLength(0);
  });

  it('skips a zone whose members are all missing (zoneBounds has nothing to frame)', () => {
    const pg = page({
      zones: [{ id: 'z1', label: 'DMZ', nodes: ['gone'] }],
    });
    const locate: ProblemLocator = () => ({ kind: 'zone', id: 'z1' });
    const placements = computeBadgePlacements(
      [problem('zone "z1" has no present members')],
      pg,
      locate,
    );
    expect(placements).toHaveLength(0);
  });

  it('skips a link with a dangling endpoint (no resolvable position)', () => {
    const pg = page({
      nodes: [{ id: 'a', type: 'router', x: 0, y: 0, label: 'A' }],
      links: [{ id: 'l1', type: 'line', from: 'a', to: 'missing' }],
    });
    const locate: ProblemLocator = () => ({ kind: 'link', id: 'l1' });
    const placements = computeBadgePlacements(
      [problem('link "l1" references missing node "missing"')],
      pg,
      locate,
    );
    expect(placements).toHaveLength(0);
  });

  it('returns one badge per distinct element for unrelated problems', () => {
    const pg = page({
      nodes: [
        { id: 'a', type: 'router', x: 0, y: 0, label: 'A' },
        { id: 'b', type: 'router', x: 500, y: 500, label: 'B' },
      ],
    });
    const placements = computeBadgePlacements(
      [
        problem('node "a" overlaps another node'),
        problem('node "b" is off-page'),
      ],
      pg,
      locateByQuotedId,
    );
    expect(placements).toHaveLength(2);
    expect(placements.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });
});
