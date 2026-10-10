/**
 * Visual-quality inspection (inspect_render's engine). Each defect class the
 * report covers is provoked in isolation, plus one deliberately bad dense page
 * showing the text-clipping + routing findings that validate_topology's
 * semantic/layout checks alone would not communicate.
 */
import { describe, it, expect } from 'vitest';
import { inspectPage, type InspectReport } from './inspect.js';
import type { Page } from '../pages/model.js';
import type { NodeConfig, LinkConfig } from '../vendor/topology-ds.js';
import { validateDocument } from '../api/validate.js';

function page(partial: Partial<Page>): Page {
  return {
    id: 'p',
    name: 'Frame 1',
    viewBox: '0 0 1050 700',
    nodes: [],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
    ...partial,
  };
}

function node(id: string, x: number, y: number, label?: string): NodeConfig {
  return { id, type: 'ec', x, y, ...(label !== undefined ? { label } : {}) };
}

function link(id: string, from: string, to: string): LinkConfig {
  return { id, type: 'line', from, to };
}

const messages = (r: InspectReport): string =>
  r.findings.map((f) => f.message).join('\n');

describe('inspectPage', () => {
  it('reports a clean page as clean with no findings', () => {
    // Two well-spaced, well-labeled nodes centred on the page.
    const r = inspectPage(
      page({
        nodes: [node('a', 400, 350, 'EC-A'), node('b', 660, 350, 'EC-B')],
        links: [link('l1', 'a', 'b')],
      }),
    );
    expect(r.clean).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.omitted).toBe(0);
    expect(r.contentBounds).not.toBeNull();
    expect(r.margins!.left).toBeGreaterThan(0);
  });

  it('flags a node outside the viewBox as a crop problem with the overhang', () => {
    const r = inspectPage(page({ nodes: [node('far', 1200, 350, 'Far')] }));
    expect(r.clean).toBe(false);
    const f = r.findings.find(
      (x) => x.category === 'crop' && x.severity === 'problem',
    );
    expect(f).toBeDefined();
    expect(f!.message).toContain('"far"');
    expect(f!.message).toMatch(/~\d+px past the right page edge/);
  });

  it('flags a long label that collides with a neighbouring node', () => {
    // 22-char label ≈ 132px wide collides with the node 90px to the right.
    const r = inspectPage(
      page({
        nodes: [
          node('er2', 400, 350, 'edge-router-fallback-2'),
          node('er3', 490, 380),
        ],
      }),
    );
    const f = r.findings.find(
      (x) =>
        x.category === 'text' &&
        x.severity === 'problem' &&
        /collides with node "er3"/.test(x.message),
    );
    expect(f).toBeDefined();
    expect(f!.message).toContain('edge-router-fallback-2');
    expect(f!.message).toMatch(/~\d+px overlap/);
  });

  it('notes labels the renderer will truncate at 24 chars', () => {
    const r = inspectPage(
      page({
        nodes: [node('n', 500, 350, 'an-extremely-long-node-label-name')],
      }),
    );
    expect(messages(r)).toMatch(/truncates it to 24/);
  });

  it('flags overlapping nodes as a density problem', () => {
    const r = inspectPage(
      page({ nodes: [node('a', 400, 350), node('b', 410, 352)] }),
    );
    const f = r.findings.find(
      (x) => x.category === 'density' && x.severity === 'problem',
    );
    expect(f).toBeDefined();
    expect(f!.message).toMatch(/nodes "a" and "b" overlap/);
  });

  it('flags crossing links as a routing problem', () => {
    // An X: a→d and c→b cross mid-page; sharing-endpoint links never count.
    const r = inspectPage(
      page({
        nodes: [
          node('a', 300, 200),
          node('b', 700, 200),
          node('c', 300, 500),
          node('d', 700, 500),
        ],
        links: [link('l1', 'a', 'd'), link('l2', 'c', 'b')],
      }),
    );
    const f = r.findings.find(
      (x) => x.category === 'routing' && x.severity === 'problem',
    );
    expect(f).toBeDefined();
    expect(f!.message).toMatch(/links "l1" and "l2" cross/);
  });

  it('flags a link drawn through an unrelated node', () => {
    const r = inspectPage(
      page({
        nodes: [
          node('a', 300, 350),
          node('mid', 500, 350),
          node('b', 700, 350),
        ],
        links: [link('l1', 'a', 'b')],
      }),
    );
    expect(messages(r)).toMatch(
      /link "l1" passes through unrelated node "mid"/,
    );
  });

  it('flags degenerate flow-path geometry', () => {
    const r = inspectPage(
      page({
        nodes: [node('a', 300, 350), node('b', 700, 350)],
        links: [link('l1', 'a', 'b')],
        flowPaths: [
          {
            id: 'fp',
            waypoints: ['a', 'a', 'b', 'a'],
            color: '#01a982',
          },
        ],
      }),
    );
    expect(messages(r)).toMatch(/flow path "fp" repeats waypoint "a"/);
    expect(messages(r)).toMatch(/doubles back over "b"/);
  });

  it('flags a zone label overlapped by a node drawn on top of it', () => {
    // A non-member node parked on the zone's top-left corner sits on the label.
    const r = inspectPage(
      page({
        nodes: [node('m', 500, 350, 'Member'), node('intruder', 430, 285)],
        zones: [{ id: 'z1', label: 'Branch', nodes: ['m'] }],
      }),
    );
    expect(messages(r)).toMatch(/label of zone "z1" is overlapped by node/);
  });

  it('caps findings per category but keeps true totals', () => {
    // A pile of 12 coincident nodes → dozens of overlap problems.
    const nodes = Array.from({ length: 12 }, (_, i) =>
      node(`n${i}`, 500 + i, 350),
    );
    const r = inspectPage(page({ nodes }), { maxPerCategory: 3 });
    expect(r.findings.filter((f) => f.category === 'density').length).toBe(3);
    expect(r.counts.density.problems).toBeGreaterThan(3);
    expect(r.omitted).toBeGreaterThan(0);
  });

  it('surfaces text clipping + bad routing on a dense page that validate misses', () => {
    // Deliberately bad but SEMANTICALLY valid: every reference resolves, yet
    // the long labels collide between the columns and the diagonal links cross
    // — the visual defects validate_topology's messages never mention.
    const dense = page({
      nodes: [
        node('core1', 320, 300, 'core-aggregation-router-1'),
        node('core2', 440, 300, 'core-aggregation-router-2'),
        node('edge1', 320, 420, 'edge-firewall-cluster-a'),
        node('edge2', 440, 420, 'edge-firewall-cluster-b'),
        node('svc', 380, 420, 'svc'),
      ],
      links: [
        link('x1', 'core1', 'edge2'),
        link('x2', 'core2', 'edge1'),
        link('thru', 'edge1', 'edge2'),
      ],
    });
    const r = inspectPage(dense);
    expect(r.clean).toBe(false);
    // Text clipping: the ~150px-wide labels collide across the 120px columns.
    expect(r.counts.text.problems).toBeGreaterThan(0);
    expect(messages(r)).toMatch(/collide/);
    // Routing: the diagonal pair crosses, and 'thru' slices through "svc".
    expect(r.counts.routing.problems).toBeGreaterThan(0);
    expect(messages(r)).toMatch(/links "x1" and "x2" cross/);
    expect(messages(r)).toMatch(
      /link "thru" passes through unrelated node "svc"/,
    );

    // validate_topology (semantic pass) reports nothing about labels or
    // crossings for this page — the whole reason inspect_render exists.
    const semantic = validateDocument({
      title: 'T',
      pages: [dense],
      customNodes: [],
    });
    expect(semantic.filter((p) => p.level === 'error')).toEqual([]);
    expect(semantic.some((p) => /label|cross/.test(p.message))).toBe(false);

    // Bounded: the whole report stays a few KB even for a defective page.
    expect(JSON.stringify(r).length).toBeLessThan(4096);
  });
});

describe('self-labelled nodes (#253)', () => {
  const LONG =
    'SRX: one table, zone per VRF. Import: Transit 0/0 only, HPE ClearPass list only, others own CIDR.';

  it('does not report wrapped text-box or callout labels as truncated', () => {
    const r = inspectPage(
      page({
        nodes: [
          { id: 'key', type: 'text', x: 300, y: 350, width: 260, label: LONG },
          {
            id: 'co',
            type: 'callout',
            x: 700,
            y: 350,
            width: 340,
            label: LONG,
          },
        ],
      }),
    );
    expect(messages(r)).not.toMatch(/truncates it to 24/);
  });

  it('gives a callout no phantom below-node label that collides with neighbours', () => {
    // A 97-char label would be a 150px label rect at y+24; the callout box
    // itself (340 wide) ends at x=620 and the node at 700 is well clear.
    const r = inspectPage(
      page({
        nodes: [
          {
            id: 'co',
            type: 'callout',
            x: 450,
            y: 350,
            width: 340,
            label: LONG,
          },
          node('w2', 700, 350, 'w2'),
        ],
      }),
    );
    expect(messages(r)).not.toMatch(/label .* on node "co"/);
    expect(r.counts.text.problems).toBe(0);
  });
});

describe('link crossings on drawn geometry (#258)', () => {
  const routing = (r: InspectReport) =>
    r.findings.filter((f) => f.category === 'routing');

  it('reports a K2,2 crossing as an expected dual-homed mesh note', () => {
    // Two tiers drawn as rows, fully meshed: the diagonal pair must cross.
    const r = inspectPage(
      page({
        nodes: [
          node('a1', 300, 200),
          node('a2', 700, 200),
          node('b1', 300, 500),
          node('b2', 700, 500),
        ],
        links: [
          link('l11', 'a1', 'b1'),
          link('l12', 'a1', 'b2'),
          link('l21', 'a2', 'b1'),
          link('l22', 'a2', 'b2'),
        ],
      }),
    );
    const rf = routing(r);
    expect(rf.length).toBe(1);
    expect(rf[0]!.severity).toBe('note');
    expect(rf[0]!.message).toMatch(/^links "l12" and "l21" cross — expected/);
    expect(rf[0]!.message).toMatch(
      /— expected \(dual-homed mesh between a1,a2 and b1,b2\)$/,
    );
    expect(r.crossings).toEqual({ total: 1, unavoidable: 1, avoidable: 0 });
    expect(r.counts.routing).toEqual({ problems: 0, notes: 1 });
    expect(r.clean).toBe(true);
  });

  it('counts every K2,4 crossing pair as unavoidable', () => {
    const tops = [node('a1', 200, 200), node('a2', 800, 200)];
    const bottoms = [200, 400, 600, 800].map((x, i) =>
      node(`b${i + 1}`, x, 500),
    );
    const links: LinkConfig[] = [];
    for (const a of tops)
      for (const b of bottoms) links.push(link(`${a.id}-${b.id}`, a.id, b.id));
    const r = inspectPage(page({ nodes: [...tops, ...bottoms], links }));
    expect(r.crossings.total).toBe(6);
    expect(r.crossings.unavoidable).toBe(6);
    expect(r.crossings.avoidable).toBe(0);
    expect(r.counts.routing.problems).toBe(0);
    expect(routing(r).every((f) => f.severity === 'note')).toBe(true);
    expect(r.clean).toBe(true);
  });

  it('keeps an X between two unrelated links as a problem', () => {
    const r = inspectPage(
      page({
        nodes: [
          node('p', 300, 200),
          node('q', 700, 500),
          node('s', 300, 500),
          node('t', 700, 200),
        ],
        links: [link('x1', 'p', 'q'), link('x2', 's', 't')],
      }),
    );
    const rf = routing(r);
    expect(rf.length).toBe(1);
    expect(rf[0]!.severity).toBe('problem');
    expect(rf[0]!.message).toMatch(/^links "x1" and "x2" cross — reorder/);
    expect(r.crossings).toEqual({ total: 1, unavoidable: 0, avoidable: 1 });
    expect(r.clean).toBe(false);
  });

  it('honours waypoints that route a link around a node its chord would hit', () => {
    // The a→b chord slices straight through "mid" (and through the vertical
    // c→d link); the drawn route goes up and over both.
    const nodes = [
      node('a', 300, 350),
      node('mid', 500, 350),
      node('b', 700, 350),
      node('c', 600, 250),
      node('d', 600, 450),
    ];
    const chord = inspectPage(
      page({ nodes, links: [link('l1', 'a', 'b'), link('v', 'c', 'd')] }),
    );
    expect(messages(chord)).toMatch(/link "l1" passes through unrelated node/);
    expect(chord.crossings.total).toBe(1);

    const routed = inspectPage(
      page({
        nodes,
        links: [
          {
            ...link('l1', 'a', 'b'),
            waypoints: [
              { x: 300, y: 150 },
              { x: 700, y: 150 },
            ],
          },
          link('v', 'c', 'd'),
        ],
      }),
    );
    expect(messages(routed)).not.toMatch(/passes through/);
    expect(messages(routed)).not.toMatch(/cross/);
    expect(routed.crossings).toEqual({
      total: 0,
      unavoidable: 0,
      avoidable: 0,
    });
    expect(routed.counts.routing.problems).toBe(0);
  });

  it('collapses a bused crossover into one finding naming every link', () => {
    // Four left→right links bend through (almost) the same crossover point
    // above the rows; every one of the 6 pairs intersects within a few px.
    // (Identical waypoints would make the polylines touch at a shared vertex,
    // which — like a shared endpoint — is a junction, not a crossing.)
    const left = [200, 300, 400, 500].map((y, i) => node(`n${i + 1}`, 200, y));
    const right = [200, 300, 400, 500].map((y, i) => node(`r${i + 1}`, 800, y));
    const bus: { x: number; y: number }[] = [
      { x: 497, y: 150 },
      { x: 503, y: 150 },
      { x: 500, y: 147 },
      { x: 500, y: 153 },
    ];
    const links: LinkConfig[] = left.map((n, i) => ({
      ...link(`l${i + 1}`, n.id, right[3 - i]!.id),
      waypoints: [bus[i]!],
    }));
    const r = inspectPage(page({ nodes: [...left, ...right], links }));
    expect(r.crossings).toEqual({ total: 6, unavoidable: 0, avoidable: 6 });
    const rf = routing(r);
    expect(rf.length).toBe(1);
    expect(rf[0]!.severity).toBe('problem');
    expect(rf[0]!.message).toMatch(
      /^4 links cross at \(\d+,\d+\): l1, l2, l3, l4 — reorder/,
    );
    // The crossover sits where the waypoints put it, not on the chords
    // (which would meet at (500,350)).
    const at = /at \((\d+),(\d+)\)/.exec(rf[0]!.message)!;
    expect(Number(at[1])).toBeCloseTo(500, -1);
    expect(Number(at[2])).toBeCloseTo(150, -1);
    expect(r.counts.routing).toEqual({ problems: 1, notes: 0 });
  });

  it('models the orthogonal elbow when checking for nodes a link passes through', () => {
    // The link starts on a's drawn east edge (≈335, 209): the straight chord
    // from there passes x=520 at y≈255, clear of "blocker" at (520,200);
    // the orthogonal L runs horizontally along y≈209 first and hits it.
    const nodes = [
      node('a', 300, 200),
      node('b', 700, 300),
      node('blocker', 520, 200),
    ];
    const straight = inspectPage(
      page({ nodes, links: [link('l1', 'a', 'b')] }),
    );
    expect(messages(straight)).not.toMatch(/passes through/);

    const ortho = inspectPage(
      page({
        nodes,
        links: [{ ...link('l1', 'a', 'b'), lineStyle: 'orthogonal' }],
      }),
    );
    expect(messages(ortho)).toMatch(
      /link "l1" passes through unrelated node "blocker"/,
    );
  });
});

describe('wire-label pills (#261)', () => {
  it('reports a flow-path pill the renderer cannot slide clear of a node', () => {
    // a→b label pill at (450, 312) × 'HA' is 25px wide; node n's hit box
    // (418–482 × 318–352) covers it and no ≤1-width slide clears it.
    const r = inspectPage(
      page({
        nodes: [node('a', 200, 300), node('b', 700, 300), node('n', 450, 335)],
        flowPaths: [{ id: 'fp', waypoints: ['a', 'b'], label: 'HA' }],
      }),
    );
    const f = r.findings.find(
      (x) =>
        x.category === 'text' &&
        x.severity === 'problem' &&
        /label of flow path "fp" sits on node "n"/.test(x.message),
    );
    expect(f).toBeDefined();
  });

  it('does not report a pill the renderer slides clear, and does report one it cannot', () => {
    const nodes = [
      node('a', 200, 300),
      node('b', 700, 300),
      node('n', 450, 335),
    ];
    const cleared = inspectPage(
      page({
        nodes,
        links: [{ ...link('l1', 'a', 'b'), label: 'Primary uplink 10G' }],
      }),
    );
    expect(messages(cleared)).not.toMatch(/label of link "l1" sits on node/);
    const stuck = inspectPage(
      page({ nodes, links: [{ ...link('l1', 'a', 'b'), label: 'HA' }] }),
    );
    expect(messages(stuck)).toMatch(/label of link "l1" sits on node "n"/);
  });

  it('notes a marker label longer than 24 chars', () => {
    const r = inspectPage(
      page({
        nodes: [node('a', 500, 350)],
        policyMarkers: [
          {
            id: 'm',
            nodeId: 'a',
            type: 'inspect',
            label: 'Inspect all outbound traffic',
          },
        ],
      }),
    );
    const f = r.findings.find(
      (x) => x.category === 'text' && /marker "m" is 28 chars/.test(x.message),
    );
    expect(f?.severity).toBe('note');
  });

  it('still flags two link chips that collide', () => {
    // Two parallel tunnels 10px apart share the same chip spot (tunnel
    // chips are fixed, so no nudge separates them).
    const r = inspectPage(
      page({
        nodes: [
          node('a', 200, 300),
          node('b', 700, 300),
          node('c', 200, 310),
          node('d', 700, 310),
        ],
        links: [
          { ...link('l1', 'a', 'b'), type: 'tunnel', label: 'One' },
          { ...link('l2', 'c', 'd'), type: 'tunnel', label: 'Two' },
        ],
      }),
    );
    expect(messages(r)).toMatch(/labels of links "l1" and "l2" collide/);
  });

  it('flags a link drawn through a zone title', () => {
    // Zone box over m: 420–580 × 280–420, title strip at (428, 285–299).
    const r = inspectPage(
      page({
        nodes: [
          node('m', 500, 350, 'Member'),
          node('o1', 300, 292),
          node('o2', 700, 292),
        ],
        links: [link('l1', 'o1', 'o2')],
        zones: [{ id: 'z1', label: 'Branch', nodes: ['m'] }],
      }),
    );
    expect(messages(r)).toMatch(
      /link "l1" runs through the title of zone "z1"/,
    );
    // A link well below the strip is not flagged.
    const clean = inspectPage(
      page({
        nodes: [
          node('m', 500, 350, 'Member'),
          node('o1', 300, 330),
          node('o2', 700, 330),
        ],
        links: [link('l1', 'o1', 'o2')],
        zones: [{ id: 'z1', label: 'Branch', nodes: ['m'] }],
      }),
    );
    expect(messages(clean)).not.toMatch(/runs through the title/);
  });

  it('flags a flow pill sitting on a zone title', () => {
    // Flow label on a→b sits at (450, 312); a zone whose member is at
    // (470, 377) boxes from y=307, so its title strip (312–326) is under it.
    const r = inspectPage(
      page({
        nodes: [node('a', 200, 300), node('b', 700, 300), node('m', 470, 377)],
        flowPaths: [{ id: 'fp', waypoints: ['a', 'b'], label: 'HA' }],
        zones: [{ id: 'z1', label: 'Core services zone', nodes: ['m'] }],
      }),
    );
    expect(messages(r)).toMatch(
      /label of flow path "fp" sits on the title of zone "z1"/,
    );
  });
});

describe('mesh classification requires same-kind links (#265)', () => {
  // Same geometry as the K2,2 case above; only the link kinds vary.
  const meshNodes = [
    node('a1', 300, 200),
    node('a2', 700, 200),
    node('b1', 300, 500),
    node('b2', 700, 500),
  ];
  const problems = (r: InspectReport) =>
    r.findings.filter(
      (f) => f.category === 'routing' && f.severity === 'problem',
    );

  it('still treats four same-kind links as a mesh', () => {
    const r = inspectPage(
      page({
        nodes: meshNodes,
        links: [
          { ...link('l11', 'a1', 'b1'), layer: 'physical' },
          { ...link('l12', 'a1', 'b2'), layer: 'physical' },
          { ...link('l21', 'a2', 'b1'), layer: 'physical' },
          { ...link('l22', 'a2', 'b2'), layer: 'physical' },
        ],
      }),
    );
    expect(r.crossings).toEqual({ total: 1, unavoidable: 1, avoidable: 0 });
    expect(problems(r)).toHaveLength(0);
  });

  it('keeps a tunnel crossing a WAN line as a problem', () => {
    const r = inspectPage(
      page({
        nodes: meshNodes,
        links: [
          link('l11', 'a1', 'b1'),
          { ...link('t12', 'a1', 'b2'), type: 'tunnel', layer: 'overlay' },
          link('l21', 'a2', 'b1'),
          { ...link('t22', 'a2', 'b2'), type: 'tunnel', layer: 'overlay' },
        ],
      }),
    );
    expect(r.crossings).toEqual({ total: 1, unavoidable: 0, avoidable: 1 });
    expect(problems(r)).toHaveLength(1);
    expect(problems(r)[0]!.message).toMatch(/^links "t12" and "l21" cross —/);
    expect(problems(r)[0]!.message).not.toMatch(/dual-homed mesh/);
    expect(r.clean).toBe(false);
  });

  it('keeps a dashed OOB cable crossing a WAN line as a problem', () => {
    const r = inspectPage(
      page({
        nodes: meshNodes,
        links: [
          link('l11', 'a1', 'b1'),
          { ...link('o12', 'a1', 'b2'), dashed: true },
          link('l21', 'a2', 'b1'),
          { ...link('o22', 'a2', 'b2'), dashed: true },
        ],
      }),
    );
    expect(r.crossings).toEqual({ total: 1, unavoidable: 0, avoidable: 1 });
    expect(problems(r)).toHaveLength(1);
  });
});
