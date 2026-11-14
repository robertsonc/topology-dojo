/**
 * Path analysis between two elements of a page — the "visual traceroute".
 *
 * Static by design: the answer comes only from what the page draws. The graph
 * is the page's nodes and anchors joined by its links; nothing is discovered,
 * weighted or inferred. Pure and DOM-free, so the editor and the MCP tool
 * (`analyze_path`) compute the same answer from the same document.
 *
 * The graph
 * - A link is traversable in both directions, whatever its `from` / `to`.
 * - Nodes and anchors are both stops. An anchor is a junction like any
 *   other: it appears in a route's `nodes` in travel order, every link
 *   through it is a hop, and the route's `anchors` names it so a caller can
 *   tell it from a node (an anchor is never part of `page.emphasis`).
 * - A link from an element to itself, or to an id that is not on the page,
 *   is ignored.
 * - Several links joining the same two elements are ONE hop. A route is a
 *   sequence of elements; `links[i]` names the first of the hop's links in
 *   page order and `parallel` lists them all. Parallel links therefore never
 *   multiply the list of routes.
 * - Layers: only what is drawn counts, by the renderer's own rule
 *   (`layerVisible`) — an element with no `layer` always counts, an explicit
 *   `visibleLayers` set overrides, otherwise a declared layer counts unless
 *   it is `defaultVisible: false`. A hidden node cannot be passed through.
 * - Blocked: a link of type `blocked`, a link marked down (`meta.status` or
 *   `status` = "down", the way the fabric compiler marks a down tunnel) and
 *   passing THROUGH a node whose `status` is "down" are all avoided by
 *   default (`ignoreBlocked`). The two ends themselves may be down. When the
 *   only routes cross one, they are still returned, with `blockedOnly` on
 *   the result and the offending ids in each route's `blocked`.
 *
 * Order
 * Routes come shortest first, by hop count (a hop is one link). Routes with
 * the same hop count are ordered by the page order of their links: compare
 * the position in `page.links` of the first hop's link, then the second
 * hop's, and so on. Shuffling `page.links` can therefore change the order of
 * equal-length routes, which of a hop's parallel links is named first, which
 * routes fit under `maxPaths`, and which route `hiddenLayers` is read from —
 * and nothing else. The order of `page.nodes` never matters.
 *
 * Work
 * One breadth-first pass measures every element's distance to the target.
 * Routes are then read off depth-first, never stepping where the hops left
 * cannot reach the target, one exact length at a time: the shortest, then up
 * to `extraHops` longer. Shortest routes are found without dead ends, so the
 * work is proportional to the routes returned, not to how many exist. The
 * search is also limited to a number of steps proportional to
 * `maxPaths` × links; a search that spends it stops and sets `truncated`
 * (`truncatedAt` says at which hop count, so a caller knows whether every
 * shortest route made the list).
 */
import type { Page } from '../pages/model.js';
import type {
  AnchorConfig,
  FlowHop,
  LinkConfig,
} from '../vendor/topology-ds.js';
import type { FlowPathInput } from './builder.js';
import { layerVisible, type LayerDef } from './layers.js';
import { TEXT_LIMITS, normalizeText } from './text.js';

/** The part of a page the analysis reads. */
export type PathPage = Pick<Page, 'nodes' | 'links'> & {
  anchors?: AnchorConfig[];
};

export const PATH_DEFAULTS = { maxPaths: 8, extraHops: 2 } as const;
export const PATH_LIMITS = { maxPaths: 64, extraHops: 8 } as const;

export interface PathOptions {
  /**
   * The document's declared layers (`doc.layers`). They supply each layer's
   * `defaultVisible`, so the analysis sees what the page draws by default.
   */
  layers?: readonly LayerDef[];
  /**
   * Count only these layers (elements with no layer always count) — the
   * same argument, with the same meaning, as the renderer's.
   */
  visibleLayers?: readonly string[];
  /** Avoid blocked / down links and down nodes. Default true. */
  ignoreBlocked?: boolean;
  /** Most routes to return (default 8, at most 64). */
  maxPaths?: number;
  /**
   * How many hops longer than the shortest route an alternative may be
   * (default 2, at most 8; 0 = shortest routes only).
   */
  extraHops?: number;
}

/** One route between the two elements. */
export interface PathRoute {
  /**
   * Node and anchor ids in travel order: the start first, the end last.
   * Ready to use as flow-path waypoints.
   */
  nodes: string[];
  /**
   * The link of each hop: `links[i]` joins `nodes[i]` and `nodes[i + 1]`.
   * Where several links join the pair it is the first in page order
   * (usable ones before blocked ones); `parallel` lists them all.
   */
  links: string[];
  /** Links traversed (`links.length`). */
  hops: number;
  /** The ids in `nodes` that are anchors. Absent when there are none. */
  anchors?: string[];
  /**
   * Hops joined by more than one link: every link of that hop, `links[hop]`
   * first. Absent when no hop has parallel links.
   */
  parallel?: { hop: number; links: string[] }[];
  /**
   * Blocked / down elements this route crosses, in travel order: link ids,
   * and the ids of down nodes it passes through. Absent when it crosses none.
   */
  blocked?: string[];
}

export interface PathFound {
  status: 'found';
  from: string;
  to: string;
  /** Hop count of the shortest route (`paths[0].hops`). */
  hops: number;
  /** The routes, shortest first (see "Order" above). Never empty. */
  paths: PathRoute[];
  /**
   * More routes exist within the hop budget than `maxPaths` allowed, or the
   * search reached its work limit before it could rule that out.
   */
  truncated: boolean;
  /**
   * With `truncated`: the hop count at which the list was cut. Every route
   * with fewer hops is listed; routes with this many or more may be missing
   * — so when it is above `hops`, every shortest route is in `paths`.
   */
  truncatedAt?: number;
  /**
   * Every route between the two crosses a blocked / down element: with
   * `ignoreBlocked` these are the routes that would work if it were not.
   */
  blockedOnly?: true;
}

export interface PathSame {
  status: 'same';
  from: string;
  to: string;
}

export interface PathDisconnected {
  status: 'disconnected';
  from: string;
  to: string;
  /** How many other elements each end reaches over the links considered. */
  reach: { from: number; to: number };
  /**
   * Layers that are not visible but, shown, would join the two (read from
   * the first shortest route through hidden elements). Absent when the two
   * are apart on every layer.
   */
  hiddenLayers?: string[];
}

export interface PathUnknown {
  status: 'unknown';
  from: string;
  to: string;
  /** Which of the two ids is not a node or anchor on the page. */
  unknown: ('from' | 'to')[];
}

export type PathAnalysis =
  | PathFound
  | PathSame
  | PathDisconnected
  | PathUnknown;

const isDown = (status: unknown): boolean =>
  typeof status === 'string' && status.toLowerCase() === 'down';

/**
 * Whether a link is drawn as not carrying traffic: its type is `blocked`, or
 * it is marked down (`meta.status` — what the fabric compiler writes for a
 * down tunnel — or a top-level `status`).
 */
export function isBlockedLink(link: LinkConfig): boolean {
  if (link.type === 'blocked' || isDown(link.status)) return true;
  const meta = link.meta;
  return (
    typeof meta === 'object' &&
    meta !== null &&
    isDown((meta as Record<string, unknown>).status)
  );
}

/* ── the graph ────────────────────────────────────────────────────── */

/** A step from one element to a neighbour, over all the links joining them. */
interface Hop {
  /** The neighbour. */
  to: number;
  /** Positions in `page.links`: usable links first, each kind in page order. */
  links: number[];
  /** No usable link joins the pair, or one of them is a down node. */
  blocked: boolean;
}

interface Graph {
  /** Element id of each vertex. */
  ids: string[];
  index: Map<string, number>;
  anchor: boolean[];
  /** A node marked down that is not one of the two ends. */
  down: boolean[];
  /** Neighbours of each vertex, in page order of each hop's first link. */
  adj: Hop[][];
  /** Hops in total, counted from both ends. */
  size: number;
}

function buildGraph(
  page: PathPage,
  visible: (layer: string | undefined) => boolean,
  ends: readonly string[],
  withBlocked: boolean,
): Graph {
  const ids: string[] = [];
  const index = new Map<string, number>();
  const anchor: boolean[] = [];
  const down: boolean[] = [];
  for (const n of page.nodes) {
    if (index.has(n.id) || !visible(n.layer)) continue;
    index.set(n.id, ids.length);
    ids.push(n.id);
    anchor.push(false);
    down.push(isDown(n.status) && !ends.includes(n.id));
  }
  for (const a of page.anchors ?? []) {
    if (index.has(a.id)) continue;
    index.set(a.id, ids.length);
    ids.push(a.id);
    anchor.push(true);
    down.push(false);
  }

  const joins = ids.map(
    () => new Map<number, { usable: number[]; blocked: number[] }>(),
  );
  page.links.forEach((link, position) => {
    if (link.from === link.to || !visible(link.layer)) return;
    const u = index.get(link.from);
    const v = index.get(link.to);
    if (u === undefined || v === undefined) return;
    const blocked = isBlockedLink(link) || down[u]! || down[v]!;
    if (blocked && !withBlocked) return;
    for (const [a, b] of [
      [u, v],
      [v, u],
    ] as const) {
      let join = joins[a]!.get(b);
      if (!join) joins[a]!.set(b, (join = { usable: [], blocked: [] }));
      (blocked ? join.blocked : join.usable).push(position);
    }
  });

  let size = 0;
  const adj = joins.map((join) => {
    const hops: Hop[] = [];
    for (const [to, { usable, blocked }] of join)
      hops.push({
        to,
        links: usable.concat(blocked),
        blocked: usable.length === 0,
      });
    size += hops.length;
    return hops.sort((a, b) => a.links[0]! - b.links[0]!);
  });
  return { ids, index, anchor, down, adj, size };
}

/** "Not reachable" in a distance table. */
const FAR = 0x3fffffff;

/** Hop distance of every vertex from `root` (breadth-first). */
function distances(g: Graph, root: number): Int32Array {
  const dist = new Int32Array(g.ids.length).fill(FAR);
  const queue = new Int32Array(g.ids.length);
  let head = 0;
  let tail = 0;
  dist[root] = 0;
  queue[tail++] = root;
  while (head < tail) {
    const v = queue[head++]!;
    const next = dist[v]! + 1;
    for (const hop of g.adj[v]!)
      if (dist[hop.to] === FAR) {
        dist[hop.to] = next;
        queue[tail++] = hop.to;
      }
  }
  return dist;
}

/** How many other elements `id` reaches (0 when it is not in the graph). */
function reach(g: Graph, id: string): number {
  const root = g.index.get(id);
  if (root === undefined) return 0;
  let n = -1;
  for (const d of distances(g, root)) if (d !== FAR) n++;
  return n;
}

/* ── the search ───────────────────────────────────────────────────── */

interface Trail {
  verts: number[];
  hops: Hop[];
}

/**
 * Search steps allowed: a base, plus this many per route asked for per hop
 * in the graph. The first route takes at most one step per hop, so there is
 * always a route to return before the budget can run out.
 */
const SEARCH_BASE = 20_000;
const SEARCH_PER_HOP = 8;

/**
 * The routes from `s` to `t`, shortest first, or null when there is none.
 *
 * For each exact length (the shortest, then up to `extraHops` longer) a
 * depth-first walk tries each vertex's neighbours in order and steps only
 * where the hops left can still reach `t` — so a walk of the shortest length
 * never meets a dead end, and each length comes out in the documented order.
 * `cutAt` is the length being walked when the list filled up or the step
 * budget ran out; absent when every route within the hop budget is listed.
 */
function search(
  g: Graph,
  s: number,
  t: number,
  maxPaths: number,
  extraHops: number,
): { trails: Trail[]; cutAt?: number } | null {
  const toTarget = distances(g, t);
  const shortest = toTarget[s]!;
  if (shortest === FAR) return null;

  const trails: Trail[] = [];
  let budget = SEARCH_BASE + SEARCH_PER_HOP * (maxPaths + 1) * g.size;
  const onTrail = new Uint8Array(g.ids.length);

  for (let length = shortest; length <= shortest + extraHops; length++) {
    const verts = [s];
    const hops: Hop[] = [];
    /** Next neighbour to try at each depth. */
    const cursor = [0];
    onTrail[s] = 1;
    while (verts.length) {
      const depth = verts.length - 1;
      const v = verts[depth]!;
      const neighbours = g.adj[v]!;
      /** Hops still to make once the next one is taken. */
      const left = length - depth - 1;
      let step: Hop | undefined;
      let i = cursor[depth]!;
      while (!step && i < neighbours.length) {
        const hop = neighbours[i++]!;
        if (--budget < 0) return { trails, cutAt: length };
        if (onTrail[hop.to]) continue;
        if (hop.to === t) {
          if (left !== 0) continue;
          if (trails.length === maxPaths) return { trails, cutAt: length };
          trails.push({ verts: [...verts, t], hops: [...hops, hop] });
        } else if (toTarget[hop.to]! <= left) step = hop;
      }
      cursor[depth] = i;
      if (step) {
        verts.push(step.to);
        hops.push(step);
        cursor.push(0);
        onTrail[step.to] = 1;
      } else {
        onTrail[v] = 0;
        verts.pop();
        hops.pop();
        cursor.pop();
      }
    }
  }
  return { trails };
}

function toRoute(page: PathPage, g: Graph, trail: Trail): PathRoute {
  const linkAt = (position: number): LinkConfig => page.links[position]!;
  const nodes = trail.verts.map((v) => g.ids[v]!);
  const links = trail.hops.map((hop) => linkAt(hop.links[0]!).id);
  const anchors = trail.verts.filter((v) => g.anchor[v]).map((v) => g.ids[v]!);
  const parallel = trail.hops.flatMap((hop, i) =>
    hop.links.length > 1
      ? [{ hop: i, links: hop.links.map((p) => linkAt(p).id) }]
      : [],
  );
  const blocked: string[] = [];
  trail.hops.forEach((hop, i) => {
    if (!hop.blocked) return;
    const [a, b] = [trail.verts[i]!, trail.verts[i + 1]!];
    const crossed = [
      ...(g.down[a] ? [g.ids[a]!] : []),
      ...(isBlockedLink(linkAt(hop.links[0]!)) ? [links[i]!] : []),
      ...(g.down[b] ? [g.ids[b]!] : []),
    ];
    for (const id of crossed) if (!blocked.includes(id)) blocked.push(id);
  });
  return {
    nodes,
    links,
    hops: links.length,
    ...(anchors.length ? { anchors } : {}),
    ...(parallel.length ? { parallel } : {}),
    ...(blocked.length ? { blocked } : {}),
  };
}

function clamp(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * The path(s) between two elements of a page, over the links it draws.
 *
 * `fromId` / `toId` are node or anchor ids. See the module header for the
 * graph rules, the order of the routes and the work bound.
 */
export function analyzePath(
  page: PathPage,
  fromId: string,
  toId: string,
  options: PathOptions = {},
): PathAnalysis {
  const known = new Set<string>();
  for (const n of page.nodes) known.add(n.id);
  for (const a of page.anchors ?? []) known.add(a.id);
  const unknown = (['from', 'to'] as const).filter(
    (end) => !known.has(end === 'from' ? fromId : toId),
  );
  if (unknown.length)
    return { status: 'unknown', from: fromId, to: toId, unknown };
  if (fromId === toId) return { status: 'same', from: fromId, to: toId };

  const maxPaths = clamp(
    options.maxPaths,
    PATH_DEFAULTS.maxPaths,
    1,
    PATH_LIMITS.maxPaths,
  );
  const extraHops = clamp(
    options.extraHops,
    PATH_DEFAULTS.extraHops,
    0,
    PATH_LIMITS.extraHops,
  );
  const layers = options.layers ?? [];
  const visible = (layer: string | undefined): boolean =>
    layerVisible(layers, layer, options.visibleLayers);
  const ignoreBlocked = options.ignoreBlocked !== false;
  const ends = [fromId, toId];

  const routesIn = (g: Graph, most = maxPaths, extra = extraHops) => {
    const s = g.index.get(fromId);
    const t = g.index.get(toId);
    return s === undefined || t === undefined
      ? null
      : search(g, s, t, most, extra);
  };

  // What is drawn and usable; then, when that fails or was not asked for,
  // what is drawn at all.
  const usable = buildGraph(page, visible, ends, false);
  let graph = usable;
  let hit = ignoreBlocked ? routesIn(usable) : null;
  let blockedOnly = false;
  if (!hit) {
    graph = buildGraph(page, visible, ends, true);
    hit = routesIn(graph);
    blockedOnly =
      hit !== null && (ignoreBlocked || routesIn(usable, 1, 0) === null);
  }
  if (hit) {
    const paths = hit.trails.map((trail) => toRoute(page, graph, trail));
    return {
      status: 'found',
      from: fromId,
      to: toId,
      hops: paths[0]!.hops,
      paths,
      truncated: hit.cutAt !== undefined,
      ...(hit.cutAt !== undefined ? { truncatedAt: hit.cutAt } : {}),
      ...(blockedOnly ? { blockedOnly: true as const } : {}),
    };
  }

  // Apart as drawn. Would hidden layers join them? Read the layers off the
  // first shortest route through everything on the page.
  const considered = ignoreBlocked ? usable : graph;
  const everything = buildGraph(page, () => true, ends, true);
  const through = routesIn(everything, 1, 0)?.trails[0];
  const hiddenLayers: string[] = [];
  if (through) {
    const nodeLayer = new Map<string, string | undefined>();
    for (const n of page.nodes)
      if (!nodeLayer.has(n.id)) nodeLayer.set(n.id, n.layer);
    const need = (layer: string | undefined): void => {
      if (layer && !visible(layer) && !hiddenLayers.includes(layer))
        hiddenLayers.push(layer);
    };
    through.verts.forEach((v, i) => {
      if (!everything.anchor[v]) need(nodeLayer.get(everything.ids[v]!));
      const hop = through.hops[i];
      if (hop && !hop.links.some((p) => visible(page.links[p]!.layer)))
        need(page.links[hop.links[0]!]!.layer);
    });
  }
  return {
    status: 'disconnected',
    from: fromId,
    to: toId,
    reach: { from: reach(considered, fromId), to: reach(considered, toId) },
    ...(hiddenLayers.length ? { hiddenLayers } : {}),
  };
}

/* ── presenting a route ───────────────────────────────────────────── */

/**
 * The ids to spotlight for a route — the value for `page.emphasis`: its
 * nodes and links in travel order. Anchors are left out (emphasis takes
 * nodes and links only). Every parallel link of a hop is included, since the
 * route is the same whichever of them carries it; pass `parallel: false`
 * for just the one link named per hop.
 */
export function pathEmphasis(
  path: PathRoute,
  options: { parallel?: boolean } = {},
): string[] {
  const anchors = new Set(path.anchors);
  const all = new Map<number, string[]>();
  if (options.parallel !== false)
    for (const p of path.parallel ?? []) all.set(p.hop, p.links);
  const ids = new Set<string>();
  path.nodes.forEach((id, i) => {
    if (!anchors.has(id)) ids.add(id);
    const link = path.links[i];
    if (link !== undefined) for (const l of all.get(i) ?? [link]) ids.add(l);
  });
  return [...ids];
}

/** Longest element name quoted in a label or caption. */
const NAME_MAX = 40;

/** An element's label (a node's or a link's), else its id, kept short. */
function nameOf(page: PathPage, id: string): string {
  const label =
    page.nodes.find((n) => n.id === id)?.label ??
    page.links.find((l) => l.id === id)?.label;
  const name = (typeof label === 'string' && normalizeText(label)) || id;
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
}

/**
 * The arrow between the two ends in a label. Plain "->" on purpose: the
 * product's typeface (JetBrains Mono) draws it as an arrow, on the canvas
 * and in PNG / PDF exports alike — whereas the font those exports embed has
 * no "→" glyph, and would print an empty box in its place.
 */
const ARROW = '->';

/** A route in a few words: "Branch -> Hub · 3 hops" (labels, else ids). */
export function pathLabel(page: PathPage, path: PathRoute): string {
  const from = nameOf(page, path.nodes[0]!);
  const to = nameOf(page, path.nodes[path.nodes.length - 1]!);
  return `${from} ${ARROW} ${to} · ${path.hops} ${path.hops === 1 ? 'hop' : 'hops'}`;
}

/**
 * A one-line narration of a route for a page `caption`:
 * "Path: Branch -> Hub · 3 hops via Edge, Core", plus what it crosses when
 * the route is blocked.
 */
export function pathCaption(page: PathPage, path: PathRoute): string {
  const list = (ids: string[], most: number): string =>
    ids
      .slice(0, most)
      .map((id) => nameOf(page, id))
      .join(', ') + (ids.length > most ? ` +${ids.length - most} more` : '');
  const anchors = new Set(path.anchors);
  const via = path.nodes.slice(1, -1).filter((id) => !anchors.has(id));
  let text = `Path: ${pathLabel(page, path)}`;
  if (via.length) text += ` via ${list(via, 5)}`;
  if (path.blocked?.length)
    text += ` · crosses blocked or down: ${list(path.blocked, 3)}`;
  return text.length > TEXT_LIMITS.caption
    ? `${text.slice(0, TEXT_LIMITS.caption - 1)}…`
    : text;
}

/** Flow-path fields a caller may set or override on `pathFlow`'s result. */
export type PathFlowOptions = Partial<
  Omit<FlowPathInput, 'waypoints' | 'hops'>
>;

/**
 * A flow path along a route, ready for `addFlowPath` / `add_flow_path`: the
 * route's stops as waypoints (anchors included, so every leg rides exactly
 * one link), a per-hop record of the link each leg rides, and a label such
 * as "Branch -> Hub · 3 hops". When every link of the route is on the same
 * layer the flow is put on that layer too, so it rides those links — the
 * renderer prefers a link on the flow's own layer where several join a pair
 * — and hides with them. `options` sets or overrides any other field.
 */
export function pathFlow(
  page: PathPage,
  path: PathRoute,
  options: PathFlowOptions = {},
): FlowPathInput {
  const layerOf = new Map<string, string | undefined>();
  for (const l of page.links)
    if (!layerOf.has(l.id)) layerOf.set(l.id, l.layer);
  const hops: FlowHop[] = path.links.map((linkId, i) => {
    const layer = layerOf.get(linkId);
    return { ref: path.nodes[i + 1]!, linkId, ...(layer ? { layer } : {}) };
  });
  const shared = hops[0]?.layer;
  const oneLayer = shared && hops.every((hop) => hop.layer === shared);
  return {
    waypoints: [...path.nodes],
    label: pathLabel(page, path),
    hops,
    ...(oneLayer ? { layer: shared } : {}),
    ...options,
  };
}
