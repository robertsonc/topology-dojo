/**
 * Write-time checks for the element tools.
 *
 * The authoring API is permissive on purpose (build, then `validate`), and
 * the tools inherited that: `add_link` to a node that does not exist, a second
 * node with an id already in use, a node of a type nobody defined, a flow with
 * one waypoint — each returned a success result, and the mistake only showed
 * up later in `validate_topology`, away from the call that made it.
 *
 * These are the mistakes that are wrong at the moment of the call whatever
 * comes next, so the call says so: what is wrong, and what would be right.
 * Whole-document writes (`import_topology`, `upsert_by_source`) are not
 * checked here; `validate_topology` remains the full check.
 */
import {
  getLinkType,
  getNodeType,
  linkCatalog,
  nodeCatalog,
} from '../api/catalog.js';
import type { Page, TopologyDocument } from '../pages/model.js';

type Args = Record<string, unknown>;

const KINDS: [string, (p: Page) => { id: string }[]][] = [
  ['node', (p) => p.nodes],
  ['link', (p) => p.links],
  ['anchor', (p) => p.anchors],
  ['zone', (p) => p.zones ?? []],
  ['flow path', (p) => p.flowPaths ?? []],
  ['policy marker', (p) => p.policyMarkers ?? []],
];

/** What kind of element on the page already has this id, if any. */
function kindOf(page: Page, id: string): string | undefined {
  for (const [kind, of] of KINDS)
    if (of(page).some((e) => e.id === id)) return kind;
  return undefined;
}

/** An explicit id must be free: element tools find elements by id alone. */
function newId(page: Page, id: unknown): void {
  if (typeof id !== 'string' || !id) return; // generated ids are unique
  const taken = kindOf(page, id);
  if (taken)
    throw new Error(
      `id "${id}" is already used by a ${taken} on this page — choose another id, or change that element with update_element`,
    );
}

/** A few known names that resemble `wanted`, for the error message. */
function similar(wanted: string, known: readonly string[]): string {
  const w = wanted.toLowerCase();
  const parts = w.split(/[^a-z0-9]+/).filter((p) => p.length >= 3);
  const hits = known.filter((k) => {
    const name = k.toLowerCase();
    return (
      name.includes(w) ||
      w.includes(name) ||
      parts.some((p) => name.includes(p))
    );
  });
  return hits.length ? ` Closest: ${hits.slice(0, 5).join(', ')}.` : '';
}

function knownNodeType(doc: TopologyDocument, type: unknown): void {
  if (typeof type !== 'string') return;
  if (getNodeType(type, doc.customNodes)) return;
  throw new Error(
    `unknown node type "${type}" — use a type from describe_capabilities, or declare it first with define_node_type.${similar(
      type,
      nodeCatalog(doc.customNodes).map((t) => t.type),
    )}`,
  );
}

function knownLinkType(type: unknown): void {
  if (typeof type !== 'string') return;
  if (getLinkType(type)) return;
  throw new Error(
    `unknown link type "${type}" — one of ${linkCatalog()
      .map((t) => t.type)
      .join(', ')}`,
  );
}

/** A link end or a flow waypoint: a node or an anchor on the page. */
function endpoint(page: Page, id: unknown, what: string): void {
  const s = String(id);
  if (
    page.nodes.some((n) => n.id === s) ||
    page.anchors.some((a) => a.id === s)
  )
    return;
  const other = kindOf(page, s);
  throw new Error(
    other
      ? `${what} "${s}" is a ${other}, not a node or an anchor`
      : `${what} "${s}" is not on this page — add the node (or anchor) first, or pass the pageIndex of the page it is on`,
  );
}

function node(page: Page, id: unknown, what: string): void {
  const s = String(id);
  if (page.nodes.some((n) => n.id === s)) return;
  throw new Error(
    `${what} "${s}" is not a node on this page — add it first, or pass the pageIndex of the page it is on`,
  );
}

const CHECKS: Record<
  string,
  (doc: TopologyDocument, page: Page, a: Args) => void
> = {
  add_node(doc, page, a) {
    newId(page, a.nodeId);
    knownNodeType(doc, a.type);
  },
  add_link(_doc, page, a) {
    newId(page, a.linkId);
    knownLinkType(a.type);
    endpoint(page, a.from, 'link end');
    endpoint(page, a.to, 'link end');
    if (String(a.from) === String(a.to))
      throw new Error(
        `a link cannot start and end on the same element ("${String(a.from)}")`,
      );
  },
  add_anchor(_doc, page, a) {
    newId(page, a.anchorId);
  },
  add_zone(_doc, page, a) {
    newId(page, a.zoneId);
    for (const id of (a.nodes as unknown[] | undefined) ?? [])
      node(page, id, 'zone member');
    if (a.parentZone !== undefined) {
      const parent = String(a.parentZone);
      if (!(page.zones ?? []).some((z) => z.id === parent))
        throw new Error(`parentZone "${parent}" is not a zone on this page`);
    }
  },
  add_flow_path(_doc, page, a) {
    newId(page, a.flowPathId);
    const waypoints = (a.waypoints as unknown[] | undefined) ?? [];
    if (waypoints.length < 2)
      throw new Error(
        `a flow path needs at least two waypoints (got ${waypoints.length})`,
      );
    for (const id of waypoints) endpoint(page, id, 'waypoint');
  },
  add_policy_marker(_doc, page, a) {
    newId(page, a.markerId);
    node(page, a.nodeId, 'nodeId');
    if (a.flowPathId !== undefined) {
      const flow = String(a.flowPathId);
      if (!(page.flowPaths ?? []).some((f) => f.id === flow))
        throw new Error(`flowPathId "${flow}" is not a flow path on this page`);
    }
  },
  update_element(doc, page, a) {
    const id = String(a.elementId);
    const set = (a.set as Args | undefined) ?? {};
    const kind = kindOf(page, id);
    if (kind === 'node' && set.type !== undefined) knownNodeType(doc, set.type);
    if (kind === 'link') {
      if (set.type !== undefined) knownLinkType(set.type);
      if (set.from !== undefined) endpoint(page, set.from, 'link end');
      if (set.to !== undefined) endpoint(page, set.to, 'link end');
    }
  },
};

/** Tools that have a write-time check. */
export const CHECKED_TOOLS: ReadonlySet<string> = new Set(Object.keys(CHECKS));

/**
 * Refuse a call that would write something wrong at the moment of the call.
 * Throws an Error that says what is wrong and what to do; returns otherwise.
 */
export function checkWrite(
  tool: string,
  doc: TopologyDocument,
  page: Page,
  args: Args,
): void {
  CHECKS[tool]?.(doc, page, args);
}

/**
 * The page an element tool means when the caller gave no `pageIndex`: the one
 * that HAS the element. (The add tools default to the newest page; an edit or
 * a removal is aimed at something that exists, and after `add_page` the
 * newest page is empty, so the old default made every such call fail with
 * "unknown element".) Returns undefined to keep the caller's default when the
 * id is on no page, and throws when it is on more than one.
 */
export function pageIndexOfElement(
  doc: TopologyDocument,
  elementId: string,
): number | undefined {
  const on = doc.pages
    .map((p, i) => (kindOf(p, elementId) ? i : -1))
    .filter((i) => i >= 0);
  if (on.length > 1)
    throw new Error(
      `"${elementId}" is on pages ${on.join(', ')} — pass pageIndex to say which`,
    );
  return on[0];
}
