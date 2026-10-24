/**
 * Interface assignment planner (hw-catalog Phase 3: `assign_interfaces`).
 * Picks free, compatible interfaces for link ends on bound nodes, page by
 * page (a page is a standalone frame), and returns a plan; the caller
 * decides whether to apply it. Never picks optics: what transceiver is in a
 * cage is a fact about the site, not something to invent.
 *
 * Compatible = a traffic role (never console / usb; mgmt, stack and ha only
 * when the role heuristic asks for them), free on that node on that page
 * (counting the plan so far), inside the stack (`hw.stackMembers`), and
 * speed-overlapping the far end when the far end is already known. A cage
 * port facing a fixed copper port is a last resort (it would need an optic).
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';
import { endBundle } from '../api/bundles.js';
import { isBound } from '../api/hardware.js';
import { CAGE_KINDS, type Catalog, type Model } from './catalog.js';

export type AssignStrategy = 'by-role' | 'first-free' | 'keep';

export interface Assignment {
  page: number;
  linkId: string;
  end: 'from' | 'to';
  node: string;
  interface: string;
  /** Why this interface: the role it matched, or the fallback taken. */
  why: string;
  /** Present when the end had an interface the plan replaces. */
  replaced?: string;
}

export interface Unassigned {
  page: number;
  linkId: string;
  end: 'from' | 'to';
  node: string;
  reason: string;
}

export interface AssignPlan {
  assignments: Assignment[];
  unassigned: Unassigned[];
}

interface Candidate {
  name: string;
  role: string;
  kind: string;
  speeds: ReadonlySet<number>;
  cage: boolean;
}

/** Every concrete interface a bound node has, `{member}` expanded. */
function candidates(
  catalog: Catalog,
  model: Model,
  members: number,
): Candidate[] {
  const phys = new Map(
    catalog.platformFor(model.id).ports.map((p) => [p.id, p]),
  );
  const out: Candidate[] = [];
  const rows = model.interfaces.filter(
    (r) => r.role !== 'console' && r.role !== 'usb',
  );
  const memberCount = rows.some((r) => r.name.includes('{member}'))
    ? members
    : 1;
  for (let m = 1; m <= memberCount; m++)
    for (const row of rows) {
      if (m > 1 && !row.name.includes('{member}')) continue;
      const kind = phys.get(row.physical)?.kind ?? 'unknown';
      out.push({
        name: row.name.replace('{member}', String(m)),
        role: row.role,
        kind,
        speeds: new Set(row.speeds_mbps ?? []),
        cage: CAGE_KINDS.has(kind),
      });
    }
  return out;
}

const WAN_TYPES = new Set([
  'cloud',
  'overlayCloud',
  'saas',
  'igw',
  'natgw',
  'vpngw',
  'dxgw',
  'tgw',
  'cloudrouter',
  'expressroute',
  'vwanhub',
  'modem',
]);
const WAN_WORDS = /\b(isp|internet|mpls|lte|5g|broadband|carrier|wan|dia)\b/i;
const ACCESS_TYPES = new Set([
  'host',
  'server',
  'apps',
  'database',
  'ap',
  'printer',
  'camera',
  'voip',
  'iot',
  'nas',
  'ups',
  'usergroup',
  'webserver',
  'mailserver',
  'dns',
  'vm',
]);
const GATEWAY_CATEGORIES = new Set([
  'sdwan-gateway',
  'wlan-gateway',
  'router',
  'firewall',
]);

/**
 * The role an end should land on, from the far end: wan toward ISPs /
 * clouds / modems; lan toward switches and everything inside; ha toward a
 * peer of the same category; on a switch, "uplink" (prefer cage ports)
 * toward network gear and "access" (prefer copper) toward endpoints.
 */
function preferredRole(
  catalog: Catalog,
  self: NodeConfig & { hw: { model: string } },
  far: NodeConfig | undefined,
  link: LinkConfig,
): { role: string; why: string } {
  const category = catalog.model(self.hw.model).category;
  const farCategory =
    far && isBound(far) && catalog.models.has(far.hw.model)
      ? catalog.model(far.hw.model).category
      : undefined;
  const farText = `${far?.label ?? ''} ${far?.sublabel ?? ''} ${link.label ?? ''}`;
  const wanish =
    !!far &&
    !farCategory &&
    (WAN_TYPES.has(far.type) ||
      far.type === 'router' ||
      WAN_WORDS.test(farText));
  if (category === 'switch') {
    if (far && !farCategory && ACCESS_TYPES.has(far.type))
      return { role: 'access', why: `access port toward ${far.type}` };
    return { role: 'uplink', why: 'uplink toward network gear' };
  }
  if (GATEWAY_CATEGORIES.has(category)) {
    if (farCategory === category) return { role: 'ha', why: 'HA peer' };
    if (wanish) return { role: 'wan', why: 'WAN toward ISP / cloud' };
    return { role: 'lan', why: 'LAN toward the inside' };
  }
  return { role: 'data', why: 'data port' };
}

interface FarFacts {
  speeds: ReadonlySet<number> | null;
  /** Far end is a fixed copper port. */
  copper: boolean;
}

/** What is known about the far end (an assigned or planned interface). */
function farFacts(
  catalog: Catalog,
  far: NodeConfig | undefined,
  ifName: string | undefined,
  optic: string | undefined,
): FarFacts {
  if (!far || !isBound(far) || !ifName || !catalog.models.has(far.hw.model))
    return { speeds: null, copper: false };
  const r = catalog.resolveInterface(far.hw.model, ifName);
  if (!r) return { speeds: null, copper: false };
  if (!CAGE_KINDS.has(r.physicalKind))
    return { speeds: r.speeds, copper: true };
  const type = optic ? catalog.optics.types[optic] : undefined;
  if (!type) return { speeds: r.speeds, copper: false };
  const s = new Set<number>();
  for (const v of type.speeds_mbps) if (r.speeds.has(v)) s.add(v);
  return { speeds: s, copper: type.media === 'copper' };
}

/** Lower is better. */
function score(
  c: Candidate,
  role: string,
  far: FarFacts,
  bondMembers: ReadonlySet<string> | undefined,
  strategy: AssignStrategy,
): number[] {
  const roleScore = (() => {
    if (strategy === 'first-free') return 0;
    switch (role) {
      case 'wan':
      case 'lan':
      case 'ha':
        return c.role === role ? 0 : c.role === 'data' ? 1 : 2;
      case 'uplink':
        return c.cage ? 0 : 1;
      case 'access':
        return c.cage ? 1 : 0;
      default:
        return c.role === 'data' ? 0 : 1;
    }
  })();
  return [
    bondMembers ? (bondMembers.has(c.name) ? 0 : 1) : 0,
    // A cage facing fixed copper needs an optic: last resort.
    far.copper && c.cage ? 1 : 0,
    roleScore,
  ];
}

const cmp = (a: number[], b: number[]): number => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
};

function planPage(
  catalog: Catalog,
  page: Page,
  pi: number,
  strategy: AssignStrategy,
  inScope: (l: LinkConfig) => boolean,
  plan: AssignPlan,
): void {
  const nodes = new Map(page.nodes.map((n) => [n.id, n]));
  // Current interface per link end (planned values replace these).
  const current = new Map<string, string | undefined>();
  const k = (l: LinkConfig, end: 'from' | 'to'): string => `${l.id}|${end}`;
  for (const l of page.links) {
    current.set(k(l, 'from'), l.fromInterface || undefined);
    current.set(k(l, 'to'), l.toInterface || undefined);
  }

  // Which ends need a pick, and which existing picks are invalid.
  const needs: { link: LinkConfig; end: 'from' | 'to'; replaced?: string }[] =
    [];
  const usedCount = new Map<string, number>(); // node|name → ends using it
  const useKey = (node: string, name: string): string => `${node}\u0000${name}`;
  for (const l of page.links)
    for (const end of ['from', 'to'] as const) {
      const name = current.get(k(l, end));
      if (name) {
        const u = useKey(l[end], name);
        usedCount.set(u, (usedCount.get(u) ?? 0) + 1);
      }
    }
  // A port cabled twice keeps its first cable: out-of-scope links claim
  // first (they cannot be re-planned), then in-scope links in page order.
  const claimed = new Set<string>();
  for (const l of page.links)
    if (!inScope(l))
      for (const end of ['from', 'to'] as const) {
        const name = current.get(k(l, end));
        if (name) claimed.add(useKey(l[end], name));
      }
  for (const l of page.links) {
    if (!inScope(l)) continue;
    for (const end of ['from', 'to'] as const) {
      const node = nodes.get(l[end]);
      if (!node || !isBound(node) || !catalog.models.has(node.hw.model))
        continue;
      const name = current.get(k(l, end));
      if (!name) {
        needs.push({ link: l, end });
        continue;
      }
      const u = useKey(l[end], name);
      const duplicate = claimed.has(u);
      claimed.add(u);
      if (strategy === 'keep') continue;
      const r = catalog.resolveInterface(node.hw.model, name);
      const limit =
        node.hw.stackMembers ||
        catalog.model(node.hw.model).stackable?.max_members ||
        1;
      const bad =
        !r ||
        r.role === 'console' ||
        r.role === 'usb' ||
        (r.member !== null && r.member > limit) ||
        duplicate;
      if (bad) {
        // Release it: an invalid name frees nothing real, a duplicate
        // leaves the first cable on the port.
        usedCount.set(u, (usedCount.get(u) ?? 1) - 1);
        current.set(k(l, end), undefined);
        needs.push({ link: l, end, replaced: name });
      }
    }
  }
  // Bond ends first, so a bundle named like a bond group gets its members
  // before single links take them.
  const bonded = (n: (typeof needs)[number]): boolean => {
    const node = nodes.get(n.link[n.end]);
    const bundle = endBundle(n.link, n.end);
    return (
      !!bundle &&
      !!node &&
      isBound(node) &&
      !!catalog.model(node.hw.model).bond_groups?.some((g) => g.name === bundle)
    );
  };
  needs.sort((x, y) => Number(bonded(y)) - Number(bonded(x)));

  for (const { link: l, end, replaced } of needs) {
    const node = nodes.get(l[end]) as NodeConfig & {
      hw: { model: string; stackMembers?: number };
    };
    const farEnd = end === 'from' ? 'to' : 'from';
    const far = nodes.get(l[farEnd]);
    const model = catalog.model(node.hw.model);
    const members = node.hw.stackMembers || 1;
    const { role, why } = preferredRole(catalog, node, far, l);
    const facts = farFacts(
      catalog,
      far,
      current.get(k(l, farEnd)),
      farEnd === 'from' ? l.fromOptic : l.toOptic,
    );
    const bundle = endBundle(l, end);
    const group = bundle
      ? model.bond_groups?.find((g) => g.name === bundle)
      : undefined;
    const bondMembers = group ? new Set(group.members) : undefined;
    const pool = candidates(catalog, model, members).filter((c) => {
      if ((usedCount.get(useKey(node.id, c.name)) ?? 0) > 0) return false;
      if (c.role === 'mgmt' || c.role === 'stack') return false;
      if (c.role === 'ha' && role !== 'ha') return false;
      if (facts.speeds && facts.speeds.size) {
        let overlap = false;
        for (const s of c.speeds) if (facts.speeds.has(s)) overlap = true;
        if (!overlap) return false;
      }
      return true;
    });
    if (!pool.length) {
      plan.unassigned.push({
        page: pi,
        linkId: l.id,
        end,
        node: node.id,
        reason: `no free compatible interface on ${model.id}${
          members > 1 ? ` (${members} members)` : ''
        }`,
      });
      continue;
    }
    // Stable sort keeps catalog order within a score: that is "first free".
    const best = pool
      .map((c, i) => ({
        c,
        i,
        s: score(c, role, facts, bondMembers, strategy),
      }))
      .sort((a, b) => cmp(a.s, b.s) || a.i - b.i)[0]!.c;
    const reasons: string[] = [];
    if (bondMembers?.has(best.name)) reasons.push(`bond group ${group!.name}`);
    reasons.push(strategy === 'first-free' ? 'first free' : why);
    if (
      strategy !== 'first-free' &&
      role === 'uplink' &&
      !best.cage &&
      facts.copper
    )
      reasons.push('copper: the far end is a fixed copper port');
    if (
      strategy !== 'first-free' &&
      ['wan', 'lan', 'ha'].includes(role) &&
      best.role !== role
    )
      reasons.push(`no free ${role} port; fell back to ${best.role}`);
    if (best.cage) reasons.push('cage port: declare the optic');
    plan.assignments.push({
      page: pi,
      linkId: l.id,
      end,
      node: node.id,
      interface: best.name,
      why: reasons.join('; '),
      ...(replaced ? { replaced } : {}),
    });
    current.set(k(l, end), best.name);
    const u = useKey(node.id, best.name);
    usedCount.set(u, (usedCount.get(u) ?? 0) + 1);
  }
}

/**
 * Plan interfaces for link ends on bound nodes. `by-role` and `first-free`
 * fill empty ends and re-plan ends whose interface cannot work (unknown on
 * the model, console / usb, outside the stack, or cabled twice); `keep`
 * only fills empty ends. `linkIds` limits the scope (any page).
 */
export function planInterfaces(
  doc: TopologyDocument,
  catalog: Catalog,
  strategy: AssignStrategy,
  linkIds?: readonly string[],
): AssignPlan {
  const want = linkIds?.length ? new Set(linkIds) : null;
  const plan: AssignPlan = { assignments: [], unassigned: [] };
  doc.pages.forEach((page, pi) =>
    planPage(catalog, page, pi, strategy, (l) => !want || want.has(l.id), plan),
  );
  return plan;
}

/** Write a plan's interfaces onto the document's links. */
export function applyPlan(doc: TopologyDocument, plan: AssignPlan): void {
  for (const a of plan.assignments) {
    const link = doc.pages[a.page]?.links.find((l) => l.id === a.linkId);
    if (!link) continue;
    if (a.end === 'from') link.fromInterface = a.interface;
    else link.toInterface = a.interface;
  }
}
