/**
 * draw.io / diagrams.net export — the "my team can still edit it" format.
 *
 * Every page becomes one <diagram> in a single <mxfile>. Built from the shared
 * export scene (`./scene`), so geometry agrees with the Visio and PowerPoint
 * exports:
 *
 * - Declared document layers → draw.io layers (cells parented to the root,
 *   with each layer's `defaultVisible` as its visibility); untagged elements
 *   sit on the base layer.
 * - Zones → draw.io containers (`container=1`); member nodes on the same
 *   layer are their children with container-relative geometry, and nested
 *   zones nest. A member on a different layer stays a top-level cell of its
 *   own layer (draw.io children always share their container's layer).
 * - Nodes → vertices wrapped in an <object> that carries the Topology Dojo
 *   type, sublabel and metadata as draw.io "Edit Data" properties (plus the
 *   native `link` / `tooltip`), so `.drawio` import (`src/import/drawio.ts`)
 *   round-trips them. Common network types use draw.io's built-in network
 *   stencils; everything else a matching basic shape.
 * - Links → edges glued to their endpoints, waypoints kept, port labels as
 *   edge-end labels; anchors become small endpoint stubs.
 *
 * Lossy by design (docs/EXPORTS.md): flow paths, policy markers, port pills,
 * port tables, the sheet frame and the legend are not exported.
 *
 * DOM-free and pure.
 */
import type { TopologyDocument } from '../pages/model.js';
import {
  buildScene,
  type SceneDash,
  type SceneLink,
  type SceneNode,
  type ScenePage,
  type SceneZone,
} from './scene.js';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '&#10;');
}

/** draw.io reserves cell ids 0 (root) and 1 (base layer). */
export const DRAWIO_RESERVED_PREFIX = 'dojo:';
export function drawioCellId(id: string): string {
  return id === '0' || id === '1' || id.startsWith(DRAWIO_RESERVED_PREFIX)
    ? `${DRAWIO_RESERVED_PREFIX}${id}`
    : id;
}
const LAYER_PREFIX = 'layer:';
function layerCellId(layer: string): string {
  return layer ? `${LAYER_PREFIX}${layer}` : '1';
}

/** draw.io network stencils (verified names) with their natural aspect. */
const STENCILS: Record<string, { shape: string; aspect: number }> = {
  firewall: { shape: 'mxgraph.networks.firewall', aspect: 1 },
  router: { shape: 'mxgraph.networks.router', aspect: 0.3 },
  loadbalancer: { shape: 'mxgraph.networks.load_balancer', aspect: 0.3 },
  server: { shape: 'mxgraph.networks.server', aspect: 1.1 },
  webserver: { shape: 'mxgraph.networks.server', aspect: 1.1 },
  dns: { shape: 'mxgraph.networks.server', aspect: 1.1 },
  vm: { shape: 'mxgraph.networks.server', aspect: 1.1 },
  mailserver: { shape: 'mxgraph.networks.mail_server', aspect: 1 },
  proxy: { shape: 'mxgraph.networks.proxy_server', aspect: 1 },
  nas: { shape: 'mxgraph.networks.server_storage', aspect: 1 },
};

function dashStyle(d: SceneDash): string {
  if (d === 'dashed') return 'dashed=1;';
  if (d === 'dotted') return 'dashed=1;dashPattern=1 3;';
  return '';
}

/** Base style for a node's outline. */
function shapeStyle(n: SceneNode): string {
  switch (n.shape) {
    case 'text':
      return 'text;';
    case 'rect':
      return 'rounded=0;';
    case 'roundRect':
      return 'rounded=1;arcSize=12;';
    case 'ellipse':
      return 'ellipse;';
    case 'diamond':
      return 'rhombus;';
    case 'triangle':
      return 'triangle;direction=north;';
    case 'hexagon':
      return 'shape=hexagon;perimeter=hexagonPerimeter2;size=0.25;';
    case 'pentagon':
      return 'shape=mxgraph.basic.pentagon;';
    case 'star':
      return 'shape=mxgraph.basic.star;';
    case 'cross':
      return 'shape=cross;';
    case 'arrow':
      return 'shape=singleArrow;';
    case 'cloud':
      return 'ellipse;shape=cloud;';
    case 'cylinder':
      return 'shape=cylinder3;boundedLbl=1;size=8;';
    case 'image':
      return 'rounded=0;';
  }
}

/**
 * An image URI as a draw.io style value: `;` ends a style entry, so data URIs
 * drop the `;base64` marker (draw.io's own convention) and https URLs
 * percent-encode it.
 */
export function drawioImageRef(href: string): string {
  const m = /^data:(image\/[a-z+.-]+);base64,(.*)$/is.exec(href);
  if (m) return `data:${m[1]},${m[2]}`;
  return href.replace(/;/g, '%3B');
}

function nodeStyle(n: SceneNode): string {
  const below = !n.labelInside
    ? 'verticalLabelPosition=bottom;verticalAlign=top;labelPosition=center;align=center;'
    : 'verticalAlign=middle;align=center;';
  if (n.shape === 'image' && n.imageHref)
    return `shape=image;imageAspect=1;image=${drawioImageRef(n.imageHref)};${below}html=1;`;
  if (n.shape === 'text')
    return `text;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;fontColor=${n.stroke};`;
  const stencil = STENCILS[n.type];
  const outline = stencil ? `shape=${stencil.shape};` : shapeStyle(n);
  return (
    `${outline}fillColor=${n.fill};strokeColor=${n.stroke};fontColor=#222222;` +
    `whiteSpace=wrap;html=1;${below}`
  );
}

/** Geometry for a node: stencils keep their aspect, centred on the box. */
function nodeBox(n: SceneNode): { x: number; y: number; w: number; h: number } {
  const stencil = STENCILS[n.type];
  if (!stencil) return n;
  const w = Math.max(n.w, 50);
  const h = Math.max(16, Math.round(w * stencil.aspect));
  return {
    x: Math.round((n.x + n.w / 2 - w / 2) * 10) / 10,
    y: Math.round((n.y + n.h / 2 - h / 2) * 10) / 10,
    w,
    h,
  };
}

/** Label value (HTML; draw.io renders it with html=1). */
function nodeValue(n: SceneNode): string {
  const parts = [htmlText(n.label)];
  if (n.body) parts.push(htmlText(n.body));
  if (n.sublabel)
    parts.push(
      `<font style="font-size:9px;color:#666666">${htmlText(n.sublabel)}</font>`,
    );
  return parts.filter(Boolean).join('<br>');
}

function htmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
}

/** Valid draw.io data-attribute name for a metadata key. */
function dataKey(k: string): string | null {
  const key = k.replace(/[^A-Za-z0-9_.-]/g, '_');
  if (!/^[A-Za-z_]/.test(key)) return null;
  if (['id', 'label', 'placeholders', 'link', 'tooltip'].includes(key))
    return null;
  return key;
}

function nodeCell(
  n: SceneNode,
  parent: string,
  origin: { x: number; y: number },
): string {
  const b = nodeBox(n);
  const attrs: string[] = [
    `label="${esc(nodeValue(n))}"`,
    `dojoType="${esc(n.type)}"`,
    `dojoLabel="${esc(n.label)}"`,
  ];
  if (n.sublabel) attrs.push(`dojoSublabel="${esc(n.sublabel)}"`);
  if (n.body) attrs.push(`dojoBody="${esc(n.body)}"`);
  if (n.href) attrs.push(`link="${esc(n.href)}"`);
  if (n.tooltip) attrs.push(`tooltip="${esc(n.tooltip)}"`);
  for (const [k, v] of Object.entries(n.meta ?? {})) {
    const key = dataKey(k);
    if (key) attrs.push(`${key}="${esc(v)}"`);
  }
  return (
    `<object id="${esc(drawioCellId(n.id))}" ${attrs.join(' ')}>` +
    `<mxCell style="${esc(nodeStyle(n))}" vertex="1" parent="${esc(parent)}">` +
    geom(b.x - origin.x, b.y - origin.y, b.w, b.h) +
    `</mxCell></object>`
  );
}

function geom(x: number, y: number, w: number, h: number): string {
  const r = (v: number): number => Math.round(v * 10) / 10;
  return `<mxGeometry x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" as="geometry"/>`;
}

function zoneCell(
  z: SceneZone,
  parent: string,
  origin: { x: number; y: number },
): string {
  const label = z.sublabel
    ? `${htmlText(z.label)}<br><font style="font-size:9px">${htmlText(z.sublabel)}</font>`
    : htmlText(z.label);
  const style =
    `rounded=1;arcSize=4;container=1;pointerEvents=0;collapsible=0;recursiveResize=0;` +
    `fillColor=${z.fill};strokeColor=${z.stroke};${dashStyle(z.dash)}` +
    `fontColor=${z.stroke};fontStyle=1;verticalAlign=${z.labelPosition === 'bottom' ? 'bottom' : 'top'};` +
    `align=left;spacingLeft=8;spacingTop=2;whiteSpace=wrap;html=1;`;
  return (
    `<object id="${esc(drawioCellId(z.id))}" label="${esc(label)}" dojoKind="zone" dojoLabel="${esc(z.label)}"` +
    (z.sublabel ? ` dojoSublabel="${esc(z.sublabel)}"` : '') +
    `><mxCell style="${esc(style)}" vertex="1" parent="${esc(parent)}">` +
    geom(z.x - origin.x, z.y - origin.y, z.w, z.h) +
    `</mxCell></object>`
  );
}

function edgeStyle(l: SceneLink): string {
  const route =
    l.routing === 'orthogonal'
      ? 'edgeStyle=orthogonalEdgeStyle;rounded=1;'
      : l.routing === 'curved'
        ? 'curved=1;'
        : 'rounded=0;';
  return (
    `endArrow=none;startArrow=none;html=1;${route}${dashStyle(l.dash)}` +
    `strokeColor=${l.color};strokeWidth=${l.width};fontColor=#222222;` +
    `labelBackgroundColor=default;`
  );
}

function edgeCells(l: SceneLink, parent: string): string {
  const id = drawioCellId(l.id);
  const points = l.waypoints
    .map((w) => `<mxPoint x="${w.x}" y="${w.y}"/>`)
    .join('');
  const attrs = [
    `label="${esc(htmlText(l.label))}"`,
    `dojoType="${esc(l.type)}"`,
  ];
  if (l.style) attrs.push(`dojoStyle="${esc(l.style)}"`);
  let out =
    `<object id="${esc(id)}" ${attrs.join(' ')}>` +
    `<mxCell style="${esc(edgeStyle(l))}" edge="1" parent="${esc(parent)}" ` +
    `source="${esc(drawioCellId(l.from))}" target="${esc(drawioCellId(l.to))}">` +
    `<mxGeometry relative="1" as="geometry">` +
    (points ? `<Array as="points">${points}</Array>` : '') +
    `</mxGeometry></mxCell></object>`;
  // Port labels: edge-label children pinned near each end (x = ∓0.8).
  const endLabel = (text: string, end: 'from' | 'to'): string =>
    `<mxCell id="${esc(`${id}#${end}`)}" value="${esc(htmlText(text))}" ` +
    `style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;points=[];fontSize=9;" ` +
    `vertex="1" connectable="0" parent="${esc(id)}">` +
    `<mxGeometry x="${end === 'from' ? -0.8 : 0.8}" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry>` +
    `</mxCell>`;
  if (l.fromLabel) out += endLabel(l.fromLabel, 'from');
  if (l.toLabel) out += endLabel(l.toLabel, 'to');
  return out;
}

/** One page → the <root> cell list of an mxGraphModel. */
function pageCells(
  page: ScenePage,
  anchors: { id: string; x: number; y: number }[],
): string {
  let out = `<mxCell id="0"/><mxCell id="1" value="Base" parent="0"/>`;
  for (const layer of page.layers) {
    if (!layer.id) continue;
    out +=
      `<mxCell id="${esc(layerCellId(layer.id))}" value="${esc(layer.name)}" parent="0"` +
      (layer.visible ? '' : ' visible="0"') +
      `/>`;
  }

  const zoneById = new Map(page.zones.map((z) => [z.id, z]));
  /** The container a zone/node is nested in, honouring the same-layer rule. */
  const containerOf = (
    zoneId: string | undefined,
    layer: string,
  ): SceneZone | undefined => {
    let z = zoneId ? zoneById.get(zoneId) : undefined;
    while (z && z.layer !== layer)
      z = z.parent ? zoneById.get(z.parent) : undefined;
    return z;
  };
  const top = { x: 0, y: 0 };

  // Zones first (behind everything), parents before children (scene order).
  for (const z of page.zones) {
    const parentZone = containerOf(z.parent, z.layer);
    out += zoneCell(
      z,
      parentZone ? drawioCellId(parentZone.id) : layerCellId(z.layer),
      parentZone ?? top,
    );
  }
  for (const n of page.nodes) {
    const parentZone = containerOf(n.zone, n.layer);
    out += nodeCell(
      n,
      parentZone ? drawioCellId(parentZone.id) : layerCellId(n.layer),
      parentZone ?? top,
    );
  }
  // Anchors become small ellipse vertices so links keep both endpoints.
  const used = new Set(page.links.flatMap((l) => [l.from, l.to]));
  for (const a of anchors) {
    if (!used.has(a.id)) continue;
    out +=
      `<object id="${esc(drawioCellId(a.id))}" label="" dojoKind="anchor">` +
      `<mxCell style="ellipse;fillColor=#7d8a92;strokeColor=none;resizable=0;" vertex="1" parent="1">` +
      geom(a.x - 3, a.y - 3, 6, 6) +
      `</mxCell></object>`;
  }
  for (const l of page.links) out += edgeCells(l, layerCellId(l.layer));
  return out;
}

/** The whole document as one draw.io file (one <diagram> per page). */
export function documentToDrawioXML(doc: TopologyDocument): string {
  const scene = buildScene(doc);
  const diagrams = scene.pages
    .map((page, i) => {
      const src = doc.pages[i]!;
      const [vx = 0, vy = 0] = src.viewBox.trim().split(/\s+/).map(Number);
      const anchors = (src.anchors ?? []).map((a) => ({
        id: a.id,
        x: a.x - vx,
        y: a.y - vy,
      }));
      return (
        `<diagram id="${esc(page.id)}" name="${esc(page.name)}">` +
        `<mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${page.width}" pageHeight="${page.height}" math="0" shadow="0">` +
        `<root>${pageCells(page, anchors)}</root>` +
        `</mxGraphModel>` +
        `</diagram>`
      );
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<mxfile host="Topology Dojo" agent="topology-dojo-export" version="2">` +
    diagrams +
    `</mxfile>`
  );
}
