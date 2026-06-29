/**
 * The headless authoring API — construct/mutate a topology document in code,
 * with no DOM. This is the single authoring path the GUI and a future MCP server
 * both build on; the document JSON it produces is the contract.
 *
 * Two styles, same primitives:
 *   - pure ops: addPage/addNode/addLink/addAnchor/defineNodeType (mutate + return)
 *   - fluent:   createDocument().page().node()… for ergonomic construction
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import type {
  AnchorConfig,
  FlowPathConfig,
  LinkConfig,
  NodeConfig,
  PolicyMarkerConfig,
  ZoneConfig,
} from '../vendor/topology-ds.js';
import type { CustomNodeSpec } from '../nodes/spec.js';
import type { LayerDef, LayerKind } from './layers.js';
import { validateDocument, type Problem } from './validate.js';

const DEFAULT_VIEWBOX = '0 0 1050 700';

let _seq = 0;
/** Stable-ish unique id with a prefix (deterministic order within a run). */
export function genId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${(_seq++).toString(36)}`;
}

export interface NodeInput {
  id?: string;
  type: string;
  x: number;
  y: number;
  label?: string;
  sublabel?: string;
  color?: string;
  [key: string]: unknown;
}
export interface LinkInput {
  id?: string;
  type: string;
  from: string;
  to: string;
  color?: string;
  label?: string;
  lineStyle?: 'orthogonal' | 'curved';
  waypoints?: { x: number; y: number }[];
  [key: string]: unknown;
}
export interface PageInput {
  id?: string;
  name?: string;
  viewBox?: string;
  /** Playback hold time in ms (players default to 2000 when absent). */
  duration?: number;
  transition?: 'cut' | 'fade';
}
export interface ZoneInput extends Omit<ZoneConfig, 'id' | 'nodes'> {
  id?: string;
  nodes?: string[];
}
export interface FlowPathInput extends Omit<FlowPathConfig, 'id'> {
  id?: string;
}
export interface PolicyMarkerInput extends Omit<PolicyMarkerConfig, 'id'> {
  id?: string;
}
export interface LayerInput {
  id?: string;
  name?: string;
  kind?: LayerKind;
  color?: string;
  /** Plane opacity 0–1 (B.3) — multiplies each member element's opacity. */
  opacity?: number;
  defaultVisible?: boolean;
}

/* ── pure ops ─────────────────────────────────────────────────────── */

export function emptyDocument(title = 'Untitled'): TopologyDocument {
  return { title, pages: [], customNodes: [] };
}

export function addPage(doc: TopologyDocument, input: PageInput = {}): Page {
  const page: Page = {
    id: input.id ?? genId('p'),
    name: input.name ?? `Frame ${doc.pages.length + 1}`,
    viewBox: input.viewBox ?? DEFAULT_VIEWBOX,
    ...(input.duration !== undefined ? { duration: input.duration } : {}),
    ...(input.transition !== undefined ? { transition: input.transition } : {}),
    nodes: [],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  };
  doc.pages.push(page);
  return page;
}

export function addNode(page: Page, input: NodeInput): NodeConfig {
  const { id, ...rest } = input;
  const node: NodeConfig = { id: id ?? genId('n'), ...rest };
  page.nodes.push(node);
  return node;
}

export function addLink(page: Page, input: LinkInput): LinkConfig {
  const { id, ...rest } = input;
  const link: LinkConfig = { id: id ?? genId('l'), ...rest };
  page.links.push(link);
  return link;
}

export function addAnchor(
  page: Page,
  x: number,
  y: number,
  id?: string,
): AnchorConfig {
  const anchor: AnchorConfig = { id: id ?? genId('a'), x, y };
  page.anchors.push(anchor);
  return anchor;
}

export function addZone(page: Page, input: ZoneInput): ZoneConfig {
  const { id, nodes, ...rest } = input;
  const zone: ZoneConfig = {
    id: id ?? genId('z'),
    nodes: nodes ?? [],
    ...rest,
  };
  page.zones.push(zone);
  return zone;
}

export function addFlowPath(page: Page, input: FlowPathInput): FlowPathConfig {
  const { id, ...rest } = input;
  const flow: FlowPathConfig = { id: id ?? genId('fp'), ...rest };
  page.flowPaths.push(flow);
  return flow;
}

export function addPolicyMarker(
  page: Page,
  input: PolicyMarkerInput,
): PolicyMarkerConfig {
  const { id, ...rest } = input;
  const marker: PolicyMarkerConfig = { id: id ?? genId('pm'), ...rest };
  page.policyMarkers.push(marker);
  return marker;
}

/**
 * Declare or update (by id) a document layer. Declaration order is z-order
 * (bottom → top); untagged elements form the implicit base layer beneath all
 * declared layers. Elements opt in via their `layer` field.
 */
export function defineLayer(
  doc: TopologyDocument,
  input: LayerInput = {},
): LayerDef {
  const { id, ...rest } = input;
  const def: LayerDef = { id: id ?? genId('ly'), ...rest };
  doc.layers ??= [];
  const i = doc.layers.findIndex((l) => l.id === def.id);
  if (i >= 0) doc.layers[i] = def;
  else doc.layers.push(def);
  return def;
}

/** Add or replace a custom node type (by typeName). */
export function defineNodeType(
  doc: TopologyDocument,
  spec: CustomNodeSpec,
): CustomNodeSpec {
  const i = doc.customNodes.findIndex((c) => c.typeName === spec.typeName);
  if (i >= 0) doc.customNodes[i] = spec;
  else doc.customNodes.push(spec);
  return spec;
}

/* ── fluent builder ───────────────────────────────────────────────── */

export class PageBuilder {
  constructor(
    readonly page: Page,
    private readonly owner: DocumentBuilder,
  ) {}
  node(input: NodeInput): this {
    addNode(this.page, input);
    return this;
  }
  link(input: LinkInput): this {
    addLink(this.page, input);
    return this;
  }
  anchor(x: number, y: number, id?: string): this {
    addAnchor(this.page, x, y, id);
    return this;
  }
  zone(input: ZoneInput): this {
    addZone(this.page, input);
    return this;
  }
  flowPath(input: FlowPathInput): this {
    addFlowPath(this.page, input);
    return this;
  }
  policyMarker(input: PolicyMarkerInput): this {
    addPolicyMarker(this.page, input);
    return this;
  }
  viewBox(vb: string): this {
    this.page.viewBox = vb;
    return this;
  }
  /** Start another page on the same document. */
  nextPage(input: PageInput = {}): PageBuilder {
    return this.owner.page(input);
  }
  validate(): Problem[] {
    return this.owner.validate();
  }
  /** Finish and return the document. */
  build(): TopologyDocument {
    return this.owner.build();
  }
}

export class DocumentBuilder {
  private readonly doc: TopologyDocument;
  constructor(title = 'Untitled') {
    this.doc = emptyDocument(title);
  }
  /** Add a page and return a builder scoped to it. */
  page(input: PageInput = {}): PageBuilder {
    return new PageBuilder(addPage(this.doc, input), this);
  }
  defineNodeType(spec: CustomNodeSpec): this {
    defineNodeType(this.doc, spec);
    return this;
  }
  /** Declare a document layer (z-order = declaration order, bottom → top). */
  layer(input: LayerInput): this {
    defineLayer(this.doc, input);
    return this;
  }
  validate(): Problem[] {
    return validateDocument(this.doc);
  }
  /** The finished document (a live reference — clone if you need isolation). */
  build(): TopologyDocument {
    return this.doc;
  }
  toJSON(): string {
    return JSON.stringify(this.doc);
  }
}

export function createDocument(title?: string): DocumentBuilder {
  return new DocumentBuilder(title);
}
