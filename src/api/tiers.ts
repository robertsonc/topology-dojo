/**
 * Tiers (proposal 0008, W2) — the ROLE axis of a wiring sheet. Gateways on
 * top, distribution in the middle, core at the bottom: vertical position
 * encodes role, not link depth, which the `hierarchical` layout (longest
 * path over from→to) cannot express on a dual-homed fabric.
 *
 * Tiers are declared on the document (`doc.tiers`, top → bottom); nodes opt
 * in with `tier: <tier id>`. Untiered nodes are left where they are. The
 * `tiered` layout (api/autolayout) rows nodes by tier order, orders each
 * row by the barycentre of its neighbours in the adjacent rows (one sweep
 * down, one up, so fan-ins do not cross themselves), optionally mirrors
 * `-01` / `-02` pairs about the page centre line, and can emit one zone per
 * tier captioned at its bottom edge.
 */
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';

/** A declared tier. Declaration order is vertical order (top → bottom). */
export interface TierDef {
  id: string;
  /** Display name (the tier zone's caption). Falls back to the id. */
  name?: string;
}

/** Declare (or update, by id) a document tier; returns the stored list. */
export function defineTier(
  doc: { tiers?: TierDef[] },
  def: TierDef,
  /** Insert before this tier id (else append / keep position). */
  before?: string,
): TierDef[] {
  const tiers = (doc.tiers ??= []);
  const next: TierDef = {
    id: def.id,
    ...(def.name !== undefined ? { name: def.name } : {}),
  };
  const i = tiers.findIndex((t) => t.id === def.id);
  if (i >= 0) tiers.splice(i, 1);
  const at = before ? tiers.findIndex((t) => t.id === before) : -1;
  if (at >= 0) tiers.splice(at, 0, next);
  else if (i >= 0 && !before) tiers.splice(i, 0, next);
  else tiers.push(next);
  return tiers;
}

/** The tier rank of a node: declaration index, or -1 when untiered / unknown. */
export function tierRank(
  tiers: readonly TierDef[] | undefined,
  tier: unknown,
): number {
  if (typeof tier !== 'string' || !tiers) return -1;
  return tiers.findIndex((t) => t.id === tier);
}

/** Zone id the tiered layout uses for a tier's band. */
export function tierZoneId(tierId: string): string {
  return `tier:${tierId}`;
}

/**
 * The mirror-pair key of an id or label: `sw-venue-01` / `sw-venue-02`,
 * `RT-CORE-1` / `RT-CORE-2`, `gw-a` / `gw-b` all pair. Returns the shared
 * prefix and the side (0 = left / first, 1 = right / second), or null.
 */
export function mirrorPairKey(
  s: string,
): { prefix: string; side: 0 | 1 } | null {
  const m = /^(.*?)[-_ ]?(0?1|0?2|a|b)$/i.exec(s.trim());
  if (!m || !m[1]) return null;
  const tail = m[2]!.toLowerCase();
  const side = tail === 'a' || tail === '1' || tail === '01' ? 0 : 1;
  return { prefix: m[1].toLowerCase(), side };
}

/**
 * Pin each tiered link end to the face that looks at the other tier: the
 * end on the upper tier leaves through its SOUTH face, the lower one through
 * its NORTH face; two ends on the same tier use EAST / WEST by relative x.
 * Only ends with no explicit port are set, so hand-pinned ports survive.
 * Returns how many ends were pinned.
 */
export function pinPortsByTier(
  tiers: readonly TierDef[] | undefined,
  nodes: readonly NodeConfig[],
  links: LinkConfig[],
): number {
  if (!tiers?.length) return 0;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let pinned = 0;
  for (const l of links) {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b) continue;
    const ra = tierRank(tiers, a.tier);
    const rb = tierRank(tiers, b.tier);
    if (ra < 0 || rb < 0) continue;
    let fromPort: 'n' | 's' | 'e' | 'w';
    let toPort: 'n' | 's' | 'e' | 'w';
    if (ra < rb) {
      fromPort = 's';
      toPort = 'n';
    } else if (ra > rb) {
      fromPort = 'n';
      toPort = 's';
    } else if (a.x <= b.x) {
      fromPort = 'e';
      toPort = 'w';
    } else {
      fromPort = 'w';
      toPort = 'e';
    }
    if (!l.fromPort) {
      l.fromPort = fromPort;
      pinned++;
    }
    if (!l.toPort) {
      l.toPort = toPort;
      pinned++;
    }
  }
  return pinned;
}

/** Links joining two tiered nodes whose tiers are not adjacent. */
export function nonAdjacentTierLinks(
  tiers: readonly TierDef[] | undefined,
  nodes: readonly NodeConfig[],
  links: readonly LinkConfig[],
): { link: LinkConfig; fromTier: string; toTier: string }[] {
  if (!tiers?.length) return [];
  const rank = new Map<string, number>();
  const name = new Map<string, string>();
  for (const n of nodes) {
    const r = tierRank(tiers, n.tier);
    if (r >= 0) {
      rank.set(n.id, r);
      name.set(n.id, String(n.tier));
    }
  }
  const out: { link: LinkConfig; fromTier: string; toTier: string }[] = [];
  for (const l of links) {
    const a = rank.get(l.from);
    const b = rank.get(l.to);
    if (a === undefined || b === undefined) continue;
    if (Math.abs(a - b) > 1)
      out.push({
        link: l,
        fromTier: name.get(l.from)!,
        toTier: name.get(l.to)!,
      });
  }
  return out;
}
