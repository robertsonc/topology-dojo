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
  LinkConfig,
  NodeConfig,
} from '../vendor/topology-ds.js';
import type { CustomNodeSpec } from '../nodes/spec.js';
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
    nodes: [],
    links: [],
    anchors: [],
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
