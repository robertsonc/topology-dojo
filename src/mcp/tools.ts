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
import { analyzeLayout, layoutGuidelines } from '../api/layout.js';
import { tidyDocument, balanceDocument } from '../api/tidy.js';
import { layoutDocument, type LayoutAlgorithm } from '../api/autolayout.js';
import { POLICY_MARKER_TYPES } from '../api/markers.js';
import { buildTemplate, listTemplates } from '../api/templates.js';
import type { RenderOptions } from '../render/core.js';
import type { TopologyDocument } from '../pages/model.js';
import { defaultSpec, type CustomNodeSpec } from '../nodes/spec.js';
import { TopologyStore } from './store.js';

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
   * Live fabric data source (an SD-WAN orchestrator client or the fixture
   * mock). Wired from environment credentials by the servers — never from
   * tool arguments. When absent, the live-data tools are not registered.
   */
  provider?: TopologyProvider;
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
const extra = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    'Any additional catalog fields for this type (see describe_capabilities).',
  );
type MetaMap = Record<string, string | number | boolean>;
const metaShape = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .describe('Key/value node metadata (serial, version, hostname, site…).');
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

/** Build the full set of tools bound to a store and runtime deps. */
export function createTools(store: TopologyStore, deps: ToolDeps): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: 'describe_capabilities',
      description:
        'List every node type, link type, and annotation kind with its editable fields. This is the discovery surface: call it first to learn what you can set. Pass a topologyId to include that document’s custom node types.',
      inputShape: { topologyId: topologyId.optional() },
      handler: (a) => {
        const custom = a.topologyId
          ? store.get(String(a.topologyId)).customNodes
          : [];
        return {
          nodeTypes: nodeCatalog(custom),
          linkTypes: linkCatalog(),
          annotations: annotationCatalog(),
          layers: layerCatalog(),
        };
      },
    },
    {
      name: 'create_topology',
      description:
        'Create a new topology document (seeded with one empty page "Frame 1"). Returns its id; pass that id to subsequent tools.',
      inputShape: { title: z.string().optional() },
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
        title: z.string().optional(),
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
        'Return the full document JSON for a topology (the canonical, portable contract).',
      inputShape: { topologyId },
      handler: (a) => store.get(String(a.topologyId)),
    },
    {
      name: 'import_topology',
      description:
        'Load a topology from document JSON (a string or object). Returns the new id.',
      inputShape: {
        json: z
          .union([z.string(), z.record(z.string(), z.unknown())])
          .describe('Document JSON as a string or object.'),
        title: z.string().optional(),
      },
      handler: (a) => {
        const { id, document } = store.import(
          a.json,
          a.title ? String(a.title) : undefined,
        );
        return { id, title: document.title, pages: document.pages.length };
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
        name: z.string().optional(),
        viewBox: z.string().optional(),
        duration: z
          .number()
          .optional()
          .describe('Playback hold time in ms (players default to 2000).'),
        transition: z.enum(['cut', 'fade']).optional(),
      },
      handler: (a) => {
        const doc = store.get(String(a.topologyId));
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
      inputShape: { topologyId, title: z.string() },
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
        name: z.string().optional(),
        viewBox: z.string().optional(),
        duration: z
          .number()
          .optional()
          .describe('Playback hold time in ms (players default to 2000).'),
        transition: z.enum(['cut', 'fade']).optional(),
      },
      handler: (a) => {
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
        name: z.string().optional().describe('Label for the palette.'),
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
        label: z.string().optional(),
        sublabel: z.string().optional(),
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
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
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
        label: z.string().optional(),
        color: z.string().optional(),
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
        label: z.string().optional(),
        sublabel: z.string().optional(),
        description: z.string().optional(),
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
        label: z.string().optional(),
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
        label: z.string().optional(),
        color: z.string().optional(),
        icon: z
          .string()
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
        set: z
          .record(z.string(), z.unknown())
          .describe('Fields to merge; null clears a field.'),
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
        set: z
          .record(z.string(), z.unknown())
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
        name: z
          .string()
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
        'Tidy then BALANCE a topology in place: de-overlap, snap nodes onto shared rows/columns, and centre the whole layout in the page. The crisp follow-up to tidy_topology — run it last to make a generated diagram look hand-arranged. Returns how many nodes moved plus the layout-warning count before/after.',
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
      name: 'render_svg',
      description:
        'Render a page to a complete, standalone SVG string. `pageIndex` defaults to 0 (the first frame). `visibleLayers` restricts the output to those declared layers (untagged base elements always draw) — e.g. just the underlay, or underlay + overlay.',
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
        deps.renderDocument(
          store.get(String(a.topologyId)),
          (a.pageIndex as number | undefined) ?? 0,
          a.visibleLayers !== undefined
            ? { visibleLayers: a.visibleLayers as string[] }
            : {},
        ),
    },
    {
      name: 'export_flipbook',
      description:
        'Export the whole document as one standalone, self-playing HTML flipbook: every page rendered to SVG, played in order on each page’s duration (default 2000ms) with cut/fade transitions, loop, play/pause, and frame dots. No external assets — save it as an .html file and open in any browser. This is how an animated multi-frame story (e.g. a flow’s setup → steady state → teardown) is delivered end to end.',
      inputShape: { topologyId },
      handler: (a) =>
        exportFlipbookHTML(store.get(String(a.topologyId)), (doc, i) =>
          deps.renderDocument(doc, i),
        ),
    },
  ];

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
          title: z.string().optional(),
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

  // Sharing is only available where a durable store + public origin are wired in
  // (the Worker). When present, expose a tool that snapshots the topology and
  // returns a browser link — the durable way to view what was built, immune to
  // the per-session store expiring.
  if (deps.publishTopology) {
    const publish = deps.publishTopology;
    tools.push({
      name: 'share_topology',
      description:
        'Publish the current topology and return a link that opens it in the Topology Dojo editor in a browser. Use this to give the user a viewable/shareable result after building. The snapshot is stored durably (it does NOT depend on the live server session, so the link keeps working after this session ends). Re-run after further edits to publish an updated snapshot (a new link).',
      inputShape: { topologyId },
      handler: (a) => publish(store.get(String(a.topologyId))),
    });
  }

  return tools;
}
