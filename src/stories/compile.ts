/**
 * The story compiler — a `FlowScenario` in, a flipbook out: one complete
 * page per step, in step order.
 *
 * NO INHERITANCE. A page is never stored as a difference from another page
 * and never refers to one. Each step's fabric state is compiled from
 * scratch by the flow compiler — `compileFabric` + `compileFlow`, the calls
 * `build_flow_topology` makes, used as they are — and then placed.
 * Pages share ids (the same appliance is `ne_…` on each) and nothing else:
 * delete or rewrite one and the others are untouched
 * (docs/decisions/0001-flipbook-vs-beats.md, DESIGN.md #1).
 *
 * POSITION STABILITY. Independent pages are not enough for playback: lay
 * each one out on its own and nodes move whenever a flow and its endpoints
 * come or go, so the picture jumps as it flips. So one frame is laid out
 * first — the fabric plus every endpoint that appears in any step
 * (frame.ts) — and every page takes its node positions from it. A node sits
 * at the same x/y on every page it is on.
 *
 * (Converging each page into the next would not do it: a re-read writes the
 * seed position again and leaves the previous state's keys behind — the
 * "known limits" pinned in src/connect/compile.test.ts.)
 *
 * Pure and deterministic: no clock, no provider, no generated ids. The same
 * scenario compiles to the same document, byte for byte.
 */
import {
  compileFabric,
  compileFlow,
  dedupeFlows,
  type CompileOptions,
} from '../connect/compile.js';
import type { FlowRecord, TunnelRecord } from '../connect/types.js';
import { emptyDocument } from '../api/builder.js';
import { TEXT_LIMITS } from '../api/text.js';
import type { TopologyDocument } from '../pages/model.js';
import { layOutFrame } from './frame.js';
import {
  farEnd,
  findTunnel,
  flowMatches,
  hostname,
  scenarioStates,
  type FabricState,
  type FlowScenario,
  type ScenarioChange,
  type ScenarioStep,
} from './types.js';

/** The freshness stamp when a scenario gives none: not a live read. */
export const STORY_EPOCH = '1970-01-01T00:00:00.000Z';

/**
 * Compile a scenario into a document whose pages are its steps, in order.
 * Throws `ScenarioError` (naming step and field) when it does not validate.
 */
export function compileFlowStory(scenario: FlowScenario): TopologyDocument {
  // states[0] is the base; states[i + 1] is the fabric after step i.
  const states = scenarioStates(scenario);
  const opts: CompileOptions = {
    system: scenario.system,
    fetchedAt: scenario.fetchedAt ?? STORY_EPOCH,
  };
  const frame = layOutFrame(states.slice(1), opts);

  const story = emptyDocument(scenario.title ?? 'Flow story');
  scenario.steps.forEach((step, i) => {
    const before = states[i]!;
    const after = states[i + 1]!;
    // A fresh compile per step: nothing on this page comes from another.
    const compiled = compileState(after, opts);
    const page = compiled.pages[0]!;
    page.id = `story-${i + 1}`;
    page.name = step.name;
    page.viewBox = frame.viewBox;
    for (const node of page.nodes) {
      const at = frame.positions.get(node.id);
      if (at) Object.assign(node, at);
    }
    const caption = step.caption ?? describeStep(step, before, after);
    if (caption) page.caption = caption;
    const duration = step.duration ?? scenario.playback?.duration;
    if (duration !== undefined) page.duration = duration;
    if (scenario.playback?.transition)
      page.transition = scenario.playback.transition;
    // The layers every state declares; kept from the first compile.
    if (i === 0 && compiled.layers) story.layers = compiled.layers;
    story.pages.push(page);
  });
  return story;
}

/** One fabric state as the flow compiler draws it: fabric, then each flow. */
function compileState(
  state: FabricState,
  opts: CompileOptions,
): TopologyDocument {
  const doc = compileFabric(state, opts);
  for (const flow of dedupeFlows(state.flows))
    compileFlow(doc, flow, state, opts);
  return doc;
}

/* ── captions: what a step did, in a sentence per change ────────────── */

/** The page caption for a step that brings none of its own. */
function describeStep(
  step: ScenarioStep,
  before: FabricState,
  after: FabricState,
): string {
  const changes = step.changes ?? [];
  if (!changes.length) return describeState(after);
  const sentences = changes.map((c) => describeChange(c, before, after));
  // Whole sentences only, within the caption limit: the ones that do not
  // fit are counted, not cut.
  const limit = TEXT_LIMITS.caption;
  const more = (n: number): string => (n ? ` (+${n} more.)` : '');
  let caption = '';
  for (const [i, sentence] of sentences.entries()) {
    const left = sentences.length - i - 1;
    const next = caption ? `${caption} ${sentence}` : sentence;
    if (next.length + more(left).length <= limit) caption = next;
    else if (caption) return caption + more(left + 1);
    else return `${next.slice(0, limit - 1)}…`;
  }
  return caption;
}

function describeState(state: FabricState): string {
  const tunnels = [...state.underlay, ...state.overlay];
  const down = tunnels.filter((t) => t.status === 'down').length;
  const count = (n: number, noun: string): string =>
    `${n} ${noun}${n === 1 ? '' : 's'}`;
  return `${count(state.appliances.length, 'appliance')}, ${count(
    tunnels.length,
    'tunnel',
  )} (${down ? `${down} down` : 'all up'}), ${count(
    dedupeFlows(state.flows).length,
    'flow',
  )}.`;
}

function describeChange(
  change: ScenarioChange,
  before: FabricState,
  after: FabricState,
): string {
  switch (change.kind) {
    case 'set-tunnel': {
      const t = findTunnel(after, change.tunnelId)!;
      const name = `Tunnel ${tunnelName(after, t)}`;
      if (change.set.status === 'down') return `${name} goes down.`;
      if (change.set.status === 'up') return `${name} comes back up.`;
      return `${name} changes: ${describePatch(change.set)}.`;
    }
    case 'set-appliance': {
      const name = hostname(after, change.applianceId);
      if (change.set.reachable === false) return `${name} goes down.`;
      if (change.set.reachable === true) return `${name} comes back.`;
      return `${name} changes: ${describePatch(change.set)}.`;
    }
    case 'add-flow': {
      const via = farEnd(after, change.flow);
      return `${flowName(change.flow)} starts${via ? `, via ${hostname(after, via)}` : ''}.`;
    }
    case 'remove-flow': {
      const flow = before.flows.find((f) => flowMatches(f, change.flow));
      return `${flow ? flowName(flow) : 'A flow'} ends.`;
    }
    case 'set-flow': {
      const was = before.flows.find((f) => flowMatches(f, change.flow));
      const now = after.flows.find((f) => flowMatches(f, change.flow))!;
      const name = flowName(now);
      const via = farEnd(after, now);
      if (was && via && farEnd(before, was) !== via)
        return `${name} reroutes via ${hostname(after, via)}.`;
      if (was && via && riddenTunnel(was) !== riddenTunnel(now))
        return `${name} moves to another tunnel to ${hostname(after, via)}.`;
      if (change.set.active === false) return `${name} ends; its trace stays.`;
      if (change.set.active === true && was && !was.active)
        return `${name} resumes.`;
      return `${name} changes: ${describePatch(change.set)}.`;
    }
  }
}

/** `status degraded, alias cleared` — a patch in words. */
function describePatch(set: object): string {
  return Object.entries(set)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) =>
      value === null ? `${key} cleared` : `${key} ${String(value)}`,
    )
    .join(', ');
}

/* ── names ──────────────────────────────────────────────────────────── */

const riddenTunnel = (flow: FlowRecord): string | undefined =>
  flow.outboundTunnel ?? flow.inboundTunnel;

/** `amer-br01-ec to amer-hub01-ec (Default)` */
function tunnelName(state: FabricState, t: TunnelRecord): string {
  const plane = t.overlay ?? t.fromInterface ?? t.alias;
  return `${hostname(state, t.from)} to ${hostname(state, t.to)}${
    plane ? ` (${plane})` : ''
  }`;
}

/** `voip 10.1.1.20 to 10.0.0.80` */
function flowName(flow: FlowRecord): string {
  const what = flow.application ?? flow.protocol ?? 'flow';
  return flow.srcIp && flow.dstIp
    ? `${what} ${flow.srcIp} to ${flow.dstIp}`
    : what;
}
