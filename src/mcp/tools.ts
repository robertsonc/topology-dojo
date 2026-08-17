/**
 * MCP tool definitions for Topology Dojo.
 *
 * Each tool maps directly onto the headless authoring API (`src/api`) + the
 * headless renderer (`src/server/render`), so everything the GUI can express is
 * reachable programmatically — no UI-only surfaces. The handlers are pure (they
 * take parsed args, mutate the store, and return a plain value), which keeps
 * them unit-testable without an MCP transport; `server.ts` is the thin adapter.
 *
 * Return convention: a handler returns either a string (used verbatim as text,
 * e.g. rendered SVG) or any JSON-serializable value (stringified by the server).
 */
import { z } from 'zod';
import {
  addAnchor,
  addFlowPath,
  addLink,
  addNode,
  addPage,
  addPolicyMarker,
  addZone,
  defineLayer,
  defineNodeType,
} from '../api/builder.js';
import {
  annotationCatalog,
  filterNodeCatalog,
  layerCatalog,
  linkCatalog,
  nodeCatalog,
} from '../api/catalog.js';
import { LAYER_KINDS } from '../api/layers.js';
import {
  removeElement,
  updateElement,
  upsertBySource,
  type SourcedKind,
} from '../api/edit.js';
import type { SourceRef } from '../api/source.js';
import type { FlowQuery, TopologyProvider } from '../connect/types.js';
import { compileFlowTopology } from '../connect/compile.js';
import { exportFlipbookHTML } from '../render/flipbook.js';
import { validateDocument } from '../api/validate.js';
import {
  analyzeLayout,
  isValidViewBox,
  layoutGuidelines,
} from '../api/layout.js';
import { tidyDocument, balanceDocument } from '../api/tidy.js';
import { layoutDocument, type LayoutAlgorithm } from '../api/autolayout.js';
import { POLICY_MARKER_TYPES } from '../api/markers.js';
import { buildTemplate, listTemplates } from '../api/templates.js';
import type { RenderOptions } from '../render/core.js';
import { inspectPage } from '../render/inspect.js';
import type { TopologyDocument } from '../pages/model.js';
import { convertLegacyStudio, detectLegacyStudio } from '../import/legacy.js';
import { defaultSpec, type CustomNodeSpec } from '../nodes/spec.js';
import {
  ABSOLUTE_GUIDANCE_TOKENS,
  MAX_GUIDANCE_RULES,
  type GuidanceResult,
  type PreferenceExplanation,
  type PreferenceSummary,
} from '../profile/guidance.js';
import { TopologyStore } from './store.js';
import {
  MAX_HTML_EXPORT_BYTES,
  MAX_SVG_EXPORT_BYTES,
  assertExportWithinLimit,
} from './rate-limit.js';
import {
  TEXT_LIMITS,
  normalizeText,
  overlongDisplayMax,
  overlongMetaMax,
  sanitizeDisplayFields,
} from '../api/text.js';
import {
  ELEMENT_KINDS,
  type ChangesResult,
  type CheckpointSummary,
  type CommitRequest,
  type CommitResult,
  type ElementKind,
  type ElementPageResult,
  type ProposalResult,
  type WorkspaceListItem,
  type WorkspaceManifest,
  type WorkspaceOperation,
} from '../workspace/model.js';
import { SHARE_PUBLIC_WARNING } from '../share/copy.js';

export interface ToolDef {
  name: string;
  description: string;
  inputShape: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => unknown;
}

/**
 * Runtime dependencies injected into the tools — chiefly the SVG renderer, which
 * differs by runtime (Node uses `createRequire`; the Worker uses a bundled
 * engine). Keeping it injected means `tools.ts` has no runtime-specific imports
 * and bundles cleanly for Cloudflare Workers.
 */
export interface ToolDeps {
  renderDocument: (
    doc: TopologyDocument,
    pageIndex?: number,
    opts?: RenderOptions,
  ) => string;
  /**
   * Snapshot a document to durable storage and return a shareable link that
   * opens it in the browser editor. Only wired up where a backing store + public
   * origin exist (the Cloudflare Worker); absent for the local stdio server, in
   * which case the `share_topology` tool is not registered.
   */
  publishTopology?: (
    doc: TopologyDocument,
  ) => Promise<{ id: string; url: string }>;
  /**
   * Owner-only delete of a published `doc:<id>` snapshot. Wired with
   * `publishTopology` on the Worker; absent for the local stdio server.
   */
  unpublishTopology?: (shareId: string) => Promise<{ revoked: true }>;
  /**
   * Live fabric data source (an SD-WAN orchestrator client or the fixture
   * mock). Wired from environment credentials by the servers — never from
   * tool arguments. When absent, the live-data tools are not registered.
   */
  provider?: TopologyProvider;
  /**
   * Read-only authoring-profile guidance (remote-only, Packet P4 / proposal
   * 0003-B). Deliberately exposes NOTHING that mutates the profile —
   * confirmation, scoping, pause, and forget stay browser-owner actions, so
   * an agent can never promote its own lesson through MCP.
   */
  profile?: {
    guidance(query: {
      archetype?: string;
      workspaceId?: string;
      lastProfileRevision?: number;
      lastGuidanceRevision?: number;
      maxTokens?: number;
    }): Promise<GuidanceResult>;
    list(): Promise<PreferenceSummary[]>;
    explain(preferenceId: string): Promise<PreferenceExplanation>;
  };
  /** Canonical owner workspace (remote-only). Keeping this injected preserves
   * the pure/local MCP server and makes the tool protocol unit-testable. */
  workspace?: {
    createEmpty(title?: string): Promise<{
      id: string;
      revision: number;
      document: TopologyDocument;
    }>;
    list(): Promise<WorkspaceListItem[]>;
    manifest(id: string): Promise<WorkspaceManifest>;
    changes(
      id: string,
      sinceRevision: number,
      limit?: number,
      includeOperations?: boolean,
    ): Promise<ChangesResult>;
    elements(
      id: string,
      pageId: string,
      ids?: string[],
      kinds?: ElementKind[],
      cursor?: number,
      limit?: number,
    ): Promise<ElementPageResult>;
    propose(
      id: string,
      request: CommitRequest,
      title: string,
      rationale?: string,
    ): Promise<ProposalResult>;
    applyAgent(id: string, request: CommitRequest): Promise<CommitResult>;
    createCheckpoint(
      id: string,
      name: string,
      actorKind?: 'user' | 'agent',
    ): Promise<CheckpointSummary>;
    listCheckpoints(id: string): Promise<CheckpointSummary[]>;
  };
}

/* Reusable field fragments ------------------------------------------------- */
const topologyId = z
  .string()
  .describe('Topology id returned by create_topology / import_topology.');
const pageIndex = z
  .number()
  .int()
  .optional()
  .describe('0-based page index; defaults to the most recently added page.');

/** Zod string: reject overlong raw input, then strip controls / collapse space. */
function displayString(max: number, opts?: { multiline?: boolean }) {
  return z
    .string()
    .max(max)
    .transform((s) => normalizeText(s, opts));
}

function refineDisplayRecord(
  val: Record<string, unknown>,
  ctx: z.RefinementCtx,
): void {
  for (const [k, v] of Object.entries(val)) {
    const max = overlongDisplayMax(k, v);
    if (max !== null)
      ctx.addIssue({
        code: 'custom',
        path: [k],
        message: `exceeds ${max} characters`,
      });
    if (k === 'meta' && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [mk, mv] of Object.entries(v as Record<string, unknown>)) {
        const over = overlongMetaMax(mk, mv);
        if (over)
          ctx.addIssue({
            code: 'custom',
            path: ['meta', over.path],
            message: `exceeds ${over.max} characters`,
          });
      }
    }
  }
}

function normalizeDisplayRecord(
  val: Record<string, unknown>,
): Record<string, unknown> {
  const copy = structuredClone(val);
  sanitizeDisplayFields(copy);
  return copy;
}

const extra = z
  .record(z.string(), z.unknown())
  .superRefine(refineDisplayRecord)
  .transform(normalizeDisplayRecord)
  .optional()
  .describe(
    'Any additional catalog fields for this type (see describe_capabilities).',
  );
type MetaMap = Record<string, string | number | boolean>;
const metaValue = z.union([
  displayString(TEXT_LIMITS.metaValue),
  z.number(),
  z.boolean(),
]);
const metaShape = z
  .record(z.string().max(TEXT_LIMITS.label), metaValue)
  .optional()
  .describe('Key/value node metadata (serial, version, hostname, site…).');
const patchSet = z
  .record(z.string(), z.unknown())
  .superRefine(refineDisplayRecord)
  .transform(normalizeDisplayRecord);
const layerArg = z
  .string()
  .optional()
  .describe(
    'Layer id this element belongs to (declare layers with define_layer); omit for the base layer.',
  );

const BORDER = ['dashed', 'solid', 'dotted'] as const;
const ANIMATION = ['particles', 'dashed', 'pulse'] as const;
const DIRECTION = ['forward', 'reverse', 'bidirectional'] as const;
const SPEED = ['slow', 'medium', 'fast'] as const;
const ALIGN9 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'C'] as const;
const MARKER = POLICY_MARKER_TYPES;
/** A CSS hex colour (`#rgb` or `#rrggbb`). */
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const elementKindSchema = z.enum(ELEMENT_KINDS);
// Keep routine MCP discovery small. The strict, versioned vocabulary is
// returned on demand by describe_workspace_operations and is always validated
// again inside the document coordinator.
const compactWorkspaceOperations = z
  .array(z.record(z.string(), z.unknown()))
  .min(1)
  .max(250);

/** Build the full set of tools bound to a store and runtime deps. */
export function createTools(store: TopologyStore, deps: ToolDeps): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: 'describe_capabilities',
      description:
        'Discover what a topology can express. By default returns a compact INDEX (node/link type names, labels, categories + annotation and layer kinds) — cheap to call first. To get editable fields, either pass detail:"full" (the whole catalog — large) or, better, narrow with types:[…] and/or query:"…" which return full fields for just the matches. Pass a topologyId to include that document’s custom node types.',
      inputShape: {
        topologyId: topologyId.optional(),
        detail: z
          .enum(['index', 'full'])
          .optional()
          .describe(
            'index (default) = names/categories only; full = include every editable field.',
          ),
        types: z
          .array(z.string())
          .max(50)
          .optional()
          .describe('Return full fields for just these node/link type names.'),
        query: z
          .string()
          .optional()
          .describe(
            'Free-text node-type filter (matches type/label/category/aliases); returns full fields for the matches.',
          ),
      },
      handler: (a) => {
        const custom = a.topologyId
          ? store.get(String(a.topologyId)).customNodes
          : [];
        const types = a.types as string[] | undefined;
        const query = a.query as string | undefined;
        const full = a.detail === 'full' || !!types?.length || !!query;
        let nodes = query
          ? filterNodeCatalog(query, custom)
          : nodeCatalog(custom);
        let links = linkCatalog();
        if (types?.length) {
          const want = new Set(types);
          nodes = nodes.filter((n) => want.has(n.type));
          links = links.filter((l) => want.has(l.type));
        }
        if (full) {
          return {
            nodeTypes: nodes,
            linkTypes: links,
            annotations: annotationCatalog(),
            layers: layerCatalog(),
          };
        }
        return {
          nodeTypes: nodes.map((n) => ({
            type: n.type,
            label: n.label,
            category: n.category,
            ...(n.custom ? { custom: true } : {}),
          })),
          linkTypes: links.map((l) => ({
            type: l.type,
            label: l.label,
            ...(l.animated ? { animated: true } : {}),
          })),
          annotationKinds: annotationCatalog().map((x) => x.kind),
          layerKinds: layerCatalog().kinds,
          note: 'Index view. For editable fields, call again with detail:"full" or narrow with types:[…] / query:"…".',
        };
      },
    },
    {
      name: 'create_topology',
      description:
        'Create a new topology document (seeded with one empty page "Frame 1"). Returns its id; pass that id to subsequent tools.',
      inputShape: { title: displayString(TEXT_LIMITS.title).optional() },
      handler: (a) => {
        const { id, document } = store.create(
          a.title ? String(a.title) : undefined,
        );
        return { id, title: document.title, pages: document.pages.length };
      },
    },
    {
      name: 'list_topologies',
      description: 'List all topologies currently held by the server.',
      inputShape: {},
      handler: () => store.list(),
    },
    {
      name: 'list_templates',
      description:
        'List starter templates (id + name + description) that create_from_template can instantiate.',
      inputShape: {},
      handler: () => listTemplates(),
    },
    {
      name: 'create_from_template',
      description:
        'Create a new topology from a starter template (see list_templates). Returns its id, like create_topology.',
      inputShape: {
        template: z.string().describe('Template id from list_templates.'),
        title: displayString(TEXT_LIMITS.title).optional(),
      },
      handler: (a) => {
        const doc = buildTemplate(String(a.template));
        if (a.title) doc.title = String(a.title);
        const { id } = store.import(doc);
        return { id, title: doc.title, pages: doc.pages.length };
      },
    },
    {
      name: 'get_topology',
      description:
        'Return the document JSON for a topology (the canonical, portable contract). The full document can be large: pass summary:true for a compact overview (page names + element counts), or pageIndex to fetch a single page — prefer those unless the whole document is really needed.',
      inputShape: {
        topologyId,
        summary: z
          .boolean()
          .optional()
          .describe('Compact overview instead of the full document.'),
        pageIndex: z
          .number()
          .int()
          .optional()
          .describe('Return only this page (with document title/page count).'),
      },
      handler: (a) => {
        const doc = store.get(String(a.topologyId));
        if (a.summary) {
          return {
            title: doc.title,
            pages: doc.pages.map((p, index) => ({
              index,
              name: p.name,
              viewBox: p.viewBox,
              nodes: p.nodes.length,
              links: p.links.length,
              anchors: p.anchors.length,
              zones: p.zones?.length ?? 0,
              flowPaths: p.flowPaths?.length ?? 0,
              policyMarkers: p.policyMarkers?.length ?? 0,
            })),
            ...(doc.layers?.length
              ? { layers: doc.layers.map((l) => l.id) }
              : {}),
            ...(doc.customNodes?.length
              ? { customNodeTypes: doc.customNodes.map((c) => c.typeName) }
              : {}),
          };
        }
        if (a.pageIndex !== undefined) {
          const page = doc.pages[Number(a.pageIndex)];
          if (!page)
            throw new Error(`page index ${Number(a.pageIndex)} out of range`);
          return {
            title: doc.title,
            pageCount: doc.pages.length,
            pageIndex: Number(a.pageIndex),
            page,
          };
        }
        return doc;
      },
    },
    {
      name: 'import_topology',
      description:
        'Load a topology from document JSON (a string or object). Returns the new id. ' +
        "Also accepts a legacy Topology Studio save (the older sibling app's format) " +
        'and converts it, reporting any lossy-conversion warnings.',
      inputShape: {
        json: z
          .union([z.string(), z.record(z.string(), z.unknown())])
          .describe('Document JSON as a string or object.'),
        title: displayString(TEXT_LIMITS.title).optional(),
        format: z
          .enum(['auto', 'topology-dojo', 'legacy-studio'])
          .optional()
          .describe(
            '"auto" (default) detects a legacy Topology Studio save and converts it, ' +
              'otherwise imports natively; "topology-dojo" requires the native document ' +
              'shape (no legacy detection); "legacy-studio" always runs the legacy ' +
              'converter, failing with a typed error if the input is not legacy-shaped.',
          ),
      },
      handler: (a) => {
        const format = (a.format as string | undefined) ?? 'auto';
        const title = a.title ? String(a.title) : undefined;

        if (format === 'topology-dojo') {
          const { id, document } = store.import(a.json, title);
          return { id, title: document.title, pages: document.pages.length };
        }

        // 'auto' and 'legacy-studio' both need the parsed JSON to sniff or convert.
        let parsedJson: unknown = a.json;
        if (typeof a.json === 'string') {
          try {
            parsedJson = JSON.parse(a.json);
          } catch {
            throw new Error(
              'invalid topology document JSON — could not parse as JSON',
            );
          }
        }

        const isLegacy =
          format === 'legacy-studio' || detectLegacyStudio(parsedJson);
        if (!isLegacy) {
          const { id, document } = store.import(a.json, title);
          return { id, title: document.title, pages: document.pages.length };
        }

        const result = convertLegacyStudio(parsedJson);
        if (!result.ok) {
          throw new Error(
            `legacy Topology Studio conversion failed: ${result.error.message}`,
          );
        }
        const { id, document } = store.importDocument(result.document, title);
        const shownWarnings = result.warnings.slice(0, 20);
        return {
          id,
          title: document.title,
          pages: document.pages.length,
          format: 'legacy-studio',
          warnings: shownWarnings,
          ...(result.warnings.length > shownWarnings.length
            ? {
                warningsTruncated:
                  result.warnings.length - shownWarnings.length,
              }
            : {}),
        };
      },
    },
    {
      name: 'delete_topology',
      description: 'Remove a topology from the server.',
      inputShape: { topologyId },
      handler: (a) => ({ removed: store.remove(String(a.topologyId)) }),
    },
    {
      name: 'add_page',
      description:
        'Append a new (empty) page/frame to a topology. Returns its 0-based index. duration/transition control flipbook playback (see export_flipbook).',
      inputShape: {
        topologyId,
        name: displayString(TEXT_LIMITS.name).optional(),
        viewBox: z.string().optional(),
        duration: z
          .number()
          .optional()
          .describe('Playback hold time in ms (players default to 2000).'),
        transition: z.enum(['cut', 'fade']).optional(),
      },
      handler: (a) => {
        const doc = store.get(String(a.topologyId));
        if (a.viewBox !== undefined && !isValidViewBox(String(a.viewBox)))
          throw new Error(
            `viewBox must be "minX minY width height" with a positive width and height (got "${String(a.viewBox)}")`,
          );
        const page = addPage(doc, {
          name: a.name ? String(a.name) : undefined,
          viewBox: a.viewBox ? String(a.viewBox) : undefined,
          ...(a.duration !== undefined ? { duration: Number(a.duration) } : {}),
          ...(a.transition !== undefined
            ? { transition: a.transition as 'cut' | 'fade' }
            : {}),
        });
        return { pageIndex: doc.pages.length - 1, page };
      },
    },
    {
      name: 'set_document_title',
      description: 'Rename a topology document.',
      inputShape: { topologyId, title: displayString(TEXT_LIMITS.title) },
      handler: (a) => {
        const doc = store.get(String(a.topologyId));
        doc.title = String(a.title);
        return { id: String(a.topologyId), title: doc.title };
      },
    },
    {
      name: 'set_page_properties',
      description:
        'Update an existing page’s name, viewBox (the canvas extent "minX minY width height"), and/or playback timing (duration ms / transition) for flipbook playback.',
      inputShape: {
        topologyId,
        pageIndex,
        name: displayString(TEXT_LIMITS.name).optional(),
        viewBox: z.string().optional(),
        duration: z
          .number()
          .optional()
          .describe('Playback hold time in ms (players default to 2000).'),
        transition: z.enum(['cut', 'fade']).optional(),
      },
      handler: (a) => {
        if (a.viewBox !== undefined && !isValidViewBox(String(a.viewBox)))
          throw new Error(
            `viewBox must be "minX minY width height" with a positive width and height (got "${String(a.viewBox)}")`,
          );
        const page = store.page(
          String(a.topologyId),
          a.pageIndex as number | undefined,
        );
        if (a.name !== undefined) page.name = String(a.name);
        if (a.viewBox !== undefined) page.viewBox = String(a.viewBox);
        if (a.duration !== undefined) page.duration = Number(a.duration);
        if (a.transition !== undefined)
          page.transition = a.transition as 'cut' | 'fade';
        return {
          name: page.name,
          viewBox: page.viewBox,
          ...(page.duration !== undefined ? { duration: page.duration } : {}),
          ...(page.transition !== undefined
            ? { transition: page.transition }
            : {}),
        };
      },
    },
    {
      name: 'set_legend',
      description:
        'Toggle and place the document’s auto-generated legend / key — a panel of the node + link symbols actually in use, drawn on the canvas and in exports. Built live from the elements present, so it stays in sync.',
      inputShape: {
        topologyId,
        show: z.boolean().describe('Draw the legend (false hides it).'),
        position: z
          .enum(['tl', 'tr', 'bl', 'br'])
          .optional()
          .describe('Corner: tl / tr / bl / br (default tl).'),
      },
      handler: (a) => {
        const doc = store.get(String(a.topologyId));
        doc.legend = {
          show: Boolean(a.show),
          ...(a.position !== undefined
            ? { position: a.position as 'tl' | 'tr' | 'bl' | 'br' }
            : doc.legend?.position
              ? { position: doc.legend.position }
              : {}),
        };
        return { legend: doc.legend };
      },
    },
    {
      name: 'set_palette',
      description:
        'Set the document brand palette — recolours the canvas accents (the engine green → accent, blue → secondary) and the app chrome, so generated topologies match a brand. Colours are #rgb / #rrggbb hex. Omit accent (or pass clear:true) to remove the palette and restore the default colours.',
      inputShape: {
        topologyId,
        accent: z
          .string()
          .regex(HEX)
          .optional()
          .describe('Primary brand colour (remaps the engine green).'),
        secondary: z
          .string()
          .regex(HEX)
          .optional()
          .describe('Secondary brand colour (remaps the engine blue).'),
        chrome: z
          .string()
          .regex(HEX)
          .optional()
          .describe('App-chrome accent override (defaults to accent).'),
        name: displayString(TEXT_LIMITS.name)
          .optional()
          .describe('Label for the palette.'),
        clear: z
          .boolean()
          .optional()
          .describe('Remove the palette and restore default colours.'),
      },
      handler: (a) => {
        const doc = store.get(String(a.topologyId));
        if (a.clear || a.accent === undefined) {
          delete doc.palette;
          return { palette: null };
        }
        doc.palette = {
          id: 'custom',
          accent: String(a.accent).toLowerCase(),
          ...(a.secondary !== undefined
            ? { secondary: String(a.secondary).toLowerCase() }
            : {}),
          ...(a.chrome !== undefined
            ? { chrome: String(a.chrome).toLowerCase() }
            : {}),
          ...(a.name !== undefined ? { name: String(a.name) } : {}),
        };
        return { palette: doc.palette };
      },
    },
    {
      name: 'add_node',
      description:
        'Add a node to a page. `type` must be a known node type (see describe_capabilities). Extra per-type fields go in `extra`.',
      inputShape: {
        topologyId,
        pageIndex,
        type: z.string(),
        x: z.number(),
        y: z.number(),
        label: displayString(TEXT_LIMITS.label).optional(),
        sublabel: displayString(TEXT_LIMITS.sublabel).optional(),
        color: z.string().optional(),
        nodeId: z.string().optional().describe('Explicit id (else generated).'),
        meta: metaShape,
        layer: layerArg,
        extra,
      },
      handler: (a) =>
        addNode(
          store.page(String(a.topologyId), a.pageIndex as number | undefined),
          {
            id: a.nodeId as string | undefined,
            type: String(a.type),
            x: Number(a.x),
            y: Number(a.y),
            ...(a.label !== undefined ? { label: String(a.label) } : {}),
            ...(a.sublabel !== undefined
              ? { sublabel: String(a.sublabel) }
              : {}),
            ...(a.color !== undefined ? { color: String(a.color) } : {}),
            ...(a.meta !== undefined ? { meta: a.meta as MetaMap } : {}),
            ...(a.layer !== undefined ? { layer: String(a.layer) } : {}),
            ...((a.extra as Record<string, unknown>) ?? {}),
          },
        ),
    },
    {
      name: 'set_node_metadata',
      description:
        'Attach free-form key/value metadata to a node — serials, software versions, hostnames, site/cluster names, etc. (string/number/boolean values). By default replaces the node’s metadata; pass merge:true to merge into the existing map.',
      inputShape: {
        topologyId,
        pageIndex,
        nodeId: z.string(),
        meta: z
          .record(z.string().max(TEXT_LIMITS.label), metaValue)
          .describe('Key/value metadata.'),
        merge: z
          .boolean()
          .optional()
          .describe('Merge into existing metadata instead of replacing.'),
      },
      handler: (a) => {
        const page = store.page(
          String(a.topologyId),
          a.pageIndex as number | undefined,
        );
        const node = page.nodes.find((n) => n.id === String(a.nodeId));
        if (!node) throw new Error(`unknown node "${String(a.nodeId)}"`);
        const incoming = a.meta as MetaMap;
        node.meta = a.merge ? { ...(node.meta ?? {}), ...incoming } : incoming;
        return { id: node.id, meta: node.meta };
      },
    },
    {
      name: 'add_link',
      description:
        'Connect two endpoints (node or anchor ids) with a link. `type` must be a known link type.',
      inputShape: {
        topologyId,
        pageIndex,
        type: z.string(),
        from: z.string(),
        to: z.string(),
        label: displayString(TEXT_LIMITS.label).optional(),
        color: z.string().optional(),
        labelScale: z
          .number()
          .optional()
          .describe(
            'Per-link label size multiplier (1 = default; clamped to 0.25–4).',
          ),
        lineStyle: z.enum(['straight', 'orthogonal', 'curved']).optional(),
        flowSpeed: z
          .number()
          .optional()
          .describe('Animated-flow particle speed in seconds.'),
        flowParticles: z
          .number()
          .optional()
          .describe('Animated-flow particle count (1–32).'),
        reverseFlow: z
          .boolean()
          .optional()
          .describe('Reverse the flow direction.'),
        linkId: z.string().optional(),
        layer: layerArg,
        extra,
      },
      handler: (a) =>
        addLink(
          store.page(String(a.topologyId), a.pageIndex as number | undefined),
          {
            id: a.linkId as string | undefined,
            type: String(a.type),
            from: String(a.from),
            to: String(a.to),
            ...(a.label !== undefined ? { label: String(a.label) } : {}),
            ...(a.color !== undefined ? { color: String(a.color) } : {}),
            ...(a.labelScale !== undefined
              ? { labelScale: Number(a.labelScale) }
              : {}),
            ...(a.lineStyle !== undefined
              ? { lineStyle: a.lineStyle as 'orthogonal' | 'curved' }
              : {}),
            ...(a.flowSpeed !== undefined
              ? { flowSpeed: Number(a.flowSpeed) }
              : {}),
            ...(a.flowParticles !== undefined
              ? { flowParticles: Number(a.flowParticles) }
              : {}),
            ...(a.reverseFlow !== undefined
              ? { reverseFlow: Boolean(a.reverseFlow) }
              : {}),
            ...(a.layer !== undefined ? { layer: String(a.layer) } : {}),
            ...((a.extra as Record<string, unknown>) ?? {}),
          },
        ),
    },
    {
      name: 'add_anchor',
      description:
        'Add a free-floating anchor point usable as a link endpoint or flow-path waypoint.',
      inputShape: {
        topologyId,
        pageIndex,
        x: z.number(),
        y: z.number(),
        anchorId: z.string().optional(),
      },
      handler: (a) =>
        addAnchor(
          store.page(String(a.topologyId), a.pageIndex as number | undefined),
          Number(a.x),
          Number(a.y),
          a.anchorId as string | undefined,
        ),
    },
    {
      name: 'add_zone',
      description:
        'Group member nodes into a labeled region (auto-sized around the members).',
      inputShape: {
        topologyId,
        pageIndex,
        nodes: z.array(z.string()).describe('Member node ids.'),
        label: displayString(TEXT_LIMITS.label).optional(),
        sublabel: displayString(TEXT_LIMITS.sublabel).optional(),
        description: displayString(TEXT_LIMITS.description, {
          multiline: true,
        }).optional(),
        color: z.string().optional(),
        borderStyle: z.enum(BORDER).optional(),
        padding: z.number().optional(),
        labelAlign: z.enum(['left', 'center', 'right']).optional(),
        parentZone: z.string().optional(),
        zoneId: z.string().optional(),
        layer: layerArg,
      },
      handler: (a) =>
        addZone(
          store.page(String(a.topologyId), a.pageIndex as number | undefined),
          {
            id: a.zoneId as string | undefined,
            nodes: (a.nodes as string[]) ?? [],
            ...(a.label !== undefined ? { label: String(a.label) } : {}),
            ...(a.sublabel !== undefined
              ? { sublabel: String(a.sublabel) }
              : {}),
            ...(a.description !== undefined
              ? { description: String(a.description) }
              : {}),
            ...(a.color !== undefined ? { color: String(a.color) } : {}),
            ...(a.borderStyle !== undefined
              ? { borderStyle: a.borderStyle as (typeof BORDER)[number] }
              : {}),
            ...(a.padding !== undefined ? { padding: Number(a.padding) } : {}),
            ...(a.labelAlign !== undefined
              ? { labelAlign: a.labelAlign as 'left' | 'center' | 'right' }
              : {}),
            ...(a.parentZone !== undefined
              ? { parentZone: String(a.parentZone) }
              : {}),
            ...(a.layer !== undefined ? { layer: String(a.layer) } : {}),
          },
        ),
    },
    {
      name: 'add_flow_path',
      description:
        'Add an animated overlay route threaded through an ordered list of node/anchor ids (≥2 waypoints).',
      inputShape: {
        topologyId,
        pageIndex,
        waypoints: z.array(z.string()).describe('Ordered node/anchor ids.'),
        label: displayString(TEXT_LIMITS.label).optional(),
        color: z.string().optional(),
        animation: z.enum(ANIMATION).optional(),
        speed: z.union([z.number(), z.enum(SPEED)]).optional(),
        direction: z.enum(DIRECTION).optional(),
        width: z.number().optional(),
        opacity: z.number().optional(),
        flowPathId: z.string().optional(),
        layer: layerArg,
      },
      handler: (a) =>
        addFlowPath(
          store.page(String(a.topologyId), a.pageIndex as number | undefined),
          {
            id: a.flowPathId as string | undefined,
            waypoints: (a.waypoints as string[]) ?? [],
            ...(a.label !== undefined ? { label: String(a.label) } : {}),
            ...(a.color !== undefined ? { color: String(a.color) } : {}),
            ...(a.animation !== undefined
              ? { animation: a.animation as (typeof ANIMATION)[number] }
              : {}),
            ...(a.speed !== undefined
              ? { speed: a.speed as number | (typeof SPEED)[number] }
              : {}),
            ...(a.direction !== undefined
              ? { direction: a.direction as (typeof DIRECTION)[number] }
              : {}),
            ...(a.width !== undefined ? { width: Number(a.width) } : {}),
            ...(a.opacity !== undefined ? { opacity: Number(a.opacity) } : {}),
            ...(a.layer !== undefined ? { layer: String(a.layer) } : {}),
          },
        ),
    },
    {
      name: 'add_policy_marker',
      description:
        'Pin a badge to a node — an enforcement action (inspect/allow/deny/encrypt/…), a host OS (windows/macos/linux/ios/android/chromeos), or SSE posture (agent/agentless). `icon` overrides the default glyph.',
      inputShape: {
        topologyId,
        pageIndex,
        nodeId: z.string(),
        type: z.enum(MARKER),
        label: displayString(TEXT_LIMITS.label).optional(),
        color: z.string().optional(),
        icon: displayString(TEXT_LIMITS.label)
          .optional()
          .describe('Glyph override (default per type).'),
        align: z.enum(ALIGN9).optional(),
        flowPathId: z.string().optional(),
        markerId: z.string().optional(),
        layer: layerArg,
      },
      handler: (a) =>
        addPolicyMarker(
          store.page(String(a.topologyId), a.pageIndex as number | undefined),
          {
            id: a.markerId as string | undefined,
            nodeId: String(a.nodeId),
            type: a.type as (typeof MARKER)[number],
            ...(a.label !== undefined ? { label: String(a.label) } : {}),
            ...(a.color !== undefined ? { color: String(a.color) } : {}),
            ...(a.icon !== undefined ? { icon: String(a.icon) } : {}),
            ...(a.align !== undefined
              ? { align: a.align as (typeof ALIGN9)[number] }
              : {}),
            ...(a.flowPathId !== undefined
              ? { flowPathId: String(a.flowPathId) }
              : {}),
            ...(a.layer !== undefined ? { layer: String(a.layer) } : {}),
          },
        ),
    },
    {
      name: 'update_element',
      description:
        'Patch an existing element (node, link, anchor, zone, flow path, or policy marker) by its id: merge the given fields, set a field to null to clear it. The id cannot be changed. Field names come from describe_capabilities. This is how a topology is refreshed in place instead of rebuilt.',
      inputShape: {
        topologyId,
        pageIndex,
        elementId: z.string().describe('Id of the element to patch.'),
        set: patchSet.describe('Fields to merge; null clears a field.'),
      },
      handler: (a) =>
        updateElement(
          store.page(String(a.topologyId), a.pageIndex as number | undefined),
          String(a.elementId),
          (a.set as Record<string, unknown>) ?? {},
        ),
    },
    {
      name: 'remove_element',
      description:
        'Remove an element by id. By default dependents are removed or cleaned too (links on a removed endpoint, markers on a removed node, zone memberships, flow-path waypoints — a path left with <2 waypoints is removed). Pass cascade:false to leave dangling references for validate_topology to flag.',
      inputShape: {
        topologyId,
        pageIndex,
        elementId: z.string().describe('Id of the element to remove.'),
        cascade: z
          .boolean()
          .optional()
          .describe('Remove/clean dependents too (default true).'),
      },
      handler: (a) =>
        removeElement(
          store.page(String(a.topologyId), a.pageIndex as number | undefined),
          String(a.elementId),
          a.cascade !== undefined ? { cascade: Boolean(a.cascade) } : {},
        ),
    },
    {
      name: 'upsert_by_source',
      description:
        'Converge an element onto external data by its source identity (system + kind + id, e.g. an orchestrator appliance or tunnel). If an element of that kind already carries the same source, it is patched with `set` and its source ref refreshed; otherwise it is created (set must then include the kind’s required fields, e.g. type/x/y for a node). Re-running never duplicates — the idempotent write for live importers.',
      inputShape: {
        topologyId,
        pageIndex,
        kind: z
          .enum(['node', 'link', 'zone', 'flowPath', 'policyMarker'])
          .describe('Element kind to upsert.'),
        source: z
          .object({
            system: z.string().describe('External system, e.g. "edgeconnect".'),
            kind: z
              .string()
              .describe('Object kind there, e.g. "appliance" | "tunnel".'),
            id: z.string().describe('The object’s id in that system.'),
            fetchedAt: z
              .string()
              .optional()
              .describe('Freshness timestamp (ISO 8601).'),
          })
          .describe('The external identity to match on.'),
        set: patchSet
          .optional()
          .describe('Fields to apply (see describe_capabilities).'),
      },
      handler: (a) =>
        upsertBySource(
          store.page(String(a.topologyId), a.pageIndex as number | undefined),
          a.kind as SourcedKind,
          a.source as SourceRef,
          (a.set as Record<string, unknown>) ?? {},
        ),
    },
    {
      name: 'define_layer',
      description:
        'Declare (or update, by id) a document layer — a named plane such as underlay / overlay / policy. Declaration order is z-order (bottom → top); untagged elements form the implicit base layer beneath all declared layers. Elements opt in by passing `layer` to the add_* tools; render_svg can filter with visibleLayers.',
      inputShape: {
        topologyId,
        layerId: z
          .string()
          .optional()
          .describe('Explicit id (else generated). Re-use an id to update.'),
        name: displayString(TEXT_LIMITS.name)
          .optional()
          .describe('Display name (falls back to id).'),
        kind: z
          .enum(LAYER_KINDS)
          .optional()
          .describe('Semantic role of the plane.'),
        color: z.string().optional(),
        opacity: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            'Plane opacity 0–1 — dims every element on the layer (default 1).',
          ),
        defaultVisible: z
          .boolean()
          .optional()
          .describe(
            'Drawn when render_svg gets no visibleLayers (default true).',
          ),
      },
      handler: (a) =>
        defineLayer(store.get(String(a.topologyId)), {
          ...(a.layerId !== undefined ? { id: String(a.layerId) } : {}),
          ...(a.name !== undefined ? { name: String(a.name) } : {}),
          ...(a.kind !== undefined
            ? { kind: a.kind as (typeof LAYER_KINDS)[number] }
            : {}),
          ...(a.color !== undefined ? { color: String(a.color) } : {}),
          ...(a.opacity !== undefined ? { opacity: Number(a.opacity) } : {}),
          ...(a.defaultVisible !== undefined
            ? { defaultVisible: Boolean(a.defaultVisible) }
            : {}),
        }),
    },
    {
      name: 'define_node_type',
      description:
        'Define (or replace) a custom node type for a topology. `spec` is merged over sensible defaults; only `typeName` is required. The type then renders in get/validate/render and shows in describe_capabilities.',
      inputShape: {
        topologyId,
        spec: z
          .record(z.string(), z.unknown())
          .describe('Partial CustomNodeSpec; must include typeName.'),
      },
      handler: (a) => {
        const spec = (a.spec ?? {}) as Record<string, unknown>;
        if (typeof spec.typeName !== 'string' || !spec.typeName)
          throw new Error('spec.typeName is required');
        const merged: CustomNodeSpec = {
          ...defaultSpec(),
          ...spec,
        } as CustomNodeSpec;
        return defineNodeType(store.get(String(a.topologyId)), merged);
      },
    },
    {
      name: 'validate_topology',
      description:
        'Validate a topology: semantic problems (dangling refs, duplicate ids, unknown types) AND layout problems (overlapping/crowded nodes, labels, zones; off-page elements). Errors block meaning; warnings — including all layout issues — are advisory. An empty problems list means the document is clean. See layout_guidelines for the rules.',
      inputShape: { topologyId },
      handler: (a) => {
        const doc = store.get(String(a.topologyId));
        const semantic = validateDocument(doc);
        const layout = analyzeLayout(doc);
        const problems = [...semantic, ...layout];
        return {
          valid: !problems.some((p) => p.level === 'error'),
          problems,
          layoutClean: layout.length === 0,
        };
      },
    },
    {
      name: 'tidy_topology',
      description:
        'Auto-arrange a topology toward the layout guidelines: snap nodes to the grid, push apart overlapping/crowded nodes, and keep them inside the page. Mutates the stored topology in place and returns how many nodes moved plus the layout-warning count before/after. Call this after generating, or whenever validate_topology reports layout issues.',
      inputShape: {
        topologyId,
        snapToGrid: z
          .boolean()
          .optional()
          .describe('Snap nodes onto the grid first (default true).'),
        minGap: z
          .number()
          .optional()
          .describe('Target clear gap between nodes in px (default 24).'),
        keepInBounds: z
          .boolean()
          .optional()
          .describe('Keep nodes inside the page margin (default true).'),
      },
      handler: (a) =>
        tidyDocument(store.get(String(a.topologyId)), {
          ...(a.snapToGrid !== undefined
            ? { snapToGrid: Boolean(a.snapToGrid) }
            : {}),
          ...(a.minGap !== undefined ? { minGap: Number(a.minGap) } : {}),
          ...(a.keepInBounds !== undefined
            ? { keepInBounds: Boolean(a.keepInBounds) }
            : {}),
        }),
    },
    {
      name: 'layout_topology',
      description:
        'Arrange a topology from scratch with a layout algorithm (unlike tidy, which only de-overlaps existing positions). Use after adding nodes/links when you have not placed them well. Links inform structure. Mutates the stored topology in place; returns how many nodes moved.',
      inputShape: {
        topologyId,
        algorithm: z
          .enum(['grid', 'hierarchical', 'circular', 'force'])
          .describe(
            'hierarchical = layered by link direction; grid; circular; force = force-directed.',
          ),
        direction: z
          .enum(['TB', 'LR'])
          .optional()
          .describe('Hierarchical flow direction (default TB).'),
        spacing: z.number().optional().describe('Gap between nodes in px.'),
      },
      handler: (a) =>
        layoutDocument(store.get(String(a.topologyId)), {
          algorithm: a.algorithm as LayoutAlgorithm,
          ...(a.direction !== undefined
            ? { direction: a.direction as 'TB' | 'LR' }
            : {}),
          ...(a.spacing !== undefined ? { spacing: Number(a.spacing) } : {}),
        }),
    },
    {
      name: 'balance_topology',
      description:
        'Tidy then BALANCE a topology in place: de-overlap, snap nodes onto shared rows/columns, and centre the whole layout in the page. The crisp follow-up to tidy_topology — run it last to make a generated diagram look hand-arranged, then confirm with inspect_render before rendering. Returns how many nodes moved plus the layout-warning count before/after.',
      inputShape: {
        topologyId,
        alignTolerance: z
          .number()
          .optional()
          .describe(
            'Snap nodes onto a shared axis when within this many px (default ≈ grid×1.3).',
          ),
        center: z
          .boolean()
          .optional()
          .describe(
            "Centre the layout's bounding box in the page (default true).",
          ),
      },
      handler: (a) =>
        balanceDocument(store.get(String(a.topologyId)), {
          ...(a.alignTolerance !== undefined
            ? { alignTolerance: Number(a.alignTolerance) }
            : {}),
          ...(a.center !== undefined ? { center: Boolean(a.center) } : {}),
        }),
    },
    {
      name: 'layout_guidelines',
      description:
        'Return the ground-truth layout rules (spacing minimums, grid, zone padding, margins) plus prose guidance for arranging a well-organized, overlap-free topology. Read this before generating coordinates; validate_topology checks against the same rules.',
      inputShape: {},
      handler: () => layoutGuidelines(),
    },
    {
      name: 'inspect_render',
      description:
        'Inspect the VISUAL quality of one rendered page and return a compact report (a few KB) instead of the SVG: page/viewBox vs content bounds with margins, crop/clipping diagnostics, text-legibility warnings (labels overflowing nodes, label/label and label/node collisions, zone labels overlapped by content), routing quality (link crossings, links through unrelated nodes, degenerate link/flow geometry), and density/balance signals (overlaps, crowding clusters, unbalanced whitespace). Findings are severity-tagged (problem vs note), actionable, and capped per category with true totals in `counts`. Complements validate_topology (which checks semantics + layout rules, not legibility) — use this as the cheap final visual QA step after validate/tidy/balance and BEFORE render_svg / share_topology / export_flipbook; only render once the report is clean.',
      inputShape: {
        topologyId,
        pageIndex: z
          .number()
          .int()
          .optional()
          .describe('0-based page index; defaults to 0 (like render_svg).'),
        maxFindingsPerCategory: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe('Cap reported findings per category (default 8).'),
      },
      handler: (a) => {
        const doc = store.get(String(a.topologyId));
        const index = (a.pageIndex as number | undefined) ?? 0;
        const page = doc.pages[index];
        if (!page) throw new Error(`page index ${index} out of range`);
        return {
          pageIndex: index,
          pageName: page.name,
          ...inspectPage(
            page,
            a.maxFindingsPerCategory !== undefined
              ? { maxPerCategory: Number(a.maxFindingsPerCategory) }
              : {},
          ),
        };
      },
    },
    {
      name: 'render_svg',
      description:
        'Render a page to a complete, standalone SVG string. `pageIndex` defaults to 0 (the first frame). `visibleLayers` restricts the output to those declared layers (untagged base elements always draw) — e.g. just the underlay, or underlay + overlay. NOTE: the returned SVG is large (often 20–300KB) and is rejected above 2 MiB — do not call this after every edit. Use validate_topology for correctness checks while iterating, inspect_render for a compact visual-quality report once the layout settles, and render (or share_topology, where available) once at the end.',
      inputShape: {
        topologyId,
        pageIndex: z
          .number()
          .int()
          .optional()
          .describe('0-based page index; defaults to 0.'),
        visibleLayers: z
          .array(z.string())
          .optional()
          .describe('Layer ids to draw (omit for the layers’ defaults).'),
      },
      handler: (a) =>
        assertExportWithinLimit(
          deps.renderDocument(
            store.get(String(a.topologyId)),
            (a.pageIndex as number | undefined) ?? 0,
            a.visibleLayers !== undefined
              ? { visibleLayers: a.visibleLayers as string[] }
              : {},
          ),
          MAX_SVG_EXPORT_BYTES,
          'SVG',
        ),
    },
    {
      name: 'export_flipbook',
      description:
        'Export the whole document as one standalone, self-playing HTML flipbook: every page rendered to SVG, played in order on each page’s duration (default 2000ms) with cut/fade transitions, loop, play/pause, and frame dots. No external assets — save it as an .html file and open in any browser. Rejected above 6 MiB — for a long story, render_svg pages individually. This is how an animated multi-frame story (e.g. a flow’s setup → steady state → teardown) is delivered end to end.',
      inputShape: { topologyId },
      handler: (a) =>
        assertExportWithinLimit(
          exportFlipbookHTML(store.get(String(a.topologyId)), (doc, i) =>
            deps.renderDocument(doc, i),
          ),
          MAX_HTML_EXPORT_BYTES,
          'HTML',
        ),
    },
  ];

  // Batch authoring — one tool call applying many operations, so building a
  // diagram is O(1) tool calls instead of one per element (which exhausts
  // per-turn tool-call budgets in agent sessions). Dispatches to the same
  // validated handlers as the individual tools; atomic via snapshot/restore.
  const BATCH_OPS = [
    'add_page',
    'define_layer',
    'define_node_type',
    'add_node',
    'add_link',
    'add_anchor',
    'add_zone',
    'add_flow_path',
    'add_policy_marker',
    'set_node_metadata',
    'update_element',
    'remove_element',
    'upsert_by_source',
  ] as const;
  const batchTargets = new Map(
    tools
      .filter((t) => (BATCH_OPS as readonly string[]).includes(t.name))
      .map((t) => [t.name, t] as const),
  );
  tools.push({
    name: 'edit_topology',
    description:
      'Apply a BATCH of authoring operations to a topology in ONE call — strongly preferred over per-element tool calls when adding or editing more than a couple of elements. Each operation is {op, …args}: op is one of ' +
      BATCH_OPS.join(', ') +
      ' and the remaining keys are that tool’s arguments (topologyId and pageIndex are inherited from this call; a per-op pageIndex overrides). Operations apply in order, so later ops can reference ids created earlier. Atomic: if any operation fails the document is left unchanged and the failing index is reported. Returns compact per-op results (ids), not full elements.',
    inputShape: {
      topologyId,
      pageIndex,
      operations: z
        .array(z.record(z.string(), z.unknown()))
        .min(1)
        .max(200)
        .describe(
          'Ordered operations, e.g. [{op:"add_node", type:"ec", x:120, y:80, nodeId:"a", label:"Branch"}, {op:"add_link", type:"line", from:"a", to:"b"}].',
        ),
    },
    handler: (a) => {
      const tid = String(a.topologyId);
      const doc = store.get(tid);
      const snapshot = structuredClone(doc);
      const ops = a.operations as Record<string, unknown>[];
      const results: Record<string, unknown>[] = [];
      try {
        ops.forEach((raw, i) => {
          const { op, ...rest } = raw;
          const name = String(op ?? '');
          const tool = batchTargets.get(name);
          if (!tool)
            throw new Error(
              `operations[${i}]: unknown op "${name}" (expected one of ${BATCH_OPS.join(', ')})`,
            );
          const args = {
            topologyId: tid,
            ...(a.pageIndex !== undefined ? { pageIndex: a.pageIndex } : {}),
            ...rest,
          };
          const parsed = z.object(tool.inputShape).safeParse(args);
          if (!parsed.success)
            throw new Error(
              `operations[${i}] (${name}): ${parsed.error.issues
                .map((is) => `${is.path.join('.') || '(args)'}: ${is.message}`)
                .join('; ')}`,
            );
          const result = tool.handler(parsed.data);
          const r = (result ?? {}) as Record<string, unknown>;
          const el = r.element as Record<string, unknown> | undefined;
          results.push({
            op: name,
            ...(typeof r.id === 'string' ? { id: r.id } : {}),
            ...(el && typeof el.id === 'string' ? { id: el.id } : {}),
            ...(typeof r.pageIndex === 'number'
              ? { pageIndex: r.pageIndex }
              : {}),
          });
        });
      } catch (err) {
        // Atomic: restore the pre-batch document in place (the store holds the
        // same object reference, so mutating it back undoes every applied op).
        for (const key of Object.keys(doc))
          delete (doc as unknown as Record<string, unknown>)[key];
        Object.assign(doc, snapshot);
        throw err;
      }
      return { applied: results.length, results };
    },
  });

  // Live fabric data — registered only when a provider is wired in (from env
  // credentials on the stdio server / Worker secrets remotely). All read-only:
  // the agent queries the fabric here and authors the diagram with the tools
  // above; credentials never pass through tool arguments.
  if (deps.provider) {
    const provider = deps.provider;
    const info = provider.describe();
    tools.push(
      {
        name: 'describe_data_source',
        description:
          'Describe the connected live-data source (system id, display name, capabilities). The system id is what element source refs use in `source.system`.',
        inputShape: {},
        handler: () => provider.describe(),
      },
      {
        name: 'list_appliances',
        description: `List the SD-WAN appliances/gateways known to the connected ${info.displayName} (id, hostname, serial, model, software, site, role). Use the id in source refs (kind "appliance") and flow queries.`,
        inputShape: {},
        handler: () => provider.getAppliances(),
      },
      {
        name: 'list_tunnels',
        description:
          'List fabric tunnels from the connected data source. scope "underlay" = per-WAN transport tunnels; "overlay" = bonded/logical tunnels belonging to an overlay (BIO). Endpoints are appliance ids.',
        inputShape: {
          scope: z
            .enum(['underlay', 'overlay'])
            .describe('Which plane of tunnels to list.'),
        },
        handler: (a) => provider.getTunnels(a.scope as 'underlay' | 'overlay'),
      },
      {
        name: 'get_overlay_policies',
        description:
          'List overlay / business-intent policy definitions from the connected data source (id, name, topology shape, full raw policy document).',
        inputShape: {},
        handler: () => provider.getOverlayPolicies(),
      },
      {
        name: 'list_flows',
        description:
          'Query flow tables across the fabric (or one appliance) from the connected data source. Returns active flows by default; includeEnded:true also returns ended flows still present in the tables. Filter by ip / port / application; cap with limit.',
        inputShape: {
          applianceId: z
            .string()
            .optional()
            .describe('Restrict to one appliance (see list_appliances).'),
          ip: z.string().optional().describe('Match either endpoint IP.'),
          port: z
            .number()
            .int()
            .optional()
            .describe('Match either endpoint port.'),
          application: z
            .string()
            .optional()
            .describe('Application name (substring, case-insensitive).'),
          includeEnded: z
            .boolean()
            .optional()
            .describe('Also return ended flows still in the tables.'),
          limit: z.number().int().optional().describe('Max flows to return.'),
        },
        handler: (a) => provider.getFlows(a as FlowQuery),
      },
      {
        name: 'get_flow_details',
        description:
          'Fetch full detail for one flow from its owning appliance (normalized record + the raw vendor payload, incl. overlay and tunnel usage). Address it by applianceId + flowId (+ seqNum when list_flows reported one).',
        inputShape: {
          applianceId: z.string(),
          flowId: z.string(),
          seqNum: z.number().int().optional(),
        },
        handler: (a) =>
          provider.getFlowDetails({
            applianceId: String(a.applianceId),
            flowId: String(a.flowId),
            ...(a.seqNum !== undefined ? { seqNum: Number(a.seqNum) } : {}),
          }),
      },
      {
        name: 'build_flow_topology',
        description:
          'One shot: query the live fabric and compile a complete layered topology document — appliances as nodes, sites as zones, underlay + overlay tunnels as links on their layers, and each matched flow as an animated flow path (hop-by-hop data attached) with a policy marker for the overlay that steered it. The result is laid out, tidied, validated, and stored; render it with render_svg (use visibleLayers to isolate a plane) or share it with share_topology. Flow filters work like list_flows; limit defaults to 10. Re-running creates a fresh topology — to refresh an existing one, re-run and use the new id.',
        inputShape: {
          title: displayString(TEXT_LIMITS.title).optional(),
          applianceId: z.string().optional(),
          ip: z.string().optional().describe('Match either endpoint IP.'),
          port: z.number().int().optional(),
          application: z.string().optional(),
          includeEnded: z
            .boolean()
            .optional()
            .describe('Also draw ended flows still in the tables (as traces).'),
          limit: z
            .number()
            .int()
            .optional()
            .describe('Max flows to draw (default 10).'),
        },
        handler: async (a) => {
          const [appliances, underlay, overlay, policies] = await Promise.all([
            provider.getAppliances(),
            provider.getTunnels('underlay'),
            provider.getTunnels('overlay'),
            provider.getOverlayPolicies(),
          ]);
          const flows = await provider.getFlows({
            ...(a as FlowQuery),
            limit: (a.limit as number | undefined) ?? 10,
          });
          const { document, flowsCompiled } = compileFlowTopology(
            { appliances, underlay, overlay, policies },
            flows,
            {
              system: info.system,
              ...(a.title !== undefined ? { title: String(a.title) } : {}),
            },
          );
          const { id } = store.import(document);
          const problems = validateDocument(document);
          return {
            topologyId: id,
            title: document.title,
            appliances: appliances.length,
            tunnels: underlay.length + overlay.length,
            flowsCompiled,
            valid: !problems.some((p) => p.level === 'error'),
            problems,
          };
        },
      },
    );
  }

  // Canonical shared workspace — remote-only. These tools are intentionally
  // bounded and delta-oriented: manifest → changes → targeted elements. Agents
  // propose by default; direct writes require a lease granted from the browser.
  if (deps.workspace) {
    const workspace = deps.workspace;
    const workspaceId = z
      .string()
      .describe('Workspace id shown in the browser Agent Workspace panel.');
    const operationId = z
      .string()
      .min(1)
      .max(128)
      .describe('Client-generated idempotency id; reuse it when retrying.');
    tools.push(
      {
        name: 'create_workspace',
        description:
          'Create a canonical shared workspace with one empty page. Use this instead of a private draft when the result should immediately appear in the browser; subsequent agent edits are proposals by default.',
        inputShape: { title: displayString(TEXT_LIMITS.title).optional() },
        handler: async (a) => {
          const snapshot = await workspace.createEmpty(
            a.title === undefined ? undefined : String(a.title),
          );
          return {
            id: snapshot.id,
            revision: snapshot.revision,
            title: snapshot.document.title,
            pages: snapshot.document.pages.map((page) => ({
              id: page.id,
              name: page.name,
            })),
          };
        },
      },
      {
        name: 'list_workspaces',
        description:
          'List this owner’s canonical workspaces and legacy drafts. Legacy drafts (migrated: false) stay editable with the direct topology tools until the owner hands them off from the browser. Does not return document contents.',
        inputShape: {},
        handler: () => workspace.list(),
      },
      {
        name: 'get_workspace_manifest',
        description:
          'Get compact workspace status: revision, page ids/names, element counts, pending proposal count, and active lease. Only valid for ids already handed off as shared workspaces; a legacy topology id is rejected without being migrated.',
        inputShape: { workspaceId },
        handler: (a) => workspace.manifest(String(a.workspaceId)),
      },
      {
        name: 'describe_workspace_operations',
        description:
          'Return the versioned semantic operation vocabulary and one example. Call only before a first workspace write or when operationSchemaRevision changes; do not repeat it every turn.',
        inputShape: {},
        handler: () => ({
          operationSchemaRevision: 1,
          limits: { maxOperations: 250, maxSerializedBytes: 524288 },
          patch: {
            set: 'top-level fields to set or replace',
            unset: 'top-level optional field names to remove',
          },
          operations: {
            'document.patch': '{ type, patch }',
            'page.add': '{ type, page, afterPageId?: string|null }',
            'page.patch': '{ type, pageId, patch }',
            'page.remove': '{ type, pageId }',
            'page.reorder': '{ type, pageIds: string[] }',
            'element.add':
              '{ type, pageId, kind, element, afterElementId?: string|null }',
            'element.patch': '{ type, pageId, kind, elementId, patch }',
            'element.remove': '{ type, pageId, kind, elementId }',
            'element.reorder': '{ type, pageId, kind, elementIds: string[] }',
          },
          elementKinds: ELEMENT_KINDS,
          example: {
            type: 'element.patch',
            pageId: 'page-id',
            kind: 'nodes',
            elementId: 'node-id',
            patch: { set: { label: 'Branch A', x: 240 } },
          },
        }),
      },
      {
        name: 'get_workspace_changes',
        description:
          'Get bounded changes after a last-seen revision. Defaults to compact summaries; request operations only when exact patches are needed. If checkpointRequired is true, hydrate only the relevant page/elements.',
        inputShape: {
          workspaceId,
          sinceRevision: z.number().int().min(0),
          limit: z.number().int().min(1).max(50).optional(),
          detail: z.enum(['summary', 'operations']).optional(),
        },
        handler: (a) =>
          workspace.changes(
            String(a.workspaceId),
            Number(a.sinceRevision),
            a.limit as number | undefined,
            a.detail === 'operations',
          ),
      },
      {
        name: 'get_workspace_elements',
        description:
          'Hydrate a bounded page slice instead of loading the full document. Filter by element ids and/or collections; paginate with nextCursor.',
        inputShape: {
          workspaceId,
          pageId: z.string(),
          elementIds: z.array(z.string()).max(100).optional(),
          kinds: z.array(elementKindSchema).optional(),
          cursor: z.number().int().min(0).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
        handler: (a) =>
          workspace.elements(
            String(a.workspaceId),
            String(a.pageId),
            a.elementIds as string[] | undefined,
            a.kinds as ElementKind[] | undefined,
            a.cursor as number | undefined,
            a.limit as number | undefined,
          ),
      },
      {
        name: 'propose_workspace_changes',
        description:
          'Submit a named semantic change set for owner review. This is the default write path: it never mutates the canonical document until the browser user accepts it.',
        inputShape: {
          workspaceId,
          baseRevision: z.number().int().min(0),
          operationId,
          title: z
            .string()
            .min(1)
            .max(TEXT_LIMITS.title)
            .transform((s) => normalizeText(s)),
          rationale: displayString(TEXT_LIMITS.rationale, {
            multiline: true,
          }).optional(),
          operations: compactWorkspaceOperations,
        },
        handler: (a) =>
          workspace.propose(
            String(a.workspaceId),
            {
              baseRevision: Number(a.baseRevision),
              operationId: String(a.operationId),
              operations: a.operations as WorkspaceOperation[],
            },
            String(a.title),
            a.rationale === undefined ? undefined : String(a.rationale),
          ),
      },
      {
        name: 'apply_workspace_changes',
        description:
          'Commit semantic operations directly only while the browser has granted a live lease for that page. Suggest-only is the default; without a lease use propose_workspace_changes.',
        inputShape: {
          workspaceId,
          baseRevision: z.number().int().min(0),
          operationId,
          operations: compactWorkspaceOperations,
        },
        handler: (a) =>
          workspace.applyAgent(String(a.workspaceId), {
            baseRevision: Number(a.baseRevision),
            operationId: String(a.operationId),
            operations: a.operations as WorkspaceOperation[],
          }),
      },
      {
        name: 'create_checkpoint',
        description:
          'Snapshot the current workspace document as a named checkpoint (e.g. before a risky batch of changes). The owner can later restore or fork it from the browser. Bounded: creating beyond the per-workspace limit fails until one is deleted.',
        inputShape: {
          workspaceId,
          name: z
            .string()
            .min(1)
            .max(TEXT_LIMITS.checkpointName)
            .transform((s) => normalizeText(s))
            .describe('A short label for later.'),
        },
        handler: (a) =>
          workspace.createCheckpoint(
            String(a.workspaceId),
            String(a.name),
            'agent',
          ),
      },
      {
        name: 'list_checkpoints',
        description:
          'List this workspace’s named checkpoints (id, name, revision, page count, author). Restore and fork remain browser-owner actions.',
        inputShape: { workspaceId },
        handler: (a) => workspace.listCheckpoints(String(a.workspaceId)),
      },
    );
  }

  // Read-only authoring-profile guidance (Packet P4 / proposal 0003-B).
  // Bounded and delta-oriented like the workspace loop: pass the last-seen
  // revisions and an unchanged profile costs one tiny notModified response.
  // There is intentionally NO tool that confirms, edits, pauses, or forgets a
  // preference — those stay browser-owner actions.
  if (deps.profile) {
    const profile = deps.profile;
    tools.push(
      {
        name: 'get_authoring_guidance',
        description:
          'Get the owner’s confirmed authoring preferences plus product guidance applicable to this task, compiled into at most 5 concise directives under a hard token budget, ordered most-specific first. Call before authoring or laying out a topology; pass profileRevision/guidanceRevision from the previous response and an unchanged profile returns notModified with no instruction body. Rules that match but exceed the budget are returned as ids with an omission count, never truncated prose.',
        inputShape: {
          archetype: z
            .string()
            .max(60)
            .optional()
            .describe(
              'Task topology archetype (e.g. multi-region-hub-spoke), when known.',
            ),
          workspaceId: z
            .string()
            .max(120)
            .optional()
            .describe(
              'Workspace being authored in, for workspace conventions.',
            ),
          lastProfileRevision: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('profileRevision from the previous guidance response.'),
          lastGuidanceRevision: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('guidanceRevision from the previous guidance response.'),
          maxTokens: z
            .number()
            .int()
            .min(1)
            .max(ABSOLUTE_GUIDANCE_TOKENS)
            .optional()
            .describe(
              `Raise the ${MAX_GUIDANCE_RULES}-rule response budget above the 400-token default (absolute ceiling ${ABSOLUTE_GUIDANCE_TOKENS}) when the user explicitly asks for profile inspection.`,
            ),
        },
        handler: (a) =>
          profile.guidance({
            ...(a.archetype !== undefined
              ? { archetype: String(a.archetype) }
              : {}),
            ...(a.workspaceId !== undefined
              ? { workspaceId: String(a.workspaceId) }
              : {}),
            ...(a.lastProfileRevision !== undefined
              ? { lastProfileRevision: Number(a.lastProfileRevision) }
              : {}),
            ...(a.lastGuidanceRevision !== undefined
              ? { lastGuidanceRevision: Number(a.lastGuidanceRevision) }
              : {}),
            ...(a.maxTokens !== undefined
              ? { maxTokens: Number(a.maxTokens) }
              : {}),
          }),
      },
      {
        name: 'list_authoring_preferences',
        description:
          'List the owner’s learned authoring preferences as compact summaries (id, status, scope, directive, evidence counts) for profile inspection. Read-only management support: confirmation, scoping, pause, and forget happen in the browser, never over MCP.',
        inputShape: {},
        handler: () => profile.list(),
      },
      {
        name: 'explain_authoring_preference',
        description:
          'Explain one authoring preference: scope, trigger, rationale, confidence, and an evidence summary (counts and dates only — never document content). Use it to tell the user why a rule applies; only the user can confirm or change it.',
        inputShape: {
          preferenceId: z
            .string()
            .min(1)
            .max(64)
            .describe('Preference id from guidance or the summaries list.'),
        },
        handler: (a) => profile.explain(String(a.preferenceId)),
      },
    );
  }

  // Sharing is only available where a durable store + public origin are wired in
  // (the Worker). When present, expose a tool that snapshots the topology and
  // returns a browser link — the durable way to view what was built, immune to
  // the per-session store expiring.
  if (deps.publishTopology) {
    const publish = deps.publishTopology;
    tools.push({
      name: 'share_topology',
      description: `Publish the current topology and return a public link that opens it in the Topology Dojo editor. ${SHARE_PUBLIC_WARNING} Do not publish internal addresses, credentials, or other sensitive content. The snapshot is stored durably (it does NOT depend on the live server session). Re-run after further edits to publish an updated snapshot (a new link). Remote deployments rate-limit this tool per authenticated user (8 per 5 minutes); back off on a rate-limited error rather than retrying immediately. The publisher can revoke the link with unpublish_topology or DELETE /api/topology/<id>.`,
      inputShape: { topologyId },
      handler: (a) => publish(store.get(String(a.topologyId))),
    });
  }
  if (deps.unpublishTopology) {
    const unpublish = deps.unpublishTopology;
    tools.push({
      name: 'unpublish_topology',
      description: `Revoke a public share link you published with share_topology. Deletes the KV snapshot so /v/<id> and /api/topology/<id> stop serving it. Only the publisher can revoke. Pass the 12-character share id from the URL (or the id returned by share_topology). ${SHARE_PUBLIC_WARNING}`,
      inputShape: {
        shareId: z
          .string()
          .min(1)
          .describe(
            'Share id from share_topology (the <id> in /v/<id>), not a topologyId.',
          ),
      },
      handler: (a) => unpublish(String(a.shareId)),
    });
  }

  return tools;
}
