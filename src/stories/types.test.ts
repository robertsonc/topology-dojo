import { describe, it, expect } from 'vitest';
import { MockProvider } from '../connect/mock.js';
import type { FlowRecord } from '../connect/types.js';
import {
  SCENARIO_CHANGE_KINDS,
  ScenarioError,
  farEnd,
  formatScenarioProblem,
  scenarioStates,
  validateFlowScenario,
  type FlowScenario,
  type ScenarioChange,
} from './types.js';

/** Two branches, two hubs, a tunnel from each branch to each hub. */
const voip: FlowRecord = {
  id: 'f1',
  applianceId: 'br1',
  active: true,
  application: 'voip',
  srcIp: '10.1.0.5',
  dstIp: '10.0.0.80',
  outboundTunnel: 't-br1-hub1',
};

function scenario(steps: FlowScenario['steps']): FlowScenario {
  return {
    title: 'Branch 1 loses hub 1',
    system: 'synthetic',
    base: {
      appliances: [
        { id: 'hub1', hostname: 'hub-1', role: 'hub', reachable: true },
        { id: 'hub2', hostname: 'hub-2', role: 'hub' },
        { id: 'br1', hostname: 'branch-1', role: 'spoke', site: 'Lyon' },
        { id: 'br2', hostname: 'branch-2', role: 'spoke' },
      ],
      overlay: [
        { id: 't-br1-hub1', scope: 'overlay', from: 'br1', to: 'hub1' },
        { id: 't-br1-hub2', scope: 'overlay', from: 'br1', to: 'hub2' },
        { id: 't-br2-hub1', scope: 'overlay', from: 'br2', to: 'hub1' },
      ],
      underlay: [
        {
          id: 'u-br1-hub1',
          scope: 'underlay',
          from: 'br1',
          to: 'hub1',
          status: 'up',
          alias: 'br1-hub1_INET1',
        },
      ],
      flows: [voip],
    },
    steps,
  };
}

const ref = { applianceId: 'br1', flowId: 'f1' };

/** The two changes the contract exists for, and the rest of the vocabulary. */
const tunnelDown: ScenarioChange = {
  kind: 'set-tunnel',
  tunnelId: 't-br1-hub1',
  set: { status: 'down' },
};
const reroute: ScenarioChange = {
  kind: 'set-flow',
  flow: ref,
  set: { outboundTunnel: 't-br1-hub2' },
};
const story = scenario([
  { name: 'Normal' },
  { name: 'Tunnel down', changes: [tunnelDown] },
  { name: 'Reroute', changes: [reroute] },
  {
    name: 'Everything else',
    caption: 'The other kinds of change.',
    duration: 4000,
    changes: [
      { kind: 'set-tunnel', tunnelId: 't-br1-hub1', set: { status: 'up' } },
      { kind: 'set-appliance', applianceId: 'hub1', set: { reachable: false } },
      {
        kind: 'add-flow',
        flow: { ...voip, id: 'f2', applianceId: 'br2', srcIp: '10.2.0.9' },
      },
      { kind: 'set-flow', flow: ref, set: { active: false } },
      { kind: 'remove-flow', flow: ref },
    ],
  },
]);

describe('FlowScenario', () => {
  it('expresses a tunnel going down and a flow rerouting, and validates', () => {
    expect(validateFlowScenario(story)).toEqual([]);
    // Every kind of change is in the example above.
    const used = story.steps.flatMap((s) =>
      (s.changes ?? []).map((c) => c.kind),
    );
    expect([...new Set(used)].sort()).toEqual(
      [...SCENARIO_CHANGE_KINDS].sort(),
    );
  });

  it('rejects at compile time what the validator rejects at run time', () => {
    const changes: ScenarioChange[] = [
      // @ts-expect-error a tunnel's ends are its identity
      { kind: 'set-tunnel', tunnelId: 't-br1-hub1', set: { to: 'hub2' } },
      // @ts-expect-error a required field cannot be cleared
      { kind: 'set-appliance', applianceId: 'br1', set: { hostname: null } },
      // @ts-expect-error a flow's appliance is its identity
      { kind: 'set-flow', flow: ref, set: { applianceId: 'br2' } },
      // @ts-expect-error not a kind of change
      { kind: 'add-tunnel', tunnelId: 't-new' },
    ];
    const problems = validateFlowScenario(scenario([{ name: 'Bad', changes }]));
    expect(problems.map((p) => p.path)).toEqual([
      'steps[0].changes[0].set.to',
      'steps[0].changes[1].set.hostname',
      'steps[0].changes[2].set.applianceId',
      'steps[0].changes[3].kind',
    ]);
  });

  it('needs no provider: a provider snapshot is just one way to fill the base', async () => {
    const p = new MockProvider();
    const snapshot: FlowScenario = {
      system: p.describe().system,
      fetchedAt: '2026-06-11T07:00:00Z',
      base: {
        appliances: await p.getAppliances(),
        underlay: await p.getTunnels('underlay'),
        overlay: await p.getTunnels('overlay'),
        policies: await p.getOverlayPolicies(),
        flows: await p.getFlows({ includeEnded: true }),
      },
      steps: [
        { name: 'Now' },
        {
          name: 'Branch 77 loses its overlay',
          changes: [
            {
              kind: 'set-tunnel',
              tunnelId: 'bt_77_rt',
              set: { status: 'down' },
            },
          ],
        },
      ],
    };
    expect(validateFlowScenario(snapshot)).toEqual([]);
    // Only the appliances are required.
    expect(
      validateFlowScenario({
        system: 'x',
        base: { appliances: [{ id: 'a', hostname: 'a' }] },
        steps: [{ name: 'One' }],
      }),
    ).toEqual([]);
  });
});

describe('scenarioStates', () => {
  it('gives the base, then the fabric after each step', () => {
    const states = scenarioStates(story);
    expect(states).toHaveLength(story.steps.length + 1);
    const [base, normal, down, rerouted, rest] = states as [
      (typeof states)[0],
      (typeof states)[0],
      (typeof states)[0],
      (typeof states)[0],
      (typeof states)[0],
    ];
    const tunnel = (s: typeof base) =>
      s.overlay.find((t) => t.id === 't-br1-hub1')!;

    // A step with no changes is the state as it stands.
    expect(normal).toEqual(base);
    expect(tunnel(base).status).toBeUndefined();
    // "A tunnel goes down."
    expect(tunnel(down).status).toBe('down');
    expect(farEnd(down, down.flows[0]!)).toBe('hub1'); // not yet rerouted
    // "A flow reroutes": the same flow, another tunnel, another far end.
    expect(rerouted.flows).toHaveLength(1);
    expect(rerouted.flows[0]).toMatchObject({
      id: 'f1',
      outboundTunnel: 't-br1-hub2',
    });
    expect(farEnd(rerouted, rerouted.flows[0]!)).toBe('hub2');
    expect(tunnel(rerouted).status).toBe('down'); // a state carries forward
    // The rest: back up, appliance down, a flow added, the first one removed.
    expect(tunnel(rest).status).toBe('up');
    expect(rest.appliances.find((a) => a.id === 'hub1')!.reachable).toBe(false);
    expect(rest.flows.map((f) => f.id)).toEqual(['f2']);
  });

  it('applies changes in order, and `null` clears an optional field', () => {
    const [, after] = scenarioStates(
      scenario([
        {
          name: 'Patch',
          changes: [
            {
              kind: 'set-tunnel',
              tunnelId: 'u-br1-hub1',
              set: { status: 'down', alias: null },
            },
            {
              kind: 'set-tunnel',
              tunnelId: 'u-br1-hub1',
              set: { status: 'up' },
            },
            { kind: 'set-appliance', applianceId: 'br1', set: { site: null } },
          ],
        },
      ]),
    );
    const tunnel = after!.underlay[0]!;
    expect(tunnel.status).toBe('up');
    expect('alias' in tunnel).toBe(false);
    expect('site' in after!.appliances.find((a) => a.id === 'br1')!).toBe(
      false,
    );
  });

  it('returns independent copies and leaves the scenario untouched', () => {
    const input = structuredClone(story);
    const states = scenarioStates(input);
    expect(input).toEqual(story);
    // Rewriting one state reaches neither its neighbours nor the scenario.
    const before = structuredClone(states);
    states[2]!.appliances[0]!.hostname = 'scribbled';
    states[2]!.flows.length = 0;
    states[2]!.overlay[0]!.status = 'scribbled';
    expect(states[1]).toEqual(before[1]);
    expect(states[3]).toEqual(before[3]);
    expect(input).toEqual(story);
    // And the same scenario always steps to the same states.
    expect(scenarioStates(story)).toEqual(before);
  });

  it('throws a ScenarioError that lists every problem', () => {
    const bad = scenario([
      { name: 'Normal' },
      {
        name: 'Tunnel down',
        changes: [{ ...tunnelDown, tunnelId: 'nope' } as ScenarioChange],
      },
    ]);
    let thrown: unknown;
    try {
      scenarioStates(bad);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ScenarioError);
    expect((thrown as ScenarioError).problems).toHaveLength(1);
    expect((thrown as Error).message).toBe(
      'invalid flow scenario:\n' +
        '- step 2 "Tunnel down", steps[1].changes[0].tunnelId: no tunnel "nope" in the base',
    );
  });
});

describe('validateFlowScenario names the step and the field', () => {
  /** One broken change in step 2 ("Tunnel down") → its one problem. */
  const problemOf = (change: unknown) => {
    const problems = validateFlowScenario(
      scenario([
        { name: 'Normal' },
        { name: 'Tunnel down', changes: [change as ScenarioChange] },
      ]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ step: 1, stepName: 'Tunnel down' });
    return problems[0]!;
  };

  it.each<[string, unknown, string, RegExp]>([
    [
      'an unknown tunnel',
      { kind: 'set-tunnel', tunnelId: 't-nope', set: { status: 'down' } },
      'steps[1].changes[0].tunnelId',
      /no tunnel "t-nope" in the base/,
    ],
    [
      'a tunnel field that does not exist',
      { kind: 'set-tunnel', tunnelId: 't-br1-hub1', set: { staus: 'down' } },
      'steps[1].changes[0].set.staus',
      /is not a tunnel field \(alias, status, fromInterface, toInterface, overlay\)/,
    ],
    [
      "a tunnel's identity",
      { kind: 'set-tunnel', tunnelId: 't-br1-hub1', set: { to: 'hub2' } },
      'steps[1].changes[0].set.to',
      /cannot change: a tunnel between other appliances is another tunnel/,
    ],
    [
      'a wrong type',
      { kind: 'set-tunnel', tunnelId: 't-br1-hub1', set: { status: 0 } },
      'steps[1].changes[0].set.status',
      /must be a string or null \(got 0\)/,
    ],
    [
      'an empty patch',
      { kind: 'set-tunnel', tunnelId: 't-br1-hub1', set: {} },
      'steps[1].changes[0].set',
      /must set at least one tunnel field/,
    ],
    [
      'an unknown appliance',
      { kind: 'set-appliance', applianceId: 'br9', set: { reachable: false } },
      'steps[1].changes[0].applianceId',
      /no appliance "br9" in the base/,
    ],
    [
      'clearing a required field',
      { kind: 'set-appliance', applianceId: 'br1', set: { hostname: null } },
      'steps[1].changes[0].set.hostname',
      /is required and cannot be cleared/,
    ],
    [
      'a flow that is not there',
      {
        kind: 'set-flow',
        flow: { ...ref, flowId: 'f9' },
        set: { active: false },
      },
      'steps[1].changes[0].flow',
      /no flow "f9" on appliance "br1" at this step/,
    ],
    [
      'a reroute onto an unknown tunnel',
      { kind: 'set-flow', flow: ref, set: { outboundTunnel: 't-nope' } },
      'steps[1].changes[0].set.outboundTunnel',
      /no tunnel "t-nope" in the base/,
    ],
    [
      "a flow's identity",
      { kind: 'set-flow', flow: ref, set: { applianceId: 'br2' } },
      'steps[1].changes[0].set.applianceId',
      /cannot change: a flow is addressed by its appliance and id/,
    ],
    [
      'a flow added twice',
      { kind: 'add-flow', flow: voip },
      'steps[1].changes[0].flow',
      /flow "f1" is already on appliance "br1" at this step/,
    ],
    [
      'a flow added on an unknown appliance',
      { kind: 'add-flow', flow: { ...voip, id: 'f2', applianceId: 'br9' } },
      'steps[1].changes[0].flow.applianceId',
      /no appliance "br9" in the base, so the flow is never drawn/,
    ],
    [
      'a flow added without a required field',
      { kind: 'add-flow', flow: { id: 'f2', applianceId: 'br2' } },
      'steps[1].changes[0].flow.active',
      /is required/,
    ],
    [
      'a flow with nothing to draw',
      {
        kind: 'add-flow',
        flow: { id: 'f2', applianceId: 'br2', active: true },
      },
      'steps[1].changes[0].flow',
      /nothing to draw: it needs an endpoint IP or a tunnel to another appliance/,
    ],
    [
      'removing a flow that is not there',
      { kind: 'remove-flow', flow: { applianceId: 'br2', flowId: 'f1' } },
      'steps[1].changes[0].flow',
      /no flow "f1" on appliance "br2" at this step/,
    ],
    [
      'a kind that does not exist',
      { kind: 'add-tunnel', tunnel: {} },
      'steps[1].changes[0].kind',
      /must be one of set-tunnel, set-appliance, set-flow, add-flow, remove-flow \(got "add-tunnel"\)/,
    ],
    [
      'a kind that only looks like one',
      { kind: 'constructor' },
      'steps[1].changes[0].kind',
      /must be one of set-tunnel/,
    ],
    [
      'a patch field that only looks like one',
      { kind: 'set-tunnel', tunnelId: 't-br1-hub1', set: { constructor: 'x' } },
      'steps[1].changes[0].set.constructor',
      /is not a tunnel field/,
    ],
    [
      'a misspelt key on a flow a step adds',
      {
        kind: 'add-flow',
        flow: { ...voip, id: 'f2', outbountTunnel: 't-br1-hub2' },
      },
      'steps[1].changes[0].flow.outbountTunnel',
      /is not a flow field/,
    ],
    [
      'a misspelt key on a flow ref',
      { kind: 'remove-flow', flow: { ...ref, seqnum: 0 } },
      'steps[1].changes[0].flow.seqnum',
      /is not a flow ref field \(applianceId, flowId, seqNum\)/,
    ],
  ])('%s', (_what, change, path, message) => {
    const problem = problemOf(change);
    expect(problem.path).toBe(path);
    expect(problem.message).toMatch(message);
  });

  it('a misspelt key is a problem, and so is the key it should have been', () => {
    const problems = validateFlowScenario(
      scenario([
        { name: 'Normal' },
        {
          name: 'Tunnel down',
          changes: [
            {
              kind: 'set-tunnel',
              tunnelId: 't-br1-hub1',
              sett: { status: 'down' },
            } as never,
          ],
        },
      ]),
    );
    expect(problems.map(formatScenarioProblem)).toEqual([
      'step 2 "Tunnel down", steps[1].changes[0].sett: is not a set-tunnel field (kind, tunnelId, set)',
      'step 2 "Tunnel down", steps[1].changes[0].set: must set at least one tunnel field',
    ]);
  });

  it('checks each change against the state it meets, not against the base', () => {
    // Removed in step 2, so step 3 cannot reroute it.
    const problems = validateFlowScenario(
      scenario([
        { name: 'Normal' },
        { name: 'Call ends', changes: [{ kind: 'remove-flow', flow: ref }] },
        { name: 'Reroute', changes: [reroute] },
      ]),
    );
    expect(problems.map(formatScenarioProblem)).toEqual([
      'step 3 "Reroute", steps[2].changes[0].flow: no flow "f1" on appliance "br1" at this step',
    ]);
    // Added in step 2, so step 3 can.
    expect(
      validateFlowScenario(
        scenario([
          { name: 'Call ends', changes: [{ kind: 'remove-flow', flow: ref }] },
          { name: 'Call starts', changes: [{ kind: 'add-flow', flow: voip }] },
          { name: 'Reroute', changes: [reroute] },
        ]),
      ),
    ).toEqual([]);
  });

  it('reports the step itself: name, caption, duration, changes', () => {
    const problems = validateFlowScenario(
      scenario([
        { name: '' },
        { name: 'x'.repeat(201) },
        { name: 'Long', caption: 'x'.repeat(501) },
        { name: 'Held', duration: 0 },
        { name: 'Shape', changes: {} as never },
        // A misspelt `changes` would otherwise be a page where nothing happens.
        { name: 'Typo', change: [tunnelDown] } as never,
      ]),
    );
    expect(problems.map((p) => [p.step, p.path])).toEqual([
      [0, 'steps[0].name'],
      [1, 'steps[1].name'],
      [2, 'steps[2].caption'],
      [3, 'steps[3].duration'],
      [4, 'steps[4].changes'],
      [5, 'steps[5].change'],
    ]);
    expect(problems[2]!.stepName).toBe('Long');
    expect(formatScenarioProblem(problems[5]!)).toBe(
      'step 6 "Typo", steps[5].change: is not a step field (name, caption, changes, duration)',
    );
  });

  it('reports the base and the top level without a step', () => {
    const bad = {
      title: 7,
      base: {
        appliances: [
          { id: 'a', hostname: 'a' },
          { id: 'a', hostname: 'again' },
          { hostname: 'no id' },
          { id: 'b' },
        ],
        overlay: [
          { id: 't', from: 'a', to: 'b' },
          { id: 't', from: 'a', to: 'b' },
          { id: 'u', from: 'a' },
        ],
        flows: [
          { id: 'f', applianceId: 'a', active: true, srcIp: '10.0.0.1' },
          { id: 'f', applianceId: 'a', active: true, srcIp: '10.0.0.2' },
          { id: 'g', applianceId: 'a', active: 'yes' },
        ],
        policies: 'none',
        // The likeliest slip: a fabric drawn with no links at all.
        tunnels: [{ id: 'v', from: 'a', to: 'b' }],
      },
      steps: [],
      playback: { duration: -1, transition: 'wipe', loop: true },
      provider: 'edgeconnect',
    };
    const problems = validateFlowScenario(bad);
    expect(problems.every((p) => p.step === undefined)).toBe(true);
    expect(problems.map((p) => p.path)).toEqual([
      'provider',
      'system',
      'title',
      'playback.loop',
      'playback.duration',
      'playback.transition',
      'base.tunnels',
      'base.appliances[1].id',
      'base.appliances[2].id',
      'base.appliances[3].hostname',
      'base.overlay[1].id',
      'base.overlay[2].to',
      'base.policies',
      'base.flows[1]',
      'base.flows[2].active',
      'steps',
    ]);
    expect(problems.map(formatScenarioProblem)).toEqual(
      expect.arrayContaining([
        'base.tunnels: is not a base collection (appliances, underlay, overlay, policies, flows)',
        'base.appliances[1].id: duplicate appliance "a"',
      ]),
    );
    expect(validateFlowScenario(null).map(formatScenarioProblem)).toEqual([
      'scenario: a scenario is an object { system, base, steps }',
    ]);
  });

  it('takes anything and never throws', () => {
    const cycle: Record<string, unknown> = { system: 'x' };
    cycle.base = cycle;
    const withFunction = scenario([{ name: 'Normal' }]);
    (withFunction.base.appliances[0] as unknown as { f: unknown }).f = () => 1;
    const oddKind = scenario([
      { name: 'Odd', changes: [{ kind: Object.create(null) } as never] },
    ]);
    for (const input of [
      undefined,
      7,
      'scenario',
      [],
      () => story,
      cycle,
      withFunction,
      oddKind,
      { system: 1n, base: 2n, steps: 3n },
    ]) {
      const problems = validateFlowScenario(input);
      expect(problems.length).toBeGreaterThan(0);
      for (const p of problems) expect(typeof p.message).toBe('string');
    }
    expect(validateFlowScenario(oddKind).map(formatScenarioProblem)).toEqual([
      'step 1 "Odd", steps[0].changes[0].kind: must be one of set-tunnel, set-appliance, set-flow, add-flow, remove-flow (got {})',
    ]);
    // Not plain data at all: one problem, at the root.
    expect(validateFlowScenario(withFunction).map((p) => p.path)).toEqual(['']);
    expect(validateFlowScenario(withFunction)[0]!.message).toMatch(
      /^is not plain data: /,
    );
  });

  it('lets a live base carry what the flow compiler would skip, but not a step', () => {
    // A tunnel to an appliance the read did not return, and a flow on one:
    // the compiler draws neither, and a snapshot must not be rejected for it.
    const live = scenario([{ name: 'Now' }]);
    live.base.overlay!.push({
      id: 't-ghost',
      scope: 'overlay',
      from: 'br1',
      to: 'elsewhere',
    });
    live.base.flows!.push({
      id: 'f-ghost',
      applianceId: 'elsewhere',
      active: true,
    });
    expect(validateFlowScenario(live)).toEqual([]);
    // A step that changes either says something that can never be seen.
    live.steps.push({
      name: 'Ghosts',
      changes: [
        { kind: 'set-tunnel', tunnelId: 't-ghost', set: { status: 'down' } },
        {
          kind: 'set-flow',
          flow: { applianceId: 'elsewhere', flowId: 'f-ghost' },
          set: { active: false },
        },
      ],
    });
    expect(validateFlowScenario(live).map(formatScenarioProblem)).toEqual([
      'step 2 "Ghosts", steps[1].changes[0].tunnelId: tunnel "t-ghost" is never drawn: its end "elsewhere" is not an appliance in the base',
      'step 2 "Ghosts", steps[1].changes[1].flow: no appliance "elsewhere" in the base, so the flow is never drawn',
    ]);
  });
});
