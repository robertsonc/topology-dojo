import { describe, it, expect } from 'vitest';
import { MockProvider } from './mock.js';
import {
  compileFabric,
  compileFlow,
  compileFlowTopology,
  dedupeFlows,
  type FabricRecords,
} from './compile.js';
import { validateDocument } from '../api/validate.js';
import { renderDocumentToSVG } from '../server/render.js';
import type { TopologyDocument } from '../pages/model.js';
import type { FlowRecord, TopologyProvider } from './types.js';

async function records(): Promise<FabricRecords> {
  const p = new MockProvider();
  return {
    appliances: await p.getAppliances(),
    underlay: await p.getTunnels('underlay'),
    overlay: await p.getTunnels('overlay'),
    policies: await p.getOverlayPolicies(),
  };
}

const OPTS = { system: 'mock', fetchedAt: '2026-06-11T07:00:00Z' };

describe('compileFabric', () => {
  it('builds a layered, sourced, valid fabric document', async () => {
    const doc = compileFabric(await records(), OPTS);
    expect(doc.layers?.map((l) => l.id)).toEqual([
      'underlay',
      'overlay',
      'policy',
    ]);
    const page = doc.pages[0]!;
    // Appliances → sourced nodes with metadata.
    expect(page.nodes).toHaveLength(3);
    const hub = page.nodes.find((n) => n.label === 'ec-hub-dc1')!;
    expect(hub.source).toMatchObject({
      system: 'mock',
      kind: 'appliance',
      id: '1.NE',
    });
    expect(hub.meta).toMatchObject({ serial: 'SN-HUB-001', role: 'hub' });
    // Sites → zones.
    expect(page.zones.map((z) => z.label).sort()).toEqual([
      'Branch-77',
      'Branch-78',
      'DC-1',
    ]);
    // Tunnels → links on their layers; a down tunnel reads as down.
    const under = page.links.filter((l) => l.layer === 'underlay');
    const over = page.links.filter((l) => l.layer === 'overlay');
    expect(under).toHaveLength(3);
    expect(over).toHaveLength(2);
    const down = page.links.find((l) => l.source?.id === 'ut_78_inet')!;
    expect(down.color).toBe('#fc6161');
    // Clean by construction.
    expect(validateDocument(doc).filter((p) => p.level === 'error')).toEqual(
      [],
    );
  });

  it('is convergent: recompiling onto the same document never duplicates', async () => {
    const recs = await records();
    const doc = compileFabric(recs, OPTS);
    const counts = {
      nodes: doc.pages[0]!.nodes.length,
      links: doc.pages[0]!.links.length,
      zones: doc.pages[0]!.zones.length,
    };
    // Refresh with changed data: hub got upgraded.
    recs.appliances[0]!.softwareVersion = '9.6.0';
    compileFabric(recs, { ...OPTS, fetchedAt: 'later' }, doc);
    expect(doc.pages[0]!.nodes).toHaveLength(counts.nodes);
    expect(doc.pages[0]!.links).toHaveLength(counts.links);
    expect(doc.pages[0]!.zones).toHaveLength(counts.zones);
    const hub = doc.pages[0]!.nodes.find((n) => n.label === 'ec-hub-dc1')!;
    expect(hub.meta?.version).toBe('9.6.0');
    expect(hub.source?.fetchedAt).toBe('later');
  });
});

describe('compileFlow', () => {
  it('threads src → ingress → egress → dst with per-hop tunnel data', async () => {
    const recs = await records();
    const doc = compileFabric(recs, OPTS);
    const flows = await new MockProvider().getFlows({ application: 'voip' });
    const ok = compileFlow(doc, flows[0]!, recs, OPTS);
    expect(ok).toBe(true);

    const page = doc.pages[0]!;
    // Endpoint hosts appear, sourced by IP.
    expect(page.nodes.some((n) => n.label === '10.0.77.50')).toBe(true);
    expect(page.nodes.some((n) => n.label === '10.0.0.80')).toBe(true);

    const fp = page.flowPaths[0]!;
    expect(fp.waypoints).toHaveLength(4); // srcHost, branch, hub, dstHost
    expect(fp.animation).toBe('particles'); // live flow moves
    expect(fp.label).toContain('voip');
    // The hub-arrival hop knows the overlay tunnel it rode.
    const tunnelHop = fp.hops!.find((h) => h.meta?.tunnel === 'bt_77_rt')!;
    expect(tunnelHop.layer).toBe('overlay');
    expect(tunnelHop.linkId).toBe('lk_bt_77_rt');
    expect(tunnelHop.meta).toMatchObject({ overlay: 'RealTime' });

    // The steering BIO becomes a policy marker tied to the flow path.
    const pm = page.policyMarkers[0]!;
    expect(pm).toMatchObject({
      type: 'redirect',
      label: 'RealTime',
      layer: 'policy',
      flowPathId: fp.id,
    });
    expect(validateDocument(doc).filter((p) => p.level === 'error')).toEqual(
      [],
    );
  });

  it('draws ended flows as traces and skips flows off the fabric', async () => {
    const recs = await records();
    const doc = compileFabric(recs, OPTS);
    const ended = (
      await new MockProvider().getFlows({ includeEnded: true })
    ).find((f) => !f.active)!;
    expect(compileFlow(doc, ended, recs, OPTS)).toBe(true);
    const fp = doc.pages[0]!.flowPaths[0]!;
    expect(fp.animation).toBe('dashed');
    expect(fp.opacity).toBeLessThan(1);

    expect(
      compileFlow(doc, { ...ended, applianceId: '999.NE' }, recs, OPTS),
    ).toBe(false); // unknown appliance → not placed
  });
});

describe('dedupeFlows + compileFlowTopology', () => {
  it('collapses ingress/egress views of one conversation, ingress wins', async () => {
    const flows = await new MockProvider().getFlows();
    // f1001 (ingress, has outboundTunnel) and f2001 (egress view) are one flow.
    const deduped = dedupeFlows(flows);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.outboundTunnel).toBe('bt_77_rt');
  });

  it('one-shot compiles a laid-out, valid, renderable document', async () => {
    const recs = await records();
    const flows = await new MockProvider().getFlows({ includeEnded: true });
    const { document, flowsCompiled } = compileFlowTopology(recs, flows, {
      system: 'mock',
      title: 'Voice flow',
    });
    expect(document.title).toBe('Voice flow');
    expect(flowsCompiled).toBe(2); // voip (deduped) + ended https
    const problems = validateDocument(document);
    expect(problems.filter((p) => p.level === 'error')).toEqual([]);

    // It renders, layered: underlay-only view hides the overlay tunnel.
    const full = renderDocumentToSVG(document);
    expect(full).toContain('data-tds-link="lk_bt_77_rt"');
    expect(full).toContain('data-tds-flowpath=');
    const underOnly = renderDocumentToSVG(document, 0, {
      visibleLayers: ['underlay'],
    });
    expect(underOnly).not.toContain('data-tds-link="lk_bt_77_rt"');
    expect(underOnly).toContain('data-tds-link="lk_ut_77_inet"');
  });
});

/* ── Packet E2: a fetch that returns less never deletes ────────────────
 * The compiler only ever upserts (create, or patch by source identity);
 * nothing in it removes an element. These tests pin that for the three ways
 * a provider read goes wrong: it returns nothing, it returns some
 * collections and not others, or one of its calls throws partway through.
 */

/** One provider read: the fabric collections plus the flow table. */
type Fetched = FabricRecords & { flows: FlowRecord[] };

const COLLECTIONS = [
  'appliances',
  'underlay',
  'overlay',
  'policies',
  'flows',
] as const;
type Collection = (typeof COLLECTIONS)[number];

/** A later read than `OPTS`, so a refreshed element is told from a stale one. */
const LATER = { system: 'mock', fetchedAt: '2026-06-11T08:00:00Z' };

/** The mock fabric, read completely. */
async function fetched(): Promise<Fetched> {
  return {
    ...(await records()),
    flows: await new MockProvider().getFlows({ includeEnded: true }),
  };
}

/** `full` with only the `kept` collections returned; the rest came back empty. */
function only(full: Fetched, kept: readonly Collection[]): Fetched {
  const has = (c: Collection): boolean => kept.includes(c);
  return {
    appliances: has('appliances') ? full.appliances : [],
    underlay: has('underlay') ? full.underlay : [],
    overlay: has('overlay') ? full.overlay : [],
    policies: has('policies') ? full.policies : [],
    flows: has('flows') ? full.flows : [],
  };
}

/** What an in-place importer does with one read: the fabric, then each flow. */
function converge(doc: TopologyDocument, read: Fetched): void {
  compileFabric(read, LATER, doc);
  for (const flow of dedupeFlows(read.flows))
    compileFlow(doc, flow, read, LATER);
}

/** The first import: fabric and both flows, laid out. */
async function compiled(): Promise<{ doc: TopologyDocument; full: Fetched }> {
  const full = await fetched();
  const { document } = compileFlowTopology(full, full.flows, OPTS);
  return { doc: document, full };
}

/** Every element id on the compiled page, per collection, in order. */
function elementIds(doc: TopologyDocument): Record<string, string[]> {
  const page = doc.pages[0]!;
  return {
    nodes: page.nodes.map((n) => n.id),
    links: page.links.map((l) => l.id),
    anchors: page.anchors.map((a) => a.id),
    zones: page.zones.map((z) => z.id),
    flowPaths: page.flowPaths.map((f) => f.id),
    policyMarkers: page.policyMarkers.map((m) => m.id),
  };
}

const errors = (doc: TopologyDocument) =>
  validateDocument(doc).filter((p) => p.level === 'error');

/** A provider whose `call` rejects; every other call answers normally. */
function failingAt(call: Collection): TopologyProvider {
  const mock = new MockProvider();
  const boom = (): Promise<never> =>
    Promise.reject(new Error(`${call} unavailable`));
  return {
    describe: () => mock.describe(),
    getAppliances: () =>
      call === 'appliances' ? boom() : mock.getAppliances(),
    getTunnels: (scope) => (call === scope ? boom() : mock.getTunnels(scope)),
    getOverlayPolicies: () =>
      call === 'policies' ? boom() : mock.getOverlayPolicies(),
    getFlows: (query) => (call === 'flows' ? boom() : mock.getFlows(query)),
    getFlowDetails: (ref) => mock.getFlowDetails(ref),
  };
}

/**
 * A read by an importer that carries on when a call fails, counting it as
 * "nothing returned" — the shape that would turn a transient failure into
 * deletion evidence if the compiler ever deleted on absence.
 */
async function tolerantRead(provider: TopologyProvider): Promise<Fetched> {
  const orEmpty = <T>(call: Promise<T[]>): Promise<T[]> => call.catch(() => []);
  return {
    appliances: await orEmpty(provider.getAppliances()),
    underlay: await orEmpty(provider.getTunnels('underlay')),
    overlay: await orEmpty(provider.getTunnels('overlay')),
    policies: await orEmpty(provider.getOverlayPolicies()),
    flows: await orEmpty(provider.getFlows({ includeEnded: true })),
  };
}

describe('no delete on an empty, partial or failed fetch (packet E2)', () => {
  it('starts from a document with something of every kind to lose', async () => {
    const { doc } = await compiled();
    const ids = elementIds(doc);
    expect(ids.nodes).toHaveLength(7); // 3 appliances + 4 endpoint hosts
    expect(ids.links).toHaveLength(5);
    expect(ids.zones).toHaveLength(3);
    expect(ids.flowPaths).toHaveLength(2);
    expect(ids.policyMarkers).toHaveLength(2);
  });

  it('an empty fetch leaves the compiled document byte-identical', async () => {
    const { doc, full } = await compiled();
    const before = structuredClone(doc);
    converge(doc, only(full, []));
    expect(doc).toEqual(before);
    expect(JSON.stringify(doc)).toBe(JSON.stringify(before));
  });

  it('never removes an element, whichever collections a fetch returns', async () => {
    const { doc: first, full } = await compiled();
    const want = elementIds(first);
    // All 32 ways the five collections can come back present or empty.
    for (let mask = 0; mask < 1 << COLLECTIONS.length; mask++) {
      const kept = COLLECTIONS.filter((_, i) => (mask & (1 << i)) !== 0);
      const doc = structuredClone(first);
      converge(doc, only(full, kept));
      const when = `fetch returned only [${kept.join(', ')}]`;
      expect(elementIds(doc), when).toEqual(want);
      expect(doc.pages, when).toHaveLength(1);
      expect(doc.layers, when).toEqual(first.layers);
      expect(errors(doc), when).toEqual([]);
    }
  });

  it('leaves the elements of a missing collection exactly as they were', async () => {
    const { doc: first, full } = await compiled();
    const was = first.pages[0]!;
    const after = (kept: Collection[]) => {
      const doc = structuredClone(first);
      converge(doc, only(full, kept));
      return doc.pages[0]!;
    };

    // No tunnels: every link is untouched — its earlier fetchedAt included,
    // which is what keeps a stale element recognisable — while the
    // appliances that did come back are refreshed.
    let page = after(['appliances', 'policies', 'flows']);
    expect(page.links).toEqual(was.links);
    expect(page.links.map((l) => l.source?.fetchedAt)).toEqual(
      was.links.map(() => OPTS.fetchedAt),
    );
    expect(page.nodes.find((n) => n.id === 'ne_1_NE')!.source?.fetchedAt).toBe(
      LATER.fetchedAt,
    );

    // No appliances: nodes and site zones are untouched, and the tunnels
    // that did come back still find their endpoints on the page.
    page = after(['underlay', 'overlay', 'policies']);
    expect(page.nodes).toEqual(was.nodes);
    expect(page.zones).toEqual(was.zones);
    expect(page.links.map((l) => l.source?.fetchedAt)).toEqual(
      was.links.map(() => LATER.fetchedAt),
    );

    // No flows: flow paths, their markers and their endpoint hosts stay.
    const hosts = (p: typeof was) => p.nodes.filter((n) => n.type === 'host');
    page = after(['appliances', 'underlay', 'overlay', 'policies']);
    expect(page.flowPaths).toEqual(was.flowPaths);
    expect(page.policyMarkers).toEqual(was.policyMarkers);
    expect(hosts(page)).toEqual(hosts(was));

    // No policies: the steering markers stay.
    page = after(['appliances', 'underlay', 'overlay', 'flows']);
    expect(page.policyMarkers).toEqual(was.policyMarkers);
  });

  it.each(COLLECTIONS)(
    'a provider call that throws partway (%s) deletes nothing, even if the importer carries on',
    async (call) => {
      const { doc } = await compiled();
      const before = elementIds(doc);
      converge(doc, await tolerantRead(failingAt(call)));
      expect(elementIds(doc)).toEqual(before);
      expect(errors(doc)).toEqual([]);
    },
  );

  /* Known limits — not deletions, and not the wanted end state. An element
   * that IS returned is patched from the current read alone: two of its
   * fields shrink when a related record is missing from that read, its seed
   * position is written again, and a key the new state no longer sets is
   * left behind. They matter to partial-result handling (packet E3) and to
   * any in-place importer (E4), and they are why the story compiler
   * (src/stories) compiles every state afresh instead of converging one page
   * into the next. They are pinned here so they cannot go unnoticed: when
   * one changes, update the expectation rather than deleting the test. */
  describe('known limits of re-reading into a compiled document', () => {
    it('flows read without their tunnels are redrawn without the hub hop', async () => {
      const { doc, full } = await compiled();
      const voip = () =>
        doc.pages[0]!.flowPaths.find((f) => f.id === 'fp_77_NE_f1001')!;
      expect(voip().waypoints).toEqual([
        'host_10_0_77_50',
        'ne_77_NE',
        'ne_1_NE',
        'host_10_0_0_80',
      ]);
      converge(doc, only(full, ['appliances', 'policies', 'flows']));
      // The path survives, but its egress waypoint and that hop's tunnel
      // data are gone: the far end is only known through the tunnel record.
      expect(voip().waypoints).toEqual([
        'host_10_0_77_50',
        'ne_77_NE',
        'host_10_0_0_80',
      ]);
      expect(voip().hops?.some((h) => h.linkId !== undefined)).toBe(false);
    });

    it('a partial appliance list shrinks a site zone to the members it returned', async () => {
      const full = await fetched();
      full.appliances[1]!.site = 'DC-1'; // the hub's site now has two members
      const doc = compileFabric(full, OPTS);
      const zone = () => doc.pages[0]!.zones.find((z) => z.label === 'DC-1')!;
      expect(zone().nodes).toEqual(['ne_1_NE', 'ne_77_NE']);
      converge(doc, { ...only(full, []), appliances: [full.appliances[0]!] });
      // The absent appliance keeps its node; it only leaves the zone box.
      expect(zone().nodes).toEqual(['ne_1_NE']);
      expect(doc.pages[0]!.nodes.map((n) => n.id)).toContain('ne_77_NE');
    });

    it('a re-read appliance goes back to its seed position, undoing the layout', async () => {
      const { doc, full } = await compiled();
      const hub = () => {
        const n = doc.pages[0]!.nodes.find((x) => x.id === 'ne_1_NE')!;
        return { x: n.x, y: n.y };
      };
      const laidOut = hub();
      converge(doc, only(full, ['appliances']));
      expect(hub()).toEqual({ x: 700, y: 320 }); // the first hub's seed slot
      expect(hub()).not.toEqual(laidOut);
    });

    it('a tunnel that comes back up keeps the dimming it got while down', async () => {
      const { doc, full } = await compiled();
      const link = () =>
        doc.pages[0]!.links.find((l) => l.id === 'lk_bt_78_rt')!;
      expect(link()).toMatchObject({ color: '#fc6161', opacity: 0.6 });
      const up = structuredClone(full);
      up.overlay.find((t) => t.id === 'bt_78_rt')!.status = 'up';
      converge(doc, up);
      // Colour and status follow the read; the opacity key is never cleared.
      // A fresh compile of the same records has no opacity on this link.
      expect(link()).toMatchObject({ color: '#01a982', opacity: 0.6 });
      expect(link().meta).toMatchObject({ status: 'up' });
      const fresh = compileFabric(up, OPTS);
      expect(
        fresh.pages[0]!.links.find((l) => l.id === 'lk_bt_78_rt')!.opacity,
      ).toBeUndefined();
    });
  });
});

describe('overlay tunnel labels', () => {
  const fabric = (overlays: string[]): FabricRecords => ({
    appliances: [
      { id: 'hub', hostname: 'hub', site: 'DC' },
      { id: 'b1', hostname: 'b1', site: 'S1' },
      { id: 'b2', hostname: 'b2', site: 'S2' },
    ],
    underlay: [],
    overlay: [
      {
        id: 't1',
        scope: 'overlay',
        from: 'b1',
        to: 'hub',
        overlay: overlays[0],
      },
      {
        id: 't2',
        scope: 'overlay',
        from: 'b2',
        to: 'hub',
        overlay: overlays[1],
      },
    ],
    policies: [],
  });
  const tunnels = (recs: FabricRecords) =>
    compileFabric(recs, OPTS).pages[0]!.links.map((l) => ({
      label: l.label,
      overlay: (l as { meta?: Record<string, unknown> }).meta?.overlay,
    }));

  it('one overlay: no per-tunnel label, the name stays on the link as data', () => {
    // The same word on every tunnel says nothing and piles up at the hub.
    expect(tunnels(fabric(['Default', 'Default']))).toEqual([
      { label: undefined, overlay: 'Default' },
      { label: undefined, overlay: 'Default' },
    ]);
  });

  it('several overlays: each tunnel is labelled with its own', () => {
    expect(tunnels(fabric(['RealTime', 'BulkApps']))).toEqual([
      { label: 'RealTime', overlay: 'RealTime' },
      { label: 'BulkApps', overlay: 'BulkApps' },
    ]);
  });

  it('a tunnel with no overlay keeps its alias or id as the label', () => {
    const recs = fabric(['Default', 'Default']);
    recs.overlay.push({
      id: 't3',
      scope: 'overlay',
      from: 'b1',
      to: 'b2',
      alias: 'b1-b2',
    });
    expect(tunnels(recs)[2]).toEqual({ label: 'b1-b2', overlay: undefined });
  });
});
