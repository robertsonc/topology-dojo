import { describe, it, expect } from 'vitest';
import {
  generateSdwan,
  resolveSdwanIntent,
  SYNTHETIC_SYSTEM,
  type SdwanIntent,
} from './generate.js';
import { FABRIC_LAYERS } from './compile.js';
import { validateDocument } from '../api/validate.js';
import { analyzeLayout } from '../api/layout.js';
import type { Page, TopologyDocument } from '../pages/model.js';
import { pageLinkTarget } from '../api/page-link.js';

const page = (doc: TopologyDocument) => doc.pages[0]!;
const tunnels = (doc: TopologyDocument, layer: string) =>
  page(doc).links.filter((l) => l.layer === layer);
const byKind = (doc: TopologyDocument, kind: string) =>
  page(doc).links.filter(
    (l) => (l.meta as Record<string, unknown> | undefined)?.kind === kind,
  );
const nodeId = (applianceId: string) => `ne_${applianceId}`;

describe('generateSdwan — EdgeConnect', () => {
  it('counts label-matched underlay + one bonded overlay per appliance pair', () => {
    // Baseline case: 1 region, 2 hubs, 4 branches, 1 INET.
    const { stats, doc } = generateSdwan({
      vendor: 'edgeconnect',
      regions: 1,
      hubsPerRegion: 2,
      branchesPerRegion: 4,
      transports: ['inet'],
    });
    // 4 branches × 2 hubs + the intra-region hub pair.
    expect(stats.underlayTunnels).toBe(9);
    expect(stats.overlayTunnels).toBe(9);
    expect(stats.devices).toBe(6);
    // Two hubs are independent — no HA cable between them.
    expect(byKind(doc, 'ha')).toEqual([]);
    // WAN circuits: 2 hubs + 4 branches, each to the Internet cloud.
    expect(byKind(doc, 'wan-circuit')).toHaveLength(6);
    expect(stats.links).toBe(6);
  });

  it('builds one underlay per matching label; LTE cross-connects to INET', () => {
    const { doc } = generateSdwan({
      vendor: 'edgeconnect',
      hubsPerRegion: 1,
      branchesPerRegion: 1,
      transports: ['mpls', 'lte'],
    });
    const labels = tunnels(doc, FABRIC_LAYERS.underlay)
      .map((l) => l.label)
      .sort();
    expect(labels).toEqual(['LTE1→INET1', 'MPLS1']);
    // Hubs terminate INET (for LTE) and MPLS; no LTE cloud is drawn.
    const clouds = page(doc)
      .nodes.filter((n) => n.type === 'cloud')
      .map((n) => n.label)
      .sort();
    expect(clouds).toEqual(['Internet', 'MPLS']);
  });

  it('HA: both members tunnel to every hub; circuits alternate across members', () => {
    const { doc, stats } = generateSdwan({
      vendor: 'edgeconnect',
      hubsPerRegion: 2,
      branchesPerRegion: 1,
      transports: ['inet', 'mpls'],
      branchHa: true,
    });
    // 2 members × 2 hubs × 2 labels + hub pair × 2 labels.
    expect(stats.underlayTunnels).toBe(10);
    expect(stats.overlayTunnels).toBe(5);
    for (const m of ['amer-br01-1', 'amer-br01-2'])
      expect(
        tunnels(doc, FABRIC_LAYERS.overlay).filter((l) => l.from === nodeId(m)),
      ).toHaveLength(2);
    expect(byKind(doc, 'ha')).toHaveLength(1);
    const circuits = byKind(doc, 'wan-circuit').filter((l) =>
      l.from.startsWith(nodeId('amer-br01')),
    );
    expect(circuits.map((l) => [l.from, l.label])).toEqual([
      [nodeId('amer-br01-1'), 'INET1'],
      [nodeId('amer-br01-2'), 'MPLS1'],
    ]);
  });

  it('hides the dense underlay layer by default and drops the empty policy layer', () => {
    const { doc } = generateSdwan({ vendor: 'edgeconnect' });
    const ids = (doc.layers ?? []).map((l) => [l.id, l.defaultVisible]);
    expect(ids).toEqual([
      ['underlay', false],
      ['overlay', undefined],
    ]);
  });
});

describe('generateSdwan — Juniper SRX', () => {
  it('chassis cluster: tunnels from node0 only, circuits on both nodes, control + fabric', () => {
    const { doc, stats } = generateSdwan({
      vendor: 'juniper',
      hubsPerRegion: 2,
      branchesPerRegion: 1,
      transports: ['inet', 'mpls'],
      branchHa: true,
    });
    expect(stats.underlayTunnels).toBe(0);
    // node0 × 2 hubs × 2 paths + hub pair × 2 paths.
    expect(stats.overlayTunnels).toBe(6);
    const fromNode1 = tunnels(doc, FABRIC_LAYERS.overlay).filter(
      (l) => l.from === nodeId('amer-br01-2') || l.to === nodeId('amer-br01-2'),
    );
    expect(fromNode1).toEqual([]);
    expect(
      byKind(doc, 'cluster-ctl').length + byKind(doc, 'cluster-fab').length,
    ).toBe(2);
    // reth: both transports land on both nodes.
    const branchCircuits = byKind(doc, 'wan-circuit').filter((l) =>
      l.from.startsWith(nodeId('amer-br01')),
    );
    expect(branchCircuits).toHaveLength(4);
    expect(
      page(doc).nodes.find((n) => n.id === nodeId('amer-br01-1'))?.label,
    ).toBe('amer-br01-srx-node0');
    expect((doc.layers ?? []).map((l) => l.id)).toEqual(['overlay']);
  });

  it('uses the firewall glyph for SRX and the EC glyph for EdgeConnect', () => {
    const types = (v: SdwanIntent['vendor']) =>
      new Set(
        page(generateSdwan({ vendor: v }).doc)
          .nodes.filter((n) => n.source)
          .map((n) => n.type),
      );
    expect(types('juniper')).toEqual(new Set(['firewall']));
    expect(types('edgeconnect')).toEqual(new Set(['ec']));
  });
});

describe('generateSdwan — regions and detail', () => {
  it('meshes hubs across regions only when asked', () => {
    const base = {
      vendor: 'edgeconnect',
      regions: 3,
      hubsPerRegion: 2,
      branchesPerRegion: 1,
      transports: ['inet'],
    } as const;
    const meshed = generateSdwan({ ...base, interRegionHubMesh: true });
    const local = generateSdwan({ ...base, interRegionHubMesh: false });
    // 6 hubs: C(6,2)=15 pairs meshed vs 3 intra-region pairs.
    expect(meshed.stats.overlayTunnels - local.stats.overlayTunnels).toBe(12);
    expect(
      page(meshed.doc).zones.filter((z) => z.id.startsWith('region_')),
    ).toHaveLength(3);
  });

  it("mirrors the top grid row so every region's hubs face the hub band", () => {
    const { doc } = generateSdwan({
      vendor: 'edgeconnect',
      regions: 3,
      hubsPerRegion: 2,
      branchesPerRegion: 2,
      transports: ['inet'],
      branchLan: 'switch',
    });
    const y = (id: string) => page(doc).nodes.find((n) => n.id === id)!.y;
    // Top row (AMER, EMEA): hubs below their branches, aligned with each other.
    expect(y(nodeId('amer-hub01'))).toBeGreaterThan(y(nodeId('amer-br01')));
    expect(y(nodeId('amer-br01'))).toBeGreaterThan(y('lan_amer-br01_sw'));
    expect(y(nodeId('emea-hub01'))).toBe(y(nodeId('amer-hub01')));
    // Bottom row (APAC): normal orientation, hubs directly below the band.
    expect(y(nodeId('apac-hub01'))).toBeGreaterThan(y(nodeId('amer-hub01')));
    expect(y(nodeId('apac-hub01'))).toBeLessThan(y(nodeId('apac-br01')));
    // Every top-row node sits above every bottom-row node.
    const top = page(doc).nodes.filter((n) => /amer|emea/.test(n.id));
    const bottom = page(doc).nodes.filter((n) => /apac/.test(n.id));
    expect(Math.max(...top.map((n) => n.y))).toBeLessThan(
      Math.min(...bottom.map((n) => n.y)),
    );
  });

  it('accepts per-region branch counts and region names', () => {
    const { doc } = generateSdwan({
      vendor: 'juniper',
      regions: 2,
      regionNames: ['West', 'East'],
      branchesPerRegion: [2, 5],
      hubsPerRegion: 1,
    });
    const branches = (prefix: string) =>
      page(doc).nodes.filter((n) => n.id.startsWith(`ne_${prefix}-br`));
    expect(branches('west')).toHaveLength(2);
    expect(branches('east')).toHaveLength(5);
  });

  it('site detail: one tile per site, one tunnel per branch per hub, no cabling', () => {
    const { doc, stats } = generateSdwan({
      vendor: 'edgeconnect',
      detail: 'site',
      hubsPerRegion: 2,
      branchesPerRegion: 4,
      transports: ['inet', 'mpls'],
      branchHa: true,
      branchLan: 'switch-ap',
    });
    expect(stats.devices).toBe(6);
    expect(stats.overlayTunnels).toBe(9);
    expect(stats.underlayTunnels).toBe(0);
    expect(stats.links).toBe(0);
    expect(
      page(doc).nodes.find((n) => n.id === nodeId('amer-br01'))?.sublabel,
    ).toBe('HA pair · INET1+MPLS1');
  });

  it('site detail draws places: hubs are data centers, branches offices', () => {
    const { doc } = generateSdwan({ vendor: 'juniper', detail: 'site' });
    const types = (role: string) =>
      new Set(
        page(doc)
          .nodes.filter((n) => n.meta?.role === role)
          .map((n) => n.type),
      );
    expect(types('hub')).toEqual(new Set(['datacenter']));
    expect(types('spoke')).toEqual(new Set(['branchoffice']));
    // Tiles are named for the site, not an appliance hostname.
    expect(
      page(doc).nodes.find((n) => n.id === nodeId('amer-br01'))?.label,
    ).toBe('amer-br01');
  });

  it('overview: a site page that drills into one device page per region', () => {
    const { doc, stats } = generateSdwan({
      vendor: 'edgeconnect',
      detail: 'overview',
      regions: 3,
      regionNames: ['West', 'East', 'Asia'],
      branchesPerRegion: [2, 3, 1],
      branchHa: true,
      transports: ['inet', 'mpls'],
    });
    expect(stats.pages).toBe(4);
    expect(doc.pages.map((p) => p.id)).toEqual([
      'sdwan',
      'sdwan-west',
      'sdwan-east',
      'sdwan-asia',
    ]);
    const [overview, west] = doc.pages as [Page, Page];
    // Every overview tile links to its own region's page.
    for (const n of overview.nodes.filter((x) => x.source)) {
      const region = n.id.split('_')[1]!.split('-')[0];
      expect(pageLinkTarget(n.href), n.id).toBe(`sdwan-${region}`);
    }
    // Region pages: device detail for that region only, plus a back link.
    expect(west.nodes.some((n) => n.id === nodeId('west-br01-2'))).toBe(true);
    expect(west.nodes.some((n) => n.id.includes('east'))).toBe(false);
    const back = west.nodes.find((n) => n.type === 'text')!;
    expect(pageLinkTarget(back.href)).toBe('sdwan');
    // The EC underlay plane exists (hidden) because region pages use it.
    expect(doc.layers?.map((l) => [l.id, l.defaultVisible])).toEqual([
      ['underlay', false],
      ['overlay', undefined],
    ]);
    // No dangling page links.
    expect(
      validateDocument(doc).filter((p) => /page link/.test(p.message)),
    ).toEqual([]);
  });

  it('marks every fabric element synthetic, never a live provider', () => {
    const { doc } = generateSdwan({ vendor: 'edgeconnect', branchHa: true });
    const sourced = [...page(doc).nodes, ...page(doc).links].filter(
      (e) => e.source,
    );
    expect(sourced.length).toBeGreaterThan(0);
    for (const e of sourced) expect(e.source!.system).toBe(SYNTHETIC_SYSTEM);
  });

  it('is deterministic', () => {
    const intent: SdwanIntent = {
      vendor: 'juniper',
      regions: 2,
      branchHa: true,
      transports: ['inet', 'lte'],
    };
    expect(JSON.stringify(generateSdwan(intent).doc)).toBe(
      JSON.stringify(generateSdwan(intent).doc),
    );
  });
});

describe('generateSdwan — every shape is valid and overlap-free', () => {
  const matrix: SdwanIntent[] = [];
  for (const vendor of ['edgeconnect', 'juniper'] as const)
    for (const detail of ['device', 'site', 'overview'] as const)
      for (const regions of [1, 4])
        for (const branchHa of [false, true])
          for (const branchLan of ['none', 'switch-ap'] as const)
            matrix.push({
              vendor,
              detail,
              regions,
              branchHa,
              branchLan,
              hubsPerRegion: regions === 1 ? 1 : 2,
              branchesPerRegion: regions === 1 ? 12 : 3,
              transports: regions === 1 ? ['inet'] : ['inet', 'mpls', 'lte'],
            });

  it.each(matrix.map((m) => [JSON.stringify(m), m] as const))(
    '%s',
    (_, intent) => {
      const { doc } = generateSdwan(intent);
      expect(validateDocument(doc).filter((p) => p.level === 'error')).toEqual(
        [],
      );
      expect(analyzeLayout(doc)).toEqual([]);
    },
  );
});

describe('resolveSdwanIntent — bounds', () => {
  it.each([
    [{ vendor: 'fortinet' }, /vendor must be one of/],
    [
      { vendor: 'juniper', regions: 5 },
      /regions must be an integer from 1 to 4/,
    ],
    [{ vendor: 'juniper', hubsPerRegion: 3 }, /hubsPerRegion/],
    [{ vendor: 'juniper', branchesPerRegion: 0 }, /branchesPerRegion\[0\]/],
    [
      { vendor: 'juniper', regions: 2, branchesPerRegion: [1] },
      /has 1 entries but regions is 2/,
    ],
    [{ vendor: 'juniper', transports: [] }, /transports needs 1–3/],
    [{ vendor: 'juniper', transports: ['dsl'] }, /transport must be one of/],
    [{ vendor: 'juniper', regions: 2, regionNames: ['A', 'a'] }, /distinct/],
  ])('rejects %j', (intent, msg) => {
    expect(() => resolveSdwanIntent(intent as SdwanIntent)).toThrow(msg);
  });

  it('fills a blank region name by position and rejects slug collisions', () => {
    expect(
      resolveSdwanIntent({
        vendor: 'juniper',
        regions: 3,
        regionNames: ['West', '', 'Asia'],
      }).regionNames,
    ).toEqual(['West', 'EMEA', 'Asia']);
    expect(() =>
      resolveSdwanIntent({
        vendor: 'juniper',
        regions: 2,
        regionNames: ['US-East', 'US East'],
      }),
    ).toThrow(/distinct/);
  });

  it('defaults to inter-region mesh only when there are several regions', () => {
    expect(resolveSdwanIntent({ vendor: 'juniper' }).interRegionHubMesh).toBe(
      false,
    );
    expect(
      resolveSdwanIntent({ vendor: 'juniper', regions: 2 }).interRegionHubMesh,
    ).toBe(true);
  });
});
