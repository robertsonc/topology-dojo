/**
 * The connector layer's contract — a vendor-neutral `TopologyProvider` that
 * yields normalized fabric data (appliances, tunnels, overlay policies, flows)
 * for the rest of the system to consume. DOM-free and runtime-free: the
 * EdgeConnect implementation does HTTP, the mock serves fixtures, and nothing
 * outside src/connect knows the difference.
 *
 * These records are the normalization boundary: vendor-API field names stop
 * here. Downstream (the flow-to-topology compiler, MCP tools) sees only these
 * shapes; `raw` carries the original payload where fidelity matters.
 */

export interface ProviderInfo {
  /** Source-system id used in element `SourceRef`s, e.g. "edgeconnect". */
  system: string;
  displayName: string;
  /** Capability hints for agents, e.g. ["appliances", "tunnels", "flows"]. */
  capabilities: string[];
}

/** An SD-WAN edge device / gateway known to the orchestrator. */
export interface ApplianceRecord {
  /** Stable orchestrator id (EdgeConnect: the nePk, e.g. "77.NE"). */
  id: string;
  hostname: string;
  serial?: string;
  model?: string;
  softwareVersion?: string;
  /** Site / location name as configured in the orchestrator. */
  site?: string;
  /** Fabric role, e.g. "hub" | "spoke" (vendor vocabulary, normalized lower-case). */
  role?: string;
  mgmtIp?: string;
  reachable?: boolean;
}

/** A tunnel between two appliances — underlay (per-WAN) or overlay (bonded). */
export interface TunnelRecord {
  id: string;
  alias?: string;
  scope: 'underlay' | 'overlay';
  /** Appliance ids (ApplianceRecord.id). */
  from: string;
  to: string;
  /** Operational status, normalized lower-case, e.g. "up" | "down". */
  status?: string;
  /** WAN interface labels, e.g. "INET1" / "MPLS". */
  fromInterface?: string;
  toInterface?: string;
  /** Owning overlay id/name (overlay-scope tunnels). */
  overlay?: string;
}

/** A Business Intent Overlay / traffic policy definition. */
export interface OverlayPolicyRecord {
  id: string;
  name: string;
  /** Topology shape if expressed, e.g. "hub-spoke" | "full-mesh". */
  topology?: string;
  /** The vendor's full policy document (match criteria, preferences, …). */
  raw?: unknown;
}

/** One entry from an appliance's flow table (active or recently ended). */
export interface FlowRecord {
  /** Flow id as reported by the owning appliance. */
  id: string;
  /** The appliance whose flow table this came from. */
  applianceId: string;
  /** Disambiguator some flow APIs pair with the id. */
  seqNum?: number;
  active: boolean;
  application?: string;
  protocol?: string;
  srcIp?: string;
  srcPort?: number;
  dstIp?: string;
  dstPort?: number;
  /** The overlay (BIO) the flow was steered into. */
  overlay?: string;
  /** Tunnel ids the flow rode, when reported. */
  inboundTunnel?: string;
  outboundTunnel?: string;
  bytes?: number;
  startTime?: string;
  endTime?: string;
}

/** Full per-flow detail: the normalized record plus the vendor payload. */
export interface FlowDetail {
  flow: FlowRecord;
  raw: unknown;
}

/** Addressing a single flow for detail lookup. */
export interface FlowRef {
  applianceId: string;
  flowId: string;
  seqNum?: number;
}

export interface FlowQuery {
  /** Restrict to one appliance's flow table; omit for fabric-wide. */
  applianceId?: string;
  /** Match either endpoint IP. */
  ip?: string;
  /** Match either endpoint port. */
  port?: number;
  /** Match the identified application name (substring, case-insensitive). */
  application?: string;
  /** Include flows that already ended but are still in the table. */
  includeEnded?: boolean;
  /** Cap the number of returned flows (applied after filtering). */
  limit?: number;
}

/**
 * The vendor-neutral data source. Implementations: `EdgeConnectProvider`
 * (Orchestrator REST) and `MockProvider` (fixtures, for tests/demos).
 */
export interface TopologyProvider {
  describe(): ProviderInfo;
  getAppliances(): Promise<ApplianceRecord[]>;
  getTunnels(scope: 'underlay' | 'overlay'): Promise<TunnelRecord[]>;
  getOverlayPolicies(): Promise<OverlayPolicyRecord[]>;
  getFlows(query?: FlowQuery): Promise<FlowRecord[]>;
  getFlowDetails(ref: FlowRef): Promise<FlowDetail>;
}

/** Shared client-side filtering for providers whose APIs return whole tables. */
export function filterFlows(
  flows: FlowRecord[],
  query: FlowQuery = {},
): FlowRecord[] {
  let out = flows;
  if (!query.includeEnded) out = out.filter((f) => f.active);
  if (query.applianceId)
    out = out.filter((f) => f.applianceId === query.applianceId);
  if (query.ip)
    out = out.filter((f) => f.srcIp === query.ip || f.dstIp === query.ip);
  if (query.port !== undefined)
    out = out.filter(
      (f) => f.srcPort === query.port || f.dstPort === query.port,
    );
  if (query.application) {
    const needle = query.application.toLowerCase();
    out = out.filter((f) =>
      (f.application ?? '').toLowerCase().includes(needle),
    );
  }
  if (query.limit !== undefined && query.limit >= 0)
    out = out.slice(0, query.limit);
  return out;
}
