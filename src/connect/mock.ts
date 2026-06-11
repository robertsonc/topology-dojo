/**
 * A fixture-backed `TopologyProvider` — a small but representative SD-WAN
 * fabric (hub + two branches, dual underlay transports, one bonded overlay,
 * a BIO, live + ended flows). Used by unit tests and as a demo data source
 * (`TOPOLOGY_PROVIDER=mock` on the stdio server) so the whole agent loop runs
 * with zero fabric access.
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

const APPLIANCES: ApplianceRecord[] = [
  {
    id: '1.NE',
    hostname: 'ec-hub-dc1',
    serial: 'SN-HUB-001',
    model: 'EC-XL',
    softwareVersion: '9.5.2',
    site: 'DC-1',
    role: 'hub',
    mgmtIp: '10.0.0.1',
    reachable: true,
  },
  {
    id: '77.NE',
    hostname: 'ec-branch-77',
    serial: 'SN-BR-077',
    model: 'EC-S',
    softwareVersion: '9.5.2',
    site: 'Branch-77',
    role: 'spoke',
    mgmtIp: '10.0.77.1',
    reachable: true,
  },
  {
    id: '78.NE',
    hostname: 'ec-branch-78',
    serial: 'SN-BR-078',
    model: 'EC-S',
    softwareVersion: '9.5.1',
    site: 'Branch-78',
    role: 'spoke',
    mgmtIp: '10.0.78.1',
    reachable: true,
  },
];

const UNDERLAY: TunnelRecord[] = [
  {
    id: 'ut_77_inet',
    alias: 'br77-hub_INET1',
    scope: 'underlay',
    from: '77.NE',
    to: '1.NE',
    status: 'up',
    fromInterface: 'INET1',
    toInterface: 'INET1',
  },
  {
    id: 'ut_77_mpls',
    alias: 'br77-hub_MPLS',
    scope: 'underlay',
    from: '77.NE',
    to: '1.NE',
    status: 'up',
    fromInterface: 'MPLS',
    toInterface: 'MPLS',
  },
  {
    id: 'ut_78_inet',
    alias: 'br78-hub_INET1',
    scope: 'underlay',
    from: '78.NE',
    to: '1.NE',
    status: 'down',
    fromInterface: 'INET1',
    toInterface: 'INET1',
  },
];

const OVERLAY: TunnelRecord[] = [
  {
    id: 'bt_77_rt',
    alias: 'br77-hub_RealTime',
    scope: 'overlay',
    from: '77.NE',
    to: '1.NE',
    status: 'up',
    overlay: 'RealTime',
  },
  {
    id: 'bt_78_rt',
    alias: 'br78-hub_RealTime',
    scope: 'overlay',
    from: '78.NE',
    to: '1.NE',
    status: 'down',
    overlay: 'RealTime',
  },
];

const POLICIES: OverlayPolicyRecord[] = [
  {
    id: 'bio_rt',
    name: 'RealTime',
    topology: 'hub-spoke',
    raw: {
      match: { dscp: 'ef', application: ['voip', 'webex'] },
      preferred: ['MPLS', 'INET1'],
      brownout: { loss: 1, latency: 120 },
    },
  },
  {
    id: 'bio_default',
    name: 'DefaultOverlay',
    topology: 'full-mesh',
    raw: { match: 'any', preferred: ['INET1', 'MPLS'] },
  },
];

const FLOWS: FlowRecord[] = [
  {
    id: 'f1001',
    applianceId: '77.NE',
    seqNum: 0,
    active: true,
    application: 'voip',
    protocol: 'udp',
    srcIp: '10.0.77.50',
    srcPort: 16384,
    dstIp: '10.0.0.80',
    dstPort: 16384,
    overlay: 'RealTime',
    outboundTunnel: 'bt_77_rt',
    bytes: 1_204_352,
    startTime: '2026-06-11T06:55:00Z',
  },
  {
    id: 'f1002',
    applianceId: '77.NE',
    seqNum: 0,
    active: false,
    application: 'https',
    protocol: 'tcp',
    srcIp: '10.0.77.51',
    srcPort: 51544,
    dstIp: '142.250.72.4',
    dstPort: 443,
    overlay: 'DefaultOverlay',
    outboundTunnel: 'ut_77_inet',
    bytes: 88_201,
    startTime: '2026-06-11T06:40:00Z',
    endTime: '2026-06-11T06:41:30Z',
  },
  {
    id: 'f2001',
    applianceId: '1.NE',
    seqNum: 0,
    active: true,
    application: 'voip',
    protocol: 'udp',
    srcIp: '10.0.77.50',
    srcPort: 16384,
    dstIp: '10.0.0.80',
    dstPort: 16384,
    overlay: 'RealTime',
    inboundTunnel: 'bt_77_rt',
    bytes: 1_198_004,
    startTime: '2026-06-11T06:55:00Z',
  },
];

export class MockProvider implements TopologyProvider {
  describe(): ProviderInfo {
    return {
      system: 'mock',
      displayName: 'Mock SD-WAN fabric (fixtures)',
      capabilities: ['appliances', 'tunnels', 'overlays', 'flows'],
    };
  }

  getAppliances(): Promise<ApplianceRecord[]> {
    return Promise.resolve(structuredClone(APPLIANCES));
  }

  getTunnels(scope: 'underlay' | 'overlay'): Promise<TunnelRecord[]> {
    return Promise.resolve(
      structuredClone(scope === 'underlay' ? UNDERLAY : OVERLAY),
    );
  }

  getOverlayPolicies(): Promise<OverlayPolicyRecord[]> {
    return Promise.resolve(structuredClone(POLICIES));
  }

  getFlows(query: FlowQuery = {}): Promise<FlowRecord[]> {
    return Promise.resolve(filterFlows(structuredClone(FLOWS), query));
  }

  getFlowDetails(ref: FlowRef): Promise<FlowDetail> {
    const flow = FLOWS.find(
      (f) =>
        f.applianceId === ref.applianceId &&
        f.id === ref.flowId &&
        (ref.seqNum === undefined || f.seqNum === ref.seqNum),
    );
    if (!flow)
      return Promise.reject(
        new Error(
          `unknown flow "${ref.flowId}" on appliance "${ref.applianceId}"`,
        ),
      );
    return Promise.resolve({
      flow: structuredClone(flow),
      raw: { fixture: true, ...flow },
    });
  }
}
