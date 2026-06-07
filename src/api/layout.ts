/**
 * Layout analysis + ground-truth guidelines for well-organized topologies.
 *
 * AI-generated topologies tend to overlap nodes, labels, and zones, which then
 * needs hand-tuning. This module is the "ground truth": a machine-readable set
 * of layout rules an agent can read up front (`layoutGuidelines`), plus a
 * geometric checker that flags the overlaps/crowding/out-of-bounds it should fix
 * (`analyzeLayout`). It is detection + guidance only — nothing is moved.
 *
 * DOM-free, so it runs in the browser, in Node, and behind the MCP server.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import type { ZoneConfig } from '../vendor/topology-ds.js';
import { nodeBounds, type BoundsRect } from './geometry.js';
import type { Problem } from './validate.js';

/** Quantitative layout rules — the numbers the checker enforces and the agent should target. */
export const LAYOUT_RULES = {
  /** Recommended grid; snap node x/y to multiples of this. */
  gridStep: 20,
  /** Minimum clear space between two node footprints (icon + label). */
  minNodeGap: 24,
  /** Keep node footprints at least this far inside the page edges. */
  edgeMargin: 24,
  /** A zone auto-pads this far around its member nodes. */
  zonePadding: 40,
  /** Minimum clear space between two un-nested zones. */
  minZoneGap: 16,
  /** Approx. vertical space a label adds below a node. */
  labelHeight: 16,
  /** Approx. width per label character (monospace ~ this many px). */
  labelCharWidth: 6,
} as const;

export interface LayoutGuidelines {
  rules: typeof LAYOUT_RULES;
  /** Human-readable rules an LLM can follow while generating a topology. */
  guidance: string[];
}

/** The ground-truth layout guidelines (rules + prose) for agent consumption. */
export function layoutGuidelines(): LayoutGuidelines {
  const r = LAYOUT_RULES;
  return {
    rules: r,
    guidance: [
      `Place nodes on a ${r.gridStep}px grid — snap x and y to multiples of ${r.gridStep}.`,
      `Keep at least ${r.minNodeGap}px of clear space between node footprints (the icon plus its label, which renders below the node).`,
      `Keep node footprints at least ${r.edgeMargin}px inside the page edges (the viewBox).`,
      `A zone auto-sizes a ${r.zonePadding}px-padded box around its member nodes. Keep non-member nodes outside that box so a zone never visually swallows unrelated nodes.`,
      `Do not overlap two zones unless one is nested in the other (set the child's parentZone).`,
      `Give every node a short label and leave vertical room beneath it; long labels widen the footprint.`,
      `Lay flows out left→right or top→bottom and order waypoints so routes do not cross over nodes.`,
      `Prefer even spacing: align rows/columns and distribute nodes uniformly rather than clustering.`,
    ],
  };
}

/**
 * Analyze a document's layout and return overlap / crowding / out-of-bounds
 * problems (all warnings — layout is advisory and never blocks rendering).
 */
export function analyzeLayout(doc: TopologyDocument): Problem[] {
  const problems: Problem[] = [];
  doc.pages.forEach((page, pi) =>
    analyzePage(page, `page[${pi}] "${page.name}"`, problems),
  );
  return problems;
}

function analyzePage(page: Page, at: string, out: Problem[]): void {
  const warn = (message: string): void => {
    out.push({ level: 'warning', message, where: at });
  };
  const [vx, vy, vw, vh] = parseViewBox(page.viewBox);

  const fps = new Map<string, BoundsRect>();
  for (const n of page.nodes) fps.set(n.id, footprint(page, n.id)!);

  // 1. Out-of-bounds / edge crowding.
  const m = LAYOUT_RULES.edgeMargin;
  for (const n of page.nodes) {
    const f = fps.get(n.id)!;
    if (f.x < vx || f.y < vy || f.x + f.w > vx + vw || f.y + f.h > vy + vh)
      warn(`node "${n.id}" extends past the page edge`);
    else if (
      f.x < vx + m ||
      f.y < vy + m ||
      f.x + f.w > vx + vw - m ||
      f.y + f.h > vy + vh - m
    )
      warn(`node "${n.id}" is within ${m}px of the page edge`);
  }

  // 2. Node–node overlap / crowding (footprints include labels).
  for (let i = 0; i < page.nodes.length; i++) {
    for (let j = i + 1; j < page.nodes.length; j++) {
      const a = page.nodes[i]!,
        b = page.nodes[j]!;
      const gap = rectGap(fps.get(a.id)!, fps.get(b.id)!);
      if (gap < 0) warn(`nodes "${a.id}" and "${b.id}" overlap`);
      else if (gap < LAYOUT_RULES.minNodeGap)
        warn(
          `nodes "${a.id}" and "${b.id}" are too close (<${LAYOUT_RULES.minNodeGap}px apart)`,
        );
    }
  }

  // 3. Zones swallowing non-member nodes.
  for (const zone of page.zones ?? []) {
    const box = zoneBox(page, zone);
    if (!box) continue;
    const members = new Set(allZoneNodeIds(page, zone.id));
    for (const n of page.nodes) {
      if (members.has(n.id)) continue;
      if (intersects(box, fps.get(n.id)!))
        warn(`zone "${zone.id}" visually contains non-member node "${n.id}"`);
    }
  }

  // 4. Un-nested zones overlapping each other.
  const zones = page.zones ?? [];
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const za = zones[i]!,
        zb = zones[j]!;
      if (zoneRelated(page, za.id, zb.id)) continue; // nesting is fine
      const ba = zoneBox(page, za),
        bb = zoneBox(page, zb);
      if (ba && bb && intersects(ba, bb))
        warn(
          `zones "${za.id}" and "${zb.id}" overlap — nest one (parentZone) or move them apart`,
        );
    }
  }
}

/** True if the document has no layout warnings. */
export function isWellLaidOut(doc: TopologyDocument): boolean {
  return analyzeLayout(doc).length === 0;
}

/* ── geometry helpers ─────────────────────────────────────────────── */

/** A node's footprint: its drawn glyph plus the label that renders below it. */
function footprint(page: Page, id: string): BoundsRect | null {
  const n = page.nodes.find((m) => m.id === id);
  if (!n) return null;
  const b = nodeBounds(n);
  const label = typeof n.label === 'string' ? n.label : '';
  const labelW = label ? label.length * LAYOUT_RULES.labelCharWidth : 0;
  const halfW = Math.max(b.w / 2, labelW / 2);
  const extraH = label ? LAYOUT_RULES.labelHeight : 0;
  return { x: n.x - halfW, y: b.y, w: halfW * 2, h: b.h + extraH };
}

/** The padded box the engine draws around a zone's (recursive) member nodes. */
function zoneBox(page: Page, zone: ZoneConfig): BoundsRect | null {
  const ids = allZoneNodeIds(page, zone.id);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const id of ids) {
    const n = page.nodes.find((m) => m.id === id);
    if (!n) continue;
    minX = Math.min(minX, n.x - 40);
    minY = Math.min(minY, n.y - 30);
    maxX = Math.max(maxX, n.x + 40);
    maxY = Math.max(maxY, n.y + 30);
  }
  if (!isFinite(minX)) return null;
  const pad = zone.padding ?? LAYOUT_RULES.zonePadding;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

/** All node ids belonging to a zone and its descendant zones. */
function allZoneNodeIds(page: Page, zoneId: string): string[] {
  const zones = page.zones ?? [];
  const zone = zones.find((z) => z.id === zoneId);
  if (!zone) return [];
  const ids = [...(zone.nodes ?? [])];
  for (const child of zones)
    if (child.parentZone === zoneId)
      ids.push(...allZoneNodeIds(page, child.id));
  return ids;
}

/** True if one zone is an ancestor of the other (so overlap is intentional nesting). */
function zoneRelated(page: Page, a: string, b: string): boolean {
  const zones = page.zones ?? [];
  const isAncestor = (anc: string, node: string): boolean => {
    let cur = zones.find((z) => z.id === node)?.parentZone;
    while (cur) {
      if (cur === anc) return true;
      cur = zones.find((z) => z.id === cur)?.parentZone;
    }
    return false;
  };
  return isAncestor(a, b) || isAncestor(b, a);
}

function intersects(a: BoundsRect, b: BoundsRect): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

/** Separation between two boxes: negative = penetration depth (overlap), 0 = touching. */
function rectGap(a: BoundsRect, b: BoundsRect): number {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  if (dx === 0 && dy === 0) {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return -Math.min(ox, oy);
  }
  return Math.hypot(dx, dy);
}

function parseViewBox(vb: string): [number, number, number, number] {
  const p = vb.split(/\s+/).map(Number);
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 1050, p[3] ?? 700];
}
