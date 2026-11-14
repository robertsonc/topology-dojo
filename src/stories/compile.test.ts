import { describe, it, expect } from 'vitest';
import { analyzeLayout } from '../api/layout.js';
import { validateDocument } from '../api/validate.js';
import {
  compileFabric,
  compileFlow,
  compileFlowTopology,
  dedupeFlows,
} from '../connect/compile.js';
import {
  SYNTHETIC_SYSTEM,
  sdwanFabricRecords,
  type SdwanIntent,
} from '../connect/generate.js';
import { MockProvider } from '../connect/mock.js';
import type { FlowRecord } from '../connect/types.js';
import type { Page, TopologyDocument } from '../pages/model.js';
import { parseDoc, serializeDoc } from '../pages/persist.js';
import { STORY_EPOCH, compileFlowStory } from './compile.js';
import {
  ScenarioError,
  scenarioStates,
  type FabricState,
  type FlowScenario,
} from './types.js';

/* ── the worked example ─────────────────────────────────────────────────
 * The SD-WAN generator's fabric — three branches, two hubs, one overlay
 * tunnel from every branch to every hub — carrying one call from branch 1
 * through hub 1. The tunnel fails, the call moves to hub 2, the tunnel
 * comes back.
 */
const PRIMARY = 'ov:amer-br01:amer-hub01';
const BACKUP = 'ov:amer-br01:amer-hub02';
const CALL = { applianceId: 'amer-br01', flowId: 'voip-1' };

const FABRIC: SdwanIntent = {
  vendor: 'edgeconnect',
  detail: 'site',
  hubsPerRegion: 2,
  branchesPerRegion: 3,
};

function call(tunnel: string): FlowRecord {
  return {
    id: 'voip-1',
    applianceId: 'amer-br01',
    active: true,
    application: 'voip',
    protocol: 'udp',
    srcIp: '10.1.1.20',
    srcPort: 16384,
    dstIp: '10.0.0.80',
    dstPort: 16384,
    overlay: 'Default',
    outboundTunnel: tunnel,
  };
}

function workedExample(): FlowScenario {
  return {
    title: 'Branch 1 loses its primary hub',
    system: SYNTHETIC_SYSTEM,
    base: { ...sdwanFabricRecords(FABRIC), flows: [call(PRIMARY)] },
    steps: [
      { name: 'Normal' },
      {
        name: 'Tunnel down',
        changes: [
          { kind: 'set-tunnel', tunnelId: PRIMARY, set: { status: 'down' } },
        ],
      },
      {
        name: 'Reroute',
        changes: [
          { kind: 'set-flow', flow: CALL, set: { outboundTunnel: BACKUP } },
        ],
      },
      {
        name: 'Restored',
        changes: [
          { kind: 'set-tunnel', tunnelId: PRIMARY, set: { status: 'up' } },
          { kind: 'set-flow', flow: CALL, set: { outboundTunnel: PRIMARY } },
        ],
      },
    ],
  };
}

/** A second flow comes and goes, so the set of nodes changes page to page. */
function comeAndGo(): FlowScenario {
  const backup: FlowRecord = {
    id: 'backup',
    applianceId: 'amer-br02',
    active: true,
    application: 'backup',
    srcIp: '10.1.2.30',
    dstIp: '10.0.0.90',
    outboundTunnel: 'ov:amer-br02:amer-hub02',
  };
  return {
    system: SYNTHETIC_SYSTEM,
    base: { ...sdwanFabricRecords(FABRIC), flows: [call(PRIMARY)] },
    steps: [
      { name: 'Normal' },
      { name: 'Backup starts', changes: [{ kind: 'add-flow', flow: backup }] },
      { name: 'Call ends', changes: [{ kind: 'remove-flow', flow: CALL }] },
      {
        name: 'Backup ends',
        changes: [
          {
            kind: 'remove-flow',
            flow: { applianceId: 'amer-br02', flowId: 'backup' },
          },
        ],
      },
    ],
  };
}

/** Everything validation and the layout analyzer have to say. */
const problems = (doc: TopologyDocument) => [
  ...validateDocument(doc),
  ...analyzeLayout(doc),
];

/** A document holding one page of `doc` and nothing else of its pages. */
const alone = (doc: TopologyDocument, page: Page): TopologyDocument => ({
  ...doc,
  pages: [page],
});

/** Every object and array reachable from a value. */
function objectsIn(value: unknown, seen = new Set<object>()): Set<object> {
  if (typeof value !== 'object' || value === null || seen.has(value))
    return seen;
  seen.add(value);
  for (const child of Object.values(value)) objectsIn(child, seen);
  return seen;
}

/** How many of the nodes two pages share sit somewhere else on the second. */
function moved(a: Page, b: Page): { moved: number; shared: number } {
  const at = new Map(a.nodes.map((n) => [n.id, n]));
  const shared = b.nodes.filter((n) => at.has(n.id));
  return {
    shared: shared.length,
    moved: shared.filter((n) => {
      const was = at.get(n.id)!;
      return was.x !== n.x || was.y !== n.y;
    }).length,
  };
}

/** A step's state as the flow compiler draws it, with no story around it. */
function drawnByTheCompiler(state: FabricState, scenario: FlowScenario): Page {
  const opts = { system: scenario.system, fetchedAt: STORY_EPOCH };
  const doc = compileFabric(state, opts);
  for (const flow of dedupeFlows(state.flows))
    compileFlow(doc, flow, state, opts);
  return doc.pages[0]!;
}

describe('compileFlowStory', () => {
  it('makes one page per step, in order, named and captioned by the step', () => {
    const doc = compileFlowStory(workedExample());
    expect(doc.title).toBe('Branch 1 loses its primary hub');
    expect(doc.pages.map((p) => [p.id, p.name])).toEqual([
      ['story-1', 'Normal'],
      ['story-2', 'Tunnel down'],
      ['story-3', 'Reroute'],
      ['story-4', 'Restored'],
    ]);
    expect(doc.pages.map((p) => p.caption)).toEqual([
      '5 appliances, 7 tunnels (all up), 1 flow.',
      'Tunnel amer-br01-ec to amer-hub01-ec (Default) goes down.',
      'voip 10.1.1.20 to 10.0.0.80 reroutes via amer-hub02-ec.',
      'Tunnel amer-br01-ec to amer-hub01-ec (Default) comes back up. ' +
        'voip 10.1.1.20 to 10.0.0.80 reroutes via amer-hub01-ec.',
    ]);
    // The layers are declared once, on the document.
    expect(doc.layers?.map((l) => l.id)).toEqual([
      'underlay',
      'overlay',
      'policy',
    ]);
    // A step's own caption wins.
    const told = workedExample();
    told.steps[1]!.caption = 'The primary tunnel fails.';
    expect(compileFlowStory(told).pages[1]!.caption).toBe(
      'The primary tunnel fails.',
    );
  });

  it('draws each page as the flow compiler draws that state', () => {
    const scenario = workedExample();
    const doc = compileFlowStory(scenario);
    const states = scenarioStates(scenario).slice(1);
    doc.pages.forEach((page, i) => {
      const drawn = drawnByTheCompiler(states[i]!, scenario);
      // Same links and zones, to the last field; the same nodes and flow
      // paths; only where a node sits is the story's.
      expect(page.links).toEqual(drawn.links);
      expect(page.zones).toEqual(drawn.zones);
      expect(page.nodes.map((n) => n.id)).toEqual(drawn.nodes.map((n) => n.id));
      expect(page.nodes.map((n) => [n.type, n.label, n.source])).toEqual(
        drawn.nodes.map((n) => [n.type, n.label, n.source]),
      );
      expect(page.flowPaths.map((f) => [f.id, f.waypoints, f.hops])).toEqual(
        drawn.flowPaths.map((f) => [f.id, f.waypoints, f.hops]),
      );
    });
    // The state shows: red on the two pages where the tunnel is down, and
    // the call threaded through the hub it uses on each page.
    const link = (page: Page) =>
      page.links.find((l) => l.source?.id === PRIMARY)!;
    expect(doc.pages.map((p) => link(p).color)).toEqual([
      '#01a982',
      '#fc6161',
      '#fc6161',
      '#01a982',
    ]);
    expect(doc.pages.map((p) => p.flowPaths[0]!.waypoints[2])).toEqual([
      'ne_amer-hub01',
      'ne_amer-hub01',
      'ne_amer-hub02',
      'ne_amer-hub01',
    ]);
  });

  it('every page is valid and warning-free, together and on its own', () => {
    const doc = compileFlowStory(workedExample());
    expect(problems(doc)).toEqual([]);
    for (const page of doc.pages)
      expect(problems(alone(doc, page))).toEqual([]);
  });

  it('pages share nothing: one can be deleted or rewritten without the others noticing', () => {
    const scenario = workedExample();
    const doc = compileFlowStory(scenario);

    // No object or array is reachable from two pages — or from a page and
    // the scenario, or from a page and the document's layers.
    const owners = doc.pages.map((page) => objectsIn(page));
    owners.push(objectsIn(scenario), objectsIn(doc.layers));
    for (let a = 0; a < owners.length; a++)
      for (let b = a + 1; b < owners.length; b++)
        for (const object of owners[a]!)
          expect(owners[b]!.has(object), `owners ${a} and ${b}`).toBe(false);

    // Rewrite the "Tunnel down" page beyond recognition.
    const before = doc.pages.map((page) => JSON.stringify(page));
    const page = doc.pages[1]!;
    page.nodes.length = 1;
    page.nodes[0]!.x = Number.NaN;
    page.links.forEach((l) => (l.from = 'nowhere'));
    page.flowPaths[0]!.waypoints.length = 0;
    page.zones = [];
    page.emphasis = ['nothing'];
    expect(validateDocument(doc).some((p) => p.level === 'error')).toBe(true);
    for (const i of [0, 2, 3]) {
      expect(JSON.stringify(doc.pages[i])).toBe(before[i]);
      expect(problems(alone(doc, doc.pages[i]!))).toEqual([]);
    }
    // Delete it: what is left is still a clean document.
    doc.pages.splice(1, 1);
    expect(problems(doc)).toEqual([]);
    expect(doc.pages.map((p) => JSON.stringify(p))).toEqual([
      before[0],
      before[2],
      before[3],
    ]);
  });

  it('compiles the same scenario to the same document, byte for byte', () => {
    const scenario = workedExample();
    const untouched = structuredClone(scenario);
    const first = compileFlowStory(scenario);
    expect(scenario).toEqual(untouched);
    expect(JSON.stringify(compileFlowStory(scenario))).toBe(
      JSON.stringify(first),
    );
    expect(JSON.stringify(compileFlowStory(workedExample()))).toBe(
      JSON.stringify(first),
    );
    // No clock: the freshness stamp is the epoch unless the scenario has one.
    const stamps = (doc: TopologyDocument) => [
      ...new Set(
        doc.pages.flatMap((p) =>
          [...p.nodes, ...p.links, ...p.zones, ...p.flowPaths].map(
            (e) => e.source?.fetchedAt,
          ),
        ),
      ),
    ];
    expect(stamps(first)).toEqual([STORY_EPOCH]);
    expect(
      stamps(
        compileFlowStory({ ...scenario, fetchedAt: '2026-11-14T09:00:00Z' }),
      ),
    ).toEqual(['2026-11-14T09:00:00Z']);
  });

  it('is plain document contract: it survives the persistence round trip', () => {
    const doc = compileFlowStory(workedExample());
    // The parser collapses the double space the flow compiler puts in a
    // flow label; nothing else differs.
    const expected = structuredClone(doc);
    for (const page of expected.pages)
      for (const path of page.flowPaths)
        path.label = path.label?.replace(/ +/g, ' ');
    expect(parseDoc(serializeDoc(doc))).toEqual(expected);
  });

  it('carries nothing over from one page to the next', () => {
    // "Restored" is the same fabric state as "Normal", so it must be the
    // same drawing: no dimming left on the tunnel that was down.
    const doc = compileFlowStory(workedExample());
    const [normal, , , restored] = doc.pages as [Page, Page, Page, Page];
    expect(restored.links).toEqual(normal.links);
    expect(restored.nodes).toEqual(normal.nodes);
    expect(restored.zones).toEqual(normal.zones);
    expect(restored.flowPaths).toEqual(normal.flowPaths);
    expect(
      restored.links.find((l) => l.source?.id === PRIMARY)!.opacity,
    ).toBeUndefined();
    // A flow that has ended is not on the pages after it.
    const pages = compileFlowStory(comeAndGo()).pages;
    expect(pages.map((p) => p.flowPaths.map((f) => f.id))).toEqual([
      ['fp_amer-br01_voip-1'],
      ['fp_amer-br01_voip-1', 'fp_amer-br02_backup'],
      ['fp_amer-br02_backup'],
      [],
    ]);
    expect(pages.map((p) => p.nodes.length)).toEqual([7, 9, 7, 5]);
  });

  it('writes playback settings onto the pages', () => {
    const scenario = workedExample();
    expect(compileFlowStory(scenario).pages[0]).not.toHaveProperty('duration');
    scenario.playback = { duration: 3000, transition: 'fade' };
    scenario.steps[1]!.duration = 6000;
    const pages = compileFlowStory(scenario).pages;
    expect(pages.map((p) => p.duration)).toEqual([3000, 6000, 3000, 3000]);
    expect(pages.map((p) => p.transition)).toEqual(Array(4).fill('fade'));
  });

  it('refuses a scenario that does not validate, naming step and field', () => {
    const scenario = workedExample();
    scenario.steps[2]!.changes = [
      { kind: 'set-flow', flow: CALL, set: { outboundTunnel: 'ov:nowhere' } },
    ];
    expect(() => compileFlowStory(scenario)).toThrow(ScenarioError);
    expect(() => compileFlowStory(scenario)).toThrow(
      'step 3 "Reroute", steps[2].changes[0].set.outboundTunnel: no tunnel "ov:nowhere" in the base',
    );
  });
});

describe('position stability', () => {
  it('keeps every node where it is, on every page it is on', () => {
    for (const scenario of [workedExample(), comeAndGo()]) {
      const { pages } = compileFlowStory(scenario);
      expect(new Set(pages.map((p) => p.viewBox)).size).toBe(1);
      for (const a of pages)
        for (const b of pages) expect(moved(a, b).moved).toBe(0);
    }
    // Not vacuously: the pages do share nodes, and the set changes.
    const pages = compileFlowStory(comeAndGo()).pages;
    expect(pages.slice(1).map((p, i) => moved(pages[i]!, p).shared)).toEqual([
      7, 7, 5,
    ]);
  });

  it('which each step compiled and laid out on its own does not', () => {
    // The control: the one-shot compiler per state, each with its own
    // layout pass. Nodes move as the second flow's endpoints come and go.
    const scenario = comeAndGo();
    const opts = { system: scenario.system, fetchedAt: STORY_EPOCH };
    const pages = scenarioStates(scenario)
      .slice(1)
      .map((s) => compileFlowTopology(s, s.flows, opts).document.pages[0]!);
    const jumps = pages.slice(1).map((p, i) => moved(pages[i]!, p).moved);
    expect(jumps).toEqual([0, 2, 5]);
  });
});

describe('the frame fits other fabrics too', () => {
  /** A fabric with two flows from its first tunnel's branch, one rerouted. */
  function storyOn(intent: SdwanIntent): TopologyDocument {
    const fabric = sdwanFabricRecords(intent);
    const tunnels = [...fabric.overlay, ...fabric.underlay];
    const first = tunnels[0]!;
    const other =
      tunnels.find((t) => t.from === first.from && t.to !== first.to) ?? first;
    const flow = (id: string, host: number): FlowRecord => ({
      id,
      applianceId: first.from,
      active: true,
      application: id,
      srcIp: `10.1.1.${host}`,
      dstIp: `10.0.0.${host}`,
      outboundTunnel: first.id,
    });
    return compileFlowStory({
      system: SYNTHETIC_SYSTEM,
      base: { ...fabric, flows: [flow('voip', 20), flow('web', 21)] },
      steps: [
        { name: 'Normal' },
        {
          name: 'Down',
          changes: [
            { kind: 'set-tunnel', tunnelId: first.id, set: { status: 'down' } },
          ],
        },
        {
          name: 'Reroute',
          changes: [
            {
              kind: 'set-flow',
              flow: { applianceId: first.from, flowId: 'voip' },
              set: { outboundTunnel: other.id },
            },
          ],
        },
      ],
    });
  }

  it.each<[string, SdwanIntent]>([
    [
      'one hub, one branch',
      { vendor: 'edgeconnect', hubsPerRegion: 1, branchesPerRegion: 1 },
    ],
    [
      'underlay and overlay',
      { vendor: 'edgeconnect', transports: ['inet', 'mpls'] },
    ],
    [
      'HA branch pairs',
      { vendor: 'edgeconnect', branchHa: true, branchesPerRegion: 2 },
    ],
    [
      'an SRX chassis cluster',
      { vendor: 'juniper', branchHa: true, transports: ['inet', 'lte'] },
    ],
    ['two regions', { vendor: 'edgeconnect', detail: 'site', regions: 2 }],
    [
      'a cloud hub',
      { vendor: 'juniper', cloudHub: 'aws', branchesPerRegion: 2 },
    ],
    [
      'twelve branches',
      { vendor: 'edgeconnect', detail: 'site', branchesPerRegion: 12 },
    ],
  ])('%s: no validation or layout problem on any page', (_name, intent) => {
    const doc = storyOn(intent);
    expect(doc.pages).toHaveLength(3);
    expect(problems(doc)).toEqual([]);
  });

  it('a provider snapshot, with a site of two and no roles to go by', async () => {
    const p = new MockProvider();
    const appliances = await p.getAppliances();
    const snapshot: FlowScenario = {
      system: p.describe().system,
      fetchedAt: '2026-06-11T07:00:00Z',
      base: {
        appliances,
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
    const doc = compileFlowStory(snapshot);
    expect(problems(doc)).toEqual([]);
    // Per-appliance views of one conversation collapse, as in the one-shot.
    expect(doc.pages[0]!.flowPaths).toHaveLength(2);

    // The same fabric as a mesh: no hub role, two appliances in one site.
    for (const a of appliances) delete a.role;
    appliances[2]!.site = appliances[1]!.site;
    const mesh = compileFlowStory(snapshot);
    expect(problems(mesh)).toEqual([]);
    expect(mesh.pages[0]!.zones.map((z) => z.nodes.length).sort()).toEqual([
      1, 2,
    ]);
  });
});
