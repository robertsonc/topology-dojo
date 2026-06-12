/**
 * The flow-to-topology compiler — turns normalized provider records (see
 * types.ts) into a layered, sourced, validated `TopologyDocument`:
 *
 *   appliances → nodes (source refs + meta)   sites → zones
 *   underlay tunnels → links on the underlay layer
 *   overlay tunnels  → links on the overlay layer
 *   flows → animated flow paths with per-hop data + policy markers
 *
 * Every element is written with `upsertBySource`, so compiling the same
 * fabric/flows onto an existing document CONVERGES it (updates in place)
 * instead of duplicating — the importer can re-run forever. Deterministic:
 * the same records always produce the same document.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import { addPage, defineLayer, emptyDocument } from '../api/builder.js';
import { upsertBySource } from '../api/edit.js';
import { layoutDocument } from '../api/autolayout.js';
import { tidyDocument } from '../api/tidy.js';
import type { FlowHop } from '../vendor/topology-ds.js';
import type {
  ApplianceRecord,
  FlowRecord,
  OverlayPolicyRecord,
  TunnelRecord,
} from './types.js';

export interface FabricRecords {
  appliances: ApplianceRecord[];
  underlay: TunnelRecord[];
  overlay: TunnelRecord[];
  policies: OverlayPolicyRecord[];
}

export interface CompileOptions {
  /** Source-system id written into element source refs (e.g. "edgeconnect"). */
  system: string;
  title?: string;
  /** Freshness stamp for source refs; defaults to now. */
  fetchedAt?: string;
}

/** Document layer ids the compiler declares (bottom → top). */
export const FABRIC_LAYERS = {
  underlay: 'underlay',
  overlay: 'overlay',
  policy: 'policy',
} as const;

const COLORS = {
  underlayUp: '#b1b9be',
  overlayUp: '#01a982',
  down: '#fc6161',
  flow: '#65aef9',
  flowOverlay: '#01a982',
};

/** Deterministic element id from an external id (safe for SVG/data attrs). */
function elId(prefix: string, externalId: string): string {
  return `${prefix}_${externalId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function findNodeBySource(
  page: Page,
  system: string,
  kind: string,
  id: string,
): string | undefined {
  return page.nodes.find(
    (n) =>
      n.source?.system === system &&
      n.source.kind === kind &&
      n.source.id === id,
  )?.id;
}

/**
 * Compile (or converge) the fabric structure onto a document: layers, one
 * page, appliance nodes, site zones, and tunnel links on their layers.
 * Pass an existing compiled document to refresh it in place.
 */
export function compileFabric(
  records: FabricRecords,
  opts: CompileOptions,
  into?: TopologyDocument,
): TopologyDocument {
  const doc = into ?? emptyDocument(opts.title ?? 'Live fabric');
  const fetchedAt = opts.fetchedAt ?? new Date().toISOString();
  const src = (kind: string, id: string) => ({
    system: opts.system,
    kind,
    id,
    fetchedAt,
  });
  defineLayer(doc, {
    id: FABRIC_LAYERS.underlay,
    name: 'Underlay',
    kind: 'underlay',
  });
  defineLayer(doc, {
    id: FABRIC_LAYERS.overlay,
    name: 'Overlay',
    kind: 'overlay',
  });
  defineLayer(doc, {
    id: FABRIC_LAYERS.policy,
    name: 'Policy',
    kind: 'policy',
  });
  const page = doc.pages[0] ?? addPage(doc, { name: 'Fabric' });

  // Appliances: hubs in a right column, spokes in a left grid (the layout
  // pass refines this; positions only matter on first create).
  let hubY = 160;
  let spokeY = 160;
  for (const a of records.appliances) {
    const hub = a.role === 'hub';
    const x = hub ? 700 : 220;
    const y = hub ? (hubY += 160) : (spokeY += 160);
    upsertBySource(page, 'node', src('appliance', a.id), {
      id: elId('ne', a.id),
      type: 'ec',
      x,
      y,
      label: a.hostname,
      ...(a.site ? { sublabel: a.site } : {}),
      meta: {
        ...(a.serial ? { serial: a.serial } : {}),
        ...(a.model ? { model: a.model } : {}),
        ...(a.softwareVersion ? { version: a.softwareVersion } : {}),
        ...(a.role ? { role: a.role } : {}),
        ...(a.mgmtIp ? { mgmtIp: a.mgmtIp } : {}),
      },
    });
  }

  // Sites become zones around their member appliances.
  const bySite = new Map<string, string[]>();
  for (const a of records.appliances) {
    if (!a.site) continue;
    const nodeId = findNodeBySource(page, opts.system, 'appliance', a.id);
    if (!nodeId) continue;
    bySite.set(a.site, [...(bySite.get(a.site) ?? []), nodeId]);
  }
  for (const [site, nodes] of bySite)
    upsertBySource(page, 'zone', src('site', site), {
      id: elId('site', site),
      label: site,
      nodes,
    });

  // Tunnels: links on their plane; endpoints resolved via source refs so a
  // tunnel whose appliance is unknown is skipped (warned by validate later).
  const tunnels: [TunnelRecord[], 'underlay' | 'overlay'][] = [
    [records.underlay, 'underlay'],
    [records.overlay, 'overlay'],
  ];
  for (const [list, scope] of tunnels)
    for (const t of list) {
      const from = findNodeBySource(page, opts.system, 'appliance', t.from);
      const to = findNodeBySource(page, opts.system, 'appliance', t.to);
      if (!from || !to) continue;
      const down = t.status === 'down';
      const up = scope === 'underlay' ? COLORS.underlayUp : COLORS.overlayUp;
      upsertBySource(page, 'link', src('tunnel', t.id), {
        id: elId('lk', t.id),
        type: scope === 'underlay' ? 'line' : 'tunnel',
        from,
        to,
        layer: FABRIC_LAYERS[scope],
        color: down ? COLORS.down : up,
        label:
          scope === 'underlay'
            ? (t.fromInterface ?? t.alias ?? t.id)
            : (t.overlay ?? t.alias ?? t.id),
        ...(down ? { opacity: 0.6 } : {}),
        meta: {
          ...(t.status ? { status: t.status } : {}),
          ...(t.alias ? { alias: t.alias } : {}),
        },
      });
    }

  return doc;
}

/**
 * Collapse the per-appliance views of one conversation: the same 5-tuple seen
 * on ingress and egress appliances is one flow. The record that knows its
 * outbound tunnel (the ingress view) wins.
 */
export function dedupeFlows(flows: FlowRecord[]): FlowRecord[] {
  const byTuple = new Map<string, FlowRecord>();
  for (const f of flows) {
    const key = `${f.srcIp}:${f.srcPort}>${f.dstIp}:${f.dstPort}/${f.protocol}`;
    const prior = byTuple.get(key);
    if (!prior || (!prior.outboundTunnel && f.outboundTunnel))
      byTuple.set(key, f);
  }
  return [...byTuple.values()];
}

/**
 * Compile one flow onto a compiled-fabric page: endpoint host nodes, an
 * animated flow path threading src → ingress appliance → egress appliance →
 * dst with per-hop tunnel data, and a policy marker for the overlay (BIO)
 * that steered it. Returns false when the flow can't be placed (its
 * appliance isn't on the page).
 */
export function compileFlow(
  doc: TopologyDocument,
  flow: FlowRecord,
  records: FabricRecords,
  opts: CompileOptions,
): boolean {
  const page = doc.pages[0];
  if (!page) return false;
  const fetchedAt = opts.fetchedAt ?? new Date().toISOString();
  const src = (kind: string, id: string) => ({
    system: opts.system,
    kind,
    id,
    fetchedAt,
  });

  const ingress = findNodeBySource(
    page,
    opts.system,
    'appliance',
    flow.applianceId,
  );
  if (!ingress) return false;
  const ingressNode = page.nodes.find((n) => n.id === ingress)!;

  // The tunnel the flow rode tells us the far end.
  const tunnelId = flow.outboundTunnel ?? flow.inboundTunnel;
  const tunnel = [...records.overlay, ...records.underlay].find(
    (t) => t.id === tunnelId,
  );
  const egressApplianceId = tunnel
    ? tunnel.from === flow.applianceId
      ? tunnel.to
      : tunnel.from
    : undefined;
  const egress = egressApplianceId
    ? findNodeBySource(page, opts.system, 'appliance', egressApplianceId)
    : undefined;

  // Endpoint hosts (when the flow reports IPs), placed beside their edge.
  const host = (ip: string, near: { x: number; y: number }, dx: number) =>
    upsertBySource(page, 'node', src('endpoint', ip), {
      id: elId('host', ip),
      type: 'host',
      x: near.x + dx,
      y: near.y + 90,
      label: ip,
    }).element.id as string;
  const egressNode = egress
    ? page.nodes.find((n) => n.id === egress)!
    : undefined;
  const srcHost = flow.srcIp ? host(flow.srcIp, ingressNode, -140) : undefined;
  const dstHost = flow.dstIp
    ? host(flow.dstIp, egressNode ?? ingressNode, 140)
    : undefined;

  const waypoints = [srcHost, ingress, egress, dstHost].filter(
    (w): w is string => w !== undefined,
  );
  if (waypoints.length < 2) return false;

  // Per-hop data: which page link each segment rode (the tunnel link exists
  // when the fabric was compiled from the same records).
  const tunnelLink = tunnel
    ? page.links.find((l) => l.source?.id === tunnel.id)
    : undefined;
  const hops: FlowHop[] = waypoints.slice(1).map((ref) => {
    const viaTunnel = ref === egress && tunnel !== undefined;
    return {
      ref,
      ...(viaTunnel && tunnelLink ? { linkId: tunnelLink.id } : {}),
      ...(viaTunnel && tunnelLink?.layer ? { layer: tunnelLink.layer } : {}),
      meta: {
        ...(viaTunnel && tunnel ? { tunnel: tunnel.id } : {}),
        ...(viaTunnel && flow.overlay ? { overlay: flow.overlay } : {}),
        ...(flow.bytes !== undefined ? { bytes: flow.bytes } : {}),
      },
    };
  });

  const flowKey = `${flow.applianceId}:${flow.id}`;
  const label = [
    flow.application ?? flow.protocol ?? 'flow',
    flow.srcIp && flow.dstIp ? `${flow.srcIp} → ${flow.dstIp}` : '',
  ]
    .filter(Boolean)
    .join('  ');
  upsertBySource(page, 'flowPath', src('flow', flowKey), {
    id: elId('fp', flowKey),
    waypoints,
    label,
    color: flow.overlay ? COLORS.flowOverlay : COLORS.flow,
    // Live flows move; ended flows (still in the table) draw as a trace.
    animation: flow.active ? 'particles' : 'dashed',
    speed: 'medium',
    direction: 'forward',
    ...(flow.active ? {} : { opacity: 0.55 }),
    hops,
  });

  // The overlay (BIO) that steered the flow → a policy marker at ingress.
  const policy = flow.overlay
    ? records.policies.find(
        (p) => p.name === flow.overlay || p.id === flow.overlay,
      )
    : undefined;
  if (policy)
    upsertBySource(
      page,
      'policyMarker',
      src('policy', `${policy.id}@${flowKey}`),
      {
        id: elId('pm', flowKey),
        nodeId: ingress,
        type: 'redirect',
        label: policy.name,
        layer: FABRIC_LAYERS.policy,
        flowPathId: elId('fp', flowKey),
        align: 'NE',
      },
    );
  return true;
}

export interface FlowTopologyResult {
  document: TopologyDocument;
  /** Flows placed on the page (after dedupe; skipped ones excluded). */
  flowsCompiled: number;
}

/**
 * One-shot: fabric + flows → laid-out document. The orchestrating call the
 * `build_flow_topology` MCP tool wraps.
 */
export function compileFlowTopology(
  records: FabricRecords,
  flows: FlowRecord[],
  opts: CompileOptions,
): FlowTopologyResult {
  const document = compileFabric(records, opts);
  let flowsCompiled = 0;
  for (const flow of dedupeFlows(flows))
    if (compileFlow(document, flow, records, opts)) flowsCompiled++;
  layoutDocument(document, { algorithm: 'hierarchical', direction: 'LR' });
  tidyDocument(document);
  return { document, flowsCompiled };
}
