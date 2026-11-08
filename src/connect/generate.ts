/**
 * SD-WAN topology generator — intent in, fabric out.
 *
 * A wizard (or an agent, over MCP) states the *shape* of an SD-WAN fabric:
 * vendor, regions, hubs, branches, transports, HA, LAN. This module expands
 * that intent into the same vendor-neutral `FabricRecords` a live provider
 * yields, then runs them through `compileFabric` — so a generated design and a
 * live Orchestrator pull land with the same layers, zones, colors and source
 * conventions. A generation pass then adds what a fabric API doesn't report
 * (transport clouds, WAN circuits, HA cabling, branch LAN) and lays the result
 * out deterministically: one column per region; hubs, transports, branches,
 * LAN as rows.
 *
 * Vendor semantics (the part that decides tunnel and HA counts):
 *
 * - **EdgeConnect** — underlay tunnels per *matching WAN label* between each
 *   appliance pair (INET1↔INET1, MPLS1↔MPLS1); an LTE label cross-connects to
 *   the hub's Internet label. One bonded overlay tunnel per appliance pair per
 *   Business Intent Overlay. Branch HA = two active appliances joined by an HA
 *   link; each circuit lands on one member and is shared over the HA link, so
 *   *both* members build tunnels on every label.
 * - **Juniper (SRX, Mist WAN Assurance)** — no separate bonded overlay: one
 *   IPsec overlay tunnel per spoke WAN path to the hub endpoint on the same
 *   transport (LTE → the hub's Internet endpoint). Branch HA = an SRX chassis
 *   cluster: control + fabric links, WAN circuits on redundant (reth)
 *   interfaces across both nodes, and tunnels terminate on the cluster — drawn
 *   on node0 (primary), not duplicated per node.
 *
 * Hubs are independent appliances (dual hubs are NOT an HA pair) and terminate
 * every non-LTE transport their region's branches use. Hubs within a region
 * mesh; across regions they mesh only when `interRegionHubMesh` is set.
 *
 * DOM-free and deterministic: same intent → same document.
 */
import { compileFabric, FABRIC_LAYERS, type FabricRecords } from './compile.js';
import type { ApplianceRecord, TunnelRecord } from './types.js';
import { defineLayer } from '../api/builder.js';
import type { Page, TopologyDocument } from '../pages/model.js';

/** Source-system id on every generated element — never a live provider's. */
export const SYNTHETIC_SYSTEM = 'synthetic';

export const SDWAN_VENDORS = ['edgeconnect', 'juniper'] as const;
export type SdwanVendor = (typeof SDWAN_VENDORS)[number];

export const TRANSPORTS = ['inet', 'mpls', 'lte'] as const;
export type Transport = (typeof TRANSPORTS)[number];

export const BRANCH_LAN = ['none', 'switch', 'switch-ap'] as const;
export type BranchLan = (typeof BRANCH_LAN)[number];

export const DETAIL_LEVELS = ['device', 'site'] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

export const SDWAN_LIMITS = {
  regions: { min: 1, max: 4 },
  hubsPerRegion: { min: 1, max: 2 },
  branchesPerRegion: { min: 1, max: 12 },
  wanLinks: { min: 1, max: 3 },
} as const;

export const DEFAULT_REGION_NAMES = ['AMER', 'EMEA', 'APAC', 'LATAM'] as const;

export interface SdwanIntent {
  vendor: SdwanVendor;
  /** `device`: every appliance and cable. `site`: one tile per site. */
  detail?: DetailLevel;
  /** Number of regions (1–4). */
  regions?: number;
  /** Optional region display names (defaults: AMER, EMEA, APAC, LATAM). */
  regionNames?: string[];
  /** Independent hubs per region (1–2). Two hubs are NOT an HA pair. */
  hubsPerRegion?: number;
  /** Branches per region — one count for all, or one per region (1–12). */
  branchesPerRegion?: number | number[];
  /** WAN transport of each branch circuit, in port order (1–3 entries). */
  transports?: readonly Transport[];
  /** Branch edge HA (EC HA pair / SRX chassis cluster). */
  branchHa?: boolean;
  branchLan?: BranchLan;
  /** Mesh hubs across regions (always meshed within a region). */
  interRegionHubMesh?: boolean;
  /** EdgeConnect Business Intent Overlay name (default "Default"). */
  overlayName?: string;
  title?: string;
}

/** The intent with every default applied and every bound enforced. */
export type ResolvedSdwanIntent = Required<
  Omit<SdwanIntent, 'branchesPerRegion' | 'regionNames' | 'transports'>
> & {
  branchesPerRegion: number[];
  regionNames: string[];
  transports: Transport[];
};

export interface SdwanStats {
  /** Network devices drawn (edge appliances, switches, APs). */
  devices: number;
  /** Tunnel links (underlay + overlay layers). */
  tunnels: number;
  underlayTunnels: number;
  overlayTunnels: number;
  /** Physical cables (WAN circuits, HA/cluster links, LAN). */
  links: number;
}

export interface SdwanResult {
  doc: TopologyDocument;
  intent: ResolvedSdwanIntent;
  stats: SdwanStats;
}

const VENDOR_PROFILE: Record<
  SdwanVendor,
  {
    displayName: string;
    nodeType: string;
    edgeName: string;
    switchName: string;
    apName: string;
  }
> = {
  edgeconnect: {
    displayName: 'HPE Aruba Networking EdgeConnect',
    nodeType: 'ec',
    edgeName: 'ec',
    switchName: 'AOS-CX switch',
    apName: 'AP',
  },
  juniper: {
    displayName: 'Juniper SRX (Mist WAN Assurance)',
    nodeType: 'firewall',
    edgeName: 'srx',
    switchName: 'EX switch',
    apName: 'Mist AP',
  },
};

/** Transport → the label family a hub terminates (LTE rides Internet). */
const HUB_FAMILY: Record<Transport, 'inet' | 'mpls'> = {
  inet: 'inet',
  mpls: 'mpls',
  lte: 'inet',
};

const TRANSPORT_LABEL: Record<Transport, string> = {
  inet: 'INET',
  mpls: 'MPLS',
  lte: 'LTE',
};

const CLOUD_LABEL: Record<'inet' | 'mpls', string> = {
  inet: 'Internet',
  mpls: 'MPLS',
};

const CIRCUIT_COLOR: Record<Transport, string> = {
  inet: '#65aef9',
  mpls: '#c140ff',
  lte: '#ffbc44',
};

class IntentError extends Error {}

function clampInt(
  name: string,
  v: unknown,
  def: number,
  { min, max }: { min: number; max: number },
): number {
  if (v === undefined) return def;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    throw new IntentError(
      `${name} must be an integer from ${min} to ${max} (got ${JSON.stringify(v)})`,
    );
  return v;
}

/** Apply defaults and validate bounds; throws a message naming the bad field. */
export function resolveSdwanIntent(intent: SdwanIntent): ResolvedSdwanIntent {
  if (!SDWAN_VENDORS.includes(intent.vendor))
    throw new IntentError(
      `vendor must be one of ${SDWAN_VENDORS.join(', ')} (got ${JSON.stringify(intent.vendor)})`,
    );
  const detail = intent.detail ?? 'device';
  if (!DETAIL_LEVELS.includes(detail))
    throw new IntentError(`detail must be one of ${DETAIL_LEVELS.join(', ')}`);
  const regions = clampInt('regions', intent.regions, 1, SDWAN_LIMITS.regions);
  const hubsPerRegion = clampInt(
    'hubsPerRegion',
    intent.hubsPerRegion,
    2,
    SDWAN_LIMITS.hubsPerRegion,
  );
  const raw = intent.branchesPerRegion ?? 4;
  const counts = Array.isArray(raw) ? raw : Array(regions).fill(raw);
  if (counts.length !== regions)
    throw new IntentError(
      `branchesPerRegion has ${counts.length} entries but regions is ${regions}`,
    );
  const branchesPerRegion = counts.map((c: unknown, i: number) =>
    clampInt(`branchesPerRegion[${i}]`, c, 4, SDWAN_LIMITS.branchesPerRegion),
  );
  const transports = intent.transports ?? ['inet'];
  if (
    transports.length < SDWAN_LIMITS.wanLinks.min ||
    transports.length > SDWAN_LIMITS.wanLinks.max
  )
    throw new IntentError(
      `transports needs ${SDWAN_LIMITS.wanLinks.min}–${SDWAN_LIMITS.wanLinks.max} entries`,
    );
  for (const t of transports)
    if (!TRANSPORTS.includes(t))
      throw new IntentError(
        `transport must be one of ${TRANSPORTS.join(', ')} (got ${JSON.stringify(t)})`,
      );
  const branchLan = intent.branchLan ?? 'none';
  if (!BRANCH_LAN.includes(branchLan))
    throw new IntentError(`branchLan must be one of ${BRANCH_LAN.join(', ')}`);
  const names = (intent.regionNames ?? [])
    .map((n) => String(n).trim().slice(0, 24))
    .filter(Boolean);
  const regionNames = Array.from(
    { length: regions },
    (_, i) => names[i] ?? DEFAULT_REGION_NAMES[i] ?? `R${i + 1}`,
  );
  if (new Set(regionNames.map((n) => n.toLowerCase())).size !== regions)
    throw new IntentError('regionNames must be distinct');
  const overlayName =
    String(intent.overlayName ?? 'Default')
      .trim()
      .slice(0, 32) || 'Default';
  return {
    vendor: intent.vendor,
    detail,
    regions,
    regionNames,
    hubsPerRegion,
    branchesPerRegion,
    transports: [...transports],
    branchHa: intent.branchHa ?? false,
    branchLan,
    interRegionHubMesh: intent.interRegionHubMesh ?? regions > 1,
    overlayName,
    title:
      String(intent.title ?? '')
        .trim()
        .slice(0, 120) ||
      `${VENDOR_PROFILE[intent.vendor].displayName} — ${regions} region${regions > 1 ? 's' : ''}`,
  };
}

/** Port labels per branch circuit: INET1, INET2, MPLS1, LTE1 … */
function wanLabels(transports: Transport[]): string[] {
  const n: Partial<Record<Transport, number>> = {};
  return transports.map((t) => {
    n[t] = (n[t] ?? 0) + 1;
    return `${TRANSPORT_LABEL[t]}${n[t]}`;
  });
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'r';
const pad = (n: number): string => String(n).padStart(2, '0');

/* ── synthesis: intent → FabricRecords (+ a plan of what to draw) ───── */

interface Member {
  record: ApplianceRecord;
  /** Which of the site's circuits physically land on this member. */
  circuits: number[];
}

interface SitePlan {
  id: string;
  label: string;
  region: number;
  role: 'hub' | 'branch';
  members: Member[];
  /** The member that terminates tunnels (all for EC; node0 for SRX). */
  tunnelEnds: string[];
  /** Per-circuit transport and port label. */
  transports: Transport[];
  wanLabels: string[];
}

interface Plan {
  records: FabricRecords;
  sites: SitePlan[];
  /** Hub-side label family per region (which clouds exist). */
  regionFamilies: ('inet' | 'mpls')[][];
}

function synthesize(i: ResolvedSdwanIntent): Plan {
  const p = VENDOR_PROFILE[i.vendor];
  const ec = i.vendor === 'edgeconnect';
  const sites: SitePlan[] = [];
  const appliances: ApplianceRecord[] = [];
  const underlay: TunnelRecord[] = [];
  const overlay: TunnelRecord[] = [];
  const families = Array.from(new Set(i.transports.map((t) => HUB_FAMILY[t])));
  // Hubs carry one circuit per family the region's branches need.
  const hubTransports: Transport[] = families.map((f) => f);
  const regionFamilies = i.regionNames.map(() => families);

  i.regionNames.forEach((rName, r) => {
    const rs = slug(rName);
    for (let h = 1; h <= i.hubsPerRegion; h++) {
      const id = `${rs}-hub${pad(h)}`;
      const rec: ApplianceRecord = {
        id,
        hostname: `${id}-${p.edgeName}`,
        role: 'hub',
        site: `${rName} hub ${h}`,
      };
      appliances.push(rec);
      sites.push({
        id,
        label: rec.site!,
        region: r,
        role: 'hub',
        members: [{ record: rec, circuits: hubTransports.map((_, k) => k) }],
        tunnelEnds: [id],
        transports: hubTransports,
        wanLabels: wanLabels(hubTransports),
      });
    }
    for (let b = 1; b <= i.branchesPerRegion[r]!; b++) {
      const id = `${rs}-br${pad(b)}`;
      const site = `${rName} branch ${b}`;
      const n = i.branchHa && i.detail === 'device' ? 2 : 1;
      const members: Member[] = [];
      for (let m = 0; m < n; m++) {
        const memberId = n === 1 ? id : `${id}-${m + 1}`;
        const suffix =
          n === 1
            ? p.edgeName
            : ec
              ? `${p.edgeName}${m + 1}`
              : `${p.edgeName}-node${m}`;
        const rec: ApplianceRecord = {
          id: memberId,
          hostname: `${id}-${suffix}`,
          role: 'spoke',
          site,
        };
        appliances.push(rec);
        // EC HA: circuits alternate across members (shared via the HA link).
        // SRX cluster: every circuit is a reth spanning both nodes.
        const circuits = i.transports
          .map((_, k) => k)
          .filter((k) => n === 1 || !ec || k % n === m);
        members.push({ record: rec, circuits });
      }
      sites.push({
        id,
        label: site,
        region: r,
        role: 'branch',
        members,
        tunnelEnds: ec
          ? members.map((m) => m.record.id)
          : [members[0]!.record.id],
        transports: i.transports,
        wanLabels: wanLabels(i.transports),
      });
    }
  });

  const hubs = sites.filter((s) => s.role === 'hub');
  const tunnel = (
    a: SitePlan,
    aEnd: string,
    b: SitePlan,
    bEnd: string,
  ): void => {
    if (i.detail === 'site') {
      overlay.push({
        id: `ov:${a.id}:${b.id}`,
        scope: 'overlay',
        from: aEnd,
        to: bEnd,
        status: 'up',
        overlay: ec ? i.overlayName : 'IPsec',
      });
      return;
    }
    // Pair each circuit on `a` with the hub label of the same family on `b`.
    const pairs: [string, string][] = [];
    a.transports.forEach((t, k) => {
      const fam = HUB_FAMILY[t];
      const bk = b.transports.findIndex((bt) => HUB_FAMILY[bt] === fam);
      if (bk >= 0) pairs.push([a.wanLabels[k]!, b.wanLabels[bk]!]);
    });
    for (const [la, lb] of pairs) {
      const label = la === lb ? la : `${la}→${lb}`;
      const rec: TunnelRecord = {
        id: `${ec ? 'ul' : 'ov'}:${aEnd}:${bEnd}:${la}`,
        scope: ec ? 'underlay' : 'overlay',
        from: aEnd,
        to: bEnd,
        status: 'up',
        fromInterface: label,
        toInterface: lb,
        ...(ec ? {} : { overlay: label }),
      };
      (ec ? underlay : overlay).push(rec);
    }
    if (ec && pairs.length)
      overlay.push({
        id: `ov:${aEnd}:${bEnd}`,
        scope: 'overlay',
        from: aEnd,
        to: bEnd,
        status: 'up',
        overlay: i.overlayName,
      });
  };

  // Branch → every hub in its region.
  for (const br of sites.filter((s) => s.role === 'branch'))
    for (const hub of hubs.filter((h) => h.region === br.region))
      for (const end of br.tunnelEnds) tunnel(br, end, hub, hub.tunnelEnds[0]!);
  // Hub ↔ hub: within a region always; across regions when meshed.
  for (let x = 0; x < hubs.length; x++)
    for (let y = x + 1; y < hubs.length; y++) {
      const a = hubs[x]!;
      const b = hubs[y]!;
      if (a.region !== b.region && !i.interRegionHubMesh) continue;
      tunnel(a, a.tunnelEnds[0]!, b, b.tunnelEnds[0]!);
    }

  return {
    records: { appliances, underlay, overlay, policies: [] },
    sites,
    regionFamilies,
  };
}

/* ── generation pass: draw what the fabric API doesn't report ───────── */

const GEO = {
  margin: 80,
  regionGap: 120,
  memberPitch: 180,
  sitePad: 130,
  minSitePitch: 200,
  hubPitch: 240,
  /** Branch sites per row before wrapping (single / HA). */
  perRow: { single: 6, ha: 4 },
  rowGap: 200,
  row: { hub: 120, cloud: 330, branch: 560, sw: 170, ap: 320 },
} as const;

function nodeIdFor(page: Page, applianceId: string): string {
  const n = page.nodes.find(
    (x) =>
      x.source?.system === SYNTHETIC_SYSTEM &&
      x.source.kind === 'appliance' &&
      x.source.id === applianceId,
  );
  if (!n) throw new Error(`generator: appliance ${applianceId} not compiled`);
  return n.id;
}

function decorate(
  doc: TopologyDocument,
  plan: Plan,
  i: ResolvedSdwanIntent,
): void {
  const page = doc.pages[0]!;
  const p = VENDOR_PROFILE[i.vendor];
  const ec = i.vendor === 'edgeconnect';
  const device = i.detail === 'device';
  page.id = 'sdwan';
  page.name = device ? 'SD-WAN fabric' : 'SD-WAN overview';
  const byId = new Map(page.nodes.map((n) => [n.id, n]));
  const node = (applianceId: string) => byId.get(nodeIdFor(page, applianceId))!;

  // Every element the compiler made is synthetic; label the vendor platform.
  for (const n of page.nodes) {
    n.type = p.nodeType;
    n.meta = { ...(n.meta ?? {}), platform: p.displayName, generated: 'true' };
  }

  // Regions tile in a grid (two across past two regions) so a multi-region
  // fabric stays near page-shaped instead of one very wide strip. With two
  // grid rows the top row is mirrored (LAN on top, hubs at the bottom), so
  // every region's hubs face the central hub band and the inter-region mesh
  // stays short instead of crossing the branches.
  const cols = i.regions <= 2 ? i.regions : 2;
  const mirrorTopRow = i.regions > cols;
  const topRowNodes = new Set<string>();
  let topRowBottom = 0;
  let cursorX = GEO.margin;
  let originY = 0;
  let rowBottom = 0;
  let maxX = 0;
  let maxY = 0;
  const regionZones: string[] = [];

  plan.regionFamilies.forEach((families, r) => {
    const rName = i.regionNames[r]!;
    const rs = slug(rName);
    if (r > 0 && r % cols === 0) {
      if (r === cols) topRowBottom = rowBottom;
      cursorX = GEO.margin;
      originY = rowBottom + GEO.rowGap;
    }
    const regionNodes: string[] = [];
    const hubs = plan.sites.filter((s) => s.region === r && s.role === 'hub');
    const branches = plan.sites.filter(
      (s) => s.region === r && s.role === 'branch',
    );
    const members = branches[0]?.members.length ?? 1;
    const pitch = Math.max(
      GEO.minSitePitch,
      members * GEO.memberPitch + GEO.sitePad,
    );
    const perRow = members > 1 ? GEO.perRow.ha : GEO.perRow.single;
    const firstRow = Math.min(perRow, branches.length);
    // Branch rows: device detail sits below the transport clouds; the LAN
    // block (switch, AP) hangs under each branch and sets the row stride.
    const branchY = originY + (device ? GEO.row.branch : GEO.row.cloud);
    const lanDepth = !device
      ? 0
      : i.branchLan === 'switch-ap'
        ? GEO.row.ap
        : i.branchLan === 'switch'
          ? GEO.row.sw
          : 0;
    const stride = lanDepth + GEO.rowGap;
    const width = Math.max(
      firstRow * pitch,
      hubs.length * GEO.hubPitch,
      device ? families.length * GEO.hubPitch : 0,
    );
    const centre = (count: number, step: number, k: number): number =>
      Math.round(cursorX + width / 2 - ((count - 1) * step) / 2 + k * step);

    hubs.forEach((h, k) => {
      const n = node(h.members[0]!.record.id);
      n.x = centre(hubs.length, GEO.hubPitch, k);
      n.y = originY + GEO.row.hub;
      n.sublabel = h.label;
      regionNodes.push(n.id);
    });

    // Transport clouds (device detail): one per label family per region.
    const cloudIds: Partial<Record<'inet' | 'mpls', string>> = {};
    if (device)
      families.forEach((f, k) => {
        const id = `cloud_${rs}_${f}`;
        page.nodes.push({
          id,
          type: 'cloud',
          x: centre(families.length, GEO.hubPitch, k),
          y: originY + GEO.row.cloud,
          label: `${CLOUD_LABEL[f]}`,
          sublabel: rName,
          meta: { transport: f, generated: 'true' },
        });
        cloudIds[f] = id;
        regionNodes.push(id);
      });

    // Hub WAN circuits: one per label family the region uses.
    if (device)
      for (const h of hubs)
        h.transports.forEach((t, k) => {
          const cloud = cloudIds[HUB_FAMILY[t]];
          if (!cloud) return;
          page.links.push({
            id: `lk_${h.id}_wan${k + 1}`,
            type: 'line',
            from: node(h.members[0]!.record.id).id,
            to: cloud,
            label: h.wanLabels[k]!,
            color: CIRCUIT_COLOR[t],
            meta: { kind: 'wan-circuit', transport: t, generated: 'true' },
          });
        });

    let bottom: number = originY + (device ? GEO.row.cloud : GEO.row.hub);
    branches.forEach((s, k) => {
      const rowIx = Math.floor(k / perRow);
      const inRow = Math.min(perRow, branches.length - rowIx * perRow);
      const cx = centre(inRow, pitch, k % perRow);
      const y0 = branchY + rowIx * stride;
      const ids = s.members.map((m) => node(m.record.id).id);
      s.members.forEach((m, mi) => {
        const n = node(m.record.id);
        n.x = Math.round(
          cx -
            ((s.members.length - 1) * GEO.memberPitch) / 2 +
            mi * GEO.memberPitch,
        );
        n.y = y0;
        if (!device) n.sublabel = summarizeSite(i);
      });
      bottom = Math.max(bottom, y0);
      regionNodes.push(...ids);
      if (!device) return;

      // HA / cluster cabling between members.
      if (s.members.length === 2) {
        const [a, b] = ids as [string, string];
        // SRX chassis cluster: control + fabric cables, one shared caption.
        const ha = ec
          ? [{ key: 'ha', label: 'HA link' }]
          : [
              { key: 'ctl', label: 'cluster' },
              { key: 'fab', label: undefined },
            ];
        for (const l of ha)
          page.links.push({
            id: `lk_${s.id}_${l.key}`,
            type: 'line',
            from: a,
            to: b,
            ...(l.label ? { label: l.label } : {}),
            color: '#b1b9be',
            meta: { kind: ec ? 'ha' : `cluster-${l.key}`, generated: 'true' },
          });
      }

      // WAN circuits: member → transport cloud.
      s.members.forEach((m) => {
        for (const k of m.circuits) {
          const t = s.transports[k]!;
          const cloud = cloudIds[HUB_FAMILY[t]];
          if (!cloud) continue;
          page.links.push({
            id: `lk_${m.record.id}_wan${k + 1}`,
            type: t === 'lte' ? 'wifi' : 'line',
            from: node(m.record.id).id,
            to: cloud,
            label: s.wanLabels[k]!,
            color: CIRCUIT_COLOR[t],
            meta: { kind: 'wan-circuit', transport: t, generated: 'true' },
          });
        }
      });

      // Branch LAN.
      if (i.branchLan !== 'none') {
        const sw = `lan_${s.id}_sw`;
        page.nodes.push({
          id: sw,
          type: 'switch',
          x: cx,
          y: y0 + GEO.row.sw,
          label: `${s.id}-sw`,
          sublabel: p.switchName,
          meta: { generated: 'true' },
        });
        ids.forEach((from, mi) =>
          page.links.push({
            id: `lk_${s.id}_lan${mi + 1}`,
            type: 'line',
            from,
            to: sw,
            meta: { kind: 'lan', generated: 'true' },
          }),
        );
        const siteNodes = [sw];
        bottom = Math.max(bottom, y0 + GEO.row.sw);
        if (i.branchLan === 'switch-ap') {
          const ap = `lan_${s.id}_ap`;
          page.nodes.push({
            id: ap,
            type: 'ap',
            x: cx,
            y: y0 + GEO.row.ap,
            label: `${s.id}-ap`,
            sublabel: p.apName,
            meta: { generated: 'true' },
          });
          page.links.push({
            id: `lk_${s.id}_ap`,
            type: 'poe',
            from: sw,
            to: ap,
            meta: { kind: 'lan', generated: 'true' },
          });
          siteNodes.push(ap);
          bottom = Math.max(bottom, y0 + GEO.row.ap);
        }
        regionNodes.push(...siteNodes);
        const zone = page.zones.find((z) => z.label === s.label);
        zone?.nodes.push(...siteNodes);
      }
    });

    // Hubs sit in the region band, not their own one-node zones.
    page.zones = page.zones.filter(
      (z) => !hubs.some((h) => h.label === z.label),
    );
    const regionZone = `region_${rs}`;
    page.zones.push({
      id: regionZone,
      label: rName,
      nodes: regionNodes,
      borderStyle: 'dashed',
      labelAlign: 'left',
      // A mirrored region labels its hub edge, like the row below it.
      ...(mirrorTopRow && r < cols ? { labelPosition: 'bottom' as const } : {}),
    });
    // A site zone only earns its box when it groups more than one device.
    page.zones = page.zones.filter(
      (z) => !branches.some((b) => b.label === z.label) || z.nodes.length > 1,
    );
    for (const z of page.zones)
      if (branches.some((b) => b.label === z.label)) z.parentZone = regionZone;
    regionZones.push(regionZone);
    if (mirrorTopRow && r < cols)
      for (const id of regionNodes) topRowNodes.add(id);
    maxY = Math.max(maxY, bottom);
    rowBottom = Math.max(rowBottom, bottom);
    maxX = Math.max(maxX, cursorX + width);
    cursorX += width + GEO.regionGap;
  });

  // Flip the top row about its own band: hubs (y = row.hub) land on the
  // row's bottom edge, the deepest LAN row on its top edge.
  if (mirrorTopRow)
    for (const n of page.nodes)
      if (topRowNodes.has(n.id)) n.y = GEO.row.hub + topRowBottom - n.y;

  // Tunnel labels repeat on every link — keep them in metadata only when the
  // page is dense, so the canvas stays readable.
  const tunnelCount = page.links.filter(
    (l) =>
      l.layer === FABRIC_LAYERS.underlay || l.layer === FABRIC_LAYERS.overlay,
  ).length;
  if (tunnelCount > 24)
    for (const l of page.links)
      if (l.layer && l.label) {
        l.meta = { ...(l.meta ?? {}), transport: String(l.label) };
        delete l.label;
      }

  const w = Math.max(1050, maxX + GEO.margin);
  const h = Math.max(700, maxY + 160);
  page.viewBox = `0 0 ${Math.round(w)} ${Math.round(h)}`;

  // EC: underlay is the dense plane — hidden by default, overlay shown.
  // Juniper has no separate underlay plane, so the layer is dropped if empty.
  const hasUnderlay = page.links.some(
    (l) => l.layer === FABRIC_LAYERS.underlay,
  );
  if (hasUnderlay)
    defineLayer(doc, {
      id: FABRIC_LAYERS.underlay,
      name: 'Underlay',
      kind: 'underlay',
      defaultVisible: false,
    });
  else
    doc.layers = (doc.layers ?? []).filter(
      (l) => l.id !== FABRIC_LAYERS.underlay,
    );
  doc.layers = (doc.layers ?? []).filter((l) => l.id !== FABRIC_LAYERS.policy);
}

function summarizeSite(i: ResolvedSdwanIntent): string {
  const ha = i.branchHa
    ? i.vendor === 'edgeconnect'
      ? 'HA pair'
      : 'cluster'
    : 'single';
  return `${ha} · ${wanLabels(i.transports).join('+')}`;
}

export function sdwanStats(doc: TopologyDocument): SdwanStats {
  const page = doc.pages[0]!;
  const underlayTunnels = page.links.filter(
    (l) => l.layer === FABRIC_LAYERS.underlay,
  ).length;
  const overlayTunnels = page.links.filter(
    (l) => l.layer === FABRIC_LAYERS.overlay,
  ).length;
  return {
    devices: page.nodes.filter((n) => n.type !== 'cloud').length,
    tunnels: underlayTunnels + overlayTunnels,
    underlayTunnels,
    overlayTunnels,
    links: page.links.filter((l) => !l.layer).length,
  };
}

/**
 * Generate an SD-WAN topology document from an intent. Throws an `Error` whose
 * message names the offending field when the intent is out of bounds.
 */
export function generateSdwan(intent: SdwanIntent): SdwanResult {
  const resolved = resolveSdwanIntent(intent);
  const plan = synthesize(resolved);
  const doc = compileFabric(plan.records, {
    system: SYNTHETIC_SYSTEM,
    title: resolved.title,
    // Fixed stamp: generated documents are deterministic, and the source
    // refs mark the elements as synthetic rather than freshly fetched.
    fetchedAt: '1970-01-01T00:00:00.000Z',
  });
  decorate(doc, plan, resolved);
  return { doc, intent: resolved, stats: sdwanStats(doc) };
}
