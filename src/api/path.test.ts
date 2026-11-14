/**
 * Path analysis ("visual traceroute"): the graph rules, the order of the
 * routes, the cap, the two presentations — and an exhaustive reference
 * search that the pruned search has to agree with on real and random pages.
 */
import { describe, expect, it } from 'vitest';
import { addFlowPath, addPage, emptyDocument } from './builder.js';
import type { LayerDef } from './layers.js';
import {
  PATH_DEFAULTS,
  PATH_LIMITS,
  analyzePath,
  isBlockedLink,
  pathCaption,
  pathEmphasis,
  pathFlow,
  pathLabel,
  type PathAnalysis,
  type PathFound,
  type PathOptions,
  type PathPage,
} from './path.js';
import { buildTemplate } from './templates.js';
import { TEXT_LIMITS } from './text.js';
import { validateDocument } from './validate.js';
import { generateSdwan } from '../connect/generate.js';
import type { Page, TopologyDocument } from '../pages/model.js';
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';

/* ── fixtures ─────────────────────────────────────────────────────── */

interface NetExtras {
  /** Ids that are anchors, not nodes. */
  anchors?: string[];
  /** Extra fields per link id. */
  links?: Record<string, Partial<LinkConfig>>;
  /** Extra fields per node id. */
  nodes?: Record<string, Partial<NodeConfig>>;
  /** Nodes with no link. */
  lone?: string[];
}

/**
 * A page from link tokens: `a-b` is a link "ab" from a to b; `x:a-b` names
 * it "x" (parallel links need their own ids). Nodes appear in the order the
 * links first mention them.
 */
function net(spec: string, extras: NetExtras = {}): Page {
  const anchors = new Set(extras.anchors ?? []);
  const nodeIds: string[] = [];
  const links: LinkConfig[] = spec
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const named = token.split(':');
      const pair = named[named.length - 1]!;
      const [from, to] = pair.split('-') as [string, string];
      const id = named.length > 1 ? named[0]! : `${from}${to}`;
      for (const end of [from, to])
        if (!anchors.has(end) && !nodeIds.includes(end)) nodeIds.push(end);
      return { id, type: 'line', from, to, ...extras.links?.[id] };
    });
  for (const id of extras.lone ?? []) nodeIds.push(id);
  return {
    id: 'p',
    name: 'Test',
    viewBox: '0 0 1050 700',
    nodes: nodeIds.map((id, i) => ({
      id,
      type: 'host',
      x: 100 + 60 * i,
      y: 100,
      ...extras.nodes?.[id],
    })),
    links,
    anchors: [...anchors].map((id, i) => ({ id, x: 50 * i, y: 300 })),
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  };
}

function found(result: PathAnalysis): PathFound {
  expect(result.status).toBe('found');
  return result as PathFound;
}

/** The routes of a result as "a>b>c" strings. */
const routes = (result: PathAnalysis): string[] =>
  found(result).paths.map((p) => p.nodes.join('>'));

/** Generated appliances of a role ("hub" | "spoke"), in page order. */
const byRole = (page: Page, role: string): string[] =>
  page.nodes.filter((n) => n.meta?.role === role).map((n) => n.id);

/** Whether a layer is drawn by default in a document. */
const drawnIn =
  (doc: TopologyDocument) =>
  (layer: string | undefined): boolean =>
    !layer ||
    (doc.layers ?? []).find((l) => l.id === layer)?.defaultVisible !== false;

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/* ── the reference: exhaustive, unpruned ──────────────────────────── */

interface View {
  /** Whether a layer is drawn. */
  visible?: (layer: string | undefined) => boolean;
  /** Whether a link may be crossed at all. */
  usable?: (link: LinkConfig) => boolean;
  /** Admit unusable links where no usable link joins a pair. */
  admitBlocked?: boolean;
  extraHops?: number;
}

interface RefRoute {
  nodes: string[];
  links: string[];
}

/**
 * Every simple route between two elements within the hop budget, found by
 * trying everything — no distance table, no pruning but the length limit —
 * then sorted by hop count and the page positions of the links. Written
 * independently of the module under test.
 */
function reference(
  page: PathPage,
  from: string,
  to: string,
  view: View = {},
): RefRoute[] {
  const visible = view.visible ?? (() => true);
  const usable = view.usable ?? (() => true);
  const stops = new Set<string>();
  for (const n of page.nodes) if (visible(n.layer)) stops.add(n.id);
  for (const a of page.anchors ?? []) stops.add(a.id);
  if (!stops.has(from) || !stops.has(to)) return [];

  const firstUsable = new Map<string, number>();
  const firstAny = new Map<string, number>();
  const key = (a: string, b: string): string => `${a}\n${b}`;
  page.links.forEach((l, i) => {
    if (l.from === l.to || !stops.has(l.from) || !stops.has(l.to)) return;
    if (!visible(l.layer)) return;
    const ok = usable(l);
    if (!ok && !view.admitBlocked) return;
    for (const k of [key(l.from, l.to), key(l.to, l.from)]) {
      if (ok && !firstUsable.has(k)) firstUsable.set(k, i);
      if (!firstAny.has(k)) firstAny.set(k, i);
    }
  });
  /** Each stop's neighbours, with the page position of the hop's link. */
  const hops = new Map<string, [neighbour: string, position: number][]>();
  for (const a of stops) {
    const list: [string, number][] = [];
    for (const b of stops) {
      const at = firstUsable.get(key(a, b)) ?? firstAny.get(key(a, b));
      if (at !== undefined) list.push([b, at]);
    }
    hops.set(a, list);
  }
  const next = (a: string): [string, number][] => hops.get(a)!;

  // Shortest length by plain breadth-first flooding.
  const seen = new Map([[from, 0]]);
  for (const queue = [from]; queue.length; ) {
    const at = queue.shift()!;
    for (const [b] of next(at))
      if (!seen.has(b)) {
        seen.set(b, seen.get(at)! + 1);
        queue.push(b);
      }
  }
  const shortest = seen.get(to);
  if (shortest === undefined) return [];

  const limit = shortest + (view.extraHops ?? PATH_DEFAULTS.extraHops);
  const all: { nodes: string[]; positions: number[] }[] = [];
  const walk = (trail: string[], positions: number[]): void => {
    const at = trail[trail.length - 1]!;
    if (at === to) {
      all.push({ nodes: trail, positions });
      return;
    }
    if (positions.length === limit) return;
    for (const [b, position] of next(at))
      if (!trail.includes(b)) walk([...trail, b], [...positions, position]);
  };
  walk([from], []);
  all.sort((x, y) => {
    if (x.positions.length !== y.positions.length)
      return x.positions.length - y.positions.length;
    for (let i = 0; i < x.positions.length; i++)
      if (x.positions[i] !== y.positions[i])
        return x.positions[i]! - y.positions[i]!;
    return 0;
  });
  return all.map((r) => ({
    nodes: r.nodes,
    links: r.positions.map((p) => page.links[p]!.id),
  }));
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const asRef = (result: PathAnalysis): RefRoute[] =>
  found(result).paths.map((p) => ({ nodes: p.nodes, links: p.links }));

/**
 * What is wrong with a result's routes as walks on the page, or null: every
 * route runs from one end to the other without repeating a stop, each link
 * joins the two stops beside it, and the list is shortest first.
 */
function walkProblem(page: PathPage, result: PathFound): string | null {
  const stops = new Set([
    ...page.nodes.map((n) => n.id),
    ...(page.anchors ?? []).map((a) => a.id),
  ]);
  const links = new Map<string, LinkConfig[]>();
  for (const l of page.links) links.set(l.id, [...(links.get(l.id) ?? []), l]);
  let last = 0;
  for (const path of result.paths) {
    const name = path.nodes.join('>');
    if (path.hops !== path.links.length) return `${name}: hops`;
    if (path.nodes.length !== path.links.length + 1) return `${name}: lengths`;
    if (new Set(path.nodes).size !== path.nodes.length) return `${name}: loop`;
    if (path.nodes[0] !== result.from) return `${name}: start`;
    if (path.nodes[path.nodes.length - 1] !== result.to) return `${name}: end`;
    if (path.nodes.some((id) => !stops.has(id))) return `${name}: unknown stop`;
    for (const [i, id] of path.links.entries()) {
      const [a, b] = [path.nodes[i], path.nodes[i + 1]];
      const joins = (links.get(id) ?? []).some(
        (l) => (l.from === a && l.to === b) || (l.from === b && l.to === a),
      );
      if (!joins) return `${name}: link ${id} does not join ${a} and ${b}`;
    }
    if (path.hops < last) return `${name}: out of order`;
    last = path.hops;
  }
  return result.hops === result.paths[0]?.hops ? null : 'hops of the result';
}

/** Every route must be walkable on the page it came from. */
function expectWalkable(page: PathPage, result: PathFound): void {
  expect(walkProblem(page, result)).toBeNull();
}

/* ── graph rules ──────────────────────────────────────────────────── */

describe('analyzePath — a line', () => {
  const line = net('a-b b-c c-d');

  it('finds the one route, nodes and links in travel order', () => {
    expect(analyzePath(line, 'a', 'd')).toEqual({
      status: 'found',
      from: 'a',
      to: 'd',
      hops: 3,
      paths: [
        { nodes: ['a', 'b', 'c', 'd'], links: ['ab', 'bc', 'cd'], hops: 3 },
      ],
      truncated: false,
    });
  });

  it('travels links against their from → to direction', () => {
    const back = found(analyzePath(line, 'd', 'a'));
    expect(back.paths).toEqual([
      { nodes: ['d', 'c', 'b', 'a'], links: ['cd', 'bc', 'ab'], hops: 3 },
    ]);
    // A link drawn "backwards" joins its ends just the same.
    expect(routes(analyzePath(net('b-a c-b d-c'), 'a', 'd'))).toEqual([
      'a>b>c>d',
    ]);
  });

  it('answers for neighbours and for inner elements', () => {
    expect(routes(analyzePath(line, 'b', 'c'))).toEqual(['b>c']);
    expect(found(analyzePath(line, 'b', 'c')).hops).toBe(1);
    expect(routes(analyzePath(line, 'b', 'd'))).toEqual(['b>c>d']);
  });
});

describe('analyzePath — a ring', () => {
  it('returns both ways round when they are equally long', () => {
    const ring = net('a-b b-c c-d d-a');
    const r = found(analyzePath(ring, 'a', 'c'));
    expect(r.hops).toBe(2);
    expect(r.truncated).toBe(false);
    expect(r.paths).toEqual([
      { nodes: ['a', 'b', 'c'], links: ['ab', 'bc'], hops: 2 },
      { nodes: ['a', 'd', 'c'], links: ['da', 'cd'], hops: 2 },
    ]);
  });

  it('orders equal routes by the page order of their links', () => {
    // Same ring, the d-a link drawn first: the route through d now leads.
    const ring = net('d-a a-b b-c c-d');
    expect(routes(analyzePath(ring, 'a', 'c'))).toEqual(['a>d>c', 'a>b>c']);
  });

  it('offers the long way round as a backup within the hop budget', () => {
    const ring = net('a-b b-c c-d d-e e-a');
    const r = found(analyzePath(ring, 'a', 'c'));
    expect(r.hops).toBe(2);
    expect(r.paths.map((p) => [p.nodes.join('>'), p.hops])).toEqual([
      ['a>b>c', 2],
      ['a>e>d>c', 3],
    ]);
    // …and leaves it out when only the shortest routes are wanted, or when
    // it is more than the budget longer.
    expect(routes(analyzePath(ring, 'a', 'c', { extraHops: 0 }))).toEqual([
      'a>b>c',
    ]);
    const wide = net('a-b b-c c-d d-e e-f f-g g-a');
    expect(routes(analyzePath(wide, 'a', 'b'))).toEqual(['a>b']);
    expect(routes(analyzePath(wide, 'a', 'b', { extraHops: 5 }))).toEqual([
      'a>b',
      'a>g>f>e>d>c>b',
    ]);
  });
});

describe('analyzePath — hub and spoke', () => {
  it('routes spoke to spoke through the hub of a star', () => {
    const star = net('hub-s1 hub-s2 hub-s3 hub-s4');
    expect(analyzePath(star, 's1', 's3')).toEqual({
      status: 'found',
      from: 's1',
      to: 's3',
      hops: 2,
      paths: [
        { nodes: ['s1', 'hub', 's3'], links: ['hubs1', 'hubs3'], hops: 2 },
      ],
      truncated: false,
    });
    expect(routes(analyzePath(star, 'hub', 's4'))).toEqual(['hub>s4']);
  });

  it('agrees with the exhaustive search on the hub-and-spoke starter template', () => {
    const doc = buildTemplate('hub-spoke');
    const page = doc.pages[0]!;
    const layers = doc.layers ?? [];
    const view = {
      visible: drawnIn(doc),
      usable: (l: LinkConfig) => !isBlockedLink(l),
    };
    const ids = page.nodes.map((n) => n.id);
    expect(ids.length).toBeGreaterThan(2);
    let joined = 0;
    for (const a of ids)
      for (const b of ids) {
        if (a === b) continue;
        const want = reference(page, a, b, view);
        const got = analyzePath(page, a, b, { layers, maxPaths: 64 });
        // Whatever the template draws: apart here is apart (or blocked) there.
        if (!want.length) {
          expect(got.status === 'found' ? got.blockedOnly : true).toBe(true);
          continue;
        }
        const r = found(got);
        expectWalkable(page, r);
        expect(asRef(r)).toEqual(want.slice(0, 64));
        expect(r.truncated).toBe(want.length > 64);
        joined++;
      }
    // It is a hub and spoke: sites reach each other.
    expect(joined).toBeGreaterThan(ids.length);
  });

  describe('a dual-homed SD-WAN fabric (generated)', () => {
    const { doc } = generateSdwan({
      vendor: 'edgeconnect',
      regions: 1,
      hubsPerRegion: 2,
      branchesPerRegion: 3,
      transports: ['inet', 'mpls'],
    });
    const page = doc.pages[0]!;
    const layers = doc.layers ?? [];
    const drawn = drawnIn(doc);
    const view = {
      visible: drawn,
      usable: (l: LinkConfig) => !isBlockedLink(l),
    };
    const [hub1, hub2] = byRole(page, 'hub') as [string, string];
    const [br1, br2] = byRole(page, 'spoke') as [string, string];

    it('is the shape the tests below assume', () => {
      expect(byRole(page, 'hub')).toHaveLength(2);
      expect(byRole(page, 'spoke')).toHaveLength(3);
      // Some layer is hidden by default, and links are drawn on it.
      expect(page.links.some((l) => !drawn(l.layer))).toBe(true);
    });

    it('finds a route through each hub, as the page draws it', () => {
      const r = found(
        analyzePath(page, br1, br2, { layers, maxPaths: 64, extraHops: 0 }),
      );
      expectWalkable(page, r);
      expect(r.hops).toBe(2);
      expect(r.truncated).toBe(false);
      expect(r.paths.map((p) => p.nodes[1])).toEqual(
        expect.arrayContaining([hub1, hub2]),
      );
      // No link on a layer that is hidden by default is used or listed.
      const hidden = new Set(
        page.links.filter((l) => !drawn(l.layer)).map((l) => l.id),
      );
      for (const p of r.paths)
        for (const id of [
          ...p.links,
          ...(p.parallel ?? []).flatMap((x) => x.links),
        ])
          expect(hidden.has(id)).toBe(false);
    });

    it('agrees with the exhaustive search, capped and uncapped', () => {
      const want = reference(page, br1, br2, view);
      expect(want.length).toBeGreaterThan(PATH_DEFAULTS.maxPaths);
      const shortestCount = want.filter((r) => r.links.length === 2).length;
      expect(shortestCount).toBeLessThan(PATH_DEFAULTS.maxPaths);

      const capped = found(analyzePath(page, br1, br2, { layers }));
      expect(capped.paths).toHaveLength(PATH_DEFAULTS.maxPaths);
      expect(capped.truncated).toBe(true);
      // Cut among the 3-hop routes: every 2-hop route is in the list.
      expect(capped.truncatedAt).toBe(3);
      expect(capped.paths.filter((p) => p.hops === 2)).toHaveLength(
        shortestCount,
      );
      expect(asRef(capped)).toEqual(want.slice(0, PATH_DEFAULTS.maxPaths));

      const all = found(
        analyzePath(page, br1, br2, { layers, maxPaths: PATH_LIMITS.maxPaths }),
      );
      expectWalkable(page, all);
      expect(asRef(all)).toEqual(want.slice(0, PATH_LIMITS.maxPaths));
      expect(all.truncated).toBe(want.length > PATH_LIMITS.maxPaths);

      const shortest = found(
        analyzePath(page, br1, br2, { layers, extraHops: 0, maxPaths: 64 }),
      );
      expect(asRef(shortest)).toEqual(
        reference(page, br1, br2, { ...view, extraHops: 0 }),
      );
      expect(shortest.truncated).toBe(false);
      expect(new Set(shortest.paths.map((p) => p.hops))).toEqual(new Set([2]));
    });

    it('reports the parallel tunnels of a hop instead of multiplying routes', () => {
      // With every layer shown, a branch and a hub are joined by several
      // tunnels (underlay per transport, plus the overlay).
      const r = found(
        analyzePath(page, br1, hub1, {
          layers,
          visibleLayers: layers.map((l) => l.id),
          extraHops: 0,
        }),
      );
      expect(r.paths).toHaveLength(1);
      const [direct] = r.paths;
      expect(direct!.nodes).toEqual([br1, hub1]);
      const between = page.links
        .filter(
          (l) => [l.from, l.to].sort().join() === [br1, hub1].sort().join(),
        )
        .map((l) => l.id);
      expect(between.length).toBeGreaterThan(1);
      expect(direct!.parallel).toEqual([{ hop: 0, links: between }]);
      expect(direct!.links).toEqual([between[0]]);
    });

    it('agrees with the exhaustive search for every pair of devices', () => {
      const ids = page.nodes.map((n) => n.id);
      for (const a of ids)
        for (const b of ids) {
          if (a === b) continue;
          const got = analyzePath(page, a, b, { layers, maxPaths: 64 });
          const want = reference(page, a, b, view);
          expect(want.length).toBeGreaterThan(0);
          expect(asRef(got)).toEqual(want.slice(0, 64));
          expect(found(got).truncated).toBe(want.length > 64);
        }
    });

    it('agrees on a Juniper fabric with HA pairs and a LAN', () => {
      const j = generateSdwan({
        vendor: 'juniper',
        regions: 2,
        hubsPerRegion: 2,
        branchesPerRegion: 2,
        transports: ['inet', 'mpls'],
        branchHa: true,
        branchLan: 'switch',
      }).doc;
      const jp = j.pages[0]!;
      const lan = jp.nodes.filter((n) => n.type === 'switch').map((n) => n.id);
      expect(lan.length).toBeGreaterThanOrEqual(2);
      const [a, b] = [lan[0]!, lan[lan.length - 1]!];
      const r = found(
        analyzePath(jp, a, b, { layers: j.layers ?? [], maxPaths: 64 }),
      );
      expectWalkable(jp, r);
      const want = reference(jp, a, b, {
        visible: drawnIn(j),
        usable: (l: LinkConfig) => !isBlockedLink(l),
      });
      expect(asRef(r)).toEqual(want.slice(0, 64));
      expect(r.truncated).toBe(want.length > 64);
    });
  });
});

describe('analyzePath — anchors', () => {
  const page = net('a-j j-b b-c', { anchors: ['j'] });

  it('passes through an anchor that joins two links, as a stop', () => {
    const r = found(analyzePath(page, 'a', 'c'));
    expect(r.paths).toEqual([
      {
        nodes: ['a', 'j', 'b', 'c'],
        links: ['aj', 'jb', 'bc'],
        hops: 3,
        anchors: ['j'],
      },
    ]);
  });

  it('accepts an anchor as either end', () => {
    expect(routes(analyzePath(page, 'j', 'c'))).toEqual(['j>b>c']);
    const r = found(analyzePath(page, 'c', 'j'));
    expect(r.paths[0]).toMatchObject({
      nodes: ['c', 'b', 'j'],
      anchors: ['j'],
    });
  });

  it('branches at an anchor that joins three links', () => {
    const tee = net('a-j b-j c-j c-b', { anchors: ['j'] });
    expect(routes(analyzePath(tee, 'a', 'b'))).toEqual(['a>j>b', 'a>j>c>b']);
  });

  it('reads a page that has no anchors array at all', () => {
    const { anchors: _none, ...rest } = net('a-b b-c');
    expect(routes(analyzePath(rest, 'a', 'c'))).toEqual(['a>b>c']);
  });
});

describe('analyzePath — parallel links', () => {
  it('is one route however many links join a pair', () => {
    const page = net('x:a-b y:b-a z:a-b b-c');
    const r = found(analyzePath(page, 'a', 'c'));
    expect(r.paths).toEqual([
      {
        nodes: ['a', 'b', 'c'],
        links: ['x', 'bc'],
        hops: 2,
        parallel: [{ hop: 0, links: ['x', 'y', 'z'] }],
      },
    ]);
  });

  it('does not multiply routes across several bundled hops', () => {
    const page = net('p1:a-b p2:a-b p3:a-b q1:b-c q2:b-c q3:b-c r1:c-d r2:c-d');
    const r = found(analyzePath(page, 'a', 'd'));
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0]!.parallel).toEqual([
      { hop: 0, links: ['p1', 'p2', 'p3'] },
      { hop: 1, links: ['q1', 'q2', 'q3'] },
      { hop: 2, links: ['r1', 'r2'] },
    ]);
    expect(r.truncated).toBe(false);
  });

  it('names the first link in page order for the hop', () => {
    const page = net('late:b-c x:a-b early:c-b');
    const r = found(analyzePath(page, 'a', 'c'));
    expect(r.paths[0]!.links).toEqual(['x', 'late']);
    expect(r.paths[0]!.parallel).toEqual([
      { hop: 1, links: ['late', 'early'] },
    ]);
  });
});

describe('analyzePath — blocked and down', () => {
  it('recognises a blocked or down link', () => {
    const link = (extra: Record<string, unknown>): LinkConfig => ({
      id: 'l',
      type: 'line',
      from: 'a',
      to: 'b',
      ...extra,
    });
    expect(isBlockedLink(link({}))).toBe(false);
    expect(isBlockedLink(link({ type: 'blocked' }))).toBe(true);
    // The fabric compiler's down tunnel.
    expect(isBlockedLink(link({ meta: { status: 'down' } }))).toBe(true);
    expect(isBlockedLink(link({ meta: { status: 'Down' } }))).toBe(true);
    expect(isBlockedLink(link({ status: 'down' }))).toBe(true);
    expect(isBlockedLink(link({ meta: { status: 'up' } }))).toBe(false);
    expect(isBlockedLink(link({ meta: 'down' }))).toBe(false);
    expect(isBlockedLink(link({ meta: null }))).toBe(false);
  });

  it('takes the detour round a blocked link', () => {
    const page = net('a-b a-c c-b', { links: { ab: { type: 'blocked' } } });
    expect(analyzePath(page, 'a', 'b')).toEqual({
      status: 'found',
      from: 'a',
      to: 'b',
      hops: 2,
      paths: [{ nodes: ['a', 'c', 'b'], links: ['ac', 'cb'], hops: 2 }],
      truncated: false,
    });
  });

  it('takes the detour round a down tunnel', () => {
    const page = net('a-b a-c c-b', {
      links: { ab: { type: 'tunnel', meta: { status: 'down' } } },
    });
    expect(routes(analyzePath(page, 'a', 'b'))).toEqual(['a>c>b']);
  });

  it('crosses them when asked to, and says which routes do', () => {
    const page = net('a-b a-c c-b', { links: { ab: { type: 'blocked' } } });
    const r = found(analyzePath(page, 'a', 'b', { ignoreBlocked: false }));
    expect(r.paths).toEqual([
      { nodes: ['a', 'b'], links: ['ab'], hops: 1, blocked: ['ab'] },
      { nodes: ['a', 'c', 'b'], links: ['ac', 'cb'], hops: 2 },
    ]);
    // A clean route exists, so the two are not joined by blocked links only.
    expect(r.blockedOnly).toBeUndefined();
  });

  it('says so when the only path uses a blocked link', () => {
    const page = net('a-b b-c', { links: { bc: { type: 'blocked' } } });
    expect(analyzePath(page, 'a', 'c')).toEqual({
      status: 'found',
      from: 'a',
      to: 'c',
      hops: 2,
      paths: [
        {
          nodes: ['a', 'b', 'c'],
          links: ['ab', 'bc'],
          hops: 2,
          blocked: ['bc'],
        },
      ],
      truncated: false,
      blockedOnly: true,
    });
    // The same answer when blocked links were allowed from the start.
    expect(
      found(analyzePath(page, 'a', 'c', { ignoreBlocked: false })).blockedOnly,
    ).toBe(true);
  });

  it('prefers a usable link over a blocked one on the same hop', () => {
    const page = net('bad:a-b good:a-b', {
      links: { bad: { type: 'blocked' } },
    });
    const clean = found(analyzePath(page, 'a', 'b'));
    expect(clean.paths).toEqual([
      { nodes: ['a', 'b'], links: ['good'], hops: 1 },
    ]);
    const both = found(analyzePath(page, 'a', 'b', { ignoreBlocked: false }));
    expect(both.paths).toEqual([
      {
        nodes: ['a', 'b'],
        links: ['good'],
        hops: 1,
        parallel: [{ hop: 0, links: ['good', 'bad'] }],
      },
    ]);
    expect(both.blockedOnly).toBeUndefined();
  });

  it('does not pass through a node that is down', () => {
    const page = net('a-x x-b a-c c-d d-b', {
      nodes: { x: { status: 'down' } },
    });
    expect(routes(analyzePath(page, 'a', 'b'))).toEqual(['a>c>d>b']);
    const through = found(
      analyzePath(page, 'a', 'b', { ignoreBlocked: false }),
    );
    expect(through.paths[0]).toEqual({
      nodes: ['a', 'x', 'b'],
      links: ['ax', 'xb'],
      hops: 2,
      blocked: ['x'],
    });
    expect(through.blockedOnly).toBeUndefined();
  });

  it('still reaches a node that is down, or starts from one', () => {
    const page = net('a-x x-b', { nodes: { x: { status: 'down' } } });
    expect(analyzePath(page, 'a', 'x')).toMatchObject({
      status: 'found',
      paths: [{ nodes: ['a', 'x'], links: ['ax'], hops: 1 }],
    });
    expect(found(analyzePath(page, 'x', 'b')).blockedOnly).toBeUndefined();
    // Through it is the only way from a to b: reported as blocked.
    const r = found(analyzePath(page, 'a', 'b'));
    expect(r.blockedOnly).toBe(true);
    expect(r.paths[0]!.blocked).toEqual(['x']);
  });

  it('lists every blocked element once, in travel order', () => {
    const page = net('a-b b-x x-c c-d', {
      links: { ab: { type: 'blocked' }, cd: { meta: { status: 'down' } } },
      nodes: { x: { status: 'down' } },
    });
    const r = found(analyzePath(page, 'a', 'd'));
    expect(r.blockedOnly).toBe(true);
    expect(r.paths[0]!.blocked).toEqual(['ab', 'x', 'cd']);
  });

  it('is unaffected by other statuses', () => {
    const page = net('a-x x-b', {
      nodes: { x: { status: 'maintenance' } },
      links: { ax: { meta: { status: 'up' } } },
    });
    expect(analyzePath(page, 'a', 'b')).toMatchObject({
      status: 'found',
      truncated: false,
      paths: [{ nodes: ['a', 'x', 'b'] }],
    });
    expect(found(analyzePath(page, 'a', 'b')).blockedOnly).toBeUndefined();
  });
});

describe('analyzePath — layers', () => {
  const LAYERS: LayerDef[] = [
    { id: 'under', kind: 'underlay', defaultVisible: false },
    { id: 'over', kind: 'overlay' },
  ];
  // a—b on the base layer; b—c only as an overlay tunnel; a—c as underlay.
  const page = net('a-b b-c a-c', {
    links: { bc: { layer: 'over' }, ac: { layer: 'under' } },
  });

  it('counts every layer when none is declared or named', () => {
    expect(routes(analyzePath(page, 'a', 'c', { extraHops: 0 }))).toEqual([
      'a>c',
    ]);
  });

  it('follows the layers’ defaults, like the renderer', () => {
    // `under` is hidden by default, so the direct underlay link is not used.
    expect(routes(analyzePath(page, 'a', 'c', { layers: LAYERS }))).toEqual([
      'a>b>c',
    ]);
  });

  it('follows an explicit visible set', () => {
    const only = (visibleLayers: string[]): PathOptions => ({
      layers: LAYERS,
      visibleLayers,
      extraHops: 0,
    });
    expect(routes(analyzePath(page, 'a', 'c', only(['under'])))).toEqual([
      'a>c',
    ]);
    expect(routes(analyzePath(page, 'a', 'c', only(['over'])))).toEqual([
      'a>b>c',
    ]);
    expect(
      routes(analyzePath(page, 'a', 'c', only(['under', 'over']))),
    ).toEqual(['a>c']);
    // An element with no layer is always visible.
    expect(routes(analyzePath(page, 'a', 'b', only([])))).toEqual(['a>b']);
  });

  it('says disconnected when layers hide the only path, and names them', () => {
    expect(
      analyzePath(page, 'a', 'c', { layers: LAYERS, visibleLayers: [] }),
    ).toEqual({
      status: 'disconnected',
      from: 'a',
      to: 'c',
      reach: { from: 1, to: 0 },
      // The first shortest route through everything is the direct underlay link.
      hiddenLayers: ['under'],
    });
    const overOnly = net('a-b b-c', { links: { bc: { layer: 'over' } } });
    expect(
      analyzePath(overOnly, 'a', 'c', {
        layers: LAYERS,
        visibleLayers: ['under'],
      }),
    ).toMatchObject({ status: 'disconnected', hiddenLayers: ['over'] });
    expect(
      analyzePath(overOnly, 'a', 'c', {
        layers: LAYERS,
        visibleLayers: ['over'],
      }),
    ).toMatchObject({ status: 'found', hops: 2 });
  });

  it('does not pass through, start at or end at a hidden node', () => {
    const hiddenNode = net('a-x x-b', { nodes: { x: { layer: 'under' } } });
    expect(analyzePath(hiddenNode, 'a', 'b', { layers: LAYERS })).toEqual({
      status: 'disconnected',
      from: 'a',
      to: 'b',
      reach: { from: 0, to: 0 },
      hiddenLayers: ['under'],
    });
    expect(analyzePath(hiddenNode, 'a', 'x', { layers: LAYERS })).toMatchObject(
      {
        status: 'disconnected',
        hiddenLayers: ['under'],
      },
    );
    expect(
      analyzePath(hiddenNode, 'a', 'b', {
        layers: LAYERS,
        visibleLayers: ['under'],
      }),
    ).toMatchObject({ status: 'found', hops: 2 });
  });

  it('names no layer when the two are apart on every layer', () => {
    const apart = net('a-b c-d', { links: { cd: { layer: 'under' } } });
    const r = analyzePath(apart, 'a', 'c', { layers: LAYERS });
    expect(r).toEqual({
      status: 'disconnected',
      from: 'a',
      to: 'c',
      reach: { from: 1, to: 0 },
    });
  });

  it('treats a layer that is not declared as visible unless a set excludes it', () => {
    const odd = net('a-b', { links: { ab: { layer: 'mystery' } } });
    expect(analyzePath(odd, 'a', 'b', { layers: LAYERS }).status).toBe('found');
    expect(
      analyzePath(odd, 'a', 'b', { layers: LAYERS, visibleLayers: ['over'] })
        .status,
    ).toBe('disconnected');
  });
});

describe('analyzePath — no path', () => {
  it('says disconnected, with how far each end reaches', () => {
    const page = net('a-b b-c x-y', { lone: ['z'] });
    expect(analyzePath(page, 'a', 'x')).toEqual({
      status: 'disconnected',
      from: 'a',
      to: 'x',
      reach: { from: 2, to: 1 },
    });
    expect(analyzePath(page, 'a', 'z')).toEqual({
      status: 'disconnected',
      from: 'a',
      to: 'z',
      reach: { from: 2, to: 0 },
    });
  });

  it('says same for one element asked twice', () => {
    const page = net('a-b', { anchors: ['j'] });
    expect(analyzePath(page, 'a', 'a')).toEqual({
      status: 'same',
      from: 'a',
      to: 'a',
    });
    expect(analyzePath(page, 'j', 'j').status).toBe('same');
  });

  it('names the id that is not a node or anchor', () => {
    const page = net('a-b');
    expect(analyzePath(page, 'a', 'nope')).toEqual({
      status: 'unknown',
      from: 'a',
      to: 'nope',
      unknown: ['to'],
    });
    expect(analyzePath(page, 'nope', 'a')).toMatchObject({ unknown: ['from'] });
    expect(analyzePath(page, 'no', 'pe')).toMatchObject({
      status: 'unknown',
      unknown: ['from', 'to'],
    });
    // A link id is not an end; neither is the same unknown id twice.
    expect(analyzePath(page, 'a', 'ab')).toMatchObject({ unknown: ['to'] });
    expect(analyzePath(page, 'q', 'q')).toMatchObject({
      status: 'unknown',
      unknown: ['from', 'to'],
    });
    expect(analyzePath(net(''), 'a', 'b').status).toBe('unknown');
  });

  it('ignores a self-link and a link with a missing end', () => {
    const page = net('loop:a-a a-b gone:b-ghost b-c');
    expect(analyzePath(page, 'a', 'c')).toEqual({
      status: 'found',
      from: 'a',
      to: 'c',
      hops: 2,
      paths: [{ nodes: ['a', 'b', 'c'], links: ['ab', 'bc'], hops: 2 }],
      truncated: false,
    });
    // "ghost" was only ever named by a dangling link: it is not on the page.
    page.nodes = page.nodes.filter((n) => n.id !== 'ghost');
    expect(analyzePath(page, 'a', 'ghost').status).toBe('unknown');
    expect(routes(analyzePath(page, 'a', 'c'))).toEqual(['a>b>c']);
    const onlyLoop = net('loop:a-a', { lone: ['b'] });
    expect(analyzePath(onlyLoop, 'a', 'b')).toMatchObject({
      status: 'disconnected',
      reach: { from: 0, to: 0 },
    });
  });

  it('survives duplicate ids without looping', () => {
    const page = net('a-b b-c');
    page.nodes.push({ id: 'b', type: 'host', x: 0, y: 0 });
    page.links.push({ id: 'ab', type: 'line', from: 'a', to: 'b' });
    page.anchors.push({ id: 'a', x: 0, y: 0 });
    const r = found(analyzePath(page, 'a', 'c'));
    expect(r.paths[0]!.nodes).toEqual(['a', 'b', 'c']);
    expect(r.paths[0]!.anchors).toBeUndefined();
  });
});

/* ── the cap ──────────────────────────────────────────────────────── */

/** A w × h grid of nodes "x,y" with links right and down. */
function grid(w: number, h: number): Page {
  const tokens: string[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x + 1 < w) tokens.push(`h${x}.${y}:${x},${y}-${x + 1},${y}`);
      if (y + 1 < h) tokens.push(`v${x}.${y}:${x},${y}-${x},${y + 1}`);
    }
  return net(tokens.join(' '));
}

describe('analyzePath — the cap', () => {
  // Corner to corner of a 4 × 4 grid: C(6, 3) = 20 shortest routes.
  const page = grid(4, 4);

  it('defaults to 8 routes and flags the rest', () => {
    const r = found(analyzePath(page, '0,0', '3,3'));
    expect(r.paths).toHaveLength(8);
    expect(r.truncated).toBe(true);
    // Cut among the shortest routes themselves: there are more of them.
    expect(r.truncatedAt).toBe(r.hops);
    expect(asRef(r)).toEqual(reference(page, '0,0', '3,3').slice(0, 8));
  });

  it('returns exactly maxPaths routes, the first ones in order', () => {
    const want = reference(page, '0,0', '3,3', { extraHops: 0 });
    expect(want).toHaveLength(20);
    for (const maxPaths of [1, 2, 7, 19]) {
      const r = found(
        analyzePath(page, '0,0', '3,3', { maxPaths, extraHops: 0 }),
      );
      expect(asRef(r)).toEqual(want.slice(0, maxPaths));
      expect(r.truncated).toBe(true);
    }
  });

  it('is not truncated when everything fits', () => {
    const exact = found(
      analyzePath(page, '0,0', '3,3', { maxPaths: 20, extraHops: 0 }),
    );
    expect(exact.paths).toHaveLength(20);
    expect(exact.truncated).toBe(false);
    expect(exact.truncatedAt).toBeUndefined();
    const roomy = found(
      analyzePath(page, '0,0', '3,3', { maxPaths: 21, extraHops: 0 }),
    );
    expect(roomy.paths).toHaveLength(20);
    expect(roomy.truncated).toBe(false);
  });

  it('counts longer alternatives against the same cap', () => {
    // A grid has no routes one hop longer (parity); this one has 36 that
    // are two hops longer.
    const want = reference(page, '0,0', '3,3');
    expect(want).toHaveLength(56);
    const r = found(analyzePath(page, '0,0', '3,3', { maxPaths: 30 }));
    expect(asRef(r)).toEqual(want.slice(0, 30));
    expect(r.paths.map((p) => p.hops).filter((h) => h === 6)).toHaveLength(20);
    expect(r.paths.map((p) => p.hops).filter((h) => h === 8)).toHaveLength(10);
    expect(r.truncated).toBe(true);
    // All 20 shortest routes are listed; the cut is among the 8-hop ones.
    expect(r.truncatedAt).toBe(8);
    const all = found(analyzePath(page, '0,0', '3,3', { maxPaths: 56 }));
    expect(asRef(all)).toEqual(want);
    expect(all.truncated).toBe(false);
  });

  it('keeps maxPaths and extraHops within their limits', () => {
    // Corner to corner of a 5 × 5 grid: C(8, 4) = 70 shortest routes.
    const lots = found(
      analyzePath(grid(5, 5), '0,0', '4,4', { maxPaths: 1e9 }),
    );
    expect(lots.paths).toHaveLength(PATH_LIMITS.maxPaths);
    expect(lots.truncated).toBe(true);
    for (const maxPaths of [0, -3, 0.4]) {
      const one = found(analyzePath(page, '0,0', '3,3', { maxPaths }));
      expect(one.paths).toHaveLength(1);
    }
    const nan = found(
      analyzePath(page, '0,0', '3,3', { maxPaths: Number.NaN }),
    );
    expect(nan.paths).toHaveLength(PATH_DEFAULTS.maxPaths);
    const ring = net('a-b b-c c-d d-e e-f f-g g-h h-i i-j j-k k-l l-a');
    // The other way round is 10 hops longer than the direct link.
    expect(routes(analyzePath(ring, 'a', 'b', { extraHops: 1e9 }))).toEqual([
      'a>b',
    ]);
    expect(routes(analyzePath(ring, 'a', 'c', { extraHops: -1 }))).toEqual([
      'a>b>c',
    ]);
    expect(PATH_LIMITS.extraHops).toBe(8);
    expect(routes(analyzePath(ring, 'a', 'c', { extraHops: 99 }))).toEqual([
      'a>b>c',
      'a>l>k>j>i>h>g>f>e>d>c',
    ]);
  });
});

/* ── determinism ──────────────────────────────────────────────────── */

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

describe('analyzePath — determinism', () => {
  const { doc } = generateSdwan({
    vendor: 'edgeconnect',
    regions: 1,
    hubsPerRegion: 2,
    branchesPerRegion: 3,
    transports: ['inet', 'mpls'],
  });
  const layers = doc.layers ?? [];
  const everyLayer = { layers, visibleLayers: layers.map((l) => l.id) };
  const spokes = byRole(doc.pages[0]!, 'spoke');
  const [a, b] = [spokes[0]!, spokes[2]!];

  it('gives the same answer for the same input and leaves the page alone', () => {
    const page = structuredClone(doc.pages[0]!);
    const before = JSON.stringify(page);
    const first = analyzePath(page, a, b, everyLayer);
    const second = analyzePath(page, a, b, everyLayer);
    expect(second).toEqual(first);
    expect(JSON.stringify(page)).toBe(before);
    // A frozen page proves nothing is written to it.
    const frozen = deepFreeze(structuredClone(page));
    expect(analyzePath(frozen, a, b, everyLayer)).toEqual(first);
    expect(
      analyzePath(frozen, a, b, { ...everyLayer, ignoreBlocked: false }).status,
    ).toBe('found');
    expect(analyzePath(frozen, a, 'nope').status).toBe('unknown');
  });

  it('does not depend on the order of the nodes or anchors', () => {
    const page = structuredClone(doc.pages[0]!);
    const want = analyzePath(page, a, b, { ...everyLayer, maxPaths: 64 });
    const random = rng(7);
    for (let i = 0; i < 5; i++) {
      const mixed = { ...page, nodes: shuffled(page.nodes, random) };
      expect(analyzePath(mixed, a, b, { ...everyLayer, maxPaths: 64 })).toEqual(
        want,
      );
    }
    const tee = net('a-j b-j c-j c-b a-k k-b', { anchors: ['j', 'k'] });
    const teeWant = analyzePath(tee, 'a', 'b');
    const swapped = { ...tee, anchors: [...tee.anchors].reverse() };
    expect(analyzePath(swapped, 'a', 'b')).toEqual(teeWant);
  });

  it('changes only order and the named parallel link when links are shuffled', () => {
    const page = structuredClone(doc.pages[0]!);
    const options = { ...everyLayer, maxPaths: 64, extraHops: 1 };
    const base = found(analyzePath(page, a, b, options));
    expect(base.truncated).toBe(false);
    const routeSet = (r: PathFound): string[] =>
      r.paths.map((p) => `${p.hops}:${p.nodes.join('>')}`).sort();
    /** Parallel links per hop, as sets. */
    const bundles = (r: PathFound): string[] =>
      r.paths
        .flatMap((p) =>
          (p.parallel ?? []).map(
            (x) =>
              `${p.nodes.join('>')}#${x.hop}=${[...x.links].sort().join()}`,
          ),
        )
        .sort();
    expect(bundles(base).length).toBeGreaterThan(0);

    const random = rng(42);
    let reordered = 0;
    for (let i = 0; i < 12; i++) {
      const mixed = { ...page, links: shuffled(page.links, random) };
      const got = found(analyzePath(mixed, a, b, options));
      // The same routes, hop counts and bundles…
      expect(got.hops).toBe(base.hops);
      expect(got.truncated).toBe(false);
      expect(routeSet(got)).toEqual(routeSet(base));
      expect(bundles(got)).toEqual(bundles(base));
      // …in the order the documented tie-break gives for the shuffled page.
      expect(asRef(got)).toEqual(
        reference(mixed, a, b, { extraHops: 1 }).slice(0, 64),
      );
      for (const p of got.paths)
        for (const x of p.parallel ?? [])
          expect(x.links[0]).toBe(p.links[x.hop]);
      if (JSON.stringify(asRef(got)) !== JSON.stringify(asRef(base)))
        reordered++;
    }
    expect(reordered).toBeGreaterThan(0);
  });

  it('keeps the hop count, never the route list, when a shuffle meets the cap', () => {
    const page = grid(4, 4);
    const random = rng(3);
    for (let i = 0; i < 8; i++) {
      const mixed = { ...page, links: shuffled(page.links, random) };
      const got = found(analyzePath(mixed, '0,0', '3,3', { maxPaths: 5 }));
      expect(got.hops).toBe(6);
      expect(got.truncated).toBe(true);
      expect(asRef(got)).toEqual(reference(mixed, '0,0', '3,3').slice(0, 5));
    }
  });
});

/* ── random pages against the reference ───────────────────────────── */

describe('analyzePath — agrees with an exhaustive search on random pages', () => {
  const LAYERS: LayerDef[] = [
    { id: 'L1' },
    { id: 'L2', defaultVisible: false },
    { id: 'L3' },
  ];

  /** A small page with everything the rules mention, from a seed. */
  function randomPage(seed: number): Page {
    const random = rng(seed);
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(random() * items.length)]!;
    const nodeCount = 4 + Math.floor(random() * 5);
    const ids = Array.from({ length: nodeCount }, (_, i) => `n${i}`);
    const anchors = random() < 0.6 ? ['j0', 'j1'].slice(0, 1 + (seed % 2)) : [];
    const ends = [...ids, ...anchors];
    const layer = (): { layer?: string } =>
      random() < 0.3 ? { layer: pick(['L1', 'L2', 'L3', 'L9']) } : {};
    const links: LinkConfig[] = [];
    const count = nodeCount + Math.floor(random() * nodeCount * 1.5);
    for (let i = 0; i < count; i++) {
      const roll = random();
      links.push({
        id: `l${i}`,
        type: roll < 0.12 ? 'blocked' : 'line',
        from: random() < 0.04 ? 'ghost' : pick(ends),
        to: pick(ends),
        ...(roll > 0.9 ? { meta: { status: 'down' } } : {}),
        ...layer(),
      });
    }
    return {
      id: 'p',
      name: 'Random',
      viewBox: '0 0 1050 700',
      nodes: ids.map((id, i) => ({
        id,
        type: 'host',
        x: i * 50,
        y: 0,
        ...(random() < 0.1 ? { status: 'down' as const } : {}),
        ...(random() < 0.15 ? { layer: pick(['L1', 'L2']) } : {}),
      })),
      links,
      anchors: anchors.map((id, i) => ({ id, x: i * 40, y: 200 })),
      zones: [],
      flowPaths: [],
      policyMarkers: [],
    };
  }

  it('matches on 160 pages × every pair, under four option sets', () => {
    const optionSets: {
      options: PathOptions;
      visible: (layer: string | undefined) => boolean;
    }[] = [
      { options: {}, visible: () => true },
      {
        options: { layers: LAYERS },
        visible: (l) => l !== 'L2',
      },
      {
        options: { layers: LAYERS, visibleLayers: ['L2', 'L3'] },
        visible: (l) => !l || l === 'L2' || l === 'L3',
      },
      {
        options: { layers: LAYERS, visibleLayers: [], extraHops: 0 },
        visible: (l) => !l,
      },
    ];
    let checked = 0;
    const seen = { found: 0, blockedOnly: 0, disconnected: 0, truncated: 0 };
    // Compared in plain code and asserted once: an `expect` per route would
    // be most of this test's running time.
    const problems: string[] = [];
    for (let seed = 1; seed <= 160; seed++) {
      const page = randomPage(seed);
      const { options, visible } = optionSets[seed % optionSets.length]!;
      const maxPaths = 1 + (seed % 9);
      const extraHops = options.extraHops ?? PATH_DEFAULTS.extraHops;
      const stops = [
        ...page.nodes.map((n) => n.id),
        ...page.anchors.map((x) => x.id),
      ];
      for (const from of stops)
        for (const to of stops) {
          if (from === to) continue;
          const fail = (what: string): void => {
            if (problems.length < 5)
              problems.push(`seed ${seed}, ${from} to ${to}: ${what}`);
          };
          const downNode = (id: string): boolean =>
            id !== from &&
            id !== to &&
            page.nodes.find((n) => n.id === id)?.status === 'down';
          const usable = (l: LinkConfig): boolean =>
            l.type !== 'blocked' &&
            (l.meta as { status?: string } | undefined)?.status !== 'down' &&
            !downNode(l.from) &&
            !downNode(l.to);
          const got = analyzePath(page, from, to, { ...options, maxPaths });
          const clean = reference(page, from, to, {
            visible,
            usable,
            extraHops,
          });
          const any = clean.length
            ? clean
            : reference(page, from, to, {
                visible,
                usable,
                admitBlocked: true,
                extraHops,
              });
          checked++;
          if (!any.length) {
            if (got.status !== 'disconnected') fail(`got ${got.status}`);
            seen.disconnected++;
            continue;
          }
          if (got.status !== 'found') {
            fail(`got ${got.status}, the reference finds ${any.length}`);
            continue;
          }
          const routes = got.paths.map((x) => ({
            nodes: x.nodes,
            links: x.links,
          }));
          if (!same(routes, any.slice(0, maxPaths))) fail('other routes');
          if (got.truncated !== any.length > maxPaths) fail('truncated');
          // Cut at the hop count of the first route left out.
          if (got.truncatedAt !== any[maxPaths]?.links.length)
            fail(`truncatedAt ${got.truncatedAt}`);
          // Clean routes cross nothing blocked; otherwise every route does.
          if ((got.blockedOnly === true) !== !clean.length) fail('blockedOnly');
          if (got.paths.some((x) => !!x.blocked?.length !== !clean.length))
            fail('blocked lists');
          const walk = walkProblem(page, got);
          if (walk) fail(walk);
          seen.found++;
          if (!clean.length) seen.blockedOnly++;
          if (got.truncated) seen.truncated++;
        }
    }
    expect(problems).toEqual([]);
    // The generator really does exercise every outcome.
    expect(checked).toBeGreaterThan(5000);
    expect(seen.found).toBeGreaterThan(3000);
    expect(seen.disconnected).toBeGreaterThan(1500);
    expect(seen.blockedOnly).toBeGreaterThan(500);
    expect(seen.truncated).toBeGreaterThan(150);
  }, 30_000);

  it('matches with blocked links allowed from the start', () => {
    for (let seed = 301; seed <= 360; seed++) {
      const page = randomPage(seed);
      const stops = page.nodes.map((n) => n.id);
      const [from, to] = [stops[0]!, stops[stops.length - 1]!];
      const downNode = (id: string): boolean =>
        id !== from &&
        id !== to &&
        page.nodes.find((n) => n.id === id)?.status === 'down';
      const usable = (l: LinkConfig): boolean =>
        !isBlockedLink(l) && !downNode(l.from) && !downNode(l.to);
      const got = analyzePath(page, from, to, {
        ignoreBlocked: false,
        maxPaths: 64,
      });
      const want = reference(page, from, to, { usable, admitBlocked: true });
      if (!want.length) {
        expect(got.status).toBe('disconnected');
        continue;
      }
      const f = found(got);
      expect(asRef(f)).toEqual(want.slice(0, 64));
      const clean = reference(page, from, to, { usable, extraHops: 0 });
      expect(f.blockedOnly).toBe(clean.length ? undefined : true);
    }
  });

  it('names hidden layers exactly when showing them joins the two', () => {
    const views: (string[] | undefined)[] = [undefined, [], ['L1'], ['L3']];
    let named = 0;
    let apart = 0;
    const problems: string[] = [];
    for (let seed = 400; seed < 520; seed++) {
      const page = randomPage(seed);
      const visibleLayers = views[seed % views.length];
      const options = { layers: LAYERS, visibleLayers };
      const visible = (layer: string | undefined): boolean =>
        !layer ||
        (visibleLayers ? visibleLayers.includes(layer) : layer !== 'L2');
      const inUse = new Set(['L1', 'L2', 'L3']);
      for (const el of [...page.nodes, ...page.links])
        if (el.layer) inUse.add(el.layer);
      const stops = page.nodes.map((n) => n.id);
      for (const from of stops)
        for (const to of stops) {
          if (from === to) continue;
          const r = analyzePath(page, from, to, options);
          if (r.status !== 'disconnected') continue;
          const fail = (what: string): void => {
            if (problems.length < 5)
              problems.push(`seed ${seed}, ${from} to ${to}: ${what}`);
          };
          // Everything on the page, any link, any layer.
          const through = reference(page, from, to, {
            admitBlocked: true,
            extraHops: 0,
          });
          if (!r.hiddenLayers) {
            if (through.length) fail('a route exists through hidden layers');
            apart++;
            continue;
          }
          if (!through.length) fail('no route exists on any layer');
          if (!r.hiddenLayers.length) fail('an empty list');
          if (r.hiddenLayers.some(visible)) fail('names a visible layer');
          // Show them on top of what is drawn now: the two are joined.
          const shown = [...[...inUse].filter(visible), ...r.hiddenLayers];
          const again = analyzePath(page, from, to, {
            layers: LAYERS,
            visibleLayers: shown,
          });
          if (again.status !== 'found') fail(`still ${again.status}`);
          named++;
        }
    }
    expect(problems).toEqual([]);
    expect(named).toBeGreaterThan(100);
    expect(apart).toBeGreaterThan(100);
  }, 30_000);
});

/* ── size and work ────────────────────────────────────────────────── */

describe('analyzePath — a 2,000-link page', () => {
  /**
   * Time an analysis: the best of three runs, so a busy machine pausing the
   * test does not read as a slow search.
   */
  function timed(
    page: PathPage,
    from: string,
    to: string,
    options?: PathOptions,
  ): { ms: number; result: PathAnalysis } {
    let ms = Infinity;
    let result!: PathAnalysis;
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      result = analyzePath(page, from, to, options);
      ms = Math.min(ms, performance.now() - start);
    }
    return { ms, result };
  }
  /** "Well under a second" — a typical run here takes under 10 ms. */
  const BUDGET_MS = 500;

  it('answers corner to corner on a grid, where shortest routes are countless', () => {
    // 32 × 32 nodes: 1,984 links, C(62, 31) ≈ 4.5 × 10^17 shortest routes.
    const page = grid(32, 32);
    expect(page.links).toHaveLength(1984);
    for (let i = 0; i < 16; i++)
      page.links.push({
        id: `extra${i}`,
        type: 'line',
        from: `${i},0`,
        to: `${i + 1},1`,
      });
    expect(page.links).toHaveLength(2000);
    const { ms, result } = timed(page, '0,0', '31,31');
    const r = found(result);
    expect(r.paths).toHaveLength(8);
    expect(r.truncated).toBe(true);
    expectWalkable(page, r);
    expect(ms).toBeLessThan(BUDGET_MS);
    // The cap bounds the work, not just the output: the largest cap too.
    const most = timed(page, '0,0', '31,31', { maxPaths: 64, extraHops: 8 });
    expect(found(most.result).paths).toHaveLength(64);
    expect(most.ms).toBeLessThan(BUDGET_MS);
  });

  it('answers end to end on a 2,000-link line and round a ring', () => {
    const tokens = Array.from({ length: 2000 }, (_, i) => `n${i}-n${i + 1}`);
    const line = net(tokens.join(' '));
    const a = timed(line, 'n0', 'n2000');
    expect(found(a.result).hops).toBe(2000);
    expect(found(a.result).paths).toHaveLength(1);
    expect(found(a.result).truncated).toBe(false);
    expect(a.ms).toBeLessThan(BUDGET_MS);

    const ring = net([...tokens.slice(0, 1999), 'n1999-n0'].join(' '));
    expect(ring.links).toHaveLength(2000);
    const b = timed(ring, 'n0', 'n1000');
    expect(found(b.result).paths.map((p) => p.hops)).toEqual([1000, 1000]);
    expect(b.ms).toBeLessThan(BUDGET_MS);
  });

  it('answers across a 2,000-spoke star and a full mesh', () => {
    const star = net(
      Array.from({ length: 2000 }, (_, i) => `hub-s${i}`).join(' '),
    );
    const a = timed(star, 's0', 's1999');
    expect(found(a.result).paths).toEqual([
      { nodes: ['s0', 'hub', 's1999'], links: ['hubs0', 'hubs1999'], hops: 2 },
    ]);
    expect(found(a.result).truncated).toBe(false);
    expect(a.ms).toBeLessThan(BUDGET_MS);

    // 64 nodes, every pair linked: 2,016 links.
    const tokens: string[] = [];
    for (let i = 0; i < 64; i++)
      for (let j = i + 1; j < 64; j++) tokens.push(`m${i}-m${j}`);
    const mesh = net(tokens.join(' '));
    expect(mesh.links.length).toBeGreaterThanOrEqual(2000);
    const b = timed(mesh, 'm0', 'm63', { maxPaths: 64 });
    const r = found(b.result);
    expect(r.paths).toHaveLength(64);
    expect(r.paths[0]!.hops).toBe(1);
    expect(r.truncated).toBe(true);
    expect(b.ms).toBeLessThan(BUDGET_MS);
  });

  it('stops at its work limit when longer routes hide behind dead ends', () => {
    // a — hub — b, with a 60-node full mesh hanging off the hub: 1,772
    // links. Routes up to 8 hops longer may wander the mesh, yet none can
    // leave it without crossing the hub twice — an endless supply of dead
    // ends for a search that only measures distance.
    const tokens = ['a-hub', 'hub-b'];
    for (let i = 0; i < 60; i++) {
      tokens.push(`hub-c${i}`);
      for (let j = i + 1; j < 60; j++) tokens.push(`c${i}-c${j}`);
    }
    const page = net(tokens.join(' '));
    const { ms, result } = timed(page, 'a', 'b', { extraHops: 8 });
    const r = found(result);
    expect(r.paths).toEqual([
      { nodes: ['a', 'hub', 'b'], links: ['ahub', 'hubb'], hops: 2 },
    ]);
    // It could not rule out more routes in the work it allows itself — but
    // it had finished with the shortest ones.
    expect(r.truncated).toBe(true);
    expect(r.truncatedAt).toBeGreaterThan(r.hops);
    expect(ms).toBeLessThan(BUDGET_MS);
    // With the default budget there is nothing to wander into.
    const usual = timed(page, 'a', 'b');
    expect(found(usual.result).truncated).toBe(false);
    expect(usual.ms).toBeLessThan(BUDGET_MS);
  });
});

/* ── presenting a route ───────────────────────────────────────────── */

describe('pathEmphasis', () => {
  it('lists the nodes and links of a route in travel order', () => {
    const page = net('a-b b-c');
    const [path] = found(analyzePath(page, 'a', 'c')).paths;
    expect(pathEmphasis(path!)).toEqual(['a', 'ab', 'b', 'bc', 'c']);
  });

  it('leaves anchors out — emphasis takes nodes and links only', () => {
    const page = net('a-j j-b', { anchors: ['j'] });
    const [path] = found(analyzePath(page, 'a', 'b')).paths;
    const ids = pathEmphasis(path!);
    expect(ids).toEqual(['a', 'aj', 'jb', 'b']);
    // The rule set_page_properties enforces on `emphasis`.
    const allowed = new Set([
      ...page.nodes.map((n) => n.id),
      ...page.links.map((l) => l.id),
    ]);
    expect(ids.every((id) => allowed.has(id))).toBe(true);
  });

  it('spotlights every parallel link of a hop unless told not to', () => {
    const page = net('x:a-b y:a-b b-c');
    const [path] = found(analyzePath(page, 'a', 'c')).paths;
    expect(pathEmphasis(path!)).toEqual(['a', 'x', 'y', 'b', 'bc', 'c']);
    expect(pathEmphasis(path!, { parallel: false })).toEqual([
      'a',
      'x',
      'b',
      'bc',
      'c',
    ]);
  });
});

describe('pathLabel and pathCaption', () => {
  const page = net('a-b b-c c-d', {
    nodes: {
      a: { label: 'Branch' },
      b: { label: 'Edge' },
      d: { label: 'Hub' },
    },
  });

  it('names the ends by label, else id, with the hop count', () => {
    const far = found(analyzePath(page, 'a', 'd')).paths[0]!;
    expect(pathLabel(page, far)).toBe('Branch -> Hub · 3 hops');
    const near = found(analyzePath(page, 'c', 'd')).paths[0]!;
    expect(pathLabel(page, near)).toBe('c -> Hub · 1 hop');
  });

  it('narrates the route for a page caption', () => {
    const far = found(analyzePath(page, 'a', 'd')).paths[0]!;
    expect(pathCaption(page, far)).toBe(
      'Path: Branch -> Hub · 3 hops via Edge, c',
    );
    const near = found(analyzePath(page, 'a', 'b')).paths[0]!;
    expect(pathCaption(page, near)).toBe('Path: Branch -> Edge · 1 hop');
  });

  it('says what a blocked route crosses, and skips anchors', () => {
    const blocked = net('a-j j-b b-c', {
      anchors: ['j'],
      links: { bc: { type: 'blocked', label: 'Policy deny' } },
    });
    const path = found(analyzePath(blocked, 'a', 'c')).paths[0]!;
    expect(pathCaption(blocked, path)).toBe(
      'Path: a -> c · 3 hops via b · crosses blocked or down: Policy deny',
    );
  });

  it('stays within the label and caption limits whatever the names', () => {
    const long = 'x'.repeat(TEXT_LIMITS.label);
    const tokens = Array.from({ length: 30 }, (_, i) => `n${i}-n${i + 1}`);
    const wide = net(tokens.join(' '), {
      nodes: Object.fromEntries(
        Array.from({ length: 31 }, (_, i) => [
          `n${i}`,
          { label: `${long}${i}` },
        ]),
      ),
      links: Object.fromEntries(
        tokens.map((t) => [
          t.replace('-', ''),
          { type: 'blocked', label: long },
        ]),
      ),
    });
    const path = found(analyzePath(wide, 'n0', 'n30')).paths[0]!;
    const label = pathLabel(wide, path);
    expect(label.length).toBeLessThanOrEqual(100);
    expect(label).toMatch(/^x+… -> x+… · 30 hops$/);
    const caption = pathCaption(wide, path);
    expect(caption.length).toBeLessThanOrEqual(TEXT_LIMITS.caption);
    expect(caption).toContain('+24 more');
    // Whitespace in a label never breaks the line.
    const messy = net('a-b', { nodes: { a: { label: '  Core\n  switch ' } } });
    const [p] = found(analyzePath(messy, 'a', 'b')).paths;
    expect(pathLabel(messy, p!)).toBe('Core switch -> b · 1 hop');
  });
});

describe('pathFlow', () => {
  it('builds a flow path input along the route', () => {
    const page = net('a-b b-c', {
      nodes: { a: { label: 'User' }, c: { label: 'App' } },
    });
    const path = found(analyzePath(page, 'a', 'c')).paths[0]!;
    expect(pathFlow(page, path)).toEqual({
      waypoints: ['a', 'b', 'c'],
      label: 'User -> App · 2 hops',
      hops: [
        { ref: 'b', linkId: 'ab' },
        { ref: 'c', linkId: 'bc' },
      ],
    });
  });

  it('threads anchors as waypoints so each leg rides one link', () => {
    const page = net('a-j j-b', { anchors: ['j'] });
    const path = found(analyzePath(page, 'a', 'b')).paths[0]!;
    const flow = pathFlow(page, path);
    expect(flow.waypoints).toEqual(['a', 'j', 'b']);
    expect(flow.hops).toEqual([
      { ref: 'j', linkId: 'aj' },
      { ref: 'b', linkId: 'jb' },
    ]);
  });

  it('records each leg’s layer and takes the layer the whole route shares', () => {
    const one = net('a-b b-c', {
      links: { ab: { layer: 'over' }, bc: { layer: 'over' } },
    });
    const flow = pathFlow(one, found(analyzePath(one, 'a', 'c')).paths[0]!);
    expect(flow.layer).toBe('over');
    expect(flow.hops).toEqual([
      { ref: 'b', linkId: 'ab', layer: 'over' },
      { ref: 'c', linkId: 'bc', layer: 'over' },
    ]);
    const mixed = net('a-b b-c', { links: { ab: { layer: 'over' } } });
    const other = pathFlow(
      mixed,
      found(analyzePath(mixed, 'a', 'c')).paths[0]!,
    );
    expect(other.layer).toBeUndefined();
    expect(other.hops).toEqual([
      { ref: 'b', linkId: 'ab', layer: 'over' },
      { ref: 'c', linkId: 'bc' },
    ]);
  });

  it('lets the caller set or override the other fields', () => {
    const page = net('a-b');
    const path = found(analyzePath(page, 'a', 'b')).paths[0]!;
    const flow = pathFlow(page, path, {
      id: 'trace',
      label: 'Backup',
      color: '#65aef9',
      animation: 'dashed',
      direction: 'bidirectional',
    });
    expect(flow).toMatchObject({
      id: 'trace',
      label: 'Backup',
      color: '#65aef9',
      animation: 'dashed',
      direction: 'bidirectional',
      waypoints: ['a', 'b'],
    });
    // The route itself is copied, not shared.
    flow.waypoints.push('z');
    expect(path.nodes).toEqual(['a', 'b']);
  });

  it('adds to a document that then validates clean', () => {
    const doc = emptyDocument('Trace');
    const page = addPage(doc, { name: 'One' });
    Object.assign(page, net('a-j j-b x:b-c y:b-c', { anchors: ['j'] }), {
      id: page.id,
      name: page.name,
    });
    const path = found(analyzePath(page, 'a', 'c')).paths[0]!;
    const flow = addFlowPath(page, pathFlow(page, path));
    page.emphasis = pathEmphasis(path);
    page.caption = pathCaption(page, path);
    expect(flow.id).toBeTruthy();
    expect(page.flowPaths).toHaveLength(1);
    const problems = validateDocument(doc).filter(
      (p) => p.level === 'error' || /flow path|waypoint|hop /.test(p.message),
    );
    expect(problems).toEqual([]);
  });
});
