import { describe, it, expect } from 'vitest';
import { MockProvider } from './mock.js';
import { EdgeConnectProvider } from './edgeconnect.js';
import { filterFlows, type FlowRecord } from './types.js';

describe('MockProvider (fixture fabric)', () => {
  const p = new MockProvider();

  it('describes itself and serves the fixture fabric', async () => {
    expect(p.describe().system).toBe('mock');
    const appliances = await p.getAppliances();
    expect(appliances.map((a) => a.role)).toContain('hub');
    expect(await p.getTunnels('underlay')).not.toHaveLength(0);
    expect(
      (await p.getTunnels('overlay')).every((t) => t.scope === 'overlay'),
    ).toBe(true);
    expect((await p.getOverlayPolicies()).map((o) => o.name)).toContain(
      'RealTime',
    );
  });

  it('filters flows: active by default, ended on request, by ip/app/appliance', async () => {
    const active = await p.getFlows();
    expect(active.every((f) => f.active)).toBe(true);
    const all = await p.getFlows({ includeEnded: true });
    expect(all.length).toBeGreaterThan(active.length);
    const ended = all.find((f) => !f.active)!;
    expect(ended.endTime).toBeTruthy(); // ended flows still in the table

    const voip = await p.getFlows({ application: 'VOIP' });
    expect(voip.length).toBeGreaterThan(0); // case-insensitive
    const branchOnly = await p.getFlows({ applianceId: '77.NE' });
    expect(branchOnly.every((f) => f.applianceId === '77.NE')).toBe(true);
    const byIp = await p.getFlows({ ip: '10.0.77.50' });
    expect(byIp.length).toBeGreaterThan(0);
  });

  it('returns flow details with the raw payload, errors on unknown flows', async () => {
    const detail = await p.getFlowDetails({
      applianceId: '77.NE',
      flowId: 'f1001',
    });
    expect(detail.flow.overlay).toBe('RealTime');
    expect(detail.raw).toBeTruthy();
    await expect(
      p.getFlowDetails({ applianceId: '77.NE', flowId: 'nope' }),
    ).rejects.toThrow(/unknown flow/);
  });
});

/** A fetch stub that records requests and serves canned Orchestrator JSON. */
function orchestratorStub(): {
  fetchImpl: typeof fetch;
  requests: { url: string; auth?: string }[];
} {
  const requests: { url: string; auth?: string }[] = [];
  const routes: [RegExp, unknown][] = [
    [
      /\/gms\/rest\/appliance$/,
      [
        {
          nePk: '7.NE',
          hostName: 'ec-hub',
          serial: 'SN1',
          softwareVersion: '9.5.2',
          networkRole: 'HUB',
          reachable: true,
        },
        { id: '8.NE', hostname: 'ec-br8', role: 'spoke' }, // alt field names
        { hostName: 'no-id-so-dropped' },
      ],
    ],
    [
      /\/gms\/rest\/tunnels2\/physical$/,
      [
        {
          id: 'ut1',
          alias: 'br8-hub_INET1',
          srcNePk: '8.NE',
          destNePk: '7.NE',
          status: 'Up',
          srcInterface: 'INET1',
          destInterface: 'INET1',
        },
      ],
    ],
    [
      /\/gms\/rest\/tunnels2\/bonded$/,
      [
        {
          id: 'bt1',
          srcNePk: '8.NE',
          destNePk: '7.NE',
          state: 'Up',
          overlayName: 'RealTime',
        },
      ],
    ],
    [
      /\/gms\/rest\/gms\/overlays\/config$/,
      [{ id: 'o1', name: 'RealTime', topology: 'hub-spoke', match: {} }],
    ],
    [
      /\/appliance\/rest\/7\.NE\/flow$/,
      { active: [{ flowId: 'h1', application: 'voip', active: true }] },
    ],
    [
      /\/appliance\/rest\/8\.NE\/flow$/,
      [
        {
          id: 'b1',
          app: 'https',
          srcIp: '10.8.0.5',
          destIp: '1.2.3.4',
          destPort: 443,
          endTime: '2026-06-11T06:41:00Z',
        },
      ],
    ],
    [
      /\/appliance\/rest\/8\.NE\/flow\/flowDetails2\?id=b1$/,
      { flows: [{ id: 'b1', app: 'https', overlay: 'DefaultOverlay' }] },
    ],
  ];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requests.push({ url, auth: headers['X-AUTH-TOKEN'] });
    const hit = routes.find(([re]) => re.test(url));
    if (!hit)
      return Promise.resolve(new Response('not found', { status: 404 }));
    return Promise.resolve(
      new Response(JSON.stringify(hit[1]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

describe('EdgeConnectProvider (stubbed Orchestrator)', () => {
  const make = (): {
    p: EdgeConnectProvider;
    requests: { url: string; auth?: string }[];
  } => {
    const { fetchImpl, requests } = orchestratorStub();
    const p = new EdgeConnectProvider({
      baseUrl: 'https://orch.example.com/', // trailing slash normalized
      apiKey: 'k-123',
      fetchImpl,
    });
    return { p, requests };
  };

  it('requires credentials and sends the API key on every request', async () => {
    expect(() => new EdgeConnectProvider({ baseUrl: '', apiKey: 'x' })).toThrow(
      /requires baseUrl and apiKey/,
    );
    const { p, requests } = make();
    await p.getAppliances();
    expect(requests[0]!.url).toBe(
      'https://orch.example.com/gms/rest/appliance',
    );
    expect(requests.every((r) => r.auth === 'k-123')).toBe(true);
  });

  it('normalizes appliances across field-name variants, drops id-less rows', async () => {
    const { p } = make();
    const appliances = await p.getAppliances();
    expect(appliances).toHaveLength(2);
    expect(appliances[0]).toMatchObject({
      id: '7.NE',
      hostname: 'ec-hub',
      role: 'hub', // lower-cased
    });
    expect(appliances[1]).toMatchObject({ id: '8.NE', hostname: 'ec-br8' });
  });

  it('normalizes underlay + overlay tunnels (status lower-cased, overlay kept)', async () => {
    const { p } = make();
    const under = await p.getTunnels('underlay');
    expect(under[0]).toMatchObject({
      id: 'ut1',
      scope: 'underlay',
      from: '8.NE',
      to: '7.NE',
      status: 'up',
      fromInterface: 'INET1',
    });
    const over = await p.getTunnels('overlay');
    expect(over[0]).toMatchObject({
      scope: 'overlay',
      status: 'up',
      overlay: 'RealTime',
    });
  });

  it('reads flow tables fabric-wide through the appliance proxy', async () => {
    const { p, requests } = make();
    const flows = await p.getFlows({ includeEnded: true });
    // Both appliances' tables were queried via the proxy.
    expect(
      requests.filter((r) => /\/appliance\/rest\/.+\/flow$/.test(r.url)),
    ).toHaveLength(2);
    expect(flows.map((f) => f.id).sort()).toEqual(['b1', 'h1']);
    const ended = flows.find((f) => f.id === 'b1')!;
    expect(ended.active).toBe(false); // endTime implies ended
    expect(ended.dstPort).toBe(443); // destPort variant normalized
    // Default query hides ended flows.
    expect((await p.getFlows()).map((f) => f.id)).toEqual(['h1']);
  });

  it('scopes to one appliance, surfacing its errors instead of skipping', async () => {
    const { p } = make();
    const one = await p.getFlows({ applianceId: '8.NE', includeEnded: true });
    expect(one).toHaveLength(1);
    await expect(
      p.getFlows({ applianceId: '99.NE' }), // stub 404s unknown paths
    ).rejects.toThrow(/HTTP 404/);
  });

  it('fetches flow details with the raw payload attached', async () => {
    const { p } = make();
    const detail = await p.getFlowDetails({
      applianceId: '8.NE',
      flowId: 'b1',
    });
    expect(detail.flow).toMatchObject({ id: 'b1', application: 'https' });
    expect(detail.raw).toBeTruthy();
  });
});

describe('filterFlows', () => {
  const flows: FlowRecord[] = [
    { id: '1', applianceId: 'a', active: true, srcPort: 443 },
    { id: '2', applianceId: 'a', active: false, dstPort: 443 },
    { id: '3', applianceId: 'b', active: true },
  ];
  it('applies port matching to either endpoint and respects limit', () => {
    expect(
      filterFlows(flows, { includeEnded: true, port: 443 }).map((f) => f.id),
    ).toEqual(['1', '2']);
    expect(filterFlows(flows, { limit: 1 })).toHaveLength(1);
  });
});
