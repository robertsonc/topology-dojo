/**
 * Scenario stories — the contract.
 *
 * A `FlowScenario` is a fabric at one moment (the base) plus an ordered list
 * of named steps. Each step says what changed in the fabric since the step
 * before it — a tunnel goes down, a flow takes another path — and the story
 * compiler (compile.ts) draws every step as one complete page.
 *
 * The base is plain records: the shapes a `TopologyProvider` returns and the
 * SD-WAN generator synthesizes (src/connect/types.ts). A scenario can start
 * from a live snapshot or from a generated fabric, and never needs a
 * provider to compile.
 *
 * Steps are changes here, in the INPUT. The compiled document holds none:
 * every page is a full frame (docs/decisions/0001-flipbook-vs-beats.md).
 *
 * The vocabulary is a discriminated union on `kind`, and a `set-*` change
 * carries a patch of the record itself. A field added to a record is
 * expressible without a new kind of change, and a new kind is an addition
 * to the union — neither breaks a scenario that already exists.
 *
 * DOM-free and pure: nothing here reads a clock, a provider or a document.
 */
import type { FabricRecords } from '../connect/compile.js';
import type {
  ApplianceRecord,
  FlowRecord,
  FlowRef,
  OverlayPolicyRecord,
  TunnelRecord,
} from '../connect/types.js';
import { TEXT_LIMITS } from '../api/text.js';

/** The fabric at one moment: a provider's collections and the flows on them. */
export interface FabricState extends FabricRecords {
  flows: FlowRecord[];
}

/** Where a scenario starts. Only the appliances are required. */
export interface ScenarioBase {
  appliances: ApplianceRecord[];
  underlay?: TunnelRecord[];
  overlay?: TunnelRecord[];
  policies?: OverlayPolicyRecord[];
  flows?: FlowRecord[];
}

/**
 * A patch of a record: the fields given are set, and `null` clears an
 * optional one (the rule `update_element` patches follow). A required field
 * can be set but not cleared.
 */
export type Patch<T> = {
  [K in keyof T]?: undefined extends T[K] ? T[K] | null : T[K];
};

/** What can change on a tunnel. Its id and its two ends are its identity. */
export type TunnelPatch = Patch<
  Omit<TunnelRecord, 'id' | 'scope' | 'from' | 'to'>
>;
export type AppliancePatch = Patch<Omit<ApplianceRecord, 'id'>>;
/** What can change on a flow. Its id and its appliance are its identity. */
export type FlowPatch = Patch<Omit<FlowRecord, 'id' | 'applianceId'>>;

/** A tunnel changes. `set: { status: 'down' }` is "the tunnel goes down". */
export interface SetTunnel {
  kind: 'set-tunnel';
  /** `TunnelRecord.id`, underlay or overlay. */
  tunnelId: string;
  set: TunnelPatch;
}

/** An appliance changes. `set: { reachable: false }` is "it goes down". */
export interface SetAppliance {
  kind: 'set-appliance';
  /** `ApplianceRecord.id`. */
  applianceId: string;
  set: AppliancePatch;
}

/**
 * A flow changes. `set: { outboundTunnel: '…' }` is "it takes another path";
 * `set: { active: false }` is "it ended but is still in the table".
 */
export interface SetFlow {
  kind: 'set-flow';
  flow: FlowRef;
  set: FlowPatch;
}

/** A flow appears in a flow table. */
export interface AddFlow {
  kind: 'add-flow';
  flow: FlowRecord;
}

/** A flow leaves its flow table. */
export interface RemoveFlow {
  kind: 'remove-flow';
  flow: FlowRef;
}

export type ScenarioChange =
  | SetTunnel
  | SetAppliance
  | SetFlow
  | AddFlow
  | RemoveFlow;

/** Every kind, once: one added to the union must be listed here to compile. */
const KINDS: Record<ScenarioChange['kind'], true> = {
  'set-tunnel': true,
  'set-appliance': true,
  'set-flow': true,
  'add-flow': true,
  'remove-flow': true,
};
export const SCENARIO_CHANGE_KINDS = Object.keys(
  KINDS,
) as ScenarioChange['kind'][];

/** One page of the story. */
export interface ScenarioStep {
  /** The page name. Short: "Tunnel down". */
  name: string;
  /** One-line narration; written from the changes when absent. */
  caption?: string;
  /**
   * What changed since the step before, applied in order. None means the
   * fabric as it stands — the "before" page of a before/during/after story.
   */
  changes?: ScenarioChange[];
  /** How long playback holds this page, ms. Overrides `playback.duration`. */
  duration?: number;
}

export interface FlowScenario {
  /** The document title. */
  title?: string;
  /**
   * The source-system id on every element's source ref: a provider's
   * `describe().system` for a snapshot, "synthetic" for a generated fabric.
   */
  system: string;
  /**
   * When the base was read (ISO 8601), stamped on the source refs. Absent
   * means the epoch: the records are not a fresh read of anything.
   */
  fetchedAt?: string;
  base: ScenarioBase;
  /** One page each, in order. The first step starts from the base. */
  steps: ScenarioStep[];
  /** Playback settings written onto every page. */
  playback?: { duration?: number; transition?: 'cut' | 'fade' };
}

/** One thing wrong with a scenario, located by step and by field. */
export interface ScenarioProblem {
  /** The field, as a path from the scenario root: `steps[1].changes[0].tunnelId`. */
  path: string;
  /** Index of the step the problem is in. Absent outside the steps. */
  step?: number;
  /** That step's name, when it has one. */
  stepName?: string;
  message: string;
}

/** `step 2 "Tunnel down", steps[1].changes[0].tunnelId: no tunnel "x"…` */
export function formatScenarioProblem(p: ScenarioProblem): string {
  const step =
    p.step === undefined
      ? ''
      : `step ${p.step + 1}${p.stepName ? ` "${p.stepName}"` : ''}, `;
  return `${step}${p.path || 'scenario'}: ${p.message}`;
}

/** Thrown when a scenario that does not validate is compiled or stepped. */
export class ScenarioError extends Error {
  constructor(readonly problems: ScenarioProblem[]) {
    super(
      `invalid flow scenario:\n${problems
        .map((p) => `- ${formatScenarioProblem(p)}`)
        .join('\n')}`,
    );
    this.name = 'ScenarioError';
  }
}

/** Every problem in a scenario; an empty list means it will compile. */
export function validateFlowScenario(input: unknown): ScenarioProblem[] {
  return walk(input).problems;
}

/**
 * The fabric at each point of a scenario: index 0 is the base, index `i + 1`
 * the state after step `i`. Each state is an independent deep copy and the
 * scenario is left untouched. Throws `ScenarioError` on an invalid scenario.
 */
export function scenarioStates(scenario: FlowScenario): FabricState[] {
  const { problems, states } = walk(scenario);
  if (problems.length) throw new ScenarioError(problems);
  return states;
}

/** Does `flow` answer to `ref`? `seqNum` only counts when the ref gives one. */
export function flowMatches(flow: FlowRecord, ref: FlowRef): boolean {
  return (
    flow.applianceId === ref.applianceId &&
    flow.id === ref.flowId &&
    (ref.seqNum === undefined || flow.seqNum === ref.seqNum)
  );
}

/** The key the flow compiler draws one path per: appliance plus flow id. */
export function flowKey(flow: { applianceId: string; id: string }): string {
  return `${flow.applianceId}:${flow.id}`;
}

/* ── reading a state ────────────────────────────────────────────────── */

/** A tunnel of either plane, by id. */
export function findTunnel(
  state: FabricState,
  id: string | undefined,
): TunnelRecord | undefined {
  return [...state.overlay, ...state.underlay].find((t) => t.id === id);
}

/**
 * The appliance a flow leaves the fabric through — the other end of the
 * tunnel it rides, read the way the flow compiler reads it.
 */
export function farEnd(
  state: FabricState,
  flow: FlowRecord,
): string | undefined {
  const tunnel = findTunnel(state, flow.outboundTunnel ?? flow.inboundTunnel);
  if (!tunnel) return undefined;
  return tunnel.from === flow.applianceId ? tunnel.to : tunnel.from;
}

/** An appliance's hostname, or its id when it is not in the state. */
export function hostname(state: FabricState, applianceId: string): string {
  return (
    state.appliances.find((a) => a.id === applianceId)?.hostname ?? applianceId
  );
}

/* ── validation and stepping (one walk does both) ───────────────────── */

type FieldType = 'string' | 'number' | 'boolean';

interface RecordSpec {
  /** What the record is called in a message. */
  noun: string;
  fields: Record<string, FieldType>;
  /** Fields a record must carry: a patch may set them but not clear them. */
  required: readonly string[];
  /** Fields that are the record's identity, with why they cannot change. */
  identity: Record<string, string>;
}

/*
 * The patchable fields of each record. `Record<keyof …Patch, …>` makes the
 * typecheck fail here when a record in src/connect/types.ts gains a field,
 * so the validator cannot fall behind the records.
 */
const TUNNEL_FIELDS: Record<keyof TunnelPatch, FieldType> = {
  alias: 'string',
  status: 'string',
  fromInterface: 'string',
  toInterface: 'string',
  overlay: 'string',
};
const APPLIANCE_FIELDS: Record<keyof AppliancePatch, FieldType> = {
  hostname: 'string',
  serial: 'string',
  model: 'string',
  softwareVersion: 'string',
  site: 'string',
  role: 'string',
  mgmtIp: 'string',
  reachable: 'boolean',
};
const FLOW_FIELDS: Record<keyof FlowPatch, FieldType> = {
  seqNum: 'number',
  active: 'boolean',
  application: 'string',
  protocol: 'string',
  srcIp: 'string',
  srcPort: 'number',
  dstIp: 'string',
  dstPort: 'number',
  overlay: 'string',
  inboundTunnel: 'string',
  outboundTunnel: 'string',
  bytes: 'number',
  startTime: 'string',
  endTime: 'string',
};

const TUNNEL: RecordSpec = {
  noun: 'tunnel',
  fields: TUNNEL_FIELDS,
  required: [],
  identity: {
    id: 'a tunnel is addressed by its id',
    scope: 'a tunnel stays on its plane',
    from: 'a tunnel between other appliances is another tunnel',
    to: 'a tunnel between other appliances is another tunnel',
  },
};
const APPLIANCE: RecordSpec = {
  noun: 'appliance',
  fields: APPLIANCE_FIELDS,
  required: ['hostname'],
  identity: { id: 'an appliance is addressed by its id' },
};
const FLOW: RecordSpec = {
  noun: 'flow',
  fields: FLOW_FIELDS,
  required: ['active'],
  identity: {
    id: 'a flow is addressed by its appliance and id',
    applianceId: 'a flow is addressed by its appliance and id',
  },
};

/*
 * The keys each object of a scenario may carry — typed against the
 * interfaces above, so a field added to one must be added here to compile.
 */
const keysOf = <T>(keys: Record<keyof T, true>): string[] => Object.keys(keys);
const SCENARIO_KEYS = keysOf<FlowScenario>({
  title: true,
  system: true,
  fetchedAt: true,
  base: true,
  steps: true,
  playback: true,
});
const BASE_KEYS = keysOf<ScenarioBase>({
  appliances: true,
  underlay: true,
  overlay: true,
  policies: true,
  flows: true,
});
const PLAYBACK_KEYS = keysOf<NonNullable<FlowScenario['playback']>>({
  duration: true,
  transition: true,
});
const STEP_KEYS = keysOf<ScenarioStep>({
  name: true,
  caption: true,
  changes: true,
  duration: true,
});
const FLOW_REF_KEYS = keysOf<FlowRef>({
  applianceId: true,
  flowId: true,
  seqNum: true,
});
const FLOW_KEYS = ['id', 'applianceId', ...Object.keys(FLOW_FIELDS)];
const CHANGE_KEYS: Record<ScenarioChange['kind'], string[]> = {
  'set-tunnel': keysOf<SetTunnel>({ kind: true, tunnelId: true, set: true }),
  'set-appliance': keysOf<SetAppliance>({
    kind: true,
    applianceId: true,
    set: true,
  }),
  'set-flow': keysOf<SetFlow>({ kind: true, flow: true, set: true }),
  'add-flow': keysOf<AddFlow>({ kind: true, flow: true }),
  'remove-flow': keysOf<RemoveFlow>({ kind: true, flow: true }),
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const fits = (v: unknown, max: number): boolean =>
  typeof v === 'string' && v.length <= max;
const isDuration = (v: unknown): boolean =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;
const ofType = (v: unknown, type: FieldType): boolean =>
  type === 'number' ? Number.isFinite(v) : typeof v === type;
const quote = (v: unknown): string =>
  typeof v === 'string' ? `"${v}"` : String(JSON.stringify(v));
/** A table's own entry: `constructor` and the like are not in any table. */
const own = <T>(table: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

/** What is wrong with one field of a `set` patch, if anything. */
function patchProblem(
  key: string,
  value: unknown,
  spec: RecordSpec,
): string | null {
  const identity = own(spec.identity, key);
  if (identity) return `cannot change: ${identity}`;
  const type = own(spec.fields, key);
  if (!type)
    return `is not a ${spec.noun} field (${Object.keys(spec.fields).join(', ')})`;
  if (value === undefined) return null;
  const required = spec.required.includes(key);
  if (value === null)
    return required ? 'is required and cannot be cleared' : null;
  if (ofType(value, type)) return null;
  return `must be a ${type}${required ? '' : ' or null'} (got ${quote(value)})`;
}

/** Set the given fields on a record; `null` clears one. */
function applyPatch(record: object, set: Obj): void {
  const target = record as Obj;
  for (const [key, value] of Object.entries(set))
    if (value === null) delete target[key];
    else if (value !== undefined) target[key] = value;
}

function walk(input: unknown): {
  problems: ScenarioProblem[];
  states: FabricState[];
} {
  const problems: ScenarioProblem[] = [];
  let at: { step: number; stepName?: string } | undefined;
  const bad = (path: string, message: string): void => {
    problems.push({ path, ...at, message });
  };
  /** Run a check; true when it reported nothing. */
  const clean = (check: () => void): boolean => {
    const before = problems.length;
    check();
    return problems.length === before;
  };
  /**
   * A key that is not one of `allowed` is a problem, not something to skip:
   * a misspelt `changes` would otherwise compile to a page where nothing
   * happens.
   */
  const onlyKeys = (
    v: Obj,
    allowed: readonly string[],
    path: string,
    what: string,
  ): void => {
    for (const key of Object.keys(v))
      if (!allowed.includes(key))
        bad(
          path ? `${path}.${key}` : key,
          `is not ${what} (${allowed.join(', ')})`,
        );
  };

  if (!isObj(input)) {
    bad('', 'a scenario is an object { system, base, steps }');
    return { problems, states: [] };
  }
  onlyKeys(input, SCENARIO_KEYS, '', 'a scenario field');
  if (!isText(input.system))
    bad('system', 'is required: the source-system id for element source refs');
  if (input.title !== undefined && !fits(input.title, TEXT_LIMITS.title))
    bad('title', `must be a string of at most ${TEXT_LIMITS.title} characters`);
  if (input.fetchedAt !== undefined && !isText(input.fetchedAt))
    bad('fetchedAt', 'must be an ISO 8601 string');
  const playback = input.playback;
  if (playback !== undefined && !isObj(playback))
    bad('playback', 'must be an object { duration, transition }');
  else if (playback) {
    onlyKeys(playback, PLAYBACK_KEYS, 'playback', 'a playback setting');
    if (playback.duration !== undefined && !isDuration(playback.duration))
      bad('playback.duration', 'must be a positive number of milliseconds');
    if (
      playback.transition !== undefined &&
      playback.transition !== 'cut' &&
      playback.transition !== 'fade'
    )
      bad('playback.transition', 'must be "cut" or "fade"');
  }

  /** Typed fields of a whole record: right types, required ones present. */
  const checkRecord = (v: Obj, spec: RecordSpec, path: string): void => {
    for (const [key, type] of Object.entries(spec.fields))
      if (v[key] !== undefined && !ofType(v[key], type))
        bad(`${path}.${key}`, `must be a ${type} (got ${quote(v[key])})`);
    for (const key of spec.required)
      if (v[key] === undefined) bad(`${path}.${key}`, 'is required');
  };

  /** A `set` patch: at least one field, each known, typed and changeable. */
  const checkPatch = (v: unknown, spec: RecordSpec, path: string): v is Obj => {
    if (!isObj(v) || Object.keys(v).length === 0) {
      bad(path, `must set at least one ${spec.noun} field`);
      return false;
    }
    return clean(() => {
      for (const [key, value] of Object.entries(v)) {
        const problem = patchProblem(key, value, spec);
        if (problem) bad(`${path}.${key}`, problem);
      }
    });
  };

  /**
   * A whole flow record. One a step adds is written by hand, so its keys
   * are checked; one in the base may come from a provider and is not.
   */
  const readFlow = (
    f: unknown,
    path: string,
    strict = false,
  ): FlowRecord | null => {
    if (!isObj(f)) {
      bad(path, 'must be a flow record { id, applianceId, active, … }');
      return null;
    }
    const ok = clean(() => {
      for (const key of ['id', 'applianceId'])
        if (!isText(f[key])) bad(`${path}.${key}`, 'is required');
      checkRecord(f, FLOW, path);
      if (strict) onlyKeys(f, FLOW_KEYS, path, 'a flow field');
    });
    return ok ? (structuredClone(f) as unknown as FlowRecord) : null;
  };

  // ── the base ──
  const state: FabricState = {
    appliances: [],
    underlay: [],
    overlay: [],
    policies: [],
    flows: [],
  };
  const base = input.base;
  if (!isObj(base))
    bad('base', 'is required: { appliances, underlay, overlay, flows }');
  else {
    onlyKeys(base, BASE_KEYS, 'base', 'a base collection');
    /** The objects of one base collection (absent = empty, but for appliances). */
    const list = (key: keyof ScenarioBase): Obj[] => {
      const v = base[key];
      if (v === undefined && key !== 'appliances') return [];
      if (!Array.isArray(v)) {
        bad(`base.${key}`, 'must be an array');
        return [];
      }
      return v.filter((item: unknown, i): item is Obj => {
        if (!isObj(item)) bad(`base.${key}[${i}]`, 'must be an object');
        return isObj(item);
      });
    };
    const seen = new Set<string>();
    /** False, with a problem, when this id was already used by its kind. */
    const first = (kind: string, id: string, path: string): boolean => {
      const key = `${kind}|${id}`;
      if (seen.has(key)) {
        bad(path, `duplicate ${kind} ${quote(id)}`);
        return false;
      }
      seen.add(key);
      return true;
    };

    const appliances = list('appliances');
    appliances.forEach((a, i) => {
      const path = `base.appliances[${i}]`;
      if (!isText(a.id)) return bad(`${path}.id`, 'is required');
      checkRecord(a, APPLIANCE, path);
      if (first('appliance', a.id, `${path}.id`))
        state.appliances.push(structuredClone(a) as unknown as ApplianceRecord);
    });
    if (Array.isArray(base.appliances) && appliances.length === 0)
      bad('base.appliances', 'needs at least one appliance');

    for (const scope of ['underlay', 'overlay'] as const)
      list(scope).forEach((t, i) => {
        const path = `base.${scope}[${i}]`;
        if (!isText(t.id)) return bad(`${path}.id`, 'is required');
        for (const end of ['from', 'to'])
          if (!isText(t[end])) bad(`${path}.${end}`, 'is required');
        checkRecord(t, TUNNEL, path);
        // One id space for both planes: the compiler draws one link per id.
        if (first('tunnel', t.id, `${path}.id`))
          state[scope].push(structuredClone(t) as unknown as TunnelRecord);
      });

    list('policies').forEach((p, i) => {
      const path = `base.policies[${i}]`;
      if (!isText(p.id)) bad(`${path}.id`, 'is required');
      else if (!isText(p.name)) bad(`${path}.name`, 'is required');
      else
        state.policies.push(
          structuredClone(p) as unknown as OverlayPolicyRecord,
        );
    });

    list('flows').forEach((f, i) => {
      const path = `base.flows[${i}]`;
      const flow = readFlow(f, path);
      // One path per appliance + flow id is what the compiler draws.
      if (flow && first('flow', flowKey(flow), path)) state.flows.push(flow);
    });
  }

  const tunnel = (id: unknown): TunnelRecord | undefined =>
    [...state.overlay, ...state.underlay].find((t) => t.id === id);
  const appliance = (id: unknown): ApplianceRecord | undefined =>
    state.appliances.find((a) => a.id === id);

  /** The one flow a ref points at, at this step. */
  const findFlow = (ref: unknown, path: string): FlowRecord | undefined => {
    if (!isObj(ref) || !isText(ref.applianceId) || !isText(ref.flowId)) {
      bad(path, 'must be a flow ref { applianceId, flowId }');
      return undefined;
    }
    onlyKeys(ref, FLOW_REF_KEYS, path, 'a flow ref field');
    if (ref.seqNum !== undefined && !Number.isFinite(ref.seqNum)) {
      bad(`${path}.seqNum`, 'must be a number');
      return undefined;
    }
    const hits = state.flows.filter((f) =>
      flowMatches(f, ref as unknown as FlowRef),
    );
    if (hits.length !== 1)
      bad(
        path,
        hits.length
          ? `matches ${hits.length} flows; add seqNum to pick one`
          : `no flow ${quote(ref.flowId)} on appliance ${quote(ref.applianceId)} at this step`,
      );
    return hits.length === 1 ? hits[0] : undefined;
  };

  /**
   * A flow a step states must be drawable: on a known appliance, riding a
   * known tunnel if it names one, with at least two points to thread. (A
   * base read from a live fabric may carry flows that are not; the flow
   * compiler skips those, and so does the story.)
   */
  const checkDrawable = (
    flow: FlowRecord,
    paths: { appliance: string; fields: string },
  ): boolean =>
    clean(() => {
      if (!appliance(flow.applianceId))
        return bad(
          paths.appliance,
          `no appliance ${quote(flow.applianceId)} in the base, so the flow is never drawn`,
        );
      for (const key of ['outboundTunnel', 'inboundTunnel'] as const)
        if (flow[key] !== undefined && !tunnel(flow[key]))
          bad(
            `${paths.fields}.${key}`,
            `no tunnel ${quote(flow[key])} in the base`,
          );
      const ridden = tunnel(flow.outboundTunnel ?? flow.inboundTunnel);
      const farEnd =
        ridden &&
        appliance(ridden.from === flow.applianceId ? ridden.to : ridden.from);
      if (!flow.srcIp && !flow.dstIp && !farEnd)
        bad(
          paths.fields,
          'leaves the flow with nothing to draw: it needs an endpoint IP or a tunnel to another appliance',
        );
    });

  const change = (c: unknown, path: string): void => {
    if (!isObj(c)) return bad(path, 'must be a change { kind, … }');
    const keys = own(CHANGE_KEYS, String(c.kind));
    if (keys) onlyKeys(c, keys, path, `a ${String(c.kind)} field`);
    switch (c.kind) {
      case 'set-tunnel': {
        const t = tunnel(c.tunnelId);
        if (!t)
          bad(`${path}.tunnelId`, `no tunnel ${quote(c.tunnelId)} in the base`);
        for (const end of t ? [t.from, t.to] : [])
          if (!appliance(end))
            bad(
              `${path}.tunnelId`,
              `tunnel ${quote(c.tunnelId)} is never drawn: its end ${quote(end)} is not an appliance in the base`,
            );
        if (checkPatch(c.set, TUNNEL, `${path}.set`) && t) applyPatch(t, c.set);
        return;
      }
      case 'set-appliance': {
        const a = appliance(c.applianceId);
        if (!a)
          bad(
            `${path}.applianceId`,
            `no appliance ${quote(c.applianceId)} in the base`,
          );
        if (checkPatch(c.set, APPLIANCE, `${path}.set`) && a)
          applyPatch(a, c.set);
        return;
      }
      case 'set-flow': {
        const f = findFlow(c.flow, `${path}.flow`);
        if (!checkPatch(c.set, FLOW, `${path}.set`) || !f) return;
        const next = structuredClone(f);
        applyPatch(next, c.set);
        const paths = { appliance: `${path}.flow`, fields: `${path}.set` };
        if (checkDrawable(next, paths)) applyPatch(f, c.set);
        return;
      }
      case 'add-flow': {
        const f = readFlow(c.flow, `${path}.flow`, true);
        const paths = {
          appliance: `${path}.flow.applianceId`,
          fields: `${path}.flow`,
        };
        if (!f || !checkDrawable(f, paths)) return;
        if (state.flows.some((x) => flowKey(x) === flowKey(f)))
          return bad(
            `${path}.flow`,
            `flow ${quote(f.id)} is already on appliance ${quote(f.applianceId)} at this step`,
          );
        state.flows.push(f);
        return;
      }
      case 'remove-flow': {
        const f = findFlow(c.flow, `${path}.flow`);
        if (f) state.flows.splice(state.flows.indexOf(f), 1);
        return;
      }
      default:
        bad(
          `${path}.kind`,
          `must be one of ${SCENARIO_CHANGE_KINDS.join(', ')} (got ${quote(c.kind)})`,
        );
    }
  };

  // ── the steps: check each change against the state it meets, then apply ──
  const states: FabricState[] = [structuredClone(state)];
  const steps = input.steps;
  if (!Array.isArray(steps) || steps.length === 0)
    bad('steps', 'needs at least one step: each step is one page');
  else
    steps.forEach((step: unknown, i) => {
      const path = `steps[${i}]`;
      at = { step: i };
      if (!isObj(step)) return bad(path, 'must be a step { name, changes }');
      if (isText(step.name)) at.stepName = step.name;
      onlyKeys(step, STEP_KEYS, path, 'a step field');
      if (!isText(step.name) || !fits(step.name, TEXT_LIMITS.name))
        bad(
          `${path}.name`,
          `is required: the page name, at most ${TEXT_LIMITS.name} characters`,
        );
      if (
        step.caption !== undefined &&
        !fits(step.caption, TEXT_LIMITS.caption)
      )
        bad(
          `${path}.caption`,
          `must be a string of at most ${TEXT_LIMITS.caption} characters`,
        );
      if (step.duration !== undefined && !isDuration(step.duration))
        bad(`${path}.duration`, 'must be a positive number of milliseconds');
      if (step.changes !== undefined && !Array.isArray(step.changes))
        bad(`${path}.changes`, 'must be an array of changes');
      else
        (step.changes ?? []).forEach((c: unknown, j: number) =>
          change(c, `${path}.changes[${j}]`),
        );
      states.push(structuredClone(state));
    });

  return { problems, states: problems.length ? [] : states };
}
