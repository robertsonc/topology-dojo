/**
 * PowerPoint (.pptx) export — the diagram where the deal is presented. One
 * 16:9 slide per page, or per layer (`slides: 'layers'`: the full page, then
 * the base plus one declared layer at a time — an underlay / overlay / policy
 * walk-through). Built from the shared export scene (`./scene`).
 *
 * Two content modes:
 * - `shapes` (default): native, editable PowerPoint shapes — preset outlines
 *   per node shape (rounded rect, ellipse, diamond, hexagon, cloud, can, …)
 *   with the label inside or as a text box under device icons; straight links
 *   as connectors glued to their shapes (they follow when a shape moves);
 *   orthogonal / waypointed links as freeform polylines; link and port labels
 *   as small text boxes; zones as background rounded rectangles. Each layer's
 *   shapes form a group named "Layer: …", so the Selection Pane shows and
 *   hides planes like layers (hidden by default when the layer is).
 * - `image`: the pixel-faithful render (same engine as PNG export) as one
 *   picture per slide — exactly the canvas look, not editable. The caller
 *   supplies the PNGs (the tool layer rasterizes server-side).
 *
 * Dropped in `shapes` mode (docs/EXPORTS.md): device glyph art, glow /
 * animation, flow paths, policy markers, port pills and tables, the sheet
 * frame and legend, https images. DOM-free and pure.
 */
import type { TopologyDocument } from '../pages/model.js';
import {
  buildScene,
  type SceneDash,
  type SceneLink,
  type SceneNode,
  type ScenePage,
  type ScenePoint,
} from './scene.js';
import {
  CT,
  REL,
  XML_HEADER,
  contentTypesXml,
  corePropsXml,
  decodeDataImage,
  relsXml,
  xmlEsc,
  zipPackage,
  type Relationship,
} from './opc.js';

export type PptxSlides = 'pages' | 'layers';
export type PptxMode = 'shapes' | 'image';

export interface PptxOptions {
  slides?: PptxSlides;
  mode?: PptxMode;
  /**
   * `image` mode: a PNG of the given page with only these layers visible
   * (undefined = the page's defaults). Required for `image` mode.
   */
  renderImage?: (
    pageIndex: number,
    visibleLayers: string[] | undefined,
  ) => { png: Uint8Array; width: number; height: number };
}

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const PREL = {
  slide:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  slideLayout:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  slideMaster:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  theme:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  presProps:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps',
  viewProps:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps',
  tableStyles:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles',
};
const PCT = {
  presentation:
    'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  slide:
    'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  layout:
    'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  master:
    'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  presProps:
    'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml',
  viewProps:
    'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml',
  tableStyles:
    'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml',
};

/** 16:9 slide, EMU. */
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;
const MARGIN = 365760; // 0.4 in
const TITLE_H = 457200; // 0.5 in
const EMU_PER_PT = 12700;

const rgb = (hex: string): string => hex.replace('#', '').toUpperCase();
const emu = (v: number): number => Math.round(v);

/** Preset geometry per scene shape (ECMA-376 ST_ShapeType names). */
const PRESET: Record<SceneNode['shape'], string> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  diamond: 'diamond',
  triangle: 'triangle',
  hexagon: 'hexagon',
  pentagon: 'pentagon',
  star: 'star5',
  cross: 'plus',
  arrow: 'rightArrow',
  cloud: 'cloud',
  cylinder: 'can',
  text: 'rect',
  image: 'rect',
};

function dashXml(d: SceneDash): string {
  return d === 'dashed'
    ? '<a:prstDash val="dash"/>'
    : d === 'dotted'
      ? '<a:prstDash val="sysDot"/>'
      : '';
}

function lineXml(
  color: string | null,
  widthEmu: number,
  dash: SceneDash = 'solid',
): string {
  if (!color) return '<a:ln><a:noFill/></a:ln>';
  return `<a:ln w="${emu(widthEmu)}"><a:solidFill><a:srgbClr val="${rgb(color)}"/></a:solidFill>${dashXml(dash)}</a:ln>`;
}

function fillXml(color: string | null): string {
  return color
    ? `<a:solidFill><a:srgbClr val="${rgb(color)}"/></a:solidFill>`
    : '<a:noFill/>';
}

interface TextRun {
  text: string;
  sizePt: number;
  color: string;
  bold?: boolean;
}

function txBody(
  paras: TextRun[],
  opts: {
    anchor?: 't' | 'ctr' | 'b';
    algn?: 'l' | 'ctr' | 'r';
    inset?: number;
  } = {},
): string {
  const ins = emu(opts.inset ?? 0);
  return (
    `<p:txBody><a:bodyPr wrap="square" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" anchor="${opts.anchor ?? 'ctr'}" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>` +
    (paras.length
      ? paras
          .map(
            (p) =>
              `<a:p><a:pPr algn="${opts.algn ?? 'ctr'}"/><a:r><a:rPr lang="en-US" sz="${Math.max(100, Math.round(p.sizePt * 100))}"${p.bold ? ' b="1"' : ''} dirty="0">` +
              `<a:solidFill><a:srgbClr val="${rgb(p.color)}"/></a:solidFill></a:rPr><a:t>${xmlEsc(p.text)}</a:t></a:r></a:p>`,
          )
          .join('')
      : `<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>`) +
    `</p:txBody>`
  );
}

interface SlideCtx {
  /** Page px → slide EMU. */
  k: number;
  ox: number;
  oy: number;
  /** Page-px origin of the framed region. */
  bx: number;
  by: number;
  nextId: () => number;
  rels: Relationship[];
  /** Scene node id → slide shape id, for connector glue. */
  shapeIds: Map<string, number>;
  media: { target: string; bytes: Uint8Array; ext: string }[];
  mediaSeq: { n: number };
}

const X = (c: SlideCtx, px: number): number => emu(c.ox + (px - c.bx) * c.k);
const Y = (c: SlideCtx, px: number): number => emu(c.oy + (px - c.by) * c.k);
const L = (c: SlideCtx, px: number): number => Math.max(1, emu(px * c.k));
const PT = (c: SlideCtx, px: number): number => (px * c.k) / EMU_PER_PT;

function rel(
  c: SlideCtx,
  type: string,
  target: string,
  external = false,
): string {
  const id = `rId${c.rels.length + 2}`; // rId1 is the layout
  c.rels.push({
    id,
    type,
    target,
    ...(external ? { targetMode: 'External' as const } : {}),
  });
  return id;
}

function nvPr(
  c: SlideCtx,
  id: number,
  name: string,
  descr = '',
  href?: string,
  hidden = false,
): string {
  const link = href
    ? `<a:hlinkClick r:id="${rel(c, REL.hyperlink, href, true)}"/>`
    : '';
  return (
    `<p:cNvPr id="${id}" name="${xmlEsc(name)}"` +
    (descr ? ` descr="${xmlEsc(descr)}"` : '') +
    (hidden ? ' hidden="1"' : '') +
    `>${link}</p:cNvPr>`
  );
}

function shapeXml(
  c: SlideCtx,
  name: string,
  box: { x: number; y: number; w: number; h: number },
  prst: string,
  fill: string | null,
  line: string,
  body: string,
  opts: {
    descr?: string;
    href?: string;
    txBox?: boolean;
    adj?: string;
    id?: number;
  } = {},
): { id: number; xml: string } {
  const id = opts.id ?? c.nextId();
  return {
    id,
    xml:
      `<p:sp><p:nvSpPr>${nvPr(c, id, name, opts.descr, opts.href)}<p:cNvSpPr${opts.txBox ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr><a:xfrm><a:off x="${X(c, box.x)}" y="${Y(c, box.y)}"/><a:ext cx="${L(c, box.w)}" cy="${L(c, box.h)}"/></a:xfrm>` +
      `<a:prstGeom prst="${prst}"><a:avLst>${opts.adj ?? ''}</a:avLst></a:prstGeom>${fillXml(fill)}${line}</p:spPr>` +
      body +
      `</p:sp>`,
  };
}

function textBox(
  c: SlideCtx,
  name: string,
  text: string,
  at: ScenePoint,
  sizePx: number,
  color: string,
  w?: number,
): string {
  const width = w ?? Math.max(30, text.length * sizePx * 0.62 + 8);
  const height = sizePx * 1.6;
  return shapeXml(
    c,
    name,
    { x: at.x - width / 2, y: at.y - height / 2, w: width, h: height },
    'rect',
    null,
    lineXml(null, 0),
    txBody([{ text, sizePt: PT(c, sizePx), color }]),
    { txBox: true },
  ).xml;
}

function nodeXml(c: SlideCtx, n: SceneNode): string {
  const descr = [
    n.type,
    ...Object.entries(n.meta ?? {}).map(([k, v]) => `${k}: ${v}`),
  ].join('\n');
  const img = n.shape === 'image' ? decodeDataImage(n.imageHref) : null;
  let out = '';
  if (img) {
    const target = `../media/image${++c.mediaSeq.n}.${img.ext === 'jpeg' ? 'jpg' : img.ext}`;
    c.media.push({ target, bytes: img.bytes, ext: img.ext });
    const rid = rel(c, REL.image, target);
    const id = c.shapeIds.get(n.id) ?? c.nextId();
    out +=
      `<p:pic><p:nvPicPr>${nvPr(c, id, n.label || n.id, descr, n.href)}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr><a:xfrm><a:off x="${X(c, n.x)}" y="${Y(c, n.y)}"/><a:ext cx="${L(c, n.w)}" cy="${L(c, n.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  } else {
    const isText = n.shape === 'text';
    const inside = n.labelInside
      ? [n.label, n.body, n.sublabel].filter(Boolean).map((t, i) => ({
          text: t,
          sizePt: PT(c, isText ? 14 : i === 0 ? 10 : 8),
          color: isText ? n.stroke : '#222222',
          bold: i === 0 && !isText,
        }))
      : [];
    const s = shapeXml(
      c,
      n.label || n.id,
      n,
      PRESET[n.shape],
      isText ? null : n.fill,
      isText ? lineXml(null, 0) : lineXml(n.stroke, 1.5 * c.k),
      txBody(inside, { inset: 2 * c.k }),
      {
        descr,
        ...(n.href ? { href: n.href } : {}),
        ...(isText ? { txBox: true } : {}),
        ...(n.shape === 'roundRect'
          ? { adj: '<a:gd name="adj" fmla="val 18000"/>' }
          : {}),
        ...(c.shapeIds.has(n.id) ? { id: c.shapeIds.get(n.id)! } : {}),
      },
    );
    out += s.xml;
  }
  if (!n.labelInside && (n.label || n.sublabel)) {
    const w = Math.max(n.w, 120);
    const runs: TextRun[] = [];
    if (n.label)
      runs.push({
        text: n.label,
        sizePt: PT(c, 10),
        color: '#222222',
        bold: true,
      });
    if (n.sublabel)
      runs.push({ text: n.sublabel, sizePt: PT(c, 8), color: '#555555' });
    out += shapeXml(
      c,
      `${n.label || n.id} label`,
      {
        x: n.x + n.w / 2 - w / 2,
        y: n.y + n.h + 2,
        w,
        h: 12 + runs.length * 12,
      },
      'rect',
      null,
      lineXml(null, 0),
      txBody(runs, { anchor: 't' }),
      { txBox: true },
    ).xml;
  }
  return out;
}

/** Connection-site index on a preset for the side a point lies on. */
function siteIndex(n: SceneNode, p: ScenePoint): number | null {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const dx = (p.x - cx) / (n.w / 2 || 1);
  const dy = (p.y - cy) / (n.h / 2 || 1);
  if (n.shape === 'rect' || n.shape === 'roundRect' || n.shape === 'diamond') {
    // Sites: 0 top, 1 left, 2 bottom, 3 right.
    if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 1 : 3;
    return dy < 0 ? 0 : 2;
  }
  if (n.shape === 'ellipse') {
    // Sites counter-clockwise from the top in 45° steps.
    const ang = Math.atan2(-dy, dx); // y up
    const fromTop = (Math.PI / 2 - ang + 2 * Math.PI) % (2 * Math.PI); // clockwise
    const step = Math.round(fromTop / (Math.PI / 4)) % 8;
    return (8 - step) % 8;
  }
  return null;
}

function polyline(c: SlideCtx, l: SceneLink, name: string): string {
  const xs = l.points.map((p) => p.x);
  const ys = l.points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(1, Math.max(...xs) - minX);
  const h = Math.max(1, Math.max(...ys) - minY);
  const W = L(c, w);
  const H = L(c, h);
  const pts = l.points.map((p) => ({
    x: emu((p.x - minX) * c.k),
    y: emu((p.y - minY) * c.k),
  }));
  const id = c.nextId();
  return (
    `<p:sp><p:nvSpPr>${nvPr(c, id, name, l.type)}<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>` +
    `<a:xfrm><a:off x="${X(c, minX)}" y="${Y(c, minY)}"/><a:ext cx="${W}" cy="${H}"/></a:xfrm>` +
    `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${W}" h="${H}" fill="none">` +
    `<a:moveTo><a:pt x="${pts[0]!.x}" y="${pts[0]!.y}"/></a:moveTo>` +
    pts
      .slice(1)
      .map((p) => `<a:lnTo><a:pt x="${p.x}" y="${p.y}"/></a:lnTo>`)
      .join('') +
    `</a:path></a:pathLst></a:custGeom><a:noFill/>${lineXml(l.color, l.width * 0.75 * c.k, l.dash)}</p:spPr>` +
    txBody([]) +
    `</p:sp>`
  );
}

function linkXml(
  c: SlideCtx,
  l: SceneLink,
  nodes: Map<string, SceneNode>,
): string {
  const name = l.label || `${l.from} – ${l.to}`;
  let out = '';
  const a = l.points[0]!;
  const b = l.points[l.points.length - 1]!;
  if (l.points.length > 2 || l.routing !== 'straight') {
    out += polyline(c, l, name);
  } else {
    const fromNode = l.fromIsNode ? nodes.get(l.from) : undefined;
    const toNode = l.toIsNode ? nodes.get(l.to) : undefined;
    const st = fromNode ? siteIndex(fromNode, a) : null;
    const en = toNode ? siteIndex(toNode, b) : null;
    const stId = fromNode ? c.shapeIds.get(fromNode.id) : undefined;
    const enId = toNode ? c.shapeIds.get(toNode.id) : undefined;
    const id = c.nextId();
    const flipH = b.x < a.x;
    const flipV = b.y < a.y;
    out +=
      `<p:cxnSp><p:nvCxnSpPr>${nvPr(c, id, name, l.type)}<p:cNvCxnSpPr>` +
      (st !== null && stId !== undefined
        ? `<a:stCxn id="${stId}" idx="${st}"/>`
        : '') +
      (en !== null && enId !== undefined
        ? `<a:endCxn id="${enId}" idx="${en}"/>`
        : '') +
      `</p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr>` +
      `<a:xfrm${flipH ? ' flipH="1"' : ''}${flipV ? ' flipV="1"' : ''}><a:off x="${X(c, Math.min(a.x, b.x))}" y="${Y(c, Math.min(a.y, b.y))}"/>` +
      `<a:ext cx="${emu(Math.abs(b.x - a.x) * c.k)}" cy="${emu(Math.abs(b.y - a.y) * c.k)}"/></a:xfrm>` +
      `<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${lineXml(l.color, l.width * 0.75 * c.k, l.dash)}</p:spPr></p:cxnSp>`;
  }
  // Labels: centre on the middle segment; ports a short way from each end.
  if (l.label) {
    const i = Math.floor((l.points.length - 1) / 2);
    const p = l.points[i]!;
    const q = l.points[i + 1] ?? p;
    out += textBox(
      c,
      `${name} label`,
      l.label,
      { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 - 8 },
      8,
      '#333333',
    );
  }
  const port = (text: string, fromStart: boolean): string => {
    const pts = fromStart ? l.points : [...l.points].reverse();
    const p0 = pts[0]!;
    const p1 = pts[1] ?? p0;
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    const t = Math.min(24, len / 2) / len;
    const at = {
      x: p0.x + (p1.x - p0.x) * t - ((p1.y - p0.y) / len) * 8,
      y: p0.y + (p1.y - p0.y) * t + ((p1.x - p0.x) / len) * 8,
    };
    return textBox(c, `${name} port`, text, at, 6.5, l.color);
  };
  if (l.fromLabel) out += port(l.fromLabel, true);
  if (l.toLabel) out += port(l.toLabel, false);
  return out;
}

/** Wrap shapes in a named group (identity transform over their bounds). */
function group(
  c: SlideCtx,
  name: string,
  inner: string,
  bounds: { x: number; y: number; w: number; h: number },
  hidden: boolean,
): string {
  if (!inner) return '';
  const id = c.nextId();
  const off = `<a:off x="${X(c, bounds.x)}" y="${Y(c, bounds.y)}"/><a:ext cx="${L(c, bounds.w)}" cy="${L(c, bounds.h)}"/>`;
  return (
    `<p:grpSp><p:nvGrpSpPr>${nvPr(c, id, name, '', undefined, hidden)}<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm>${off}<a:chOff x="${X(c, bounds.x)}" y="${Y(c, bounds.y)}"/><a:chExt cx="${L(c, bounds.w)}" cy="${L(c, bounds.h)}"/></a:xfrm></p:grpSpPr>` +
    inner +
    `</p:grpSp>`
  );
}

function titleXml(c: SlideCtx, title: string, caption: string): string {
  const id = c.nextId();
  let out =
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${MARGIN}" y="${emu(MARGIN / 2)}"/><a:ext cx="${SLIDE_W - 2 * MARGIN}" cy="${TITLE_H}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    txBody([{ text: title, sizePt: 22, color: '#1f2933', bold: true }], {
      anchor: 'ctr',
      algn: 'l',
    }) +
    `</p:sp>`;
  if (caption) {
    const cid = c.nextId();
    out +=
      `<p:sp><p:nvSpPr><p:cNvPr id="${cid}" name="Caption"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
      `<p:spPr><a:xfrm><a:off x="${MARGIN}" y="${SLIDE_H - MARGIN}"/><a:ext cx="${SLIDE_W - 2 * MARGIN}" cy="${emu(MARGIN * 0.8)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
      txBody([{ text: caption, sizePt: 12, color: '#52606d' }], {
        anchor: 'ctr',
        algn: 'l',
      }) +
      `</p:sp>`;
  }
  return out;
}

interface SlidePlan {
  pageIndex: number;
  title: string;
  /** Declared layer ids drawn on this slide (undefined = page defaults / all). */
  only?: string[];
}

function plan(
  doc: TopologyDocument,
  scenePages: ScenePage[],
  slides: PptxSlides,
): SlidePlan[] {
  const out: SlidePlan[] = [];
  scenePages.forEach((p, i) => {
    out.push({ pageIndex: i, title: p.name });
    if (slides !== 'layers') return;
    for (const layer of p.layers.slice(1))
      out.push({
        pageIndex: i,
        title: `${p.name} — ${layer.name}`,
        only: [layer.id],
      });
  });
  void doc;
  return out;
}

/** Content bounds of a page (+ padding), so a slide frames the diagram, not
 * the empty sheet around it. Falls back to the whole page when empty. */
function contentBounds(page: ScenePage): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number, w = 0, h = 0): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const z of page.zones) grow(z.x, z.y, z.w, z.h);
  for (const n of page.nodes)
    grow(n.x - 30, n.y, n.w + 60, n.h + (n.labelInside ? 0 : 34));
  for (const l of page.links) for (const p of l.points) grow(p.x, p.y);
  if (!Number.isFinite(minX))
    return { x: 0, y: 0, w: page.width, h: page.height };
  const pad = 24;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

function frameCtx(
  page: { x?: number; y?: number; width: number; height: number },
  mediaSeq: { n: number },
): SlideCtx {
  const areaW = SLIDE_W - 2 * MARGIN;
  const areaH = SLIDE_H - 2 * MARGIN - TITLE_H - MARGIN / 2;
  const k = Math.min(areaW / page.width, areaH / page.height);
  let seq = 1; // id 1 is the spTree group
  return {
    k,
    bx: page.x ?? 0,
    by: page.y ?? 0,
    ox: MARGIN + (areaW - page.width * k) / 2,
    oy: MARGIN / 2 + TITLE_H + MARGIN / 2 + (areaH - page.height * k) / 2,
    nextId: () => ++seq,
    rels: [],
    shapeIds: new Map(),
    media: [],
    mediaSeq,
  };
}

function shapesSlide(
  page: ScenePage,
  only: string[] | undefined,
  c: SlideCtx,
): string {
  const keep = (layer: string): boolean =>
    !only || layer === '' || only.includes(layer);
  const nodes = new Map(
    page.nodes.filter((n) => keep(n.layer)).map((n) => [n.id, n]),
  );
  // Reserve node shape ids up front so a connector can glue to a node in a
  // layer group emitted after it.
  for (const n of nodes.values()) c.shapeIds.set(n.id, c.nextId());
  let tree = '';
  for (const layer of page.layers) {
    if (!keep(layer.id)) continue;
    let inner = '';
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const grow = (x: number, y: number, w = 0, h = 0): void => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    };
    for (const z of page.zones) {
      if (z.layer !== layer.id) continue;
      grow(z.x, z.y, z.w, z.h);
      inner += shapeXml(
        c,
        `Zone: ${z.label || z.id}`,
        z,
        'roundRect',
        z.fill,
        lineXml(z.stroke, 1 * c.k, z.dash),
        txBody(
          [
            { text: z.label, sizePt: PT(c, 9), color: z.stroke, bold: true },
            ...(z.sublabel
              ? [{ text: z.sublabel, sizePt: PT(c, 7), color: z.stroke }]
              : []),
          ],
          {
            anchor: z.labelPosition === 'bottom' ? 'b' : 't',
            algn: 'l',
            inset: 6 * c.k,
          },
        ),
        { adj: '<a:gd name="adj" fmla="val 3000"/>' },
      ).xml;
    }
    for (const n of nodes.values()) {
      if (n.layer !== layer.id) continue;
      grow(n.x, n.y, n.w, n.h + (n.labelInside ? 0 : 30));
      inner += nodeXml(c, n);
    }
    for (const l of page.links) {
      if (l.layer !== layer.id) continue;
      if (
        (l.fromIsNode && !nodes.has(l.from)) ||
        (l.toIsNode && !nodes.has(l.to))
      )
        continue;
      for (const p of l.points) grow(p.x - 20, p.y - 20, 40, 40);
      inner += linkXml(c, l, nodes);
    }
    if (!inner) continue;
    if (page.layers.length === 1) tree += inner;
    else
      tree += group(
        c,
        `Layer: ${layer.name}`,
        inner,
        {
          x: minX,
          y: minY,
          w: Math.max(1, maxX - minX),
          h: Math.max(1, maxY - minY),
        },
        !only && !layer.visible,
      );
  }
  return tree;
}

function imageSlide(
  png: { png: Uint8Array; width: number; height: number },
  c: SlideCtx,
  page: ScenePage,
): string {
  const target = `../media/image${++c.mediaSeq.n}.png`;
  c.media.push({ target, bytes: png.png, ext: 'png' });
  const rid = rel(c, REL.image, target);
  const id = c.nextId();
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${xmlEsc(page.name)}" descr="${xmlEsc(page.name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${X(c, 0)}" y="${Y(c, 0)}"/><a:ext cx="${L(c, page.width)}" cy="${L(c, page.height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

function slideXml(tree: string): string {
  return (
    XML_HEADER +
    `<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    tree +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
}

const EMPTY_TREE =
  `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>`;

function masterXml(): string {
  return (
    XML_HEADER +
    `<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">` +
    `<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE.slice('<p:cSld>'.length)}` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
    `<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:otherStyle></p:txStyles>` +
    `</p:sldMaster>`
  );
}

function layoutXml(): string {
  return (
    XML_HEADER +
    `<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1">` +
    `${EMPTY_TREE.replace('<p:cSld>', '<p:cSld name="Blank">')}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
  );
}

function themeXml(): string {
  const font = (t: string): string =>
    `<a:latin typeface="${t}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  const fill3 = `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`;
  const ln = (w: number): string =>
    `<a:ln w="${w}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`;
  const clr = (n: string, v: string): string =>
    `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
  return (
    XML_HEADER +
    `<a:theme xmlns:a="${NS_A}" name="Topology Dojo"><a:themeElements>` +
    `<a:clrScheme name="Topology Dojo">${clr('dk1', '000000')}${clr('lt1', 'FFFFFF')}${clr('dk2', '1F2933')}${clr('lt2', 'F5F7FA')}` +
    `${clr('accent1', '01A982')}${clr('accent2', '65AEF9')}${clr('accent3', 'DEB146')}${clr('accent4', 'FC6161')}${clr('accent5', '7D8A92')}${clr('accent6', '9673A6')}` +
    `${clr('hlink', '0563C1')}${clr('folHlink', '954F72')}</a:clrScheme>` +
    `<a:fontScheme name="Topology Dojo"><a:majorFont>${font('Calibri')}</a:majorFont><a:minorFont>${font('Calibri')}</a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="Topology Dojo"><a:fillStyleLst>${fill3}</a:fillStyleLst>` +
    `<a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>` +
    `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
    `<a:bgFillStyleLst>${fill3}</a:bgFillStyleLst></a:fmtScheme>` +
    `</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
  );
}

function appXml(count: number): string {
  return (
    XML_HEADER +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    `<Application>Topology Dojo</Application><Slides>${count}</Slides><PresentationFormat>Widescreen</PresentationFormat></Properties>`
  );
}

/** The document as a .pptx package. */
export function documentToPptx(
  doc: TopologyDocument,
  opts: PptxOptions = {},
): Uint8Array<ArrayBuffer> {
  const mode = opts.mode ?? 'shapes';
  if (mode === 'image' && !opts.renderImage)
    throw new Error('image mode needs a renderer');
  const scene = buildScene(doc);
  const slides = plan(doc, scene.pages, opts.slides ?? 'pages');
  const parts: Record<string, string | Uint8Array> = {};
  const overrides: Record<string, string> = {
    '/ppt/presentation.xml': PCT.presentation,
    '/ppt/slideMasters/slideMaster1.xml': PCT.master,
    '/ppt/slideLayouts/slideLayout1.xml': PCT.layout,
    '/ppt/theme/theme1.xml': PCT.theme,
    '/ppt/presProps.xml': PCT.presProps,
    '/ppt/viewProps.xml': PCT.viewProps,
    '/ppt/tableStyles.xml': PCT.tableStyles,
    '/docProps/core.xml': CT.core,
    '/docProps/app.xml': CT.app,
  };
  const defaults: Record<string, string> = { rels: CT.rels, xml: CT.xml };
  const mediaSeq = { n: 0 };
  const presRels: Relationship[] = [
    {
      id: 'rId1',
      type: PREL.slideMaster,
      target: 'slideMasters/slideMaster1.xml',
    },
    { id: 'rId2', type: PREL.theme, target: 'theme/theme1.xml' },
    { id: 'rId3', type: PREL.presProps, target: 'presProps.xml' },
    { id: 'rId4', type: PREL.viewProps, target: 'viewProps.xml' },
    { id: 'rId5', type: PREL.tableStyles, target: 'tableStyles.xml' },
  ];
  const sldIds: string[] = [];

  slides.forEach((s, i) => {
    const page = scene.pages[s.pageIndex]!;
    const frame =
      mode === 'image'
        ? page
        : (() => {
            const b = contentBounds(page);
            return { x: b.x, y: b.y, width: b.w, height: b.h };
          })();
    const c = frameCtx(frame, mediaSeq);
    const tree =
      titleXml(c, s.title, page.caption) +
      (mode === 'image'
        ? imageSlide(
            opts.renderImage!(s.pageIndex, s.only ? s.only : undefined),
            c,
            page,
          )
        : shapesSlide(page, s.only, c));
    const n = i + 1;
    parts[`ppt/slides/slide${n}.xml`] = slideXml(tree);
    parts[`ppt/slides/_rels/slide${n}.xml.rels`] = relsXml([
      {
        id: 'rId1',
        type: PREL.slideLayout,
        target: '../slideLayouts/slideLayout1.xml',
      },
      ...c.rels,
    ]);
    for (const m of c.media) {
      parts[`ppt/media/${m.target.slice('../media/'.length)}`] = m.bytes;
      const ext = m.ext === 'jpeg' ? 'jpg' : m.ext;
      defaults[ext] =
        m.ext === 'jpeg' ? CT.jpeg : m.ext === 'gif' ? CT.gif : CT.png;
    }
    overrides[`/ppt/slides/slide${n}.xml`] = PCT.slide;
    const rid = `rId${presRels.length + 1}`;
    presRels.push({
      id: rid,
      type: PREL.slide,
      target: `slides/slide${n}.xml`,
    });
    sldIds.push(`<p:sldId id="${255 + n}" r:id="${rid}"/>`);
  });

  parts['[Content_Types].xml'] = contentTypesXml(defaults, overrides);
  parts['_rels/.rels'] = relsXml([
    { id: 'rId1', type: REL.officeDocument, target: 'ppt/presentation.xml' },
    { id: 'rId2', type: REL.coreProps, target: 'docProps/core.xml' },
    { id: 'rId3', type: REL.extendedProps, target: 'docProps/app.xml' },
  ]);
  parts['docProps/core.xml'] = corePropsXml(scene.title);
  parts['docProps/app.xml'] = appXml(slides.length);
  parts['ppt/presentation.xml'] =
    XML_HEADER +
    `<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" saveSubsetFonts="1">` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst>${sldIds.join('')}</p:sldIdLst>` +
    `<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/>` +
    `</p:presentation>`;
  parts['ppt/_rels/presentation.xml.rels'] = relsXml(presRels);
  parts['ppt/slideMasters/slideMaster1.xml'] = masterXml();
  parts['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = relsXml([
    {
      id: 'rId1',
      type: PREL.slideLayout,
      target: '../slideLayouts/slideLayout1.xml',
    },
    { id: 'rId2', type: PREL.theme, target: '../theme/theme1.xml' },
  ]);
  parts['ppt/slideLayouts/slideLayout1.xml'] = layoutXml();
  parts['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = relsXml([
    {
      id: 'rId1',
      type: PREL.slideMaster,
      target: '../slideMasters/slideMaster1.xml',
    },
  ]);
  parts['ppt/theme/theme1.xml'] = themeXml();
  parts['ppt/presProps.xml'] =
    XML_HEADER +
    `<p:presentationPr xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"/>`;
  parts['ppt/viewProps.xml'] =
    XML_HEADER +
    `<p:viewPr xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`;
  parts['ppt/tableStyles.xml'] =
    XML_HEADER +
    `<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;
  return zipPackage(parts);
}

/** How many slides an export will produce (for result summaries). */
export function pptxSlideCount(
  doc: TopologyDocument,
  slides: PptxSlides = 'pages',
): number {
  return plan(doc, buildScene(doc).pages, slides).length;
}
