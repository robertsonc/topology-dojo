import { describe, it, expect } from 'vitest';
import { analyzeLayout } from '../api/layout.js';
import { POLICY_MARKER_TYPES } from '../api/markers.js';
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
import { renderDocumentToSVG } from '../server/render.js';
import { STORY_EPOCH, compileFlowStory } from './compile.js';
import {
  ScenarioError,
  scenarioStates,
  validateFlowScenario,
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

  it('a three-step scenario — before, during, after — gives three pages', () => {
    const scenario = workedExample();
    scenario.steps.length = 3;
    const doc = compileFlowStory(scenario);
    expect(doc.pages.map((p) => p.name)).toEqual([
      'Normal',
      'Tunnel down',
      'Reroute',
    ]);
    for (const page of doc.pages)
      expect(problems(alone(doc, page))).toEqual([]);
    // The smallest story there is: one appliance, one step, one page.
    const one = compileFlowStory({
      system: 'lab',
      base: { appliances: [{ id: 'a', hostname: 'alone' }] },
      steps: [{ name: 'Only' }],
    });
    expect(one.title).toBe('Flow story');
    expect(one.pages).toHaveLength(1);
    expect(one.pages[0]).toMatchObject({
      id: 'story-1',
      name: 'Only',
      viewBox: '0 0 1050 700',
      caption: '1 appliance, 0 tunnels (all up), 0 flows.',
    });
    expect(problems(one)).toEqual([]);
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

/* ── Packet T3: what changed, readable from the page alone ───────────── */

describe('failure-moment annotations', () => {
  const DOWN = '#fc6161';
  const AMBER = '#e0a44a';
  const GREEN = '#01a982';
  const downMarker = {
    id: 'story_down_ne_amer-br01',
    nodeId: 'ne_amer-br01',
    type: 'deny',
    label: 'Tunnel down',
    color: DOWN,
    align: 'NW',
  };
  const primaryLink = 'lk_ov_amer-br01_amer-hub01';
  const backupLink = 'lk_ov_amer-br01_amer-hub02';
  const callPath = 'fp_amer-br01_voip-1';
  const callHosts = ['host_10_1_1_20', 'host_10_0_0_80'];

  it('the worked example: each step shows what it changed', () => {
    const [normal, down, reroute, restored] = compileFlowStory(workedExample())
      .pages as [Page, Page, Page, Page];

    // Normal — nothing to point at: no spotlight, no marker, the call runs.
    expect(normal.emphasis).toBeUndefined();
    expect(normal.policyMarkers).toEqual([]);
    expect(normal.flowPaths[0]).toMatchObject({
      color: GREEN,
      animation: 'particles',
    });

    // Tunnel down — the link is red (the flow compiler's doing), a ✕ sits
    // on the appliance it leaves from, the call on it is drawn stopped in
    // the same red, and the tunnel, its ends and the call's endpoints are
    // the spotlight.
    expect(down.links.find((l) => l.id === primaryLink)!.color).toBe(DOWN);
    expect(down.policyMarkers).toEqual([downMarker]);
    expect(down.flowPaths[0]).toMatchObject({
      color: DOWN,
      animation: 'dashed',
    });
    expect(down.emphasis).toEqual([
      'ne_amer-hub01',
      'ne_amer-br01',
      ...callHosts,
      primaryLink,
    ]);

    // Reroute — the call runs again, through hub 2, and hub 2 carries the
    // ↪ tied to the call's path. The tunnel is still down, so still marked.
    // The path it left and the path it took are both in the spotlight.
    expect(reroute.flowPaths[0]).toMatchObject({
      color: GREEN,
      animation: 'particles',
    });
    expect(reroute.policyMarkers).toEqual([
      downMarker,
      {
        id: 'story_reroute_ne_amer-hub02',
        nodeId: 'ne_amer-hub02',
        type: 'redirect',
        label: 'Rerouted here',
        color: AMBER,
        flowPathId: callPath,
        align: 'NE',
      },
    ]);
    expect(reroute.emphasis).toEqual([
      'ne_amer-hub01',
      'ne_amer-hub02',
      'ne_amer-br01',
      ...callHosts,
      primaryLink,
      backupLink,
    ]);

    // Restored — the ✕ is gone with the failure; the ↪ is on hub 1, where
    // the call went back to.
    expect(restored.links.find((l) => l.id === primaryLink)!.color).toBe(GREEN);
    expect(restored.policyMarkers).toEqual([
      {
        id: 'story_reroute_ne_amer-hub01',
        nodeId: 'ne_amer-hub01',
        type: 'redirect',
        label: 'Rerouted here',
        color: AMBER,
        flowPathId: callPath,
        align: 'NE',
      },
    ]);
    expect(restored.emphasis).toEqual(reroute.emphasis);
  });

  it('a step that changes something always has a spotlight and a caption; one that does not has no spotlight', () => {
    for (const scenario of [workedExample(), comeAndGo()]) {
      const { pages } = compileFlowStory(scenario);
      scenario.steps.forEach((step, i) => {
        const page = pages[i]!;
        expect(page.caption).toBeTruthy();
        if (step.changes?.length) expect(page.emphasis).not.toHaveLength(0);
        else expect(page).not.toHaveProperty('emphasis');
      });
    }
  });

  it('points only at what is on its own page', () => {
    for (const scenario of [workedExample(), comeAndGo()])
      for (const page of compileFlowStory(scenario).pages) {
        const nodes = new Set(page.nodes.map((n) => n.id));
        const spotlightable = new Set([
          ...nodes,
          ...page.links.map((l) => l.id),
        ]);
        const paths = new Set(page.flowPaths.map((f) => f.id));
        for (const id of page.emphasis ?? [])
          expect(spotlightable.has(id), `${page.name}: ${id}`).toBe(true);
        for (const marker of page.policyMarkers) {
          expect(nodes.has(marker.nodeId), marker.id).toBe(true);
          if (marker.flowPathId)
            expect(paths.has(marker.flowPathId), marker.id).toBe(true);
        }
      }
  });

  it('adds no marker type: deny and redirect are in the catalog already', () => {
    const types = compileFlowStory(workedExample()).pages.flatMap((p) =>
      p.policyMarkers.map((m) => m.type),
    );
    expect([...new Set(types)].sort()).toEqual(['deny', 'redirect']);
    for (const type of types) expect(POLICY_MARKER_TYPES).toContain(type);
  });

  it('a flow that starts or ends is spotlighted where it runs, or ran', () => {
    const [, starts, callEnds] = compileFlowStory(comeAndGo()).pages as [
      Page,
      Page,
      Page,
    ];
    expect(starts.emphasis).toEqual([
      'ne_amer-hub02',
      'ne_amer-br02',
      'host_10_1_2_30',
      'host_10_0_0_90',
      'lk_ov_amer-br02_amer-hub02',
    ]);
    // The call's endpoints left the page with it; its appliances and its
    // tunnel are what is left to point at.
    expect(callEnds.emphasis).toEqual([
      'ne_amer-hub01',
      'ne_amer-br01',
      primaryLink,
    ]);
    expect(callEnds.caption).toBe('voip 10.1.1.20 to 10.0.0.80 ends.');
  });

  it('an appliance that goes down: its LED, the flows through it, the spotlight', () => {
    const scenario = workedExample();
    scenario.steps = [
      { name: 'Normal' },
      {
        name: 'Hub 1 down',
        changes: [
          {
            kind: 'set-appliance',
            applianceId: 'amer-hub01',
            set: { reachable: false },
          },
        ],
      },
      {
        name: 'Hub 1 back',
        changes: [
          {
            kind: 'set-appliance',
            applianceId: 'amer-hub01',
            set: { reachable: true },
          },
        ],
      },
    ];
    const [normal, down, back] = compileFlowStory(scenario).pages as [
      Page,
      Page,
      Page,
    ];
    const hub = (page: Page) =>
      page.nodes.find((n) => n.id === 'ne_amer-hub01')!;
    // The generator says nothing about reachability, so no LED to start with.
    expect(hub(normal).status).toBeUndefined();
    expect(hub(down).status).toBe('down');
    expect(hub(back).status).toBe('ok');
    // The call runs through the dead hub, so it is drawn stopped.
    expect(down.flowPaths[0]).toMatchObject({
      color: DOWN,
      animation: 'dashed',
    });
    expect(back.flowPaths[0]).toMatchObject({ color: GREEN });
    expect(down.emphasis).toEqual([
      'ne_amer-hub01',
      'ne_amer-br01',
      ...callHosts,
      primaryLink,
    ]);
    expect(down.caption).toBe('amer-hub01-ec goes down.');
    expect(back.caption).toBe('amer-hub01-ec comes back.');
  });

  it('counts per appliance instead of piling markers up', () => {
    const scenario = workedExample();
    const second: FlowRecord = {
      ...call('ov:amer-br02:amer-hub01'),
      id: 'web-1',
      applianceId: 'amer-br02',
      srcIp: '10.1.2.20',
    };
    scenario.steps = [
      { name: 'Normal', changes: [{ kind: 'add-flow', flow: second }] },
      {
        name: 'Hub 1 unreachable from two branches',
        changes: [
          { kind: 'set-tunnel', tunnelId: PRIMARY, set: { status: 'down' } },
          {
            kind: 'set-tunnel',
            tunnelId: 'ov:amer-br02:amer-hub01',
            set: { status: 'down' },
          },
          { kind: 'set-tunnel', tunnelId: BACKUP, set: { status: 'down' } },
        ],
      },
      {
        name: 'Both reroute',
        changes: [
          { kind: 'set-tunnel', tunnelId: BACKUP, set: { status: 'up' } },
          { kind: 'set-flow', flow: CALL, set: { outboundTunnel: BACKUP } },
          {
            kind: 'set-flow',
            flow: { applianceId: 'amer-br02', flowId: 'web-1' },
            set: { outboundTunnel: 'ov:amer-br02:amer-hub02' },
          },
        ],
      },
    ];
    const doc = compileFlowStory(scenario);
    const labels = (page: Page) =>
      page.policyMarkers.map((m) => [m.nodeId, m.type, m.label]);
    expect(labels(doc.pages[1]!)).toEqual([
      ['ne_amer-br01', 'deny', '2 tunnels down'],
      ['ne_amer-br02', 'deny', 'Tunnel down'],
    ]);
    expect(labels(doc.pages[2]!)).toEqual([
      ['ne_amer-br01', 'deny', 'Tunnel down'],
      ['ne_amer-br02', 'deny', 'Tunnel down'],
      ['ne_amer-hub02', 'redirect', '2 flows rerouted here'],
    ]);
    // One marker cannot name two flow paths, so this one names none.
    expect(doc.pages[2]!.policyMarkers[2]).not.toHaveProperty('flowPathId');
    expect(problems(doc)).toEqual([]);
  });

  it('a flow that changes tunnel but not hub is rerouted too', () => {
    const fabric = sdwanFabricRecords({
      vendor: 'edgeconnect',
      hubsPerRegion: 1,
      branchesPerRegion: 1,
      transports: ['inet', 'mpls'],
    });
    const inet = 'ul:amer-br01:amer-hub01:INET1';
    const mpls = 'ul:amer-br01:amer-hub01:MPLS1';
    const doc = compileFlowStory({
      system: SYNTHETIC_SYSTEM,
      base: { ...fabric, flows: [call(inet)] },
      steps: [
        { name: 'On Internet' },
        {
          name: 'Onto MPLS',
          changes: [
            { kind: 'set-flow', flow: CALL, set: { outboundTunnel: mpls } },
          ],
        },
      ],
    });
    const page = doc.pages[1]!;
    expect(page.caption).toBe(
      'voip 10.1.1.20 to 10.0.0.80 moves to another tunnel to amer-hub01-ec.',
    );
    expect(page.policyMarkers).toMatchObject([
      { nodeId: 'ne_amer-hub01', type: 'redirect', label: 'Rerouted here' },
    ]);
    expect(page.emphasis).toEqual(
      expect.arrayContaining([
        'lk_ul_amer-br01_amer-hub01_INET1',
        'lk_ul_amer-br01_amer-hub01_MPLS1',
      ]),
    );
  });

  it('a first step that already changes something is marked against the base', () => {
    const scenario = workedExample();
    scenario.steps = [scenario.steps[1]!]; // "Tunnel down", with no "Normal"
    const [page] = compileFlowStory(scenario).pages;
    expect(page!.policyMarkers).toEqual([downMarker]);
    expect(page!.emphasis).toContain(primaryLink);
    expect(page!.caption).toBe(
      'Tunnel amer-br01-ec to amer-hub01-ec (Default) goes down.',
    );
  });

  it('a flow changed and removed in the same step still compiles', () => {
    const scenario = workedExample();
    const web = { ...call(BACKUP), id: 'web-1', srcIp: '10.1.1.21' };
    scenario.steps = [
      { name: 'Normal' },
      {
        name: 'Churn',
        changes: [
          { kind: 'set-flow', flow: CALL, set: { outboundTunnel: BACKUP } },
          { kind: 'remove-flow', flow: CALL },
          { kind: 'add-flow', flow: web },
          {
            kind: 'set-flow',
            flow: { applianceId: 'amer-br01', flowId: 'web-1' },
            set: { outboundTunnel: PRIMARY },
          },
          {
            kind: 'remove-flow',
            flow: { applianceId: 'amer-br01', flowId: 'web-1' },
          },
        ],
      },
    ];
    const doc = compileFlowStory(scenario);
    expect(doc.pages[1]!.flowPaths).toEqual([]);
    expect(doc.pages[1]!.caption).toBe(
      'voip 10.1.1.20 to 10.0.0.80 changes. ' +
        'voip 10.1.1.20 to 10.0.0.80 ends. ' +
        'voip 10.1.1.21 to 10.0.0.80 starts, via amer-hub02-ec. ' +
        'A flow changes. ' +
        'A flow ends.',
    );
    expect(problems(doc)).toEqual([]);
  });

  it('reaches the picture: every page renders, and the failure is drawn', () => {
    const doc = compileFlowStory(workedExample());
    const svgs = doc.pages.map((_, i) =>
      renderDocumentToSVG(doc, i, { profile: 'clean', theme: 'light' }),
    );
    for (const svg of svgs) expect(svg).toContain('data-tds-flowpath=');
    const marker = (id: string) => `data-tds-marker="${id}"`;
    expect(svgs[0]).not.toContain('data-tds-marker=');
    expect(svgs[1]).toContain(marker('story_down_ne_amer-br01'));
    expect(svgs[2]).toContain(marker('story_down_ne_amer-br01'));
    expect(svgs[2]).toContain(marker('story_reroute_ne_amer-hub02'));
    expect(svgs[3]).toContain(marker('story_reroute_ne_amer-hub01'));
    expect(svgs[3]).not.toContain(marker('story_down_ne_amer-br01'));
    // The down colour is on the page only while the tunnel is down (the
    // engine's own colours, so the default theme).
    const dark = doc.pages.map((_, i) =>
      renderDocumentToSVG(doc, i, { profile: 'clean' }),
    );
    expect(dark.map((svg) => svg.includes(DOWN))).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});

/* ── any scenario ───────────────────────────────────────────────────────
 * Seeded random scenarios over random generator fabrics. Whatever the
 * steps do, the story must compile, every page must be clean and
 * self-contained, and no node may move.
 */
describe('any valid scenario', () => {
  /** A small deterministic generator, so a failure can be replayed. */
  function random(seed: number) {
    let state = seed;
    const next = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    return {
      chance: (p: number): boolean => next() < p,
      pick: <T>(items: readonly T[]): T =>
        items[Math.floor(next() * items.length)]!,
      upTo: (n: number): number => Math.floor(next() * (n + 1)),
    };
  }

  function randomScenario(seed: number): FlowScenario {
    const r = random(seed);
    const fabric = sdwanFabricRecords({
      vendor: r.pick(['edgeconnect', 'juniper']),
      detail: r.pick(['site', 'device']),
      regions: r.pick([1, 1, 2]),
      hubsPerRegion: r.pick([1, 2]),
      branchesPerRegion: r.pick([1, 2, 3, 5]),
      branchHa: r.chance(0.3),
      transports: r.pick([['inet'], ['inet', 'mpls'], ['inet', 'lte']]),
    });
    for (const appliance of fabric.appliances)
      if (r.chance(0.3)) appliance.reachable = r.chance(0.8);
    const tunnels = [...fabric.overlay, ...fabric.underlay];
    const ips = ['10.0.0.1', '10.0.0.2', '10.1.1.1', '10.1.1.2', '172.16.9.9'];
    let made = 0;
    const flow = (): FlowRecord => {
      const tunnel = r.pick(tunnels);
      return {
        id: `f${made++}`,
        applianceId: r.chance(0.8) ? tunnel.from : tunnel.to,
        active: r.chance(0.8),
        application: r.pick(['voip', 'web', 'backup']),
        srcIp: r.pick(ips),
        srcPort: 1000 + made, // one conversation each: never deduped
        ...(r.chance(0.8) ? { dstIp: r.pick(ips) } : {}),
        ...(r.chance(0.8)
          ? r.chance(0.8)
            ? { outboundTunnel: tunnel.id }
            : { inboundTunnel: tunnel.id }
          : {}),
      };
    };
    const live = Array.from({ length: r.upTo(3) }, flow);
    const scenario: FlowScenario = {
      system: SYNTHETIC_SYSTEM,
      base: { ...fabric, flows: structuredClone(live) },
      steps: [],
    };
    for (let step = 0; step <= r.upTo(4); step++) {
      const changes: NonNullable<FlowScenario['steps'][number]['changes']> = [];
      for (let change = r.upTo(3); change > 0; change--) {
        const subject = live.length ? r.pick(live) : undefined;
        const ref = subject && {
          applianceId: subject.applianceId,
          flowId: subject.id,
        };
        const kind = r.pick([
          'set-tunnel',
          'set-tunnel',
          'set-appliance',
          'add-flow',
          'remove-flow',
          'set-flow',
          'set-flow',
        ] as const);
        if (kind === 'set-tunnel')
          changes.push({
            kind,
            tunnelId: r.pick(tunnels).id,
            set: { status: r.pick(['down', 'up', 'degraded']) },
          });
        else if (kind === 'set-appliance')
          changes.push({
            kind,
            applianceId: r.pick(fabric.appliances).id,
            set: { reachable: r.chance(0.5) },
          });
        else if (kind === 'add-flow') {
          live.push(flow());
          changes.push({ kind, flow: structuredClone(live.at(-1)!) });
        } else if (kind === 'remove-flow' && ref) {
          live.splice(live.indexOf(subject), 1);
          changes.push({ kind, flow: ref });
        } else if (kind === 'set-flow' && ref) {
          const other = tunnels.filter(
            (t) =>
              t.from === subject.applianceId || t.to === subject.applianceId,
          );
          changes.push({
            kind,
            flow: ref,
            set: { outboundTunnel: r.pick(other).id },
          });
        }
      }
      scenario.steps.push({ name: `Step ${step + 1}`, changes });
    }
    return scenario;
  }

  it('compiles to clean, still, self-contained pages — 60 seeded scenarios', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const scenario = randomScenario(seed);
      const at = `seed ${seed}`;
      expect(validateFlowScenario(scenario), at).toEqual([]);
      const doc = compileFlowStory(scenario);
      expect(doc.pages, at).toHaveLength(scenario.steps.length);
      expect(problems(doc), at).toEqual([]);
      for (const a of doc.pages)
        for (const b of doc.pages) expect(moved(a, b).moved, at).toBe(0);
      const owners = doc.pages.map((page) => objectsIn(page));
      for (let a = 0; a < owners.length; a++)
        for (let b = a + 1; b < owners.length; b++)
          for (const object of owners[a]!)
            expect(owners[b]!.has(object), at).toBe(false);
      expect(JSON.stringify(compileFlowStory(scenario)), at).toBe(
        JSON.stringify(doc),
      );
    }
  });
});
