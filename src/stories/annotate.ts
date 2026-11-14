/**
 * Failure-moment annotations — what lets a viewer read a step without prose.
 *
 * The flow compiler already draws a down tunnel red and dimmed. This adds
 * the rest, using only vocabulary the document already has:
 *
 *   state — on every page where it holds
 *     an unreachable appliance    node `status: 'down'` (reachable: 'ok')
 *     a down tunnel               a `deny` marker (✕) on the appliance it
 *                                 leaves from: "this link is down here"
 *     a flow that cannot flow     its path drawn stopped, in the down
 *     (down tunnel, dead end)     colour, not as particles on a dead link
 *   change — on the page of the step that made it
 *     a flow on another tunnel    a `redirect` marker (↪) on the appliance
 *                                 it now leaves through: "rerouted here"
 *     whatever a change touched   the page's `emphasis`: it is spotlighted
 *                                 and everything else dims
 *
 * No marker type was added: `deny` and `redirect` are two of the engine's
 * original nine and mean exactly this. Every annotation is written into the
 * page it describes, so a page still stands entirely on its own.
 */
import type { FlowRecord } from '../connect/types.js';
import type { Page } from '../pages/model.js';
import {
  farEnd,
  findTunnel,
  flowKey,
  flowMatches,
  type FabricState,
  type ScenarioStep,
} from './types.js';

/** Marker colours: the engine's "down" red and "warn" amber. */
export const STORY_COLORS = { down: '#fc6161', reroute: '#e0a44a' } as const;

/** The tunnel a flow rides, as the flow compiler reads it. */
const riddenTunnel = (flow: FlowRecord): string | undefined =>
  flow.outboundTunnel ?? flow.inboundTunnel;

/** Write a step's annotations onto its freshly compiled, placed page. */
export function annotateStep(
  page: Page,
  step: ScenarioStep,
  before: FabricState,
  after: FabricState,
): void {
  const sourced = <T extends { source?: { kind: string; id: string } }>(
    elements: T[],
    kind: string,
    id: string | undefined,
  ): T | undefined =>
    elements.find((e) => e.source?.kind === kind && e.source.id === id);
  const nodeOf = (applianceId: string | undefined) =>
    sourced(page.nodes, 'appliance', applianceId);
  const linkOf = (tunnelId: string | undefined) =>
    sourced(page.links, 'tunnel', tunnelId);
  const unreachable = (applianceId: string | undefined): boolean =>
    after.appliances.some((a) => a.id === applianceId && a.reachable === false);
  /** The flows that enter or leave the fabric through an appliance. */
  const flowsThrough = (applianceId: string): FlowRecord[] =>
    after.flows.filter(
      (f) => f.applianceId === applianceId || farEnd(after, f) === applianceId,
    );

  // Reachability → the status LED, in both directions.
  for (const appliance of after.appliances) {
    const node = nodeOf(appliance.id);
    if (node && appliance.reachable !== undefined)
      node.status = appliance.reachable ? 'ok' : 'down';
  }

  // A marker goes on its node's outer upper corner, which the frame keeps
  // clear (frame.ts): away from the tunnels between the two columns. (The
  // flow compiler's own steering marker sits at NE.)
  const middle = Number(page.viewBox.split(/\s+/)[2]) / 2;
  const corner = (node: { x: number }): 'NE' | 'NW' =>
    node.x > middle ? 'NE' : 'NW';
  const count = (n: number, one: string, many: string): string =>
    n === 1 ? one : `${n} ${many}`;

  // Down tunnels → one ✕ on the appliance they leave from.
  const downAt = new Map<string, number>();
  for (const tunnel of [...after.underlay, ...after.overlay])
    if (tunnel.status === 'down' && linkOf(tunnel.id))
      downAt.set(tunnel.from, (downAt.get(tunnel.from) ?? 0) + 1);
  for (const [applianceId, tunnels] of downAt) {
    const node = nodeOf(applianceId)!;
    page.policyMarkers.push({
      id: `story_down_${node.id}`,
      nodeId: node.id,
      type: 'deny',
      label: count(tunnels, 'Tunnel down', 'tunnels down'),
      color: STORY_COLORS.down,
      align: corner(node),
    });
  }

  // Flows: one that cannot flow is drawn stopped; one that rides another
  // tunnel than before puts a ↪ on the appliance it now leaves through.
  const reroutedTo = new Map<string, string[]>();
  for (const now of after.flows) {
    const path = sourced(page.flowPaths, 'flow', flowKey(now));
    if (!path) continue;
    const via = farEnd(after, now);
    if (
      findTunnel(after, riddenTunnel(now))?.status === 'down' ||
      unreachable(now.applianceId) ||
      unreachable(via)
    ) {
      path.color = STORY_COLORS.down;
      path.animation = 'dashed';
    }
    const was = before.flows.find((f) => flowKey(f) === flowKey(now));
    if (was && via && riddenTunnel(was) !== riddenTunnel(now) && nodeOf(via))
      reroutedTo.set(via, [...(reroutedTo.get(via) ?? []), path.id]);
  }
  for (const [applianceId, paths] of reroutedTo) {
    const node = nodeOf(applianceId)!;
    page.policyMarkers.push({
      id: `story_reroute_${node.id}`,
      nodeId: node.id,
      type: 'redirect',
      label: count(paths.length, 'Rerouted here', 'flows rerouted here'),
      color: STORY_COLORS.reroute,
      // A marker can name one flow path; with several it names none.
      ...(paths.length === 1 ? { flowPathId: paths[0] } : {}),
      align: corner(node),
    });
  }

  // Emphasis: the nodes and links this step's changes touched.
  const spot = new Set<string>();
  const add = (id: string | undefined): void => {
    if (id) spot.add(id);
  };
  const tunnel = (id: string | undefined): void => {
    const link = linkOf(id);
    for (const part of link ? [link.id, link.from, link.to] : []) add(part);
  };
  const flow = (record: FlowRecord | undefined): void => {
    if (!record) return;
    add(nodeOf(record.applianceId)?.id);
    tunnel(riddenTunnel(record));
    for (const ip of [record.srcIp, record.dstIp])
      add(sourced(page.nodes, 'endpoint', ip)?.id);
  };
  for (const change of step.changes ?? [])
    switch (change.kind) {
      case 'set-tunnel':
        // The tunnel, and the flows it carries: they are what it affects.
        tunnel(change.tunnelId);
        for (const record of after.flows)
          if (riddenTunnel(record) === change.tunnelId) flow(record);
        break;
      case 'set-appliance':
        // The appliance, and the flows that run through it.
        add(nodeOf(change.applianceId)?.id);
        flowsThrough(change.applianceId).forEach(flow);
        break;
      case 'add-flow':
        flow(change.flow);
        break;
      case 'remove-flow':
        // Where it ran: the flow itself is no longer on the page.
        flow(before.flows.find((f) => flowMatches(f, change.flow)));
        break;
      case 'set-flow':
        // Both the path it left and the path it is on now.
        flow(before.flows.find((f) => flowMatches(f, change.flow)));
        flow(after.flows.find((f) => flowMatches(f, change.flow)));
        break;
    }
  // Page order, so the list is the same however the changes were ordered.
  const emphasis = [...page.nodes, ...page.links]
    .map((element) => element.id)
    .filter((id) => spot.has(id));
  if (emphasis.length) page.emphasis = emphasis;
}
