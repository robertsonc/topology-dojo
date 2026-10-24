/**
 * Test helper: convert a `catalog/fixtures/wiring/*.json` fixture (the
 * Python reference's input shape) into a Topology Dojo document, so the
 * same fixtures pin both implementations.
 *
 * Mapping: node `model` / `stack_members` → `hw`; link `a` / `z` `if` /
 * `optic` → `from|toInterface` / `from|toOptic`; each `bonds[]` entry → a lag
 * bundle named by the bond, set as `from|toBundle` on the link ends that
 * carry its members, with `lacp` per node when one name spans nodes with
 * different settings.
 */
import { readdirSync, readFileSync } from 'node:fs';
import type { BundleDef } from '../api/bundles.js';
import type { TopologyDocument } from '../pages/model.js';
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';

interface FixtureEnd {
  node: string;
  if?: string;
  optic?: string;
}

export interface WiringFixture {
  file: string;
  description: string;
  nodes: { id: string; model?: string; stack_members?: number }[];
  links: { id: string; a: FixtureEnd; z: FixtureEnd }[];
  bonds: { node: string; name: string; members: string[]; lacp: boolean }[];
  expect: string[];
}

export function loadWiringFixtures(dir: string): WiringFixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const raw = JSON.parse(
        readFileSync(`${dir}/${file}`, 'utf8'),
      ) as Partial<WiringFixture>;
      return { ...raw, file, bonds: raw.bonds ?? [] } as WiringFixture;
    });
}

export function fixtureToDocument(fx: WiringFixture): TopologyDocument {
  const nodes: NodeConfig[] = fx.nodes.map((n, i) => ({
    id: n.id,
    type: 'router',
    x: 100 + 150 * i,
    y: 200,
    ...(n.model
      ? {
          hw: {
            model: n.model,
            ...(n.stack_members ? { stackMembers: n.stack_members } : {}),
          },
        }
      : {}),
  }));
  const links: LinkConfig[] = fx.links.map((l) => ({
    id: l.id,
    type: 'lan',
    from: l.a.node,
    to: l.z.node,
    ...(l.a.if ? { fromInterface: l.a.if } : {}),
    ...(l.z.if ? { toInterface: l.z.if } : {}),
    ...(l.a.optic ? { fromOptic: l.a.optic } : {}),
    ...(l.z.optic ? { toOptic: l.z.optic } : {}),
  }));
  const bundles: BundleDef[] = [];
  for (const b of fx.bonds) {
    let def = bundles.find((d) => d.id === b.name);
    if (!def) {
      def = { id: b.name, lacp: { [b.node]: b.lacp } };
      bundles.push(def);
    } else (def.lacp as Record<string, boolean>)[b.node] = b.lacp;
    for (const m of b.members) {
      const hit = links.find(
        (l) =>
          (l.from === b.node && l.fromInterface === m) ||
          (l.to === b.node && l.toInterface === m),
      );
      if (!hit)
        throw new Error(`${fx.file}: bond ${b.name} member ${m} has no link`);
      if (hit.from === b.node && hit.fromInterface === m)
        hit.fromBundle = b.name;
      else hit.toBundle = b.name;
    }
  }
  // Collapse per-node lacp to a boolean when every node agrees.
  for (const def of bundles) {
    const vals = Object.values(def.lacp as Record<string, boolean>);
    if (vals.every((v) => v === vals[0])) def.lacp = vals[0];
  }
  return {
    title: fx.description,
    customNodes: [],
    ...(bundles.length ? { bundles } : {}),
    pages: [
      {
        id: 'p1',
        name: fx.file,
        viewBox: '0 0 1050 700',
        nodes,
        links,
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
      },
    ],
  };
}
