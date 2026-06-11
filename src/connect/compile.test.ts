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
