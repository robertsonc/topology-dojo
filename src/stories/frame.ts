/**
 * The story frame — one layout that every page of a story shares.
 *
 * Every state of the scenario is compiled onto one throwaway page, so that
 * page holds each node that appears anywhere in the story, and the nodes are
 * placed once. The pages then take their positions from here (compile.ts),
 * which is what keeps a node still while the story plays.
 *
 * The placement is the flow compiler's own picture — spokes in a column,
 * hubs in a column facing them, endpoints beside their edge — made exact:
 *
 *   endpoints ‹ spoke sites │ ─ tunnels ─ │ hub sites › endpoints
 *
 * Tunnels run between the two columns and cross nothing but each other,
 * which is what lets a single red one be seen. A site's appliances stay
 * together inside its zone box; an endpoint sits outside the box, beside
 * the appliance it attaches to. Every distance is measured from the real
 * boxes (`zoneBox`, `nodeFootprint`), so the frame has no overlap for
 * `analyzeLayout` to find, whatever the hostnames.
 *
 * (The one-shot `compileFlowTopology` lays out differently: with site zones
 * present it packs every site into one row, and the tunnels then run
 * through the appliances between their ends.)
 *
 * A frame is one column a side, so a large fabric makes a tall page.
 */
import {
  compileFabric,
  compileFlow,
  dedupeFlows,
  type CompileOptions,
} from '../connect/compile.js';
import type { BoundsRect } from '../api/geometry.js';
import { LAYOUT_RULES, nodeFootprint, zoneBox } from '../api/layout.js';
import type { Page } from '../pages/model.js';
import type { NodeConfig, ZoneConfig } from '../vendor/topology-ds.js';
import { farEnd, type FabricState } from './types.js';

export interface Frame {
  viewBox: string;
  /** Node id → where that node sits, on every page it is on. */
  positions: Map<string, { x: number; y: number }>;
}

/** The standard page; a frame only grows past it. */
const PAGE_MIN = { w: 1050, h: 700 };
/** Clear space between the drawing and the page edge. */
const MARGIN = 70;
/** Clear space between two neighbours (above the analyzer's minimums). */
const GAP = LAYOUT_RULES.minNodeGap + 6;
/** The least run of tunnel between the two columns' boxes. */
const TUNNEL_RUN = 300;
/**
 * How far below its appliance an endpoint sits. Level with it, the endpoint
 * would take the one place a marker's label can slide to: the engine hangs
 * the label under the badge, at the appliance's top edge, and moves it
 * sideways off the appliance.
 */
const HOST_DROP = 40;

/** A site (its zone) or a lone appliance: what a column stacks. */
interface Block {
  members: NodeConfig[];
  zone?: ZoneConfig;
}

/** Lay out the frame for a story's states (one per step, in order). */
export function layOutFrame(
  states: FabricState[],
  opts: CompileOptions,
): Frame {
  const fabric = states[0]!;
  const doc = compileFabric(fabric, opts);
  const page = doc.pages[0]!;
  const applianceNode = (id: string): NodeConfig | undefined =>
    page.nodes.find(
      (n) => n.source?.kind === 'appliance' && n.source.id === id,
    );

  // Every endpoint of every state, each hung off the appliance the first
  // flow to name it attaches it to: its ingress, or where it leaves.
  const hostsOf = new Map<string, NodeConfig[]>();
  for (const state of states)
    for (const flow of dedupeFlows(state.flows)) {
      const known = new Set(page.nodes.map((n) => n.id));
      if (!compileFlow(doc, flow, state, opts)) continue;
      const egress = farEnd(state, flow);
      for (const node of page.nodes) {
        if (known.has(node.id)) continue;
        const owner =
          node.source?.id !== flow.srcIp && egress && applianceNode(egress)
            ? egress
            : flow.applianceId;
        hostsOf.set(owner, [...(hostsOf.get(owner) ?? []), node]);
      }
    }

  // Sites, in record order, split into the two columns by role.
  const blocks = new Map<string, Block & { hub: boolean }>();
  for (const appliance of fabric.appliances) {
    const node = applianceNode(appliance.id);
    if (!node) continue;
    const zone = page.zones.find((z) => z.nodes.includes(node.id));
    const key = zone?.id ?? node.id;
    const block = blocks.get(key) ?? {
      members: [],
      ...(zone ? { zone } : {}),
      hub: appliance.role === 'hub',
    };
    block.members.push(node);
    blocks.set(key, block);
  }
  let left = [...blocks.values()].filter((b) => !b.hub);
  let right = [...blocks.values()].filter((b) => b.hub);
  if (!left.length || !right.length) {
    // No roles to split on (a mesh): halve the list, so most tunnels still
    // run between the columns.
    const all = [...left, ...right];
    left = all.slice(0, Math.ceil(all.length / 2));
    right = all.slice(left.length);
  }

  const hosts = [...hostsOf.values()].flat();
  const tallest = (nodes: NodeConfig[]): number =>
    Math.max(0, ...nodes.map((n) => nodeFootprint(n).h));
  const hostWidth = Math.max(0, ...hosts.map((n) => nodeFootprint(n).w));
  const memberPitch =
    Math.max(
      tallest(page.nodes.filter((n) => !hosts.includes(n))),
      tallest(hosts),
    ) +
    2 * GAP;

  /**
   * Stack a column's blocks downwards from y = 0 around x = 0, endpoints
   * hanging off the `outward` side. Returns the column's height and how far
   * its boxes reach inwards, towards the other column.
   */
  const stack = (
    column: Block[],
    outward: -1 | 1,
  ): { height: number; inward: number } => {
    let top = 0;
    let inward = 0;
    for (const block of column) {
      block.members.forEach((member, k) => {
        member.x = 0;
        member.y = k * memberPitch;
      });
      const drop = top - boxOf(page, block).y;
      for (const member of block.members) member.y += drop;
      const box = boxOf(page, block);
      const edge = outward < 0 ? box.x : box.x + box.w;
      inward = Math.max(inward, outward < 0 ? box.x + box.w : -box.x);
      let bottom = box.y + box.h;
      for (const member of block.members)
        (hostsOf.get(String(member.source?.id)) ?? []).forEach((host, k) => {
          host.x =
            edge + outward * (GAP + hostWidth / 2 + k * (hostWidth + GAP));
          host.y = member.y + HOST_DROP;
          const foot = nodeFootprint(host);
          bottom = Math.max(bottom, foot.y + foot.h);
        });
      top = bottom + GAP;
    }
    return { height: Math.max(0, top - GAP), inward };
  };
  const nodesOf = (column: Block[]): NodeConfig[] =>
    column.flatMap((block) => [
      ...block.members,
      ...block.members.flatMap(
        (member) => hostsOf.get(String(member.source?.id)) ?? [],
      ),
    ]);
  const shift = (nodes: NodeConfig[], dx: number, dy: number): void => {
    for (const node of nodes) {
      node.x = Math.round(node.x + dx);
      node.y = Math.round(node.y + dy);
    }
  };

  const l = stack(left, -1);
  const r = stack(right, 1);
  // Face the columns across the tunnel run, the shorter one centred.
  const height = Math.max(l.height, r.height);
  shift(nodesOf(left), 0, (height - l.height) / 2);
  shift(
    nodesOf(right),
    l.inward + TUNNEL_RUN + r.inward,
    (height - r.height) / 2,
  );

  // Size the page to the drawing and centre it, margins kept.
  const boxes = [
    ...page.nodes.map(nodeFootprint),
    ...page.zones.flatMap((zone) => zoneBox(page, zone) ?? []),
  ];
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const w = Math.max(...boxes.map((b) => b.x + b.w)) - x0;
  const h = Math.max(...boxes.map((b) => b.y + b.h)) - y0;
  const pageW = Math.max(PAGE_MIN.w, Math.ceil(w) + 2 * MARGIN);
  const pageH = Math.max(PAGE_MIN.h, Math.ceil(h) + 2 * MARGIN);
  shift(page.nodes, (pageW - w) / 2 - x0, (pageH - h) / 2 - y0);

  return {
    viewBox: `0 0 ${pageW} ${pageH}`,
    positions: new Map(page.nodes.map((n) => [n.id, { x: n.x, y: n.y }])),
  };
}

/** The box a block occupies: its zone's box, or its lone member's footprint. */
function boxOf(page: Page, block: Block): BoundsRect {
  const zone = block.zone && zoneBox(page, block.zone);
  if (zone) return zone;
  const boxes = block.members.map(nodeFootprint);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
}
