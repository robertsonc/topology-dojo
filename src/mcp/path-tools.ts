/**
 * `analyze_path` — the agent's side of path analysis ("visual traceroute").
 *
 * The same computation the editor runs (`src/api/path.ts`): the path between
 * two elements over the links one page draws, with alternatives, or the fact
 * that they are apart. `show` turns the first path into one of the
 * presentations the product already has: the page's `emphasis`, a flow path,
 * or — the flipbook way — a new page that is a copy of this one with the
 * path spotlit and captioned (the page it was copied from is not touched).
 *
 * The answer is ids and hop counts, never element bodies, and it is bounded:
 * it lists at most `MAX_LISTED_IDS` ids, and a route that would pass that
 * reports its hop count only.
 *
 * Classification: with `show` other than "none" the tool writes to the
 * document, so wherever tools are sorted by name it is a MUTATING tool — it
 * takes the mutating quota, persists the draft store, and is not one of the
 * reads that can be served from a shared workspace snapshot.
 */
import { z } from 'zod';
import { addFlowPath } from '../api/builder.js';
import { layerVisible } from '../api/layers.js';
import {
  analyzePath,
  pathCaption,
  pathEmphasis,
  pathFlow,
  pathLabel,
  type PathRoute,
} from '../api/path.js';
import { TEXT_LIMITS } from '../api/text.js';
import { duplicatePage, type Page } from '../pages/model.js';
import type { TopologyStore } from './store.js';
import type { ToolDef, ToolDeps } from './tools.js';

export const PATH_SHOW = ['none', 'emphasis', 'flow', 'page'] as const;
export type PathShow = (typeof PATH_SHOW)[number];

/** Routes listed when `maxPaths` is not given (the API's own default is 8). */
export const DEFAULT_MAX_PATHS = 4;
/** Most routes one call may ask for. */
export const MAX_PATHS = 20;
/** Ids one answer lists in all; a route past that reports its hop count. */
export const MAX_LISTED_IDS = 400;
/** Most parallel links listed for one hop; the rest are counted. */
export const MAX_LISTED_PARALLEL = 6;

/** An end of the path: its id, and its label when it has one. */
function endpoint(page: Page, id: string): { id: string; label?: string } {
  const label = page.nodes.find((n) => n.id === id)?.label;
  return { id, ...(label ? { label } : {}) };
}

/** What an id is on the page when it is not a node or an anchor. */
function otherKind(page: Page, id: string): string {
  const kinds: [string, { id: string }[]][] = [
    ['link', page.links],
    ['zone', page.zones ?? []],
    ['flow path', page.flowPaths ?? []],
    ['policy marker', page.policyMarkers ?? []],
  ];
  const kind = kinds.find(([, list]) => list.some((e) => e.id === id))?.[0];
  return kind ? ` (it is a ${kind})` : '';
}

/**
 * The routes as the answer lists them: ids and counts, within the id budget.
 * `unlisted` counts the routes that did not fit.
 */
function listRoutes(paths: PathRoute[]): {
  paths: Record<string, unknown>[];
  unlisted: number;
} {
  let ids = 0;
  let unlisted = 0;
  const listed = paths.map((path) => {
    const parallel = path.parallel?.map(({ hop, links }) => ({
      hop,
      links: links.slice(0, MAX_LISTED_PARALLEL),
      ...(links.length > MAX_LISTED_PARALLEL
        ? { more: links.length - MAX_LISTED_PARALLEL }
        : {}),
    }));
    const size =
      path.nodes.length +
      path.links.length +
      (path.anchors?.length ?? 0) +
      (path.blocked?.length ?? 0) +
      (parallel ?? []).reduce((n, p) => n + p.links.length, 0);
    if (ids + size > MAX_LISTED_IDS) {
      unlisted++;
      return { hops: path.hops, listed: false };
    }
    ids += size;
    return {
      hops: path.hops,
      nodes: path.nodes,
      links: path.links,
      ...(path.anchors ? { anchors: path.anchors } : {}),
      ...(parallel ? { parallel } : {}),
      ...(path.blocked ? { blocked: path.blocked } : {}),
    };
  });
  return { paths: listed, unlisted };
}

/**
 * The path-analysis tool. `_deps` is accepted so it composes like the other
 * tool groups; nothing here renders or reaches outside the store.
 */
export function pathTools(store: TopologyStore, _deps?: ToolDeps): ToolDef[] {
  return [
    {
      name: 'analyze_path',
      // Every byte here is in every agent's tool list: keep it under 900.
      description: `Path between two nodes/anchors over the links a page draws (pageIndex default 0; blocked/down elements avoided): up to maxPaths (default ${DEFAULT_MAX_PATHS}) routes, shortest first, or why there is none. show: emphasis spotlights the first route on the page, flow adds a flow path along it, page appends a copy of the page with it spotlit and captioned.`,
      inputShape: {
        topologyId: z.string(),
        pageIndex: z.number().int().min(0).optional(),
        from: z.string(),
        to: z.string(),
        maxPaths: z.number().int().min(1).max(MAX_PATHS).optional(),
        visibleLayers: z.array(z.string()).optional(),
        show: z.enum(PATH_SHOW).optional(),
      },
      handler: (a) => {
        const doc = store.get(String(a.topologyId));
        const index = (a.pageIndex as number | undefined) ?? 0;
        const page = doc.pages[index];
        if (!page)
          throw new Error(
            `page index ${index} out of range (0..${doc.pages.length - 1})`,
          );
        const from = String(a.from);
        const to = String(a.to);
        const show = (a.show as PathShow | undefined) ?? 'none';
        const layers = doc.layers ?? [];
        const visibleLayers = a.visibleLayers as string[] | undefined;

        const result = analyzePath(page, from, to, {
          layers,
          ...(visibleLayers ? { visibleLayers } : {}),
          maxPaths: (a.maxPaths as number | undefined) ?? DEFAULT_MAX_PATHS,
        });

        if (result.status === 'unknown') {
          const which = result.unknown.map((end) => {
            const id = end === 'from' ? from : to;
            return `${end} "${id}" is not a node or anchor on page ${index}${otherKind(page, id)}`;
          });
          throw new Error(
            `${which.join('; ')}. get_topology lists the ids on a page.`,
          );
        }
        if (result.status === 'same')
          return {
            status: 'same',
            id: from,
            note: 'from and to are the same element: nothing to trace, nothing changed.',
          };

        const ends = { from: endpoint(page, from), to: endpoint(page, to) };
        if (result.status === 'disconnected') {
          let next: string;
          if (result.hiddenLayers) {
            // Every layer in use that is drawn now (declared or not), so
            // the suggested set hides nothing that was counted before.
            const inUse = new Set(layers.map((l) => l.id));
            for (const el of [...page.nodes, ...page.links])
              if (el.layer) inUse.add(el.layer);
            const drawn = [...inUse].filter((layer) =>
              layerVisible(layers, layer, visibleLayers),
            );
            next = `They are joined only through hidden layers: call again with visibleLayers ${JSON.stringify([...drawn, ...result.hiddenLayers])}.`;
          } else if (!result.reach.from || !result.reach.to) {
            const lone = [
              ...(result.reach.from ? [] : [from]),
              ...(result.reach.to ? [] : [to]),
            ];
            const [has, it] =
              lone.length > 1 ? ['have', 'them'] : ['has', 'it'];
            next = `${lone.map((id) => `"${id}"`).join(' and ')} ${has} no usable link on this page: connect ${it} with add_link, or check pageIndex.`;
          } else
            next =
              'No drawn path joins them: they sit in separate groups of linked elements. Join the groups with add_link, or run validate_topology to find links with a missing end.';
          return {
            status: 'disconnected',
            ...ends,
            reach: result.reach,
            ...(result.hiddenLayers
              ? { hiddenLayers: result.hiddenLayers }
              : {}),
            next: show === 'none' ? next : `${next} Nothing was changed.`,
          };
        }

        const first = result.paths[0]!;
        let shown: Record<string, unknown> | undefined;
        if (show === 'emphasis') {
          page.emphasis = pathEmphasis(first);
          shown = { emphasis: page.emphasis.length };
        } else if (show === 'flow') {
          shown = { flowPathId: addFlowPath(page, pathFlow(page, first)).id };
        } else if (show === 'page') {
          const copy = duplicatePage(
            page,
            `Path: ${pathLabel(page, first)}`.slice(0, TEXT_LIMITS.name),
          );
          copy.emphasis = pathEmphasis(first);
          copy.caption = pathCaption(page, first);
          doc.pages.push(copy);
          shown = { pageIndex: doc.pages.length - 1, name: copy.name };
        }
        const routes = listRoutes(result.paths);
        return {
          status: 'found',
          ...ends,
          hops: result.hops,
          paths: routes.paths,
          truncated: result.truncated,
          ...(result.truncatedAt !== undefined
            ? { truncatedAt: result.truncatedAt }
            : {}),
          ...(result.blockedOnly
            ? {
                blockedOnly: true,
                note: 'No route avoids blocked / down elements; each path lists the ones it crosses in `blocked`.',
              }
            : {}),
          ...(routes.unlisted
            ? {
                unlisted: `${routes.unlisted} of these routes did not fit (an answer lists at most ${MAX_LISTED_IDS} ids) and report their hop count only; show presents the first route whatever its length.`,
              }
            : {}),
          ...(shown ? { shown } : {}),
        };
      },
    },
  ];
}
