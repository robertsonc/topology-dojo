/**
 * Read-only document tools on a shared workspace (issue #276).
 *
 * Once a topology has been handed off as a shared workspace, its canonical
 * document lives in the document coordinator and the legacy per-user copy is
 * stale. The remote agent (`worker/mcp.ts`) therefore refuses every document
 * tool on a migrated id — which also locked out pure reads (`get_topology`,
 * `render_svg`, …) and left agents rebuilding scratch topologies from element
 * dumps just to validate or render a workspace.
 *
 * This module is the pure half of the fix: the allowlist of tools that only
 * READ the document, the refusal text for everything else, the per-call
 * "load the coordinator's snapshot into the store, then unload it" routine,
 * and the result stamping that tells the agent which workspace revision it
 * was served from. No Worker imports, so it is unit-testable without the
 * Durable Object (the same shape as `worker/profile-tools.ts`).
 */
import type { TopologyDocument } from '../pages/model.js';
import type { ToolCallContext } from './register.js';
import type { TopologyStore } from './store.js';

/**
 * Document tools that only read the `TopologyDocument` for the `topologyId`
 * they are given — none of them writes to the store, and none has a side
 * effect outside its own result. Audited against `createTools`:
 *
 * - `describe_capabilities` reads `document.customNodes` to extend the catalog;
 * - `get_topology` returns the document (or a summary / page / source view);
 * - `validate_topology` runs semantic + layout checks over the document;
 * - `inspect_render` measures one page's rendered geometry;
 * - `render_svg` renders one page to an SVG string;
 * - `export_flipbook` renders every page into a standalone HTML flipbook;
 * - `export_topology` renders / converts the document to a file (PNG, PDF,
 *   draw.io, Visio, PowerPoint, Mermaid) — it reads the store synchronously
 *   before its first await (rasterizer start-up);
 * - `view_topology` renders one page for the MCP Apps inline view;
 * - `catalog_diff` clones the document before awaiting the catalog and
 *   compares its cabling under two catalog versions.
 *
 * Deliberately absent: `share_topology` reads the document but PUBLISHES a
 * public KV snapshot (a side effect with its own quota), and every other
 * `topologyId` tool mutates the store — those keep the hard refusal, because
 * the only write path into a workspace is a proposal or a leased apply.
 */
export const WORKSPACE_READ_TOOLS = [
  'describe_capabilities',
  'get_topology',
  'validate_topology',
  'inspect_render',
  'render_svg',
  'export_flipbook',
  'export_topology',
  'view_topology',
  'catalog_diff',
] as const;

export type WorkspaceReadTool = (typeof WORKSPACE_READ_TOOLS)[number];

const WORKSPACE_READ_TOOL_SET: ReadonlySet<string> = new Set(
  WORKSPACE_READ_TOOLS,
);

/** Whether a tool may be served from a shared workspace's current revision. */
export function isWorkspaceReadTool(
  toolName: string,
): toolName is WorkspaceReadTool {
  return WORKSPACE_READ_TOOL_SET.has(toolName);
}

/**
 * The error a mutating document tool gets on a migrated id. Names the read
 * path as well as the write path so an agent knows it can still inspect the
 * workspace with the tools it already has.
 */
export function migratedTopologyRefusal(topologyId: string): string {
  return (
    `topology "${topologyId}" is now a shared workspace; ` +
    `reads (${WORKSPACE_READ_TOOLS.join(', ')}) serve the workspace's current revision ` +
    '(see also get_workspace_document / get_workspace_manifest); ' +
    'writes go through propose_workspace_changes (or apply_workspace_changes inside a page lease)'
  );
}

/** The slice of the workspace service a read needs: the current snapshot. */
export interface WorkspaceReadSource {
  snapshot(
    id: string,
  ): Promise<{ revision: number; document: TopologyDocument }>;
}

/**
 * Admit a document tool call on a migrated id by serving it from the
 * coordinator's current snapshot — or refuse it, when the tool is not on the
 * read allowlist.
 *
 * The snapshot is loaded into the store under the topology id for exactly one
 * call: the returned `release` unloads it again (the dispatcher runs it once
 * the handler settles, success or error), and `TopologyStore.unload` never
 * records a durable deletion. Together with the worker skipping legacy
 * persistence for every allowlisted tool (`worker/legacy-persist.ts`) and
 * unloading migrated ids before any persist, the coordinator's document can
 * never be written back to the legacy per-user registry.
 *
 * Between `store.load` and the handler there is no I/O — the read handlers
 * read the store synchronously (`export_topology` before its first await) —
 * so a concurrent `list_topologies` (which also unloads migrated ids) cannot
 * interleave and pull the document out from under the call.
 */
export async function serveWorkspaceRead(
  toolName: string,
  topologyId: string,
  store: TopologyStore,
  source: WorkspaceReadSource,
): Promise<ToolCallContext> {
  if (!isWorkspaceReadTool(toolName))
    throw new Error(migratedTopologyRefusal(topologyId));
  let snapshot: { revision: number; document: TopologyDocument };
  try {
    snapshot = await source.snapshot(topologyId);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${toolName} could not read shared workspace "${topologyId}": ${why}`,
    );
  }
  store.load(topologyId, snapshot.document);
  return {
    workspaceRevision: snapshot.revision,
    release: () => {
      store.unload(topologyId);
    },
  };
}

/** Opening `<svg …>` tag of a rendered page (`render_svg`). */
const SVG_OPEN_TAG = /^<svg\b[^>]*>/;
/** `<!doctype html>` of a flipbook export (`export_flipbook`). */
const HTML_DOCTYPE = /^<!doctype html>/i;

/**
 * Stamp the workspace revision a read was served from onto its result, so an
 * agent can tell whether a render / validation is still current.
 *
 * - A JSON-object result gains `workspaceRevision` (a fresh object — the
 *   store's document is never mutated, which matters for `get_topology`,
 *   whose handler returns the stored document itself).
 * - A rendered SVG gets `<!-- workspace revision N -->` right after its
 *   opening tag — inside the root element, so the string still starts with
 *   `<svg` and every XML/SVG consumer stays happy.
 * - A flipbook gets the same comment right after `<!doctype html>` (a comment
 *   after the doctype never triggers quirks mode).
 * - Anything else (an array, a bare string that is neither) is returned as is.
 */
export function withWorkspaceRevision(
  result: unknown,
  revision: number,
): unknown {
  if (typeof result === 'string') {
    const comment = `<!-- workspace revision ${revision} -->`;
    const svg = SVG_OPEN_TAG.exec(result);
    if (svg) return `${svg[0]}${comment}${result.slice(svg[0].length)}`;
    const html = HTML_DOCTYPE.exec(result);
    if (html) return `${html[0]}${comment}${result.slice(html[0].length)}`;
    return result;
  }
  if (typeof result === 'object' && result !== null && !Array.isArray(result))
    return {
      ...(result as Record<string, unknown>),
      workspaceRevision: revision,
    };
  return result;
}
