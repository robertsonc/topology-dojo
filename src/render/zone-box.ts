/**
 * The axis-aligned box a zone draws around its members — the ONE TypeScript
 * mirror of the engine's `_zoneBox` (public/vendor/topology-ds.js, search
 * "MIRROR OF src/render/zone-box.ts"). The layout analyzer, the inspector,
 * the editor (hit-testing / selection outline) and the workspace panel all
 * take the rect from here so `validate_topology`, `inspect_render` and the
 * canvas agree with the render to the pixel.
 *
 * Each member (direct or via a descendant zone) contributes:
 * - its centre padded by ±40 × ±30 (the pre-#271 rule, kept as a floor so a
 *   sparse zone never shrinks),
 * - its engine hit box (`engineNodeAABB` — the same table `_getNodeAABB`
 *   uses), and
 * - its classic label block at the placement / offset actually drawn
 *   (`nodeLabelRect`; types that draw their own label contribute no rect —
 *   their hit box already covers the text).
 * The union is then expanded by the zone's `padding` (default 40). Anchors
 * listed as members contribute their centre pad only, as in the engine.
 */
import type { Page } from '../pages/model.js';
import type { ZoneConfig } from '../vendor/topology-ds.js';
import type { BoundsRect } from '../api/geometry.js';
import { engineNodeAABB } from './wire-labels.js';
import { nodeLabelRect } from './label-placement.js';

/** Fixed half-extents every member centre is padded by (the floor). */
export const ZONE_MEMBER_PAD_X = 40;
export const ZONE_MEMBER_PAD_Y = 30;
/** Default `zone.padding` (the engine treats 0 / absent as this). */
export const ZONE_PADDING = 40;

/** Member node ids of a zone plus those of its descendant zones (cycle-safe). */
export function zoneMemberIds(
  page: Page,
  zoneId: string,
  seen = new Set<string>(),
): string[] {
  if (seen.has(zoneId)) return [];
  seen.add(zoneId);
  const zones = page.zones ?? [];
  const zone = zones.find((z) => z.id === zoneId);
  if (!zone) return [];
  const ids = [...(zone.nodes ?? [])];
  for (const child of zones)
    if (child.parentZone === zoneId)
      ids.push(...zoneMemberIds(page, child.id, seen));
  return ids;
}

/** The padded box the engine draws around a zone's members, or null when no
 * member resolves (the engine draws nothing then). */
export function zoneBox(page: Page, zone: ZoneConfig): BoundsRect | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const grow = (r: BoundsRect): void => {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  };
  for (const id of zoneMemberIds(page, zone.id)) {
    const n = page.nodes.find((m) => m.id === id);
    const p = n ?? page.anchors.find((a) => a.id === id);
    if (!p) continue;
    grow({
      x: p.x - ZONE_MEMBER_PAD_X,
      y: p.y - ZONE_MEMBER_PAD_Y,
      w: ZONE_MEMBER_PAD_X * 2,
      h: ZONE_MEMBER_PAD_Y * 2,
    });
    if (!n) continue;
    grow(engineNodeAABB(n));
    const lr = nodeLabelRect(n);
    if (lr) grow(lr);
  }
  if (!Number.isFinite(minX)) return null;
  const pad = zone.padding || ZONE_PADDING;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}
