/**
 * `TopologyProvider` over the HPE Aruba EdgeConnect SD-WAN **Orchestrator**
 * REST API. The Orchestrator is the single front door: appliance flow tables
 * are read through its appliance-API proxy, so gateways are never contacted
 * directly and one API key covers the whole fabric.
 *
 * Credentials come in via the constructor (the servers read them from env /
 * Worker secrets — never from MCP tool arguments). `fetchImpl` is injectable
 * so unit tests pin request/normalization behavior without a network.
 *
 * Endpoint paths and payload field names vary somewhat across Orchestrator
 * releases; they are collected in `PATHS` and the tolerant `normalize*`
 * helpers below, to be pinned against recorded fixtures from the target
 * deployment (see docs/proposals/0001, E3).
 */
import type {
  ApplianceRecord,
  FlowDetail,
  FlowQuery,
  FlowRecord,
  FlowRef,
  OverlayPolicyRecord,
  ProviderInfo,
  TopologyProvider,
  TunnelRecord,
} from './types.js';
import { filterFlows } from './types.js';

export interface EdgeConnectConfig {
  /** Orchestrator origin, e.g. https://orch.example.com */
  baseUrl: string;
  /** Orchestrator API key (sent as X-AUTH-TOKEN). */
  apiKey: string;
  /** Injectable fetch for tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

/** Orchestrator REST paths in one place (release-dependent; fixture-pinned). */
const PATHS = {
  appliances: '/gms/rest/appliance',
  physicalTunnels: '/gms/rest/tunnels2/physical',
  overlayTunnels: '/gms/rest/tunnels2/bonded',
  overlays: '/gms/rest/gms/overlays/config',
  /** Appliance-API proxy: query a device through the Orchestrator. */
  applianceProxy: (nePk: string, api: string): string =>
    `/gms/rest/appliance/rest/${encodeURIComponent(nePk)}/${api}`,
};

/* ── tolerant field pickers (vendor payloads differ across releases) ── */

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

function normalizeAppliance(raw: unknown): ApplianceRecord | null {
  const a = rec(raw);
  const id = str(a.nePk) ?? str(a.id);
  if (!id) return null;
  return {
    id,
    hostname: str(a.hostName) ?? str(a.hostname) ?? id,
    ...((str(a.serial) ?? str(a.serialNum))
      ? { serial: str(a.serial) ?? str(a.serialNum) }
      : {}),
    ...(str(a.model) ? { model: str(a.model) } : {}),
    ...((str(a.softwareVersion) ?? str(a.swVersion))
      ? { softwareVersion: str(a.softwareVersion) ?? str(a.swVersion) }
      : {}),
    ...((str(a.site) ?? str(a.siteName))
      ? { site: str(a.site) ?? str(a.siteName) }
      : {}),
    ...((str(a.networkRole) ?? str(a.role))
      ? { role: (str(a.networkRole) ?? str(a.role))!.toLowerCase() }
      : {}),
    ...((str(a.ip) ?? str(a.mgmtIp))
      ? { mgmtIp: str(a.ip) ?? str(a.mgmtIp) }
      : {}),
    ...(typeof a.reachable === 'boolean' ? { reachable: a.reachable } : {}),
  };
}

function normalizeTunnel(
  raw: unknown,
  scope: 'underlay' | 'overlay',
): TunnelRecord | null {
  const t = rec(raw);
  const id = str(t.id) ?? str(t.tunnelId) ?? str(t.alias);
  const from = str(t.srcNePk) ?? str(t.fromNePk);
  const to = str(t.destNePk) ?? str(t.toNePk);
  if (!id || !from || !to) return null;
  const overlay = str(t.overlayName) ?? str(t.overlayId);
  return {
    id,
    scope,
    from,
    to,
    ...(str(t.alias) ? { alias: str(t.alias) } : {}),
    ...((str(t.status) ?? str(t.state))
      ? { status: (str(t.status) ?? str(t.state))!.toLowerCase() }
      : {}),
    ...(str(t.srcInterface) ? { fromInterface: str(t.srcInterface) } : {}),
    ...(str(t.destInterface) ? { toInterface: str(t.destInterface) } : {}),
    ...(scope === 'overlay' && overlay ? { overlay } : {}),
  };
}

function normalizeOverlay(raw: unknown): OverlayPolicyRecord | null {
  const o = rec(raw);
  const id = str(o.id) ?? str(o.overlayId) ?? str(o.name);
  if (!id) return null;
  return {
    id,
    name: str(o.name) ?? id,
    ...(str(o.topology) ? { topology: str(o.topology) } : {}),
    raw,
  };
}

function normalizeFlow(raw: unknown, applianceId: string): FlowRecord | null {
  const f = rec(raw);
  const id = str(f.id) ?? str(f.flowId) ?? num(f.id)?.toString();
  if (!id) return null;
  const ended = f.ended === true || str(f.endTime) !== undefined;
  const dstPort = num(f.destPort) ?? num(f.dstPort);
  return {
    id,
    applianceId,
    ...(num(f.seqNum) !== undefined ? { seqNum: num(f.seqNum) } : {}),
    active: typeof f.active === 'boolean' ? f.active : !ended,
    ...((str(f.application) ?? str(f.app))
      ? { application: str(f.application) ?? str(f.app) }
      : {}),
    ...(str(f.protocol) ? { protocol: str(f.protocol)!.toLowerCase() } : {}),
    ...(str(f.srcIp) ? { srcIp: str(f.srcIp) } : {}),
    ...(num(f.srcPort) !== undefined ? { srcPort: num(f.srcPort) } : {}),
    ...((str(f.destIp) ?? str(f.dstIp))
      ? { dstIp: str(f.destIp) ?? str(f.dstIp) }
      : {}),
    ...(dstPort !== undefined ? { dstPort } : {}),
    ...((str(f.overlay) ?? str(f.overlayName))
      ? { overlay: str(f.overlay) ?? str(f.overlayName) }
      : {}),
    ...(str(f.inboundTunnel) ? { inboundTunnel: str(f.inboundTunnel) } : {}),
    ...(str(f.outboundTunnel) ? { outboundTunnel: str(f.outboundTunnel) } : {}),
    ...(num(f.bytes) !== undefined ? { bytes: num(f.bytes) } : {}),
    ...(str(f.startTime) ? { startTime: str(f.startTime) } : {}),
    ...(str(f.endTime) ? { endTime: str(f.endTime) } : {}),
  };
}

/** Accept the array-or-wrapped shapes the flow API returns across releases. */
function flowEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const p = rec(payload);
  if (Array.isArray(p.flows)) return p.flows;
  const active = Array.isArray(p.active) ? p.active : [];
  const ended = Array.isArray(p.ended) ? p.ended : [];
  return [...active, ...ended];
}

export class EdgeConnectProvider implements TopologyProvider {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: EdgeConnectConfig) {
    if (!cfg.baseUrl || !cfg.apiKey)
      throw new Error('EdgeConnectProvider requires baseUrl and apiKey');
    this.base = cfg.baseUrl.replace(/\/$/, '');
    this.apiKey = cfg.apiKey;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  describe(): ProviderInfo {
    return {
      system: 'edgeconnect',
      displayName: 'HPE Aruba EdgeConnect SD-WAN Orchestrator',
      capabilities: ['appliances', 'tunnels', 'overlays', 'flows'],
    };
  }

  /** Authenticated GET returning parsed JSON; throws on non-2xx. */
  private async get(path: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      headers: { 'X-AUTH-TOKEN': this.apiKey, accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`EdgeConnect ${path} → HTTP ${res.status}`);
    return res.json();
  }

  async getAppliances(): Promise<ApplianceRecord[]> {
    const payload = await this.get(PATHS.appliances);
    const list = Array.isArray(payload) ? payload : [];
    return list
      .map(normalizeAppliance)
      .filter((a): a is ApplianceRecord => a !== null);
  }

  async getTunnels(scope: 'underlay' | 'overlay'): Promise<TunnelRecord[]> {
    const payload = await this.get(
      scope === 'underlay' ? PATHS.physicalTunnels : PATHS.overlayTunnels,
    );
    const list = Array.isArray(payload) ? payload : [];
    return list
      .map((t) => normalizeTunnel(t, scope))
      .filter((t): t is TunnelRecord => t !== null);
  }

  async getOverlayPolicies(): Promise<OverlayPolicyRecord[]> {
    const payload = await this.get(PATHS.overlays);
    const list = Array.isArray(payload) ? payload : [];
    return list
      .map(normalizeOverlay)
      .filter((o): o is OverlayPolicyRecord => o !== null);
  }

  /**
   * Flow tables, fabric-wide by default: every appliance's table is read
   * through the Orchestrator proxy; unreachable appliances are skipped (their
   * tables are unavailable by definition). Filtering is applied client-side.
   */
  async getFlows(query: FlowQuery = {}): Promise<FlowRecord[]> {
    const targets = query.applianceId
      ? [query.applianceId]
      : (await this.getAppliances()).map((a) => a.id);

    const perAppliance = await Promise.allSettled(
      targets.map(async (nePk) => {
        const payload = await this.get(PATHS.applianceProxy(nePk, 'flow'));
        return flowEntries(payload)
          .map((f) => normalizeFlow(f, nePk))
          .filter((f): f is FlowRecord => f !== null);
      }),
    );
    // A single explicitly-requested appliance failing is an error the caller
    // should see; one silent table among many is expected fabric reality.
    if (query.applianceId && perAppliance[0]?.status === 'rejected')
      throw perAppliance[0].reason as Error;

    const flows = perAppliance.flatMap((r) =>
      r.status === 'fulfilled' ? r.value : [],
    );
    return filterFlows(flows, query);
  }

  async getFlowDetails(ref: FlowRef): Promise<FlowDetail> {
    const qs = `?id=${encodeURIComponent(ref.flowId)}${
      ref.seqNum !== undefined ? `&seqNum=${ref.seqNum}` : ''
    }`;
    const payload = await this.get(
      PATHS.applianceProxy(ref.applianceId, `flow/flowDetails2${qs}`),
    );
    const entries = flowEntries(payload);
    const flow = normalizeFlow(entries[0] ?? payload, ref.applianceId);
    if (!flow)
      throw new Error(
        `unknown flow "${ref.flowId}" on appliance "${ref.applianceId}"`,
      );
    return { flow, raw: payload };
  }
}
