/**
 * `analyze_path` — the definition as a client lists it (and its size), the
 * runtime validation of its arguments, the compact answer, the errors and
 * next steps, and the three presentations `show` writes.
 *
 * Exact expectations use small pages drawn here. On the generated SD-WAN
 * fabric the tool is checked against the API it wraps (`src/api/path.ts`,
 * which has its own tests), so these do not depend on the generator's ids.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  DEFAULT_MAX_PATHS,
  MAX_LISTED_IDS,
  MAX_LISTED_PARALLEL,
  MAX_PATHS,
  PATH_SHOW,
  pathTools,
} from './path-tools.js';
import { parseToolArgs } from './register.js';
import { TopologyStore } from './store.js';
import type { ToolDef } from './tools.js';
import {
  analyzePath,
  pathCaption,
  pathEmphasis,
  pathFlow,
  pathLabel,
  type PathFound,
  type PathOptions,
} from '../api/path.js';
import { buildTemplate } from '../api/templates.js';
import { validateDocument } from '../api/validate.js';
import { generateSdwan } from '../connect/generate.js';
import type { Page, TopologyDocument } from '../pages/model.js';

const bytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** The tools exactly as a client receives them from `tools/list`. */
async function listedTools(tools: ToolDef[]) {
  const server = new McpServer({ name: 'path', version: '0' });
  // Registered the way `registerTopologyTools` registers every tool.
  for (const tool of tools)
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputShape },
      async () => ({ content: [] }),
    );
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'path', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const { tools: listed } = await client.listTools();
  await client.close();
  return listed;
}

interface Listed {
  hops: number;
  nodes: string[];
  links: string[];
  parallel?: { hop: number; links: string[]; more?: number }[];
  [key: string]: unknown;
}
interface Answer {
  status: string;
  from: { id: string; label?: string };
  to: { id: string; label?: string };
  hops: number;
  paths: Listed[];
  truncated: boolean;
  truncatedAt?: number;
  shown?: Record<string, unknown>;
  next?: string;
  [key: string]: unknown;
}

describe('analyze_path', () => {
  let store: TopologyStore;
  let tool: ToolDef;
  /** Call the handler the way the server does: validated arguments in. */
  const call = (args: Record<string, unknown>): Answer =>
    tool.handler(parseToolArgs(tool, args)) as Answer;

  /** Add line links to a page from "a-b" tokens ("x:a-b" names the link). */
  function draw(page: Page, spec: string): void {
    for (const token of spec.split(/\s+/).filter(Boolean)) {
      const named = token.split(':');
      const [from, to] = named[named.length - 1]!.split('-') as [
        string,
        string,
      ];
      for (const id of [from, to])
        if (!page.nodes.some((n) => n.id === id))
          page.nodes.push({
            id,
            type: 'host',
            x: 100 + 80 * page.nodes.length,
            y: 200,
            label: id.toUpperCase(),
          });
      page.links.push({
        id: named.length > 1 ? named[0]! : `${from}${to}`,
        type: 'line',
        from,
        to,
      });
    }
  }
  function drawn(spec: string): { id: string; doc: TopologyDocument } {
    const { id, document } = store.create('Trace');
    draw(document.pages[0]!, spec);
    return { id, doc: document };
  }

  /** A generated dual-homed fabric: two hubs, two branches, two transports. */
  function fabric() {
    const { doc } = generateSdwan({
      vendor: 'edgeconnect',
      regions: 1,
      hubsPerRegion: 2,
      branchesPerRegion: 2,
      transports: ['inet', 'mpls'],
    });
    const id = store.importDocument(doc).id;
    const page = doc.pages[0]!;
    const role = (r: string): string[] =>
      page.nodes.filter((n) => n.meta?.role === r).map((n) => n.id);
    const [hub1, hub2] = role('hub') as [string, string];
    const [br1, br2] = role('spoke') as [string, string];
    const layers = doc.layers ?? [];
    /** What the API answers for the same question. */
    const api = (from: string, to: string, options: PathOptions = {}) =>
      analyzePath(page, from, to, {
        layers,
        maxPaths: DEFAULT_MAX_PATHS,
        ...options,
      }) as PathFound;
    return { id, doc, page, layers, hub1, hub2, br1, br2, api };
  }
  const labelOf = (page: Page, id: string): string =>
    page.nodes.find((n) => n.id === id)!.label!;
  /** Two elements two links apart: the far ends of two links that meet. */
  function twoApart(page: Page): [string, string] {
    for (const one of page.links)
      for (const other of page.links) {
        const ends = [one.from, one.to, other.from, other.to];
        if (new Set(ends).size !== 3) continue;
        const [a, b] = ends.filter(
          (end) => ends.indexOf(end) === ends.lastIndexOf(end),
        );
        return [a!, b!];
      }
    throw new Error('no two links meet on this page');
  }
  /** The links joining two elements, in page order. */
  const between = (page: Page, a: string, b: string): string[] =>
    page.links
      .filter((l) => [l.from, l.to].sort().join() === [a, b].sort().join())
      .map((l) => l.id);

  beforeEach(() => {
    store = new TopologyStore();
    [tool] = pathTools(store) as [ToolDef];
  });

  describe('the definition', () => {
    it('is one tool with the agreed inputs', () => {
      const tools = pathTools(store);
      expect(tools.map((t) => t.name)).toEqual(['analyze_path']);
      expect(Object.keys(tool.inputShape)).toEqual([
        'topologyId',
        'pageIndex',
        'from',
        'to',
        'maxPaths',
        'visibleLayers',
        'show',
      ]);
      expect(PATH_SHOW).toEqual(['none', 'emphasis', 'flow', 'page']);
      expect(tool.opOnly).toBeUndefined();
      expect(tool.meta).toBeUndefined();
    });

    it('lists in under 900 bytes — name, description and schema', async () => {
      const [listed] = await listedTools(pathTools(store));
      expect(listed!.name).toBe('analyze_path');
      expect(bytes(listed)).toBeLessThan(900);
      expect(listed!.inputSchema.required).toEqual([
        'topologyId',
        'from',
        'to',
      ]);
      const props = listed!.inputSchema.properties as Record<
        string,
        { type?: string; enum?: string[]; minimum?: number; maximum?: number }
      >;
      expect(props.show!.enum).toEqual(['none', 'emphasis', 'flow', 'page']);
      expect(props.maxPaths).toMatchObject({
        type: 'integer',
        minimum: 1,
        maximum: MAX_PATHS,
      });
      expect(props.pageIndex).toMatchObject({ type: 'integer', minimum: 0 });
      expect(props.visibleLayers!.type).toBe('array');
    });

    it('says in the description what an agent cannot see in the schema', () => {
      // The page it reads by default, the default cap, and each `show`.
      expect(tool.description).toContain('pageIndex default 0');
      expect(tool.description).toContain(`default ${DEFAULT_MAX_PATHS}`);
      for (const show of PATH_SHOW.slice(1))
        expect(tool.description).toContain(`${show} `);
    });
  });

  describe('argument validation', () => {
    const base = { topologyId: 't', from: 'a', to: 'b' };

    it('accepts the minimal and the full call', () => {
      expect(parseToolArgs(tool, base)).toEqual(base);
      const full = {
        ...base,
        pageIndex: 2,
        maxPaths: MAX_PATHS,
        visibleLayers: ['overlay'],
        show: 'page',
      };
      expect(parseToolArgs(tool, full)).toEqual(full);
      // Unknown keys never reach the handler.
      expect(parseToolArgs(tool, { ...base, extraHops: 9 })).toEqual(base);
    });

    it.each([
      ['a missing end', { topologyId: 't', from: 'a' }],
      ['a missing topology', { from: 'a', to: 'b' }],
      ['an id that is not a string', { ...base, to: 7 }],
      ['an unknown show', { ...base, show: 'spotlight' }],
      ['maxPaths below 1', { ...base, maxPaths: 0 }],
      ['maxPaths above the limit', { ...base, maxPaths: MAX_PATHS + 1 }],
      ['a fractional maxPaths', { ...base, maxPaths: 2.5 }],
      ['a negative page', { ...base, pageIndex: -1 }],
      ['a fractional page', { ...base, pageIndex: 0.5 }],
      ['layers that are not a list', { ...base, visibleLayers: 'overlay' }],
    ])('rejects %s', (_what, args) => {
      expect(() => parseToolArgs(tool, args)).toThrow(
        /invalid arguments for analyze_path/,
      );
    });
  });

  describe('the answer', () => {
    it('reports a route as ids and hop counts, and changes nothing', () => {
      const { id, doc } = drawn('a-b b-c c-d');
      const before = JSON.stringify(doc);
      const r = call({ topologyId: id, from: 'a', to: 'd' });
      expect(r).toEqual({
        status: 'found',
        from: { id: 'a', label: 'A' },
        to: { id: 'd', label: 'D' },
        hops: 3,
        paths: [
          { hops: 3, nodes: ['a', 'b', 'c', 'd'], links: ['ab', 'bc', 'cd'] },
        ],
        truncated: false,
      });
      expect(bytes(r)).toBeLessThan(200);
      expect(JSON.stringify(doc)).toBe(before);
    });

    it('answers on the hub-and-spoke starter template in under 300 bytes', () => {
      const doc = buildTemplate('hub-spoke');
      const id = store.importDocument(doc).id;
      const page = doc.pages[0]!;
      // Two sites: the far ends of two links that meet (at the hub).
      const [a, b] = twoApart(page);
      const api = analyzePath(page, a, b, {
        layers: doc.layers ?? [],
        maxPaths: 1,
      }) as PathFound;
      const r = call({ topologyId: id, from: a, to: b, maxPaths: 1 });
      expect(r.status).toBe('found');
      expect(r.hops).toBe(api.hops);
      expect(r.hops).toBeLessThanOrEqual(2);
      expect(r.paths.map((p) => [p.nodes, p.links])).toEqual(
        api.paths.map((p) => [p.nodes, p.links]),
      );
      expect(r.from).toEqual({ id: a, label: labelOf(page, a) });
      expect(bytes(r)).toBeLessThan(300);
    });

    it('answers for a dual-homed fabric in under 1 KB', () => {
      const f = fabric();
      const before = JSON.stringify(f.doc);
      const r = call({ topologyId: f.id, from: f.br1, to: f.br2 });
      // The API's answer with the document's layers and the tool's cap…
      const api = f.api(f.br1, f.br2);
      expect(r).toEqual({
        status: 'found',
        from: { id: f.br1, label: labelOf(f.page, f.br1) },
        to: { id: f.br2, label: labelOf(f.page, f.br2) },
        hops: api.hops,
        paths: api.paths.map(({ hops, nodes, links }) => ({
          hops,
          nodes,
          links,
        })),
        truncated: api.truncated,
        truncatedAt: api.truncatedAt,
      });
      // …which, between two branches, is two hops by way of either hub.
      expect(r.hops).toBe(2);
      expect(r.paths.length).toBeLessThanOrEqual(DEFAULT_MAX_PATHS);
      expect(r.paths.map((p) => p.nodes[1])).toEqual(
        expect.arrayContaining([f.hub1, f.hub2]),
      );
      // Ids and counts only — never an element body.
      for (const p of r.paths)
        for (const v of [...p.nodes, ...p.links])
          expect(typeof v).toBe('string');
      expect(bytes(r)).toBeLessThan(1000);
      expect(JSON.stringify(f.doc)).toBe(before);
    });

    it('honours maxPaths, and says where a cut list ends', () => {
      const f = fabric();
      const ask = { topologyId: f.id, from: f.br1, to: f.br2 };
      const one = call({ ...ask, maxPaths: 1 });
      expect(one.paths).toHaveLength(1);
      // Cut among the shortest routes: there are more two-hop routes.
      expect(one.truncated).toBe(true);
      expect(one.truncatedAt).toBe(2);

      const many = call({ ...ask, maxPaths: MAX_PATHS });
      const api = f.api(f.br1, f.br2, { maxPaths: MAX_PATHS });
      expect(many.paths.map((p) => p.nodes)).toEqual(
        api.paths.map((p) => p.nodes),
      );
      expect(many.paths.length).toBeGreaterThan(one.paths.length);
      const lengths = many.paths.map((p) => p.hops);
      expect(lengths).toEqual([...lengths].sort((x, y) => x - y));
      expect(many.truncatedAt).toBe(api.truncatedAt);
    });

    it('reads the layers the way render_svg draws them', () => {
      const f = fabric();
      const layerOf = new Map(f.page.links.map((l) => [l.id, l.layer]));
      const hidden = f.layers
        .filter((l) => l.defaultVisible === false)
        .map((l) => l.id);
      expect(hidden.length).toBeGreaterThan(0);
      const tunnels = between(f.page, f.br1, f.hub1);
      expect(tunnels.some((id) => hidden.includes(layerOf.get(id)!))).toBe(
        true,
      );
      const ask = { topologyId: f.id, from: f.br1, to: f.hub1, maxPaths: 1 };
      const every = (r: Answer): string[] => [
        ...r.paths[0]!.links,
        ...(r.paths[0]!.parallel ?? []).flatMap((x) => x.links),
      ];

      // By default: nothing on a layer the document hides by default.
      const asDrawn = call(ask);
      expect(asDrawn.paths[0]!.nodes).toEqual([f.br1, f.hub1]);
      for (const id of every(asDrawn))
        expect(hidden).not.toContain(layerOf.get(id));

      // Every layer shown: all the tunnels between the two, as ONE hop.
      const all = call({ ...ask, visibleLayers: f.layers.map((l) => l.id) });
      expect(all.paths).toHaveLength(1);
      expect(tunnels.length).toBeLessThanOrEqual(MAX_LISTED_PARALLEL);
      expect(all.paths[0]!.parallel).toEqual([{ hop: 0, links: tunnels }]);

      // Only the base layer: whatever joins them without a layered tunnel.
      const base = call({ ...ask, visibleLayers: [] });
      expect(base.status).toBe('found');
      for (const id of every(base)) expect(layerOf.get(id)).toBeUndefined();
    });

    it('reads page 0 unless told otherwise', () => {
      const { id, doc } = drawn('a-b b-c');
      // A second page, as authoring tools leave it: the "current" last page.
      doc.pages.push({
        ...structuredClone(doc.pages[0]!),
        id: 'p2',
        nodes: [],
        links: [],
      });
      draw(doc.pages[1]!, 'a-c');
      const ask = { topologyId: id, from: 'a', to: 'c' };
      expect(call(ask).hops).toBe(2);
      expect(call({ ...ask, pageIndex: 1 }).hops).toBe(1);
      expect(() => call({ ...ask, pageIndex: 2 })).toThrow(
        'page index 2 out of range (0..1)',
      );
      expect(() => call({ ...ask, topologyId: 'nope' })).toThrow(
        'unknown topology "nope"',
      );
    });

    it('names an unknown end, and what the id is instead', () => {
      const { id, doc } = drawn('a-b');
      doc.pages[0]!.zones.push({ id: 'z', nodes: ['a'] });
      expect(() => call({ topologyId: id, from: 'a', to: 'ghost' })).toThrow(
        'to "ghost" is not a node or anchor on page 0. get_topology lists the ids on a page.',
      );
      expect(() => call({ topologyId: id, from: 'ab', to: 'z' })).toThrow(
        'from "ab" is not a node or anchor on page 0 (it is a link); to "z" is not a node or anchor on page 0 (it is a zone).',
      );
    });

    it('says when both ends are the same element', () => {
      const { id } = drawn('a-b');
      expect(
        call({ topologyId: id, from: 'a', to: 'a', show: 'page' }),
      ).toEqual({
        status: 'same',
        id: 'a',
        note: 'from and to are the same element: nothing to trace, nothing changed.',
      });
      expect(store.get(id).pages).toHaveLength(1);
    });

    it('lists anchors and blocked elements where a route has them', () => {
      const { id, doc } = drawn('a-j j-b b-c');
      const page = doc.pages[0]!;
      page.nodes = page.nodes.filter((n) => n.id !== 'j');
      page.anchors.push({ id: 'j', x: 300, y: 300 });
      page.links.find((l) => l.id === 'bc')!.type = 'blocked';
      const r = call({ topologyId: id, from: 'a', to: 'c' });
      expect(r).toMatchObject({
        status: 'found',
        blockedOnly: true,
        paths: [
          {
            hops: 3,
            nodes: ['a', 'j', 'b', 'c'],
            links: ['aj', 'jb', 'bc'],
            anchors: ['j'],
            blocked: ['bc'],
          },
        ],
      });
      expect(r.note).toContain('blocked / down');
      // An anchor end has no label to report.
      expect(call({ topologyId: id, from: 'j', to: 'a' }).from).toEqual({
        id: 'j',
      });
    });

    it('lists at most MAX_LISTED_IDS ids, then hop counts only', () => {
      // A route of h hops lists h + 1 stops and h links.
      const most = Math.floor((MAX_LISTED_IDS - 1) / 2);
      const line = Array.from(
        { length: most + 1 },
        (_, i) => `n${i}-n${i + 1}`,
      );
      const { id } = drawn(line.join(' '));
      const fits = call({ topologyId: id, from: 'n0', to: `n${most}` });
      expect(fits.paths[0]!.nodes).toHaveLength(most + 1);
      expect(fits.paths[0]!.links).toHaveLength(most);
      expect(fits.unlisted).toBeUndefined();
      // One hop more does not fit: its hop count is all that comes back.
      const long = call({ topologyId: id, from: 'n0', to: `n${most + 1}` });
      expect(long.paths).toEqual([{ hops: most + 1, listed: false }]);
      expect(long.unlisted).toContain(`at most ${MAX_LISTED_IDS} ids`);
      expect(bytes(long)).toBeLessThan(500);

      // Two ways round a ring of 300: the first is listed, the second would
      // take the answer past the budget.
      const ring = Array.from(
        { length: 300 },
        (_, i) => `r${i}-r${(i + 1) % 300}`,
      );
      const round = drawn(ring.join(' '));
      const ask = { topologyId: round.id, from: 'r0', to: 'r150' };
      const both = call(ask);
      expect(both.paths.map((p) => p.hops)).toEqual([150, 150]);
      expect(both.paths[0]!.nodes).toHaveLength(151);
      expect(both.paths[1]).toEqual({ hops: 150, listed: false });
      expect(both.unlisted).toMatch(/^1 of these routes did not fit/);
      // The presentation is not limited by what the answer lists.
      expect(call({ ...ask, show: 'emphasis' }).shown).toEqual({
        emphasis: 301,
      });
    });

    it('counts, rather than lists, the links of a very wide bundle', () => {
      const bundle = Array.from({ length: 10 }, (_, i) => `w${i}:a-b`);
      const wide = drawn(bundle.join(' '));
      const r = call({ topologyId: wide.id, from: 'a', to: 'b' });
      expect(r.paths[0]!.parallel).toEqual([
        {
          hop: 0,
          links: bundle
            .slice(0, MAX_LISTED_PARALLEL)
            .map((t) => t.split(':')[0]),
          more: 10 - MAX_LISTED_PARALLEL,
        },
      ]);
    });
  });

  describe('when there is no path', () => {
    it('says so and what to do about an unlinked element', () => {
      const { id, doc } = drawn('a-b');
      doc.pages[0]!.nodes.push({
        id: 'c',
        type: 'host',
        x: 0,
        y: 0,
        label: 'C',
      });
      expect(call({ topologyId: id, from: 'a', to: 'c' })).toEqual({
        status: 'disconnected',
        from: { id: 'a', label: 'A' },
        to: { id: 'c', label: 'C' },
        reach: { from: 1, to: 0 },
        next: '"c" has no usable link on this page: connect it with add_link, or check pageIndex.',
      });
    });

    it('speaks of both ends when neither has a link', () => {
      const { id, doc } = drawn('a-b');
      for (const lone of ['c', 'd'])
        doc.pages[0]!.nodes.push({ id: lone, type: 'host', x: 0, y: 0 });
      const r = call({ topologyId: id, from: 'c', to: 'd' });
      expect(r.reach).toEqual({ from: 0, to: 0 });
      expect(r.next).toBe(
        '"c" and "d" have no usable link on this page: connect them with add_link, or check pageIndex.',
      );
    });

    it('tells two separate groups apart from an unlinked element', () => {
      const { id } = drawn('a-b c-d');
      const r = call({ topologyId: id, from: 'a', to: 'd' });
      expect(r.status).toBe('disconnected');
      expect(r.reach).toEqual({ from: 1, to: 1 });
      expect(r.next).toContain('add_link');
      expect(r.next).toContain('validate_topology');
      expect(bytes(r)).toBeLessThan(400);
    });

    it('names the hidden layers that would join them, ready to pass back', () => {
      const { id, doc } = drawn('a-b b-c');
      doc.layers = [{ id: 'core' }, { id: 'edge', defaultVisible: false }];
      doc.pages[0]!.links[0]!.layer = 'core';
      doc.pages[0]!.links[1]!.layer = 'edge';
      const ask = { topologyId: id, from: 'a', to: 'c' };
      expect(call(ask)).toEqual({
        status: 'disconnected',
        from: { id: 'a', label: 'A' },
        to: { id: 'c', label: 'C' },
        reach: { from: 1, to: 0 },
        hiddenLayers: ['edge'],
        // The layers drawn now, plus the one that would join them.
        next: 'They are joined only through hidden layers: call again with visibleLayers ["core","edge"].',
      });
      expect(call({ ...ask, visibleLayers: ['core', 'edge'] }).hops).toBe(2);

      // A layer in use but never declared is drawn by default; naming an
      // explicit set would hide it, so the suggestion carries it too.
      draw(doc.pages[0]!, 'c-d');
      doc.pages[0]!.links[2]!.layer = 'adhoc';
      const far = call({ ...ask, to: 'd' });
      expect(far.hiddenLayers).toEqual(['edge']);
      expect(far.next).toContain('visibleLayers ["core","adhoc","edge"]');
      const retry = {
        ...ask,
        to: 'd',
        visibleLayers: ['core', 'adhoc', 'edge'],
      };
      expect(call(retry).hops).toBe(3);
    });

    it('finds the tunnels of a fabric when asked for the layers it names', () => {
      const f = fabric();
      // Leave only the layered tunnels, then ask for the base layer alone.
      f.page.links = f.page.links.filter((l) => l.layer);
      const ask = { topologyId: f.id, from: f.hub1, to: f.hub2 };
      const apart = call({ ...ask, visibleLayers: [] });
      expect(apart.status).toBe('disconnected');
      const [firstTunnel] = between(f.page, f.hub1, f.hub2);
      const layer = f.page.links.find((l) => l.id === firstTunnel)!.layer;
      expect(apart.hiddenLayers).toEqual([layer]);
      expect(apart.next).toBe(
        `They are joined only through hidden layers: call again with visibleLayers ${JSON.stringify([layer])}.`,
      );
      const retry = call({ ...ask, visibleLayers: apart.hiddenLayers });
      expect(retry.status).toBe('found');
      expect(retry.hops).toBe(1);
    });

    it('changes nothing, and says so, when a presentation was asked for', () => {
      const { id, doc } = drawn('a-b c-d');
      const before = JSON.stringify(doc);
      for (const show of ['emphasis', 'flow', 'page']) {
        const r = call({ topologyId: id, from: 'a', to: 'd', show });
        expect(r.status).toBe('disconnected');
        expect(r.next).toMatch(/Nothing was changed\.$/);
        expect(r.shown).toBeUndefined();
      }
      expect(JSON.stringify(doc)).toBe(before);
    });
  });

  describe('show', () => {
    /** Ids `set_page_properties` accepts in `emphasis`. */
    const spotlightable = (page: Page): Set<string> =>
      new Set([...page.nodes.map((n) => n.id), ...page.links.map((l) => l.id)]);
    const errors = (doc: TopologyDocument) =>
      validateDocument(doc).filter((p) => p.level === 'error');

    it('"none" is the default and writes nothing', () => {
      const f = fabric();
      const ask = { topologyId: f.id, from: f.br1, to: f.br2 };
      const before = JSON.stringify(f.doc);
      expect(call(ask).shown).toBeUndefined();
      expect(call({ ...ask, show: 'none' }).shown).toBeUndefined();
      expect(JSON.stringify(f.doc)).toBe(before);
    });

    it('"emphasis" spotlights the first path on the page', () => {
      const { id, doc } = drawn('a-b b-c a-d d-c');
      const page = doc.pages[0]!;
      const ask = { topologyId: id, from: 'a', to: 'c' };
      const r = call({ ...ask, show: 'emphasis' });
      expect(r.paths.map((p) => p.nodes.join('>'))).toEqual(['a>b>c', 'a>d>c']);
      expect(page.emphasis).toEqual(['a', 'ab', 'b', 'bc', 'c']);
      expect(r.shown).toEqual({ emphasis: 5 });
      expect(doc.pages).toHaveLength(1);
      expect(page.flowPaths).toEqual([]);
      expect(errors(doc)).toEqual([]);
      // Asking again replaces the spotlight; it does not pile up.
      call({ ...ask, to: 'd', show: 'emphasis' });
      expect(page.emphasis).toEqual(['a', 'ad', 'd']);
    });

    it('"emphasis" leaves anchors out and takes every parallel link', () => {
      const { id, doc } = drawn('a-j j-b x:b-c y:b-c');
      const page = doc.pages[0]!;
      page.nodes = page.nodes.filter((n) => n.id !== 'j');
      page.anchors.push({ id: 'j', x: 300, y: 300 });
      call({ topologyId: id, from: 'a', to: 'c', show: 'emphasis' });
      expect(page.emphasis).toEqual(['a', 'aj', 'jb', 'b', 'x', 'y', 'c']);
      const allowed = spotlightable(page);
      expect(page.emphasis!.every((x) => allowed.has(x))).toBe(true);
    });

    it('"flow" adds a flow path along the first path', () => {
      const { id, doc } = drawn('a-b b-c');
      const page = doc.pages[0]!;
      const r = call({ topologyId: id, from: 'a', to: 'c', show: 'flow' });
      expect(page.flowPaths).toHaveLength(1);
      const [flow] = page.flowPaths;
      expect(r.shown).toEqual({ flowPathId: flow!.id });
      expect(flow).toEqual({
        id: flow!.id,
        waypoints: ['a', 'b', 'c'],
        label: 'A -> C · 2 hops',
        hops: [
          { ref: 'b', linkId: 'ab' },
          { ref: 'c', linkId: 'bc' },
        ],
      });
      expect(page.emphasis).toBeUndefined();
      expect(doc.pages).toHaveLength(1);
      expect(errors(doc)).toEqual([]);
    });

    it('presents a fabric route exactly as the API would', () => {
      const f = fabric();
      const ask = { topologyId: f.id, from: f.br1, to: f.br2 };
      const [first] = f.api(f.br1, f.br2).paths;
      const flowsBefore = f.page.flowPaths.length;
      const allowed = spotlightable(f.page);

      call({ ...ask, show: 'emphasis' });
      expect(f.page.emphasis).toEqual(pathEmphasis(first!));
      expect(f.page.emphasis!.every((x) => allowed.has(x))).toBe(true);

      const flowed = call({ ...ask, show: 'flow' });
      expect(f.page.flowPaths).toHaveLength(flowsBefore + 1);
      const flow = f.page.flowPaths[flowsBefore]!;
      expect(flowed.shown).toEqual({ flowPathId: flow.id });
      expect(flow).toEqual({ id: flow.id, ...pathFlow(f.page, first!) });
      expect(flow.waypoints).toEqual(first!.nodes);
      // The route rides tunnels of one layer, so the flow is on that layer:
      // it rides those tunnels and hides with them.
      const layers = new Set(flow.hops!.map((h) => h.layer));
      expect(layers.size).toBe(1);
      expect(flow.layer).toBe([...layers][0]);
      expect(flow.layer).toBeTruthy();

      const paged = call({ ...ask, show: 'page' });
      const copy = f.doc.pages[f.doc.pages.length - 1]!;
      expect(paged.shown).toEqual({
        pageIndex: f.doc.pages.length - 1,
        name: `Path: ${pathLabel(f.page, first!)}`,
      });
      expect(copy.emphasis).toEqual(pathEmphasis(first!));
      expect(copy.caption).toBe(pathCaption(f.page, first!));
      expect(copy.caption).toContain(labelOf(f.page, first!.nodes[1]!));

      expect(errors(f.doc)).toEqual([]);
      const aboutFlow = validateDocument(f.doc).filter((p) =>
        p.where.includes(`flow path "${flow.id}"`),
      );
      expect(aboutFlow).toEqual([]);
    });

    it('"page" appends a copy of the page with the path spotlit and captioned', () => {
      const { id, doc } = drawn('a-b b-c');
      const source = doc.pages[0]!;
      source.caption = 'As built';
      source.emphasis = ['a'];
      const before = JSON.stringify(source);
      const r = call({ topologyId: id, from: 'a', to: 'c', show: 'page' });

      expect(doc.pages).toHaveLength(2);
      expect(r.shown).toEqual({ pageIndex: 1, name: 'Path: A -> C · 2 hops' });
      const copy = doc.pages[1]!;
      expect(copy.name).toBe('Path: A -> C · 2 hops');
      expect(copy.caption).toBe('Path: A -> C · 2 hops via B');
      expect(copy.emphasis).toEqual(['a', 'ab', 'b', 'bc', 'c']);
      // A complete, independent frame: the same elements, its own id…
      expect(copy.id).not.toBe(source.id);
      expect(copy.nodes).toEqual(source.nodes);
      expect(copy.links).toEqual(source.links);
      expect(copy.nodes).not.toBe(source.nodes);
      expect(copy.nodes[0]).not.toBe(source.nodes[0]);
      // …and the page it came from is exactly as it was, story and all.
      expect(JSON.stringify(source)).toBe(before);
      copy.nodes[0]!.label = 'edited on the copy';
      expect(JSON.stringify(source)).toBe(before);
      expect(errors(doc)).toEqual([]);
    });

    it('"page" appends after the last page, whichever page was read', () => {
      const { id, doc } = drawn('a-b b-c');
      doc.pages.push({
        ...structuredClone(doc.pages[0]!),
        id: 'p2',
        name: 'Two',
      });
      const ask = { topologyId: id, from: 'a', to: 'c', show: 'page' };
      const r = call(ask);
      expect(r.shown).toEqual({ pageIndex: 2, name: 'Path: A -> C · 2 hops' });
      expect(doc.pages.map((p) => p.name)).toEqual([
        'Frame 1',
        'Two',
        'Path: A -> C · 2 hops',
      ]);
      // Each call is a new page.
      call({ ...ask, to: 'b', pageIndex: 1 });
      expect(doc.pages).toHaveLength(4);
      expect(new Set(doc.pages.map((p) => p.id)).size).toBe(4);
    });

    it('presents the only route even when it is blocked, and says so', () => {
      const { id, doc } = drawn('a-b b-c');
      const page = doc.pages[0]!;
      Object.assign(page.links[1]!, { type: 'blocked', label: 'Deny' });
      const r = call({ topologyId: id, from: 'a', to: 'c', show: 'page' });
      expect(r.blockedOnly).toBe(true);
      expect(doc.pages[1]!.caption).toBe(
        'Path: A -> C · 2 hops via B · crosses blocked or down: Deny',
      );
      expect(doc.pages[1]!.emphasis).toEqual(['a', 'ab', 'b', 'bc', 'c']);
    });
  });
});
