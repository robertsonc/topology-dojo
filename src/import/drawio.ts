/**
 * draw.io / diagrams.net import — bring an existing `.drawio` diagram in, so
 * a team can migrate without redrawing. The counterpart of
 * `src/export/drawio.ts`; a file this app exported round-trips its types,
 * labels, sublabels, metadata, layers, zones and port labels.
 *
 * Mapping:
 * - each <diagram> → a page (compressed diagrams are inflated);
 * - layers (cells parented to the root) → declared document layers (the
 *   first layer is the implicit base layer), with draw.io visibility as
 *   `defaultVisible`;
 * - containers (`container=1`, swimlanes, groups) → zones, members = the
 *   vertices nested inside them, nested containers → `parentZone`;
 * - other vertices → nodes: the exported `dojoType` when present, else a type
 *   inferred from the stencil / style (router, switch, firewall, server,
 *   cloud, database, …) and finally a basic shape; text cells → text nodes;
 *   https / data images → image nodes;
 * - edges → links (orthogonal / curved routing, dashes, colour, width,
 *   waypoints), edge-end labels → port labels; an edge end that is not
 *   attached to a vertex becomes an anchor;
 * - <object> data properties → node metadata; `link` / `tooltip` → href /
 *   tooltip.
 *
 * Anything else (draw.io-only styling, rotation, rich HTML formatting,
 * custom stencils) is dropped with a warning count. Geometry is kept as
 * drawn: node centres land where the draw.io shapes were.
 *
 * DOM-free and pure: shared by the browser open flow and `import_topology`.
 */
import { inflateSync, strFromU8 } from 'fflate';
import type { Page, TopologyDocument } from '../pages/model.js';
import type {
  AnchorConfig,
  LinkConfig,
  NodeConfig,
  ZoneConfig,
} from '../vendor/topology-ds.js';
import type { LayerDef } from '../api/layers.js';
import { getLinkType, getNodeType } from '../api/catalog.js';
import { sanitizeDisplayFields } from '../api/text.js';
import {
  childrenNamed,
  decodeEntities,
  findFirst,
  parseXml,
  type XmlElement,
} from './xml.js';

export interface DrawioConvertResult {
  ok: boolean;
  document?: TopologyDocument;
  warnings: string[];
  error?: string;
}

/** Most cells accepted per page (a guard against pathological files). */
export const MAX_DRAWIO_CELLS = 5000;
/** Most pages accepted per file. */
export const MAX_DRAWIO_PAGES = 64;

/** True when the text looks like a draw.io file or bare mxGraphModel. */
export function detectDrawio(text: string): boolean {
  const head = text
    .slice(0, 2048)
    .replace(/^\uFEFF/, '')
    .trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(mxfile|mxGraphModel)\b/.test(
    head,
  );
}

const PREFIX = 'dojo:';
const LAYER_PREFIX = 'layer:';

interface Cell {
  id: string;
  parent: string;
  vertex: boolean;
  edge: boolean;
  source?: string;
  target?: string;
  value: string;
  style: Record<string, string>;
  styleNames: Set<string>;
  geom?: XmlElement;
  /** <object>/<UserObject> data attributes (minus id/label). */
  data: Record<string, string>;
  visible: boolean;
}

/** Parse a draw.io style string into key=value pairs + bare names. */
export function parseStyle(style: string): {
  map: Record<string, string>;
  names: Set<string>;
} {
  const map: Record<string, string> = {};
  const names = new Set<string>();
  for (const part of style.split(';')) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf('=');
    if (eq === -1) names.add(p);
    else map[p.slice(0, eq)] = p.slice(eq + 1);
  }
  return { map, names };
}

/** Inflate a compressed <diagram> body (base64 → raw deflate → URI-encoded XML). */
export function inflateDiagram(text: string): string {
  const b64 = text.replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // draw.io URI-encodes before deflating (ASCII), but older writers deflate
  // the UTF-8 XML directly — decoding as UTF-8 reads both.
  const raw = strFromU8(inflateSync(bytes));
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** HTML label → plain text lines (draw.io labels are often html=1). */
export function htmlToText(value: string, html: boolean): string {
  if (!html) return value;
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(div|p|li|tr|h\d)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

function num(v: string | undefined, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function hex(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s))
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  return undefined;
}

function unprefix(id: string): string {
  return id.startsWith(PREFIX) ? id.slice(PREFIX.length) : id;
}

/** Element-id safe for this app (ids are free-form, but keep them tidy). */
function cleanId(id: string): string {
  return (
    unprefix(id)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f]/g, '')
      .slice(0, 120) || 'cell'
  );
}

function readCells(root: XmlElement): Cell[] {
  const cells: Cell[] = [];
  for (const el of root.children) {
    let cellEl: XmlElement | undefined;
    let id: string | undefined;
    let value: string | undefined;
    const data: Record<string, string> = {};
    if (el.name === 'mxCell') {
      cellEl = el;
      id = el.attrs.id;
      value = el.attrs.value;
    } else if (el.name === 'object' || el.name === 'UserObject') {
      cellEl = childrenNamed(el, 'mxCell')[0];
      id = el.attrs.id;
      value = el.attrs.label;
      for (const [k, v] of Object.entries(el.attrs))
        if (k !== 'id' && k !== 'label' && k !== 'placeholders') data[k] = v;
    }
    if (!cellEl || id === undefined) continue;
    const { map, names } = parseStyle(cellEl.attrs.style ?? '');
    cells.push({
      id,
      parent: cellEl.attrs.parent ?? '',
      vertex: cellEl.attrs.vertex === '1',
      edge: cellEl.attrs.edge === '1',
      ...(cellEl.attrs.source ? { source: cellEl.attrs.source } : {}),
      ...(cellEl.attrs.target ? { target: cellEl.attrs.target } : {}),
      value: value ?? '',
      style: map,
      styleNames: names,
      geom: childrenNamed(cellEl, 'mxGeometry')[0],
      data,
      visible: cellEl.attrs.visible !== '0',
    });
  }
  return cells;
}

/** Stencil / style keywords → Topology Dojo node types (first match wins). */
const TYPE_HINTS: [RegExp, string][] = [
  [/firewall|security\.(asa|ips)|ngfw/i, 'firewall'],
  [/load_?balancer|\bslb\b|\balb\b|\bnlb\b/i, 'loadbalancer'],
  [/wireless_?(access_?point|lan_?controller)|access_?point|\bwlc\b/i, 'ap'],
  [/router/i, 'router'],
  [/switch/i, 'switch'],
  [/mail_?server/i, 'mailserver'],
  [/proxy/i, 'proxy'],
  [/web_?server/i, 'webserver'],
  [/database|cylinder|datastore|\bdb\b/i, 'database'],
  [/storage|\bnas\b|\bsan\b/i, 'nas'],
  [/virtual_?machine|\bvm\b/i, 'vm'],
  [/server|mainframe/i, 'server'],
  [/\bcloud\b|shape=cloud|internet/i, 'cloud'],
  [/printer/i, 'printer'],
  [/camera/i, 'camera'],
  [/phone|voip/i, 'voip'],
  [/users|user_?group|group_?of_?users/i, 'usergroup'],
  [
    /laptop|desktop|workstation|\bpc\b|computer|terminal|user|person|actor/i,
    'host',
  ],
  [/modem/i, 'modem'],
  [/\bups\b/i, 'ups'],
];

function inferNodeType(c: Cell, unknownTypes: Set<string>): string {
  const dojo = c.data.dojoType;
  if (dojo && getNodeType(dojo)) return dojo;
  // A custom (Node Designer) type is not carried by the file: fall back.
  if (dojo) unknownTypes.add(dojo);
  const shape = c.style.shape ?? '';
  if (c.styleNames.has('text') || shape === 'text') return 'text';
  if (c.styleNames.has('image') || shape === 'image') return 'image';
  const stencilText = `${shape} ${c.style.prIcon ?? ''} ${c.style.image ?? ''}`;
  if (/mxgraph\./.test(shape) || c.style.prIcon) {
    for (const [re, type] of TYPE_HINTS) if (re.test(stencilText)) return type;
  }
  if (shape === 'cloud' || c.styleNames.has('cloud')) return 'cloud';
  if (shape === 'cylinder' || shape === 'cylinder3' || shape === 'datastore')
    return 'database';
  if (c.styleNames.has('rhombus') || shape === 'rhombus')
    return 'shape:diamond';
  if (c.styleNames.has('ellipse') || shape === 'ellipse')
    return c.style.aspect === 'fixed' ? 'shape:circle' : 'shape:ellipse';
  if (c.styleNames.has('triangle') || shape === 'triangle')
    return 'shape:triangle';
  if (shape === 'hexagon') return 'shape:hexagon';
  if (shape === 'mxgraph.basic.pentagon') return 'shape:pentagon';
  if (shape === 'mxgraph.basic.star') return 'shape:star';
  if (shape === 'cross') return 'shape:cross';
  if (shape === 'singleArrow') return 'shape:arrow';
  if (/mxgraph\./.test(shape))
    for (const [re, type] of TYPE_HINTS) if (re.test(stencilText)) return type;
  return 'shape:rectangle';
}

function isContainer(c: Cell, hasChildren: boolean): boolean {
  if (c.data.dojoKind === 'zone') return true;
  if (c.style.container === '1') return true;
  if (c.styleNames.has('swimlane') || c.style.shape === 'swimlane') return true;
  if (c.styleNames.has('group')) return hasChildren;
  return false;
}

const DATA_SKIP = new Set([
  'dojoType',
  'dojoLabel',
  'dojoSublabel',
  'dojoBody',
  'dojoKind',
  'dojoStyle',
  'link',
  'tooltip',
]);

function convertPage(
  model: XmlElement,
  name: string,
  pageId: string,
  layerDefs: Map<string, LayerDef>,
  warnings: string[],
): Page {
  const root = childrenNamed(model, 'root')[0];
  const cells = root ? readCells(root) : [];
  if (cells.length > MAX_DRAWIO_CELLS)
    throw new Error(`page "${name}" has more than ${MAX_DRAWIO_CELLS} cells`);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const rootCell = cells.find((c) => !c.parent || !byId.has(c.parent));
  const rootId = rootCell?.id ?? '0';

  // Layers: children of the root. The first is the base layer.
  const layerCells = cells.filter(
    (c) => c.parent === rootId && !c.vertex && !c.edge,
  );
  const layerIdOf = new Map<string, string>();
  layerCells.forEach((lc, i) => {
    if (i === 0) {
      layerIdOf.set(lc.id, '');
      return;
    }
    const id = lc.id.startsWith(LAYER_PREFIX)
      ? lc.id.slice(LAYER_PREFIX.length)
      : cleanId(lc.id);
    layerIdOf.set(lc.id, id);
    if (!layerDefs.has(id)) {
      const nm = htmlToText(lc.value, true) || id;
      layerDefs.set(id, {
        id,
        ...(nm !== id ? { name: nm } : {}),
        ...(lc.visible ? {} : { defaultVisible: false }),
      });
    }
  });

  const childCount = new Map<string, number>();
  for (const c of cells)
    if (c.vertex || c.edge)
      childCount.set(c.parent, (childCount.get(c.parent) ?? 0) + 1);

  /** Absolute top-left of a vertex: its geometry plus every vertex ancestor's. */
  const absCache = new Map<string, { x: number; y: number }>();
  const absOrigin = (id: string, guard = 0): { x: number; y: number } => {
    const hit = absCache.get(id);
    if (hit) return hit;
    const c = byId.get(id);
    if (!c || !c.vertex || guard > 64) return { x: 0, y: 0 };
    const g = c.geom?.attrs ?? {};
    const parent = absOrigin(c.parent, guard + 1);
    const out = { x: parent.x + num(g.x), y: parent.y + num(g.y) };
    absCache.set(id, out);
    return out;
  };
  const layerOfCell = (c: Cell, guard = 0): string => {
    if (layerIdOf.has(c.parent)) return layerIdOf.get(c.parent)!;
    const p = byId.get(c.parent);
    return p && guard < 64 ? layerOfCell(p, guard + 1) : '';
  };

  const nodes: NodeConfig[] = [];
  const zones: ZoneConfig[] = [];
  const anchors: AnchorConfig[] = [];
  const links: LinkConfig[] = [];
  const nodeIds = new Set<string>();
  const zoneIdOf = new Map<string, string>();
  const endLabels = new Map<
    string,
    { from?: string; to?: string; mid?: string }
  >();
  let dropped = 0;
  const unknownTypes = new Set<string>();

  // Edge-label children (vertices parented to an edge).
  for (const c of cells) {
    const parent = byId.get(c.parent);
    if (!c.vertex || !parent?.edge) continue;
    const text = htmlToText(c.value, true);
    if (!text) continue;
    const x = num(c.geom?.attrs.x);
    const slot = endLabels.get(parent.id) ?? {};
    if (c.id.endsWith('#from') || x <= -0.5) slot.from ??= text;
    else if (c.id.endsWith('#to') || x >= 0.5) slot.to ??= text;
    else slot.mid ??= text;
    endLabels.set(parent.id, slot);
  }

  for (const c of cells) {
    if (!c.vertex || c.parent === rootId) continue;
    if (byId.get(c.parent)?.edge) continue;
    const g = c.geom?.attrs ?? {};
    const o = absOrigin(c.id);
    const w = Math.max(1, num(g.width, 40));
    const h = Math.max(1, num(g.height, 30));
    const html = c.style.html === '1';
    const text = htmlToText(c.value, html);
    const layer = layerOfCell(c);
    const id = cleanId(c.id);

    if (c.data.dojoKind === 'anchor') {
      anchors.push({ id, x: round(o.x + w / 2), y: round(o.y + h / 2) });
      continue;
    }
    if (isContainer(c, (childCount.get(c.id) ?? 0) > 0)) {
      const [first = '', ...rest] = text.split('\n');
      const z: ZoneConfig = {
        id,
        nodes: [],
        label: c.data.dojoLabel ?? first,
      };
      const sub = c.data.dojoSublabel ?? rest.join(' ');
      if (sub) z.sublabel = sub;
      const stroke = hex(c.style.strokeColor);
      if (stroke) z.color = stroke;
      if (c.style.dashed === '1')
        z.borderStyle = c.style.dashPattern?.startsWith('1 ')
          ? 'dotted'
          : 'dashed';
      else z.borderStyle = 'solid';
      if (c.style.verticalAlign === 'bottom') z.labelPosition = 'bottom';
      if (layer) z.layer = layer;
      zoneIdOf.set(c.id, id);
      zones.push(z);
      continue;
    }

    const type = inferNodeType(c, unknownTypes);
    const [first = '', ...rest] = text.split('\n');
    const n: NodeConfig = {
      id,
      type,
      x: round(o.x + w / 2),
      y: round(o.y + h / 2),
    };
    const label = c.data.dojoLabel ?? (type === 'text' ? text : first);
    if (label) n.label = label;
    const sub = c.data.dojoSublabel ?? (type === 'text' ? '' : rest.join(' '));
    if (sub) n.sublabel = sub;
    if (c.data.dojoBody) n.body = c.data.dojoBody;
    const stroke = hex(c.style.strokeColor) ?? hex(c.style.fillColor);
    if (stroke && type !== 'text' && type !== 'image') n.color = stroke;
    if (type === 'image') {
      const img = (c.style.image ?? '').replace(/%3B/gi, ';');
      const m = /^data:(image\/[a-z+.-]+),(.*)$/is.exec(img);
      const href = m ? `data:${m[1]};base64,${m[2]}` : img;
      if (/^https:\/\//i.test(href) || /^data:image\//i.test(href))
        n.imageHref = href;
      n.imageW = round(w);
      n.imageH = round(h);
    } else if (type === 'shape:rectangle' || type === 'shape:ellipse') {
      n.shapeWidth = round(w);
      n.shapeHeight = round(h);
    } else if (type.startsWith('shape:')) {
      n.shapeSize = round(Math.min(w, h));
    } else if (type === 'text' && w > 1) {
      n.width = round(w);
    }
    if (c.data.link && /^https?:\/\//i.test(c.data.link)) n.href = c.data.link;
    if (c.data.tooltip) n.tooltip = c.data.tooltip;
    const meta: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.data))
      if (!DATA_SKIP.has(k) && v !== '') meta[k] = v;
    if (Object.keys(meta).length) n.meta = meta;
    if (layer) n.layer = layer;
    const zoneParent = zoneIdForAncestor(c.parent);
    if (zoneParent) zones.find((z) => z.id === zoneParent)?.nodes.push(id);
    nodes.push(n);
    nodeIds.add(id);
  }

  // Nested containers → parentZone (resolved after every zone is known).
  for (const c of cells) {
    const zid = zoneIdOf.get(c.id);
    if (!zid) continue;
    const parentZone = zoneIdOf.get(c.parent);
    if (parentZone) zones.find((z) => z.id === zid)!.parentZone = parentZone;
  }

  function zoneIdForAncestor(id: string, guard = 0): string | undefined {
    const z = zoneIdOf.get(id);
    if (z) return z;
    const c = byId.get(id);
    return c && guard < 64 ? zoneIdForAncestor(c.parent, guard + 1) : undefined;
  }

  let anchorSeq = 0;
  const pointOf = (
    el: XmlElement | undefined,
  ): { x: number; y: number } | undefined =>
    el ? { x: round(num(el.attrs.x)), y: round(num(el.attrs.y)) } : undefined;
  const endpoint = (
    ref: string | undefined,
    pt: { x: number; y: number } | undefined,
  ): string | null => {
    if (ref) {
      const rid = cleanId(ref);
      if (nodeIds.has(rid) || anchors.some((a) => a.id === rid)) return rid;
      // An edge glued to a container ends on a free anchor at its centre.
      const zc = zoneIdOf.has(ref) ? byId.get(ref) : undefined;
      if (zc && !pt) {
        const o = absOrigin(ref);
        pt = {
          x: round(o.x + num(zc.geom?.attrs.width) / 2),
          y: round(o.y + num(zc.geom?.attrs.height) / 2),
        };
      }
    }
    if (!pt) return null;
    const id = `anchor_${++anchorSeq}`;
    anchors.push({ id, ...pt });
    return id;
  };

  for (const c of cells) {
    if (!c.edge) continue;
    const g = c.geom;
    const srcPt = g
      ? pointOf(
          g.children.find(
            (p) => p.name === 'mxPoint' && p.attrs.as === 'sourcePoint',
          ),
        )
      : undefined;
    const tgtPt = g
      ? pointOf(
          g.children.find(
            (p) => p.name === 'mxPoint' && p.attrs.as === 'targetPoint',
          ),
        )
      : undefined;
    const from = endpoint(c.source, srcPt);
    const to = endpoint(c.target, tgtPt);
    if (!from || !to) {
      dropped++;
      continue;
    }
    const html = c.style.html === '1';
    const type =
      c.data.dojoType && getLinkType(c.data.dojoType)
        ? c.data.dojoType
        : 'line';
    const l: LinkConfig = { id: cleanId(c.id), type, from, to };
    const slot = endLabels.get(c.id);
    const label = htmlToText(c.value, html) || slot?.mid || '';
    if (label) l.label = label;
    if (slot?.from) l.fromLabel = slot.from;
    if (slot?.to) l.toLabel = slot.to;
    if (c.data.dojoStyle) l.style = c.data.dojoStyle;
    const color = hex(c.style.strokeColor);
    if (color) l.color = color;
    const sw = num(c.style.strokeWidth, NaN);
    if (Number.isFinite(sw) && sw !== 2) l.strokeWidth = sw;
    if (c.style.dashed === '1' && type !== 'tunnel' && type !== 'wireguard')
      l.dashed = true;
    const es = c.style.edgeStyle ?? '';
    if (/orthogonal|elbow|isometric|entityRelation/i.test(es))
      l.lineStyle = 'orthogonal';
    else if (c.style.curved === '1') l.lineStyle = 'curved';
    const arr = g?.children.find(
      (p) => p.name === 'Array' && p.attrs.as === 'points',
    );
    // Waypoints in an edge's parent frame; only layer-parented edges are absolute.
    const base = byId.get(c.parent)?.vertex
      ? absOrigin(c.parent)
      : { x: 0, y: 0 };
    const wps = (arr?.children ?? [])
      .filter((p) => p.name === 'mxPoint')
      .map((p) => ({
        x: round(base.x + num(p.attrs.x)),
        y: round(base.y + num(p.attrs.y)),
      }));
    if (wps.length) l.waypoints = wps;
    const layer = layerOfCell(c);
    if (layer) l.layer = layer;
    links.push(l);
  }
  if (unknownTypes.size)
    warnings.push(
      `${name}: custom node type(s) ${[...unknownTypes].join(', ')} are not in the catalog and were mapped to the closest shape`,
    );
  if (dropped)
    warnings.push(
      `${name}: ${dropped} edge(s) without a resolvable endpoint were skipped`,
    );

  // Frame the page around the content (draw.io coordinates are unbounded).
  const pageW = num(model.attrs.pageWidth, 1050);
  const pageH = num(model.attrs.pageHeight, 700);
  let maxX = pageW;
  let maxY = pageH;
  let minX = 0;
  let minY = 0;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - 80);
    minY = Math.min(minY, n.y - 80);
    maxX = Math.max(maxX, n.x + 80);
    maxY = Math.max(maxY, n.y + 80);
  }
  return {
    id: pageId,
    name,
    viewBox: `${Math.floor(minX)} ${Math.floor(minY)} ${Math.ceil(maxX - minX)} ${Math.ceil(maxY - minY)}`,
    nodes,
    links,
    anchors,
    zones: zones.filter(
      (z) => z.nodes.length > 0 || zones.some((k) => k.parentZone === z.id),
    ),
    flowPaths: [],
    policyMarkers: [],
  };
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Convert draw.io XML (an .drawio file or a bare mxGraphModel). */
export function convertDrawio(
  text: string,
  title?: string,
): DrawioConvertResult {
  if (!detectDrawio(text))
    return {
      ok: false,
      warnings: [],
      error:
        'not a draw.io file — expected an <mxfile> or <mxGraphModel> root element',
    };
  const warnings: string[] = [];
  let root: XmlElement;
  try {
    root = parseXml(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    return {
      ok: false,
      warnings,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const diagrams: { name: string; id: string; model: XmlElement }[] = [];
  try {
    if (root.name === 'mxGraphModel') {
      diagrams.push({ name: 'Page-1', id: 'p1', model: root });
    } else {
      const list = childrenNamed(root, 'diagram');
      if (list.length > MAX_DRAWIO_PAGES)
        return {
          ok: false,
          warnings,
          error: `more than ${MAX_DRAWIO_PAGES} pages`,
        };
      list.forEach((d, i) => {
        let model = findFirst(d, 'mxGraphModel');
        if (!model && d.text.trim()) {
          const inner = inflateDiagram(d.text);
          model = parseXml(inner);
          if (model.name !== 'mxGraphModel')
            model = findFirst(model, 'mxGraphModel');
        }
        if (!model) {
          warnings.push(`page ${i + 1} has no diagram content and was skipped`);
          return;
        }
        diagrams.push({
          name: d.attrs.name || `Page-${i + 1}`,
          id: `p${i + 1}`,
          model,
        });
      });
    }
  } catch (err) {
    return {
      ok: false,
      warnings,
      error: `could not read a compressed diagram: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!diagrams.length)
    return { ok: false, warnings, error: 'the file has no diagram pages' };

  const layers = new Map<string, LayerDef>();
  let pages: Page[];
  try {
    pages = diagrams.map((d) =>
      convertPage(d.model, d.name, d.id, layers, warnings),
    );
  } catch (err) {
    return {
      ok: false,
      warnings,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!pages.some((p) => p.nodes.length))
    return { ok: false, warnings, error: 'no shapes found in the diagram' };

  const document: TopologyDocument = {
    title: title ?? (root.attrs.title || 'Imported draw.io diagram'),
    pages,
    customNodes: [],
    ...(layers.size ? { layers: [...layers.values()] } : {}),
  };
  sanitizeDisplayFields(document);
  return { ok: true, warnings, document };
}
