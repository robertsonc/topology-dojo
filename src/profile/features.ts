/**
 * Deterministic semantic feature extraction (Packet P1 / proposal 0003-A).
 *
 * Turns *geometry + a settled change* into *topology intent*: an archetype,
 * per-node roles, region/tier structure, and categorical relational facts —
 * the compact, structural summary the P2 learner consumes instead of raw
 * documents. The learning discipline of proposal 0003 requires that we convert
 * pixels into categories: nothing here retains a raw x/y coordinate. Internally
 * we read coordinates to *categorize* placement (radial vs layered, aligned,
 * grouped-by-region); only the resulting category tokens leave this module.
 *
 * The module is PURE and DETERMINISTIC — no DOM, no I/O, no time, no random —
 * and client-safe (no node-only or browser-only APIs), so both `worker/` and
 * the browser can import it. Same inputs always produce the same output; every
 * array it returns is sorted for stability.
 *
 * @see docs/proposals/0003-adaptive-agent-authoring-profiles.md
 *      ("Extract semantic features", "Preference record").
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import type {
  LinkConfig,
  NodeConfig,
  ZoneConfig,
} from '../vendor/topology-ds.js';
import type { WorkspaceOperation } from '../workspace/model.js';
import {
  conflictingTargets,
  operationTargets,
} from '../workspace/operations.js';
import { nodeBounds } from '../api/geometry.js';
import { parseViewBox } from '../api/layout.js';

/* ── public types ─────────────────────────────────────────────────────── */

/** Topology archetype detected from graph structure (degree distribution), not
 * from labels. `multi-region-hub-spoke` is a hub/spoke family with ≥2 regions
 * whose inter-region links stay on the hub tier. */
export type Archetype =
  | 'hub-and-spoke'
  | 'multi-region-hub-spoke'
  | 'leaf-spine'
  | 'mesh'
  | 'flat'
  | 'unknown';

/** A node's structural role, from degree + graph/region position. `spine` is a
 * leaf-spine hub; `gateway` bridges regions at low fan-out; `relay` is an
 * intermediate pass-through; `isolated` has no links. */
export type NodeRole =
  | 'hub'
  | 'spine'
  | 'spoke'
  | 'leaf'
  | 'gateway'
  | 'relay'
  | 'isolated';

export const NODE_ROLES: readonly NodeRole[] = [
  'hub',
  'spine',
  'spoke',
  'leaf',
  'gateway',
  'relay',
  'isolated',
];

/** Countable role tally (every role present as a key, for stable diffing). */
export type RoleCounts = Record<NodeRole, number>;

/** A region/site grouping derived from a zone's (recursive) node membership. */
export interface RegionFeature {
  /** Stable zone id the region derives from. */
  zoneId: string;
  /** Zone label if present — structural pass-through, never parsed for rules. */
  label?: string;
  /** Enclosing region's zone id, when zones nest. */
  parentZoneId?: string;
  /** Member node count (recursive through child zones). */
  nodeCount: number;
  /** Role tally within the region. */
  roleCounts: RoleCounts;
  /** Region contains at least one hub/spine (a local interconnect point). */
  hasHub: boolean;
  /** Region contains at least one spoke/leaf. */
  hasSpoke: boolean;
}

/** One graph tier (band of roles). Index 0 is the top interconnect tier. */
export interface TierFeature {
  /** 0 = top tier (hubs/spine/gateways); increases downward. */
  index: number;
  /** Roles occupying this tier, sorted. */
  roles: NodeRole[];
  /** Nodes on this tier. */
  nodeCount: number;
}

/** Graph tiers plus the inter-tier / inter-region connectivity actually observed. */
export interface TierStructure {
  tiers: TierFeature[];
  /** Observed links between tiers as `{from,to,count}` with from ≤ to (from===to
   * is an intra-tier link, e.g. a hub-tier spine). */
  interTierLinks: Array<{ from: number; to: number; count: number }>;
  /** Count of links whose endpoints live in two different regions. */
  interRegionLinkCount: number;
  /** True when every inter-region link connects only hub-tier nodes (and at
   * least one such link exists) — the "inter-region links only at the hub tier"
   * constraint from the motivating example. */
  interRegionOnlyAtHubTier: boolean;
}

/** The settled agent-vs-user-correction analysis for this change. */
export interface CorrectionFeature {
  /** Field-granular targets the agent's operations touched (`operationTargets`). */
  agentTargets: string[];
  /** Field-granular targets the user's settled correction touched. */
  userTargets: string[];
  /** Targets both touched — where the user re-did the agent's work. */
  overlapTargets: string[];
  /** Node ids the user's settled correction added/patched/removed. */
  correctedNodeIds: string[];
  /** Traits present before (agent) but not after (user-settled). */
  removedTraits: string[];
  /** Traits present after (user-settled) but not before (agent). */
  addedTraits: string[];
  /** One-line categorical intent, e.g. "radial → layered regional hub/spoke
   * hierarchy" — never "move hub-1 to x=410". */
  summary: string;
}

/** Structural counts — no coordinates, only graph shape. */
export interface GraphStats {
  nodeCount: number;
  linkCount: number;
  zoneCount: number;
  maxDegree: number;
  minDegree: number;
  /** Connected components over the node graph (isolated node = 1 component). */
  components: number;
  /** degree → number of nodes with that degree. */
  degreeHistogram: Record<number, number>;
}

/**
 * The deterministic topology-intent summary of a settled change. Every field is
 * categorical / structural / countable; none carries a pixel coordinate. This
 * type is load-bearing for P2–P5, so it is intended to be stable: `traits` is
 * the flat token vocabulary a candidate's `trigger.requiredTraits` /
 * `excludedTraits` are built from (via a before/after trait diff).
 */
export interface SemanticFeatures {
  archetype: Archetype;
  /** Role per node id. */
  nodeRoles: Record<string, NodeRole>;
  /** Role tally across the page. */
  roleCounts: RoleCounts;
  regions: RegionFeature[];
  tiers: TierStructure;
  /** Categorical relational facts (ordering/alignment/grouping/spacing). */
  relations: string[];
  /** Flat, sorted salient trait tokens (subsumes archetype/relations/region
   * facts) — the direct input to a preference trigger's trait sets. */
  traits: string[];
  correction: CorrectionFeature;
  stats: GraphStats;
  /** Pass-through task terms (structural only, never interpreted as rules). */
  taskTerms?: string[];
  /** Pass-through user rationale. */
  rationale?: string;
}

/**
 * Inputs to {@link extractFeatures}. `document` is the post-change (settled)
 * document; `agentDocument` is the agent's version *before* the user's
 * correction, supplied so the before/after trait diff and the correction
 * summary are computable. `agentOperations` are the agent's ops and the
 * `operations` argument is the user's settled correction — their target overlap
 * says where the user re-did the agent's work.
 */
export interface DocumentContext {
  /** Post-change (settled) document. */
  document: TopologyDocument;
  /** Analyze this page; defaults to the first page. */
  pageId?: string;
  /** The agent's version of the document before the user's settled correction. */
  agentDocument?: TopologyDocument;
  /** Which page of `agentDocument` to compare; defaults to `pageId`/first. */
  agentPageId?: string;
  /** The agent's originating operations (for target-overlap analysis). */
  agentOperations?: WorkspaceOperation[];
  /** Structured task terms, passed through unparsed. */
  taskTerms?: string[];
  /** User rationale, passed through unparsed. */
  rationale?: string;
}

/* ── tuning constants (documented heuristics) ─────────────────────────── */

/** Fan-out at/above which a node is treated as a hub. Hub-and-spoke designs
 * realistically have ≥3 spokes; a 2-spoke star reads as `flat`. */
const HUB_MIN_DEGREE = 3;
/** Fraction of the relevant viewBox extent within which coordinates count as
 * "aligned" (a shared row/column). */
const ALIGN_BAND_FRACTION = 0.08;
/** Pixels of slack before a node counts as clearly above/below another. */
const VERTICAL_EPS = 8;
/** Density (0–1) at/above which a graph where every node is a hub reads mesh. */
const MESH_MIN_DENSITY = 0.5;

/* ── graph model (internal) ───────────────────────────────────────────── */

interface GraphModel {
  page: Page;
  nodes: NodeConfig[];
  nodeById: Map<string, NodeConfig>;
  /** Undirected neighbor sets over node-to-node links only. */
  neighbors: Map<string, Set<string>>;
  degree: Map<string, number>;
  hubIds: Set<string>;
  /** Node id → innermost region (zone) id it belongs to, if any. */
  regionOf: Map<string, string>;
  /** Node-to-node links (both endpoints are real nodes). */
  links: LinkConfig[];
  viewBox: [number, number, number, number];
}

const EMPTY_PAGE: Page = {
  id: '',
  name: '',
  viewBox: '0 0 1050 700',
  nodes: [],
  links: [],
  anchors: [],
  zones: [],
  flowPaths: [],
  policyMarkers: [],
};

function pickPage(doc: TopologyDocument | undefined, pageId?: string): Page {
  if (!doc || doc.pages.length === 0) return EMPTY_PAGE;
  if (pageId) return doc.pages.find((p) => p.id === pageId) ?? doc.pages[0]!;
  return doc.pages[0]!;
}

/** All node ids belonging to a zone and its descendant zones (no coords). */
function zoneMemberIds(
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

function buildGraph(page: Page): GraphModel {
  const nodes = page.nodes ?? [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const neighbors = new Map<string, Set<string>>();
  for (const n of nodes) neighbors.set(n.id, new Set());

  const links: LinkConfig[] = [];
  for (const link of page.links ?? []) {
    if (!nodeById.has(link.from) || !nodeById.has(link.to)) continue;
    if (link.from === link.to) continue;
    links.push(link);
    neighbors.get(link.from)!.add(link.to);
    neighbors.get(link.to)!.add(link.from);
  }

  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, neighbors.get(n.id)!.size);

  const hubIds = new Set<string>();
  for (const n of nodes)
    if ((degree.get(n.id) ?? 0) >= HUB_MIN_DEGREE) hubIds.add(n.id);

  // Innermost region wins: a node in a child zone belongs to that child.
  const regionOf = new Map<string, string>();
  const zones = page.zones ?? [];
  const depth = (zoneId: string): number => {
    let d = 0;
    let cur: string | undefined = zoneId;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      cur = zones.find((z) => z.id === cur)?.parentZone;
      if (cur) d++;
    }
    return d;
  };
  const byDepth = [...zones].sort((a, b) => depth(a.id) - depth(b.id));
  for (const zone of byDepth)
    for (const id of zone.nodes ?? [])
      if (nodeById.has(id)) regionOf.set(id, zone.id);

  return {
    page,
    nodes,
    nodeById,
    neighbors,
    degree,
    hubIds,
    regionOf,
    links,
    viewBox: parseViewBox(page.viewBox),
  };
}

function emptyRoleCounts(): RoleCounts {
  return {
    hub: 0,
    spine: 0,
    spoke: 0,
    leaf: 0,
    gateway: 0,
    relay: 0,
    isolated: 0,
  };
}

function connectedComponents(g: GraphModel): number {
  const seen = new Set<string>();
  let count = 0;
  for (const n of g.nodes) {
    if (seen.has(n.id)) continue;
    count++;
    const stack = [n.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const m of g.neighbors.get(id) ?? [])
        if (!seen.has(m)) stack.push(m);
    }
  }
  return count;
}

/* ── archetype ────────────────────────────────────────────────────────── */

/** True when a node is an "outer" node single-purpose-attached only to hubs
 * with ≥2 uplinks — the multihomed-leaf signal of a leaf-spine fabric. */
function isMultihomedLeaf(g: GraphModel, id: string): boolean {
  if (g.hubIds.has(id)) return false;
  const nb = g.neighbors.get(id)!;
  if (nb.size < 2) return false;
  for (const m of nb) if (!g.hubIds.has(m)) return false;
  return true;
}

/** Whether every inter-region link connects only hub-tier nodes (≥1 exists). */
function interRegionHubOnly(g: GraphModel): {
  interRegionLinkCount: number;
  onlyHub: boolean;
} {
  let interRegion = 0;
  let allHub = true;
  for (const link of g.links) {
    const ra = g.regionOf.get(link.from);
    const rb = g.regionOf.get(link.to);
    if (!ra || !rb || ra === rb) continue;
    interRegion++;
    if (!g.hubIds.has(link.from) || !g.hubIds.has(link.to)) allHub = false;
  }
  return {
    interRegionLinkCount: interRegion,
    onlyHub: interRegion > 0 && allHub,
  };
}

interface RegionShape {
  zoneId: string;
  memberIds: string[];
  hasHub: boolean;
  hasSpokeByDegree: boolean;
}

/** Region shapes keyed by degree (archetype-independent, avoids a role cycle). */
function regionShapes(g: GraphModel): RegionShape[] {
  const zones = g.page.zones ?? [];
  return zones.map((zone) => {
    const memberIds = zoneMemberIds(g.page, zone.id).filter((id) =>
      g.nodeById.has(id),
    );
    return {
      zoneId: zone.id,
      memberIds,
      hasHub: memberIds.some((id) => g.hubIds.has(id)),
      hasSpokeByDegree: memberIds.some((id) => (g.degree.get(id) ?? 0) === 1),
    };
  });
}

function detectArchetypeFor(g: GraphModel): Archetype {
  const n = g.nodes.length;
  if (n === 0) return 'unknown';
  const linkCount = g.links.length;
  if (linkCount === 0) return 'flat';

  const degrees = g.nodes.map((node) => g.degree.get(node.id) ?? 0);
  const minDegree = Math.min(...degrees);
  const density = (2 * linkCount) / (n * (n - 1));

  // Dense graph where every node is highly connected → mesh.
  if (n >= 3 && minDegree >= HUB_MIN_DEGREE && density >= MESH_MIN_DENSITY)
    return 'mesh';

  if (g.hubIds.size === 0) {
    if (n >= 3 && density >= MESH_MIN_DENSITY) return 'mesh';
    return 'flat';
  }

  const regions = regionShapes(g).filter((r) => r.hasHub && r.hasSpokeByDegree);
  const { onlyHub } = interRegionHubOnly(g);
  if (regions.length >= 2 && onlyHub) return 'multi-region-hub-spoke';

  const multihomed = g.nodes.filter((node) => isMultihomedLeaf(g, node.id));
  if (g.hubIds.size >= 2 && multihomed.length >= 1 && regions.length < 2)
    return 'leaf-spine';

  return 'hub-and-spoke';
}

/* ── roles ────────────────────────────────────────────────────────────── */

/** True when a node links to a node in a different region (cross-region reach). */
function bridgesRegions(g: GraphModel, id: string): boolean {
  const own = g.regionOf.get(id);
  if (!own) return false;
  for (const m of g.neighbors.get(id)!) {
    const other = g.regionOf.get(m);
    if (other && other !== own) return true;
  }
  return false;
}

function assignRolesFor(
  g: GraphModel,
  archetype: Archetype,
): Map<string, NodeRole> {
  const leafSpine = archetype === 'leaf-spine';
  const roles = new Map<string, NodeRole>();
  for (const node of g.nodes) {
    const id = node.id;
    const deg = g.degree.get(id) ?? 0;
    if (deg === 0) {
      roles.set(id, 'isolated');
      continue;
    }
    if (g.hubIds.has(id)) {
      roles.set(id, leafSpine ? 'spine' : 'hub');
      continue;
    }
    if (leafSpine) {
      // Every non-spine node in a fabric is a leaf (single- or multi-homed).
      roles.set(id, 'leaf');
      continue;
    }
    if (deg === 1) {
      roles.set(id, 'spoke');
      continue;
    }
    // Low-fan-out, multi-link node: a gateway if it reaches another region,
    // otherwise a pass-through relay.
    roles.set(id, bridgesRegions(g, id) ? 'gateway' : 'relay');
  }
  return roles;
}

function tallyRoles(
  roles: Map<string, NodeRole>,
  ids?: Iterable<string>,
): RoleCounts {
  const counts = emptyRoleCounts();
  const source = ids ?? roles.keys();
  for (const id of source) {
    const role = roles.get(id);
    if (role) counts[role]++;
  }
  return counts;
}

/* ── regions ──────────────────────────────────────────────────────────── */

function extractRegionsFor(
  g: GraphModel,
  roles: Map<string, NodeRole>,
): RegionFeature[] {
  const zones = g.page.zones ?? [];
  const features = zones.map((zone: ZoneConfig): RegionFeature => {
    const memberIds = zoneMemberIds(g.page, zone.id).filter((id) =>
      g.nodeById.has(id),
    );
    const roleCounts = tallyRoles(roles, memberIds);
    return {
      zoneId: zone.id,
      ...(typeof zone.label === 'string' ? { label: zone.label } : {}),
      ...(zone.parentZone ? { parentZoneId: zone.parentZone } : {}),
      nodeCount: memberIds.length,
      roleCounts,
      hasHub: roleCounts.hub + roleCounts.spine > 0,
      hasSpoke: roleCounts.spoke + roleCounts.leaf > 0,
    };
  });
  return features.sort((a, b) => a.zoneId.localeCompare(b.zoneId));
}

/* ── tiers ────────────────────────────────────────────────────────────── */

/** Role → coarse band (before reindexing): 0 interconnect, 1 relay, 2 edge,
 * 3 isolated. */
function roleBand(role: NodeRole): number {
  switch (role) {
    case 'hub':
    case 'spine':
    case 'gateway':
      return 0;
    case 'relay':
      return 1;
    case 'spoke':
    case 'leaf':
      return 2;
    case 'isolated':
      return 3;
  }
}

function analyzeTiersFor(
  g: GraphModel,
  roles: Map<string, NodeRole>,
): TierStructure {
  // Collect present bands and reindex to a dense 0..k from the top.
  const bandNodes = new Map<number, string[]>();
  for (const node of g.nodes) {
    const role = roles.get(node.id);
    if (!role) continue;
    const band = roleBand(role);
    (bandNodes.get(band) ?? bandNodes.set(band, []).get(band)!).push(node.id);
  }
  const presentBands = [...bandNodes.keys()].sort((a, b) => a - b);
  const bandToTier = new Map<number, number>();
  presentBands.forEach((band, i) => bandToTier.set(band, i));

  const tiers: TierFeature[] = presentBands.map((band, i) => {
    const ids = bandNodes.get(band)!;
    const roleSet = new Set<NodeRole>();
    for (const id of ids) {
      const role = roles.get(id);
      if (role) roleSet.add(role);
    }
    return {
      index: i,
      roles: [...roleSet].sort(),
      nodeCount: ids.length,
    };
  });

  const tierOf = (id: string): number | undefined => {
    const role = roles.get(id);
    return role ? bandToTier.get(roleBand(role)) : undefined;
  };

  const linkKey = new Map<string, number>();
  for (const link of g.links) {
    const ta = tierOf(link.from);
    const tb = tierOf(link.to);
    if (ta === undefined || tb === undefined) continue;
    const from = Math.min(ta, tb);
    const to = Math.max(ta, tb);
    const key = `${from}-${to}`;
    linkKey.set(key, (linkKey.get(key) ?? 0) + 1);
  }
  const interTierLinks = [...linkKey.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split('-').map(Number) as [number, number];
      return { from, to, count };
    })
    .sort((a, b) => a.from - b.from || a.to - b.to);

  const { interRegionLinkCount, onlyHub } = interRegionHubOnly(g);
  return {
    tiers,
    interTierLinks,
    interRegionLinkCount,
    interRegionOnlyAtHubTier: onlyHub,
  };
}

/* ── relations (geometry → categories) ────────────────────────────────── */

function nodeCenter(node: NodeConfig): { x: number; y: number } {
  const b = nodeBounds(node);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Are the given coordinates within an aligned band of the viewBox extent? */
function aligned(values: number[], extent: number): boolean {
  if (values.length < 2) return false;
  const range = Math.max(...values) - Math.min(...values);
  return range <= extent * ALIGN_BAND_FRACTION;
}

function analyzeRelationsFor(
  g: GraphModel,
  roles: Map<string, NodeRole>,
  regions: RegionFeature[],
): string[] {
  const out = new Set<string>();
  const [, , vw, vh] = g.viewBox;

  const hubIds = g.nodes
    .filter((n) => {
      const r = roles.get(n.id);
      return r === 'hub' || r === 'spine';
    })
    .map((n) => n.id);

  // 1. Hub alignment (shared row / column).
  if (hubIds.length >= 2) {
    const centers = hubIds.map((id) => nodeCenter(g.nodeById.get(id)!));
    if (
      aligned(
        centers.map((c) => c.y),
        vh,
      )
    )
      out.add('hubs-aligned-horizontal');
    if (
      aligned(
        centers.map((c) => c.x),
        vw,
      )
    )
      out.add('hubs-aligned-vertical');
  }

  // 2. Spoke placement relative to their hub: radial vs layered-below.
  let belowPairs = 0;
  let notBelowPairs = 0;
  let abovePairs = 0;
  for (const hubId of hubIds) {
    const hub = nodeCenter(g.nodeById.get(hubId)!);
    for (const m of g.neighbors.get(hubId)!) {
      const role = roles.get(m);
      if (role !== 'spoke' && role !== 'leaf') continue;
      const c = nodeCenter(g.nodeById.get(m)!);
      if (c.y > hub.y + VERTICAL_EPS) belowPairs++;
      else {
        notBelowPairs++;
        if (c.y < hub.y - VERTICAL_EPS) abovePairs++;
      }
    }
  }
  const spokePairs = belowPairs + notBelowPairs;
  if (spokePairs > 0) {
    if (abovePairs > 0 || notBelowPairs >= belowPairs) {
      out.add('radial-placement');
    } else if (notBelowPairs === 0) {
      out.add('spokes-below-hub');
      const multiRegion =
        regions.filter((r) => r.hasHub && r.hasSpoke).length >= 2;
      if (multiRegion) {
        out.add('layered-regional');
        out.add('spokes-grouped-below-hub-per-region');
      }
    }
  }

  // 3. Region grouping: spokes clustered by region beneath their hubs.
  const groupedRegions = regions.filter((r) => r.hasHub && r.hasSpoke).length;
  if (groupedRegions >= 1 && out.has('spokes-below-hub'))
    out.add('spokes-grouped-below-hub');
  if (groupedRegions >= 2) out.add('clustered-by-region');

  return [...out].sort();
}

/* ── traits ───────────────────────────────────────────────────────────── */

function extractTraitsFrom(
  archetype: Archetype,
  roleCounts: RoleCounts,
  regions: RegionFeature[],
  tiers: TierStructure,
  relations: string[],
): string[] {
  const traits = new Set<string>(relations);
  traits.add(`archetype:${archetype}`);
  if (archetype !== 'unknown' && archetype !== 'flat') traits.add(archetype);

  if (roleCounts.hub > 0) traits.add('has-hub');
  if (roleCounts.spine > 0) traits.add('has-spine');
  if (roleCounts.spoke > 0) traits.add('has-spokes');
  if (roleCounts.leaf > 0) traits.add('has-leaves');
  if (roleCounts.gateway > 0) traits.add('has-gateway');
  if (roleCounts.isolated > 0) traits.add('has-isolated-nodes');

  const hubSpokeRegions = regions.filter((r) => r.hasHub && r.hasSpoke).length;
  if (regions.length >= 1) traits.add('has-regions');
  if (hubSpokeRegions >= 2) traits.add('multi-region');
  if (regions.some((r) => r.parentZoneId)) traits.add('nested-regions');
  if (tiers.interRegionOnlyAtHubTier) traits.add('hub-only-interconnect');
  if (tiers.tiers.length >= 2) traits.add('layered-tiers');

  return [...traits].sort();
}

/* ── correction (agent vs settled user change) ────────────────────────── */

function operationNodeIds(operations: WorkspaceOperation[]): string[] {
  const ids = new Set<string>();
  for (const op of operations) {
    if (op.type === 'element.add' && op.kind === 'nodes')
      ids.add(String(op.element.id));
    else if (
      (op.type === 'element.patch' || op.type === 'element.remove') &&
      op.kind === 'nodes'
    )
      ids.add(op.elementId);
    else if (op.type === 'element.reorder' && op.kind === 'nodes')
      for (const id of op.elementIds) ids.add(id);
  }
  return [...ids].sort();
}

/** A short categorical phrase for a placement/relation trait. */
function placementPhrase(traits: Set<string>): string | null {
  if (traits.has('radial-placement')) return 'radial';
  if (traits.has('layered-regional')) return 'layered regional';
  if (traits.has('spokes-below-hub')) return 'layered';
  if (traits.has('clustered-by-region')) return 'regionally grouped';
  return null;
}

function archetypePhrase(archetype: Archetype): string {
  switch (archetype) {
    case 'hub-and-spoke':
    case 'multi-region-hub-spoke':
      return 'hub/spoke hierarchy';
    case 'leaf-spine':
      return 'leaf/spine fabric';
    case 'mesh':
      return 'mesh';
    default:
      return 'topology';
  }
}

function correctionSummary(
  archetype: Archetype,
  beforeTraits: string[],
  afterTraits: string[],
): string {
  const before = new Set(beforeTraits);
  const after = new Set(afterTraits);
  const fromPhrase = placementPhrase(before);
  const toPhrase = placementPhrase(after);
  const arch = archetypePhrase(archetype);
  if (fromPhrase && toPhrase && fromPhrase !== toPhrase)
    return `${fromPhrase} → ${toPhrase} ${arch}`;
  if (toPhrase) return `${toPhrase} ${arch}`;
  const added = afterTraits.filter((t) => !before.has(t));
  const removed = beforeTraits.filter((t) => !after.has(t));
  if (added.length || removed.length)
    return `${arch}: ${[...removed.map((t) => `-${t}`), ...added.map((t) => `+${t}`)].join(', ')}`;
  return `no structural change to ${arch}`;
}

/* ── public API ───────────────────────────────────────────────────────── */

/** Everything derived from a single page's geometry (no correction context). */
interface PageFeatures {
  archetype: Archetype;
  roles: Map<string, NodeRole>;
  roleCounts: RoleCounts;
  regions: RegionFeature[];
  tiers: TierStructure;
  relations: string[];
  traits: string[];
  stats: GraphStats;
}

function analyzePage(page: Page): PageFeatures {
  const g = buildGraph(page);
  const archetype = detectArchetypeFor(g);
  const roles = assignRolesFor(g, archetype);
  const roleCounts = tallyRoles(roles);
  const regions = extractRegionsFor(g, roles);
  const tiers = analyzeTiersFor(g, roles);
  const relations = analyzeRelationsFor(g, roles, regions);
  const traits = extractTraitsFrom(
    archetype,
    roleCounts,
    regions,
    tiers,
    relations,
  );

  const degrees = g.nodes.map((n) => g.degree.get(n.id) ?? 0);
  const degreeHistogram: Record<number, number> = {};
  for (const d of degrees) degreeHistogram[d] = (degreeHistogram[d] ?? 0) + 1;
  const stats: GraphStats = {
    nodeCount: g.nodes.length,
    linkCount: g.links.length,
    zoneCount: (page.zones ?? []).length,
    maxDegree: degrees.length ? Math.max(...degrees) : 0,
    minDegree: degrees.length ? Math.min(...degrees) : 0,
    components: connectedComponents(g),
    degreeHistogram,
  };

  return {
    archetype,
    roles,
    roleCounts,
    regions,
    tiers,
    relations,
    traits,
    stats,
  };
}

/**
 * Extract the deterministic {@link SemanticFeatures} of a settled change.
 *
 * @param operations The user's settled correction operations (agent-vs-user
 *   overlap is computed against `context.agentOperations`).
 * @param context The post-change document plus optional agent baseline / ops.
 */
export function extractFeatures(
  operations: WorkspaceOperation[],
  context: DocumentContext,
): SemanticFeatures {
  const page = pickPage(context.document, context.pageId);
  const after = analyzePage(page);

  const beforeTraits = context.agentDocument
    ? analyzePage(
        pickPage(context.agentDocument, context.agentPageId ?? context.pageId),
      ).traits
    : after.traits;

  const agentOps = context.agentOperations ?? [];
  const agentTargets = [...new Set(agentOps.flatMap(operationTargets))].sort();
  const userTargets = [...new Set(operations.flatMap(operationTargets))].sort();
  const overlapTargets =
    agentOps.length && operations.length
      ? conflictingTargets(operations, agentOps)
      : [];

  const removedTraits = beforeTraits
    .filter((t) => !after.traits.includes(t))
    .sort();
  const addedTraits = after.traits
    .filter((t) => !beforeTraits.includes(t))
    .sort();

  const correction: CorrectionFeature = {
    agentTargets,
    userTargets,
    overlapTargets,
    correctedNodeIds: operationNodeIds(operations),
    removedTraits,
    addedTraits,
    summary: correctionSummary(after.archetype, beforeTraits, after.traits),
  };

  return {
    archetype: after.archetype,
    nodeRoles: Object.fromEntries(
      [...after.roles.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    ),
    roleCounts: after.roleCounts,
    regions: after.regions,
    tiers: after.tiers,
    relations: after.relations,
    traits: after.traits,
    correction,
    stats: after.stats,
    ...(context.taskTerms ? { taskTerms: [...context.taskTerms] } : {}),
    ...(context.rationale !== undefined
      ? { rationale: context.rationale }
      : {}),
  };
}

/* ── focused helper exports (for testing / reuse) ─────────────────────── */

/** Archetype of a single page from graph structure alone. */
export function detectArchetype(page: Page): Archetype {
  return detectArchetypeFor(buildGraph(page));
}

/** Role per node id for a single page. */
export function assignRoles(page: Page): Record<string, NodeRole> {
  const g = buildGraph(page);
  return Object.fromEntries(assignRolesFor(g, detectArchetypeFor(g)));
}

/** Region/site groupings from a page's zones. */
export function extractRegions(page: Page): RegionFeature[] {
  const g = buildGraph(page);
  return extractRegionsFor(g, assignRolesFor(g, detectArchetypeFor(g)));
}

/** Graph tiers + inter-tier/inter-region connectivity for a page. */
export function analyzeTiers(page: Page): TierStructure {
  const g = buildGraph(page);
  return analyzeTiersFor(g, assignRolesFor(g, detectArchetypeFor(g)));
}

/** Categorical relational (ordering/alignment/grouping) facts for a page. */
export function analyzeRelations(page: Page): string[] {
  const g = buildGraph(page);
  const roles = assignRolesFor(g, detectArchetypeFor(g));
  return analyzeRelationsFor(g, roles, extractRegionsFor(g, roles));
}

/** Flat trait tokens for a page (the trigger-trait vocabulary). */
export function extractTraits(page: Page): string[] {
  return analyzePage(page).traits;
}
