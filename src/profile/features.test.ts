import { describe, it, expect } from 'vitest';
import { createDocument } from '../api/builder.js';
import type { Page, TopologyDocument } from '../pages/model.js';
import { diffDocuments } from '../workspace/operations.js';
import {
  analyzeRelations,
  analyzeTiers,
  assignRoles,
  detectArchetype,
  extractFeatures,
  extractRegions,
  extractTraits,
  type SemanticFeatures,
} from './features.js';

/* ── fixture builders ─────────────────────────────────────────────────── */

/** A single-region hub with `n` degree-1 spokes fanned around it. */
function hubSpokePage(): Page {
  const doc = createDocument()
    .page({ id: 'p1', name: 'F' })
    .node({ id: 'hub', type: 'ec', x: 500, y: 350, label: 'Hub' })
    .node({ id: 's1', type: 'host', x: 300, y: 350, label: 's1' })
    .node({ id: 's2', type: 'host', x: 700, y: 350, label: 's2' })
    .node({ id: 's3', type: 'host', x: 500, y: 500, label: 's3' })
    .link({ id: 'l1', type: 'line', from: 'hub', to: 's1' })
    .link({ id: 'l2', type: 'line', from: 'hub', to: 's2' })
    .link({ id: 'l3', type: 'line', from: 'hub', to: 's3' })
    .build();
  return doc.pages[0]!;
}

/** Two spines, each connected to three multihomed leaves (classic fabric). */
function leafSpinePage(): Page {
  const doc = createDocument()
    .page({ id: 'p1', name: 'F' })
    .node({
      id: 'spine1',
      type: 'switchEnterprise',
      x: 400,
      y: 200,
      label: 'sp1',
    })
    .node({
      id: 'spine2',
      type: 'switchEnterprise',
      x: 700,
      y: 200,
      label: 'sp2',
    })
    .node({ id: 'leaf1', type: 'switch', x: 300, y: 450, label: 'l1' })
    .node({ id: 'leaf2', type: 'switch', x: 550, y: 450, label: 'l2' })
    .node({ id: 'leaf3', type: 'switch', x: 800, y: 450, label: 'l3' })
    .link({ id: 'a', type: 'line', from: 'leaf1', to: 'spine1' })
    .link({ id: 'b', type: 'line', from: 'leaf1', to: 'spine2' })
    .link({ id: 'c', type: 'line', from: 'leaf2', to: 'spine1' })
    .link({ id: 'd', type: 'line', from: 'leaf2', to: 'spine2' })
    .link({ id: 'e', type: 'line', from: 'leaf3', to: 'spine1' })
    .link({ id: 'f', type: 'line', from: 'leaf3', to: 'spine2' })
    .build();
  return doc.pages[0]!;
}

/** Four nodes, fully interconnected. */
function meshPage(): Page {
  const b = createDocument()
    .page({ id: 'p1', name: 'F' })
    .node({ id: 'a', type: 'router', x: 300, y: 300, label: 'a' })
    .node({ id: 'b', type: 'router', x: 700, y: 300, label: 'b' })
    .node({ id: 'c', type: 'router', x: 300, y: 600, label: 'c' })
    .node({ id: 'd', type: 'router', x: 700, y: 600, label: 'd' });
  const pairs: Array<[string, string]> = [
    ['a', 'b'],
    ['a', 'c'],
    ['a', 'd'],
    ['b', 'c'],
    ['b', 'd'],
    ['c', 'd'],
  ];
  for (const [from, to] of pairs)
    b.link({ id: `${from}${to}`, type: 'line', from, to });
  return b.build().pages[0]!;
}

/** Nodes with no links. */
function flatPage(): Page {
  return createDocument()
    .page({ id: 'p1', name: 'F' })
    .node({ id: 'a', type: 'host', x: 300, y: 300, label: 'a' })
    .node({ id: 'b', type: 'host', x: 500, y: 300, label: 'b' })
    .node({ id: 'c', type: 'host', x: 700, y: 300, label: 'c' })
    .build().pages[0]!;
}

/**
 * Two-region hub-and-spoke, spokes placed RADIALLY around each regional hub;
 * inter-region link only between the two hubs. This is the agent's first,
 * geometric interpretation of "hub and spoke".
 */
function radialMultiRegionDoc(): TopologyDocument {
  return (
    createDocument('WAN')
      .page({ id: 'p1', name: 'WAN' })
      // Region A hub + radial spokes (up / right / down / left).
      .node({ id: 'hubA', type: 'ec', x: 300, y: 350, label: 'HubA' })
      .node({ id: 'a1', type: 'host', x: 300, y: 250, label: 'a1' })
      .node({ id: 'a2', type: 'host', x: 400, y: 350, label: 'a2' })
      .node({ id: 'a3', type: 'host', x: 300, y: 450, label: 'a3' })
      .node({ id: 'a4', type: 'host', x: 200, y: 350, label: 'a4' })
      // Region B hub + radial spokes.
      .node({ id: 'hubB', type: 'ec', x: 750, y: 350, label: 'HubB' })
      .node({ id: 'b1', type: 'host', x: 750, y: 250, label: 'b1' })
      .node({ id: 'b2', type: 'host', x: 850, y: 350, label: 'b2' })
      .node({ id: 'b3', type: 'host', x: 750, y: 450, label: 'b3' })
      .node({ id: 'b4', type: 'host', x: 650, y: 350, label: 'b4' })
      .link({ id: 'la1', type: 'line', from: 'hubA', to: 'a1' })
      .link({ id: 'la2', type: 'line', from: 'hubA', to: 'a2' })
      .link({ id: 'la3', type: 'line', from: 'hubA', to: 'a3' })
      .link({ id: 'la4', type: 'line', from: 'hubA', to: 'a4' })
      .link({ id: 'lb1', type: 'line', from: 'hubB', to: 'b1' })
      .link({ id: 'lb2', type: 'line', from: 'hubB', to: 'b2' })
      .link({ id: 'lb3', type: 'line', from: 'hubB', to: 'b3' })
      .link({ id: 'lb4', type: 'line', from: 'hubB', to: 'b4' })
      .link({ id: 'inter', type: 'tunnel', from: 'hubA', to: 'hubB' })
      .zone({
        id: 'zoneA',
        label: 'Region A',
        nodes: ['hubA', 'a1', 'a2', 'a3', 'a4'],
      })
      .zone({
        id: 'zoneB',
        label: 'Region B',
        nodes: ['hubB', 'b1', 'b2', 'b3', 'b4'],
      })
      .build()
  );
}

/**
 * The user's SETTLED correction: regional hubs on a horizontal spine tier near
 * the top; each region's spokes grouped in a row BELOW its hub; inter-region
 * link still only at the hub tier. Same ids as the radial doc, so a document
 * diff yields the user's move operations.
 */
function layeredMultiRegionDoc(): TopologyDocument {
  return (
    createDocument('WAN')
      .page({ id: 'p1', name: 'WAN' })
      // Hubs on a spine tier (aligned row, near the top).
      .node({ id: 'hubA', type: 'ec', x: 300, y: 150, label: 'HubA' })
      .node({ id: 'a1', type: 'host', x: 180, y: 340, label: 'a1' })
      .node({ id: 'a2', type: 'host', x: 300, y: 340, label: 'a2' })
      .node({ id: 'a3', type: 'host', x: 420, y: 340, label: 'a3' })
      .node({ id: 'a4', type: 'host', x: 300, y: 480, label: 'a4' })
      .node({ id: 'hubB', type: 'ec', x: 750, y: 150, label: 'HubB' })
      .node({ id: 'b1', type: 'host', x: 630, y: 340, label: 'b1' })
      .node({ id: 'b2', type: 'host', x: 750, y: 340, label: 'b2' })
      .node({ id: 'b3', type: 'host', x: 870, y: 340, label: 'b3' })
      .node({ id: 'b4', type: 'host', x: 750, y: 480, label: 'b4' })
      .link({ id: 'la1', type: 'line', from: 'hubA', to: 'a1' })
      .link({ id: 'la2', type: 'line', from: 'hubA', to: 'a2' })
      .link({ id: 'la3', type: 'line', from: 'hubA', to: 'a3' })
      .link({ id: 'la4', type: 'line', from: 'hubA', to: 'a4' })
      .link({ id: 'lb1', type: 'line', from: 'hubB', to: 'b1' })
      .link({ id: 'lb2', type: 'line', from: 'hubB', to: 'b2' })
      .link({ id: 'lb3', type: 'line', from: 'hubB', to: 'b3' })
      .link({ id: 'lb4', type: 'line', from: 'hubB', to: 'b4' })
      .link({ id: 'inter', type: 'tunnel', from: 'hubA', to: 'hubB' })
      .zone({
        id: 'zoneA',
        label: 'Region A',
        nodes: ['hubA', 'a1', 'a2', 'a3', 'a4'],
      })
      .zone({
        id: 'zoneB',
        label: 'Region B',
        nodes: ['hubB', 'b1', 'b2', 'b3', 'b4'],
      })
      .build()
  );
}

/* ── archetype detection ──────────────────────────────────────────────── */

describe('detectArchetype', () => {
  it('detects a single-region hub-and-spoke from fan-out', () => {
    expect(detectArchetype(hubSpokePage())).toBe('hub-and-spoke');
  });

  it('detects a leaf-spine fabric from multihomed leaves', () => {
    expect(detectArchetype(leafSpinePage())).toBe('leaf-spine');
  });

  it('detects a multi-region hub-and-spoke with hub-only interconnect', () => {
    expect(detectArchetype(radialMultiRegionDoc().pages[0]!)).toBe(
      'multi-region-hub-spoke',
    );
    expect(detectArchetype(layeredMultiRegionDoc().pages[0]!)).toBe(
      'multi-region-hub-spoke',
    );
  });

  it('detects a fully interconnected mesh', () => {
    expect(detectArchetype(meshPage())).toBe('mesh');
  });

  it('treats unlinked nodes as flat and an empty page as unknown', () => {
    expect(detectArchetype(flatPage())).toBe('flat');
    const empty = createDocument().page({ id: 'p1', name: 'F' }).build();
    expect(detectArchetype(empty.pages[0]!)).toBe('unknown');
  });

  it('treats a single node as flat', () => {
    const one = createDocument()
      .page({ id: 'p1', name: 'F' })
      .node({ id: 'a', type: 'host', x: 300, y: 300, label: 'a' })
      .build();
    expect(detectArchetype(one.pages[0]!)).toBe('flat');
  });
});

/* ── roles ────────────────────────────────────────────────────────────── */

describe('assignRoles', () => {
  it('labels the fan-out node hub and its leaves spokes', () => {
    const roles = assignRoles(hubSpokePage());
    expect(roles.hub).toBe('hub');
    expect(roles.s1).toBe('spoke');
    expect(roles.s2).toBe('spoke');
    expect(roles.s3).toBe('spoke');
  });

  it('labels fabric interconnects spine and their nodes leaf', () => {
    const roles = assignRoles(leafSpinePage());
    expect(roles.spine1).toBe('spine');
    expect(roles.spine2).toBe('spine');
    expect(roles.leaf1).toBe('leaf');
  });

  it('labels an unlinked node isolated', () => {
    const roles = assignRoles(flatPage());
    expect(new Set(Object.values(roles))).toEqual(new Set(['isolated']));
  });
});

/* ── regions ──────────────────────────────────────────────────────────── */

describe('extractRegions', () => {
  it('derives one region per zone with recursive membership', () => {
    const regions = extractRegions(radialMultiRegionDoc().pages[0]!);
    expect(regions.map((r) => r.zoneId)).toEqual(['zoneA', 'zoneB']);
    for (const region of regions) {
      expect(region.nodeCount).toBe(5);
      expect(region.hasHub).toBe(true);
      expect(region.hasSpoke).toBe(true);
      expect(region.roleCounts.hub).toBe(1);
      expect(region.roleCounts.spoke).toBe(4);
    }
  });

  it('carries nested membership up to the parent region', () => {
    const doc = createDocument()
      .page({ id: 'p1', name: 'F' })
      .node({ id: 'hub', type: 'ec', x: 500, y: 350, label: 'h' })
      .node({ id: 's1', type: 'host', x: 300, y: 350, label: 's1' })
      .node({ id: 's2', type: 'host', x: 700, y: 350, label: 's2' })
      .node({ id: 's3', type: 'host', x: 500, y: 520, label: 's3' })
      .link({ id: 'l1', type: 'line', from: 'hub', to: 's1' })
      .link({ id: 'l2', type: 'line', from: 'hub', to: 's2' })
      .link({ id: 'l3', type: 'line', from: 'hub', to: 's3' })
      .zone({ id: 'outer', label: 'Site', nodes: ['hub'] })
      .zone({
        id: 'inner',
        label: 'Rack',
        nodes: ['s1', 's2'],
        parentZone: 'outer',
      })
      .build();
    const regions = extractRegions(doc.pages[0]!);
    const outer = regions.find((r) => r.zoneId === 'outer')!;
    const inner = regions.find((r) => r.zoneId === 'inner')!;
    expect(inner.parentZoneId).toBe('outer');
    // outer recursively includes inner's members: hub + s1 + s2 = 3.
    expect(outer.nodeCount).toBe(3);
    expect(inner.nodeCount).toBe(2);
  });
});

/* ── tiers ────────────────────────────────────────────────────────────── */

describe('analyzeTiers', () => {
  it('separates hub and spoke tiers and confines interconnect to the hub tier', () => {
    const tiers = analyzeTiers(radialMultiRegionDoc().pages[0]!);
    expect(tiers.tiers.length).toBe(2);
    expect(tiers.tiers[0]!.roles).toContain('hub');
    expect(tiers.tiers[1]!.roles.some((r) => r === 'spoke')).toBe(true);
    expect(tiers.interRegionLinkCount).toBe(1);
    expect(tiers.interRegionOnlyAtHubTier).toBe(true);
  });

  it('flags interconnect that is NOT hub-only', () => {
    // Move the inter-region link onto a spoke instead of the hub.
    const doc = createDocument('WAN')
      .page({ id: 'p1', name: 'WAN' })
      .node({ id: 'hubA', type: 'ec', x: 300, y: 350, label: 'HubA' })
      .node({ id: 'a1', type: 'host', x: 300, y: 250, label: 'a1' })
      .node({ id: 'a2', type: 'host', x: 400, y: 350, label: 'a2' })
      .node({ id: 'a3', type: 'host', x: 300, y: 450, label: 'a3' })
      .node({ id: 'hubB', type: 'ec', x: 750, y: 350, label: 'HubB' })
      .node({ id: 'b1', type: 'host', x: 750, y: 250, label: 'b1' })
      .node({ id: 'b2', type: 'host', x: 850, y: 350, label: 'b2' })
      .node({ id: 'b3', type: 'host', x: 750, y: 450, label: 'b3' })
      .link({ id: 'la1', type: 'line', from: 'hubA', to: 'a1' })
      .link({ id: 'la2', type: 'line', from: 'hubA', to: 'a2' })
      .link({ id: 'la3', type: 'line', from: 'hubA', to: 'a3' })
      .link({ id: 'lb1', type: 'line', from: 'hubB', to: 'b1' })
      .link({ id: 'lb2', type: 'line', from: 'hubB', to: 'b2' })
      .link({ id: 'lb3', type: 'line', from: 'hubB', to: 'b3' })
      .link({ id: 'inter', type: 'line', from: 'a2', to: 'b2' })
      .zone({ id: 'zoneA', label: 'A', nodes: ['hubA', 'a1', 'a2', 'a3'] })
      .zone({ id: 'zoneB', label: 'B', nodes: ['hubB', 'b1', 'b2', 'b3'] })
      .build();
    const tiers = analyzeTiers(doc.pages[0]!);
    expect(tiers.interRegionLinkCount).toBe(1);
    expect(tiers.interRegionOnlyAtHubTier).toBe(false);
  });
});

/* ── relations (geometry → categories) ────────────────────────────────── */

describe('analyzeRelations', () => {
  it('categorizes radial placement', () => {
    expect(analyzeRelations(radialMultiRegionDoc().pages[0]!)).toContain(
      'radial-placement',
    );
  });

  it('categorizes layered regional placement', () => {
    const rel = analyzeRelations(layeredMultiRegionDoc().pages[0]!);
    expect(rel).toContain('layered-regional');
    expect(rel).toContain('spokes-grouped-below-hub-per-region');
    expect(rel).toContain('hubs-aligned-horizontal');
    expect(rel).not.toContain('radial-placement');
  });
});

/* ── traits ───────────────────────────────────────────────────────────── */

describe('extractTraits', () => {
  it('emits the multi-region hub-only-interconnect trigger vocabulary', () => {
    const traits = extractTraits(layeredMultiRegionDoc().pages[0]!);
    expect(traits).toContain('multi-region');
    expect(traits).toContain('hub-only-interconnect');
    expect(traits).toContain('multi-region-hub-spoke');
    expect(traits).toContain('layered-regional');
  });
});

/* ── the motivating example: radial → layered regional ────────────────── */

describe('extractFeatures — motivating example (radial → layered regional)', () => {
  const radial = radialMultiRegionDoc();
  const layered = layeredMultiRegionDoc();
  // The agent authored the radial layout from an empty page; the user's settled
  // correction is the diff from radial to layered.
  const empty = createDocument('WAN').page({ id: 'p1', name: 'WAN' }).build();
  const agentOperations = diffDocuments(empty, radial);
  const userOperations = diffDocuments(radial, layered);

  const features: SemanticFeatures = extractFeatures(userOperations, {
    document: layered,
    agentDocument: radial,
    agentOperations,
    taskTerms: ['hub', 'spoke', 'wan'],
    rationale: 'regional hierarchy, not cosmetic',
  });

  it('detects the hub-spoke / multi-region archetype family', () => {
    expect(features.archetype).toBe('multi-region-hub-spoke');
  });

  it('diffs traits as radial-placement → layered-regional + region grouping', () => {
    expect(features.correction.removedTraits).toContain('radial-placement');
    expect(features.correction.addedTraits).toContain('layered-regional');
    expect(features.correction.addedTraits).toContain(
      'spokes-grouped-below-hub-per-region',
    );
  });

  it('summarizes the settled correction categorically, not as coordinates', () => {
    expect(features.correction.summary).toBe(
      'radial → layered regional hub/spoke hierarchy',
    );
  });

  it('detects region membership and hub-tier-only interconnect', () => {
    expect(features.regions.map((r) => r.zoneId)).toEqual(['zoneA', 'zoneB']);
    expect(features.regions.every((r) => r.hasHub && r.hasSpoke)).toBe(true);
    expect(features.tiers.interRegionOnlyAtHubTier).toBe(true);
    expect(features.traits).toContain('multi-region');
    expect(features.traits).toContain('hub-only-interconnect');
  });

  it('finds agent/user target overlap (the user re-did the agent-authored nodes)', () => {
    expect(features.correction.overlapTargets.length).toBeGreaterThan(0);
    expect(features.correction.correctedNodeIds).toContain('hubA');
    expect(features.correction.correctedNodeIds).toContain('a1');
  });

  it('passes task terms and rationale through unchanged', () => {
    expect(features.taskTerms).toEqual(['hub', 'spoke', 'wan']);
    expect(features.rationale).toBe('regional hierarchy, not cosmetic');
  });
});

/* ── degenerate inputs ────────────────────────────────────────────────── */

describe('extractFeatures — degenerate inputs', () => {
  it('handles an empty document', () => {
    const empty = createDocument().page({ id: 'p1', name: 'F' }).build();
    const f = extractFeatures([], { document: empty });
    expect(f.archetype).toBe('unknown');
    expect(f.stats.nodeCount).toBe(0);
    expect(f.regions).toEqual([]);
    expect(f.correction.summary).toContain('no structural change');
  });

  it('handles a document with no pages', () => {
    const f = extractFeatures([], {
      document: { title: 't', pages: [], customNodes: [] },
    });
    expect(f.archetype).toBe('unknown');
    expect(f.stats.nodeCount).toBe(0);
  });

  it('counts disconnected components', () => {
    const doc = createDocument()
      .page({ id: 'p1', name: 'F' })
      .node({ id: 'a', type: 'host', x: 200, y: 200, label: 'a' })
      .node({ id: 'b', type: 'host', x: 300, y: 200, label: 'b' })
      .node({ id: 'c', type: 'host', x: 600, y: 200, label: 'c' })
      .node({ id: 'd', type: 'host', x: 700, y: 200, label: 'd' })
      .link({ id: 'ab', type: 'line', from: 'a', to: 'b' })
      .link({ id: 'cd', type: 'line', from: 'c', to: 'd' })
      .build();
    const f = extractFeatures([], { document: doc });
    expect(f.stats.components).toBe(2);
    expect(f.archetype).toBe('flat');
  });

  it('is deterministic: same inputs → identical output', () => {
    const doc = radialMultiRegionDoc();
    const a = extractFeatures([], { document: doc });
    const b = extractFeatures([], { document: doc });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

/* ── no raw coordinates retained ──────────────────────────────────────── */

describe('extractFeatures — retains no pixel coordinates', () => {
  it('emits no coordinate-named keys and no coordinate-magnitude numbers', () => {
    // Every coordinate in the fixtures is >= 150; every structural number the
    // module emits (counts, tier indices, degrees) is small. So no output
    // number may reach coordinate magnitude, and no key may be named x/y.
    const features = extractFeatures([], {
      document: layeredMultiRegionDoc(),
      agentDocument: radialMultiRegionDoc(),
    });
    const forbiddenKeys = new Set(['x', 'y', 'cx', 'cy', 'coord', 'viewBox']);
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (value && typeof value === 'object') {
        for (const [key, v] of Object.entries(value)) {
          expect(forbiddenKeys.has(key)).toBe(false);
          // Numeric-looking object keys must not be coordinate magnitude either.
          const asNum = Number(key);
          if (Number.isFinite(asNum)) expect(Math.abs(asNum)).toBeLessThan(100);
          walk(v);
        }
        return;
      }
      if (typeof value === 'number') expect(Math.abs(value)).toBeLessThan(100);
    };
    walk(features);
  });
});
