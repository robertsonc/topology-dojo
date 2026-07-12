/**
 * Pure placement math for on-canvas problem badges (Packet B1).
 *
 * Turns the flat `Problem[]` list the problems panel already renders (see
 * `renderProblems()` in `main.ts`) into a small set of badge placements
 * anchored to the elements they're about — folding every problem that lands
 * on the same element into one badge with a count, so a crowded node doesn't
 * sprout a stack of overlapping glyphs. DOM-free and editor-instance-free:
 * the editor just renders whatever this returns.
 */
import type { Page } from '../pages/model.js';
import type { Problem } from '../api/validate.js';
import { nodeBounds } from '../api/geometry.js';
import { resolvePos, zoneBounds } from './geometry.js';

export type ProblemElementKind = 'node' | 'link' | 'zone';

/**
 * Maps a problem to the element it's about, or undefined when unlocatable.
 * Callers pass `problemLocate` from `main.ts` (the panel's own click-to-jump
 * lookup) so the badge layer never disagrees with the panel about what a
 * problem refers to.
 */
export type ProblemLocator = (
  problem: Problem,
) => { kind: ProblemElementKind; id: string } | undefined;

export interface BadgePlacement {
  kind: ProblemElementKind;
  id: string;
  /** Worst severity among the problems folded into this badge. */
  level: 'error' | 'warning';
  /** How many distinct problems are folded into this one badge. */
  count: number;
  /** Anchor point in page/user-space coordinates (the overlay's own space). */
  x: number;
  y: number;
}

/**
 * `(problems, page, locate) → badge placements` — one badge per element that
 * has at least one locatable problem. Anchor point is the element's AABB
 * top-right corner for nodes/zones, and the from/to midpoint for links
 * (matching `Editor.focusLink`'s own notion of a link's centre — waypoints
 * aren't counted, same as the click-to-locate pan target). Elements missing
 * from `page` (deleted, or living on another page) are silently skipped —
 * badges reflect the current page only, and problems with no locate match
 * don't get a badge (there's nowhere to anchor one).
 */
export function computeBadgePlacements(
  problems: Problem[],
  page: Page,
  locate: ProblemLocator,
): BadgePlacement[] {
  const byElement = new Map<
    string,
    {
      kind: ProblemElementKind;
      id: string;
      level: 'error' | 'warning';
      count: number;
    }
  >();
  for (const p of problems) {
    const loc = locate(p);
    if (!loc) continue;
    const key = `${loc.kind}:${loc.id}`;
    const entry = byElement.get(key);
    if (entry) {
      entry.count++;
      if (p.level === 'error') entry.level = 'error'; // error always wins
    } else {
      byElement.set(key, {
        kind: loc.kind,
        id: loc.id,
        level: p.level,
        count: 1,
      });
    }
  }
  const placements: BadgePlacement[] = [];
  for (const entry of byElement.values()) {
    const anchor = anchorPoint(page, entry.kind, entry.id);
    if (!anchor) continue;
    placements.push({ ...entry, ...anchor });
  }
  return placements;
}

/** The badge's anchor point for one element, or null when it's not on this page. */
function anchorPoint(
  page: Page,
  kind: ProblemElementKind,
  id: string,
): { x: number; y: number } | null {
  if (kind === 'node') {
    const n = page.nodes.find((m) => m.id === id);
    if (!n) return null;
    const b = nodeBounds(n);
    return { x: b.x + b.w, y: b.y }; // top-right corner
  }
  if (kind === 'zone') {
    const z = page.zones.find((m) => m.id === id);
    if (!z) return null;
    const b = zoneBounds(page, z);
    if (!b) return null; // no present members — nothing to frame
    return { x: b.x + b.w, y: b.y }; // top-right corner
  }
  const link = page.links.find((m) => m.id === id);
  if (!link) return null;
  const a = resolvePos(page, link.from);
  const b = resolvePos(page, link.to);
  if (!a || !b) return null; // dangling endpoint — validate() already flags it
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
