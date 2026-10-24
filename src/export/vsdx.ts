/**
 * Visio (.vsdx) export — the enterprise must-have. Built from the shared
 * export scene (`./scene`), one Visio page per document page.
 *
 * What survives (editable in Visio):
 * - nodes → 2D shapes with real geometry (rect / rounded / ellipse / diamond /
 *   triangle / hexagon / pentagon / star / cross / arrow / cylinder; clouds
 *   approximate as ellipses), outline + fill colour, the label (inside shapes,
 *   below device icons), and node metadata, sublabel, type and hyperlink as
 *   **Shape Data** / hyperlinks;
 * - links → 1D dynamic connectors glued to their shapes (`Connects`, with the
 *   `_WALKGLUE` / `_XFTRIGGER` formulas Visio uses, so they follow the shapes
 *   when moved), colour, weight, dash, waypoints (as the drawn path), the
 *   label as connector text, port labels as small text shapes near each end
 *   and as connector Shape Data;
 * - zones → background rectangles in the zone colour and dash, label at the
 *   top-left (bottom for tier bands);
 * - layers → Visio page layers (base + declared, with visibility), every
 *   shape's `LayerMember` set.
 *
 * What drops (docs/EXPORTS.md): the device glyph art (a generic outline
 * stands in), glow / animation, flow paths, policy markers, port pills and
 * port tables, the sheet frame, the legend, and https images (only embedded
 * PNG / JPEG / GIF images carry over). Zones are not Visio containers (no
 * membership), and Visio may re-route a connector the first time a glued
 * shape moves.
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
} from './opc.js';

const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const NS_R =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const VREL = {
  document: 'http://schemas.microsoft.com/visio/2010/relationships/document',
  pages: 'http://schemas.microsoft.com/visio/2010/relationships/pages',
  page: 'http://schemas.microsoft.com/visio/2010/relationships/page',
  windows: 'http://schemas.microsoft.com/visio/2010/relationships/windows',
};
const VCT = {
  document: 'application/vnd.ms-visio.drawing.main+xml',
  pages: 'application/vnd.ms-visio.pages+xml',
  page: 'application/vnd.ms-visio.page+xml',
  windows: 'application/vnd.ms-visio.windows+xml',
};

/** Page px → inches. */
const PX = 1 / 96;
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

function cell(n: string, v: string | number, extra = ''): string {
  return `<Cell N="${n}" V="${typeof v === 'number' ? r4(v) : xmlEsc(v)}"${extra}/>`;
}
function fcell(n: string, v: number, f: string): string {
  return `<Cell N="${n}" V="${r4(v)}" F="${xmlEsc(f)}"/>`;
}

function linePattern(d: SceneDash): number {
  return d === 'dashed' ? 2 : d === 'dotted' ? 3 : 1;
}

/** A Shape Data row name: letters, digits, underscore; unique per shape. */
function propName(key: string, used: Set<string>): string {
  let base =
    key.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'Prop';
  base = base.slice(0, 31);
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base}_${i}`;
  used.add(name.toLowerCase());
  return name;
}

function propsSection(props: [string, string][]): string {
  if (!props.length) return '';
  const used = new Set<string>();
  return (
    '<Section N="Property">' +
    props
      .map(
        ([label, value]) =>
          `<Row N="${propName(label, used)}">${cell('Label', label)}${cell('Value', value, ' U="STR"')}${cell('Type', 0)}</Row>`,
      )
      .join('') +
    '</Section>'
  );
}

function hyperlinkSection(href: string | undefined): string {
  if (!href) return '';
  return `<Section N="Hyperlink"><Row N="Row_1">${cell('Address', href)}${cell('Default', 1)}</Row></Section>`;
}

function charSection(color: string, sizePt: number, bold = false): string {
  return (
    `<Section N="Character"><Row IX="0">${cell('Color', color)}` +
    `${cell('Size', sizePt / 72, ' U="PT"')}${cell('Style', bold ? 1 : 0)}</Row></Section>`
  );
}

function paraSection(horzAlign: 0 | 1 | 2): string {
  return `<Section N="Paragraph"><Row IX="0">${cell('HorzAlign', horzAlign)}</Row></Section>`;
}

/** Polygon (fractions of the box, y up) for outline shapes. */
const POLYGONS: Partial<Record<SceneNode['shape'], [number, number][]>> = {
  diamond: [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
  triangle: [
    [0, 0],
    [1, 0],
    [0.5, 1],
  ],
  hexagon: [
    [0.25, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.25, 1],
    [0, 0.5],
  ],
  pentagon: [
    [0.19, 0],
    [0.81, 0],
    [1, 0.62],
    [0.5, 1],
    [0, 0.62],
  ],
  star: [
    [0.5, 1],
    [0.62, 0.65],
    [1, 0.65],
    [0.69, 0.42],
    [0.81, 0.05],
    [0.5, 0.27],
    [0.19, 0.05],
    [0.31, 0.42],
    [0, 0.65],
    [0.38, 0.65],
  ],
  cross: [
    [0.35, 0],
    [0.65, 0],
    [0.65, 0.35],
    [1, 0.35],
    [1, 0.65],
    [0.65, 0.65],
    [0.65, 1],
    [0.35, 1],
    [0.35, 0.65],
    [0, 0.65],
    [0, 0.35],
    [0.35, 0.35],
  ],
  arrow: [
    [0, 0.3],
    [0.6, 0.3],
    [0.6, 0],
    [1, 0.5],
    [0.6, 1],
    [0.6, 0.7],
    [0, 0.7],
  ],
};

function polygonGeometry(
  ix: number,
  pts: [number, number][],
  w: number,
  h: number,
  noFill = false,
  noLine = false,
): string {
  const row = (t: string, i: number, fx: number, fy: number): string =>
    `<Row T="${t}" IX="${i}">${fcell('X', fx * w, `Width*${fx}`)}${fcell('Y', fy * h, `Height*${fy}`)}</Row>`;
  const [fx0, fy0] = pts[0]!;
  return (
    `<Section N="Geometry" IX="${ix}">${cell('NoFill', noFill ? 1 : 0)}${cell('NoLine', noLine ? 1 : 0)}${cell('NoShow', 0)}${cell('NoSnap', 0)}` +
    row('MoveTo', 1, fx0, fy0) +
    pts
      .slice(1)
      .map(([fx, fy], i) => row('LineTo', i + 2, fx, fy))
      .join('') +
    row('LineTo', pts.length + 1, fx0, fy0) +
    '</Section>'
  );
}

const RECT: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

function ellipseGeometry(
  ix: number,
  w: number,
  h: number,
  cy = 0.5,
  ry = 0.5,
): string {
  return (
    `<Section N="Geometry" IX="${ix}">${cell('NoFill', 0)}${cell('NoLine', 0)}${cell('NoShow', 0)}${cell('NoSnap', 0)}` +
    `<Row T="Ellipse" IX="1">${fcell('X', w / 2, 'Width*0.5')}${fcell('Y', h * cy, `Height*${cy}`)}` +
    `${fcell('A', w, 'Width*1')}${fcell('B', h * cy, `Height*${cy}`)}` +
    `${fcell('C', w / 2, 'Width*0.5')}${fcell('D', h * (cy + ry), `Height*${cy + ry}`)}</Row></Section>`
  );
}

function nodeGeometry(n: SceneNode, w: number, h: number): string {
  switch (n.shape) {
    case 'ellipse':
    case 'cloud':
      return ellipseGeometry(0, w, h);
    case 'cylinder':
      return (
        polygonGeometry(0, RECT, w, h) + ellipseGeometry(1, w, h, 0.88, 0.12)
      );
    case 'text':
      return polygonGeometry(0, RECT, w, h, true, true);
    case 'rect':
    case 'roundRect':
    case 'image':
      return polygonGeometry(0, RECT, w, h);
    default:
      return polygonGeometry(0, POLYGONS[n.shape] ?? RECT, w, h);
  }
}

/** Connection points at the box's four side midpoints. */
function connectionSection(w: number, h: number): string {
  const pts: [number, number][] = [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ];
  return (
    '<Section N="Connection">' +
    pts
      .map(
        ([fx, fy], i) =>
          `<Row IX="${i}">${fcell('X', fx * w, `Width*${fx}`)}${fcell('Y', fy * h, `Height*${fy}`)}</Row>`,
      )
      .join('') +
    '</Section>'
  );
}

interface PageCtx {
  heightIn: number;
  layerIndex: Map<string, number>;
  nextId: () => number;
  idOf: Map<string, number>;
  media: { rid: string; target: string; ext: string; bytes: Uint8Array }[];
  mediaSeq: { n: number };
}

function layerMember(ctx: PageCtx, layer: string): string {
  return cell('LayerMember', String(ctx.layerIndex.get(layer) ?? 0));
}

/** Common transform cells for a 2D shape at a page-px box. */
function xform(
  ctx: PageCtx,
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  const W = w * PX;
  const H = h * PX;
  return (
    cell('PinX', (x + w / 2) * PX) +
    cell('PinY', ctx.heightIn - (y + h / 2) * PX) +
    cell('Width', W) +
    cell('Height', H) +
    fcell('LocPinX', W / 2, 'Width*0.5') +
    fcell('LocPinY', H / 2, 'Height*0.5') +
    cell('Angle', 0)
  );
}

function zoneShape(ctx: PageCtx, z: SceneZone): string {
  const id = ctx.nextId();
  const W = z.w * PX;
  const H = z.h * PX;
  const label = [z.label, z.sublabel].filter(Boolean).join('\n');
  return (
    `<Shape ID="${id}" NameU="Zone.${id}" Name="${xmlEsc(z.label || z.id)}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    xform(ctx, z.x, z.y, z.w, z.h) +
    cell('LineColor', z.stroke) +
    cell('LineWeight', 1 * PX, ' U="PT"') +
    cell('LinePattern', linePattern(z.dash)) +
    cell('FillForegnd', z.fill) +
    cell('FillPattern', 1) +
    cell('Rounding', 6 * PX) +
    cell('VerticalAlign', z.labelPosition === 'bottom' ? 2 : 0) +
    cell('TopMargin', 4 * PX) +
    cell('LeftMargin', 8 * PX) +
    cell('BottomMargin', 4 * PX) +
    layerMember(ctx, z.layer) +
    charSection(z.stroke, 8, true) +
    paraSection(0) +
    propsSection([
      ['DojoKind', 'zone'],
      ['DojoId', z.id],
    ]) +
    polygonGeometry(0, RECT, W, H) +
    `<Text>${xmlEsc(label)}</Text>` +
    '</Shape>'
  );
}

function nodeShape(ctx: PageCtx, n: SceneNode): string {
  const id = ctx.nextId();
  ctx.idOf.set(n.id, id);
  const W = n.w * PX;
  const H = n.h * PX;
  const props: [string, string][] = [
    ['DojoType', n.type],
    ['DojoId', n.id],
  ];
  if (n.sublabel) props.push(['Sublabel', n.sublabel]);
  for (const [k, v] of Object.entries(n.meta ?? {})) props.push([k, String(v)]);
  if (n.tooltip) props.push(['Tooltip', n.tooltip]);

  // Device icons keep their label under the outline; shapes / text inside.
  const text = n.labelInside
    ? [n.label, n.body, n.sublabel].filter(Boolean).join('\n')
    : [n.label, n.sublabel].filter(Boolean).join('\n');
  const textBelow =
    !n.labelInside && text
      ? fcell('TxtWidth', Math.max(W, 1.4), 'MAX(Width,1.4 in)') +
        fcell('TxtHeight', 0.32, '0.32 in') +
        fcell('TxtPinX', W / 2, 'Width*0.5') +
        fcell('TxtPinY', -0.18, '-0.18 in') +
        fcell('TxtLocPinX', Math.max(W, 1.4) / 2, 'TxtWidth*0.5') +
        fcell('TxtLocPinY', 0.16, 'TxtHeight*0.5') +
        cell('TxtAngle', 0)
      : '';

  const img = n.shape === 'image' ? decodeDataImage(n.imageHref) : null;
  if (img) {
    const rid = `rId${++ctx.mediaSeq.n}`;
    const target = `../media/image${ctx.mediaSeq.n}.${img.ext === 'jpeg' ? 'jpg' : img.ext}`;
    ctx.media.push({ rid, target, ext: img.ext, bytes: img.bytes });
    return (
      `<Shape ID="${id}" NameU="Image.${id}" Name="${xmlEsc(n.label || n.id)}" Type="Foreign" LineStyle="0" FillStyle="0" TextStyle="0">` +
      xform(ctx, n.x, n.y, n.w, n.h) +
      fcell('ImgOffsetX', 0, 'ImgWidth*0') +
      fcell('ImgOffsetY', 0, 'ImgHeight*0') +
      fcell('ImgWidth', W, 'Width*1') +
      fcell('ImgHeight', H, 'Height*1') +
      textBelow +
      layerMember(ctx, n.layer) +
      charSection('#222222', 8) +
      propsSection(props) +
      hyperlinkSection(n.href) +
      // Schema order: cells, sections, Text, then ForeignData.
      (text ? `<Text>${xmlEsc(text)}</Text>` : '') +
      `<ForeignData ForeignType="Bitmap" CompressionType="${img.ext === 'jpeg' ? 'JPEG' : img.ext.toUpperCase()}"><Rel r:id="${rid}"/></ForeignData>` +
      '</Shape>'
    );
  }

  const isText = n.shape === 'text';
  return (
    `<Shape ID="${id}" NameU="${xmlEsc(n.type)}.${id}" Name="${xmlEsc(n.label || n.id)}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    xform(ctx, n.x, n.y, n.w, n.h) +
    cell('LineColor', n.stroke) +
    cell('LineWeight', 1.5 * PX, ' U="PT"') +
    cell('LinePattern', isText ? 0 : 1) +
    cell('FillForegnd', n.fill) +
    cell('FillPattern', isText ? 0 : 1) +
    (n.shape === 'roundRect' ? cell('Rounding', Math.min(W, H) * 0.15) : '') +
    textBelow +
    cell('VerticalAlign', !n.labelInside ? 0 : 1) +
    layerMember(ctx, n.layer) +
    charSection(
      isText ? n.stroke : '#222222',
      isText ? 10 : 8,
      !n.labelInside,
    ) +
    paraSection(1) +
    propsSection(props) +
    hyperlinkSection(n.href) +
    connectionSection(W, H) +
    nodeGeometry(n, W, H) +
    (text ? `<Text>${xmlEsc(text)}</Text>` : '') +
    '</Shape>'
  );
}

/** A free text shape (port labels) centred at a page-px point. */
function noteShape(
  ctx: PageCtx,
  text: string,
  at: { x: number; y: number },
  color: string,
  layer: string,
  name: string,
): string {
  const id = ctx.nextId();
  const w = Math.max(40, text.length * 6 + 8);
  const h = 14;
  return (
    `<Shape ID="${id}" NameU="${xmlEsc(name)}.${id}" Name="${xmlEsc(name)}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    xform(ctx, at.x - w / 2, at.y - h / 2, w, h) +
    cell('LinePattern', 0) +
    cell('FillPattern', 0) +
    layerMember(ctx, layer) +
    charSection(color, 6.5) +
    paraSection(1) +
    polygonGeometry(0, RECT, w * PX, h * PX, true, true) +
    `<Text>${xmlEsc(text)}</Text>` +
    '</Shape>'
  );
}

/** A point a short way along the polyline from one end (port-label spot). */
function alongFromEnd(
  points: { x: number; y: number }[],
  fromStart: boolean,
  dist = 26,
): { x: number; y: number } {
  const pts = fromStart ? points : [...points].reverse();
  const a = pts[0]!;
  const b = pts[1] ?? a;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = Math.min(dist, len / 2) / len;
  // Offset perpendicular so the text sits beside the wire, not on it.
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  return {
    x: a.x + (b.x - a.x) * t + nx * 9,
    y: a.y + (b.y - a.y) * t + ny * 9,
  };
}

function connectorShape(
  ctx: PageCtx,
  l: SceneLink,
  connects: string[],
): string {
  const id = ctx.nextId();
  const toIn = (p: { x: number; y: number }) => ({
    x: p.x * PX,
    y: ctx.heightIn - p.y * PX,
  });
  const pts = l.points.map(toIn);
  const b = pts[0]!;
  const e = pts[pts.length - 1]!;
  const W = e.x - b.x;
  const H = e.y - b.y;
  const fromId = l.fromIsNode ? ctx.idOf.get(l.from) : undefined;
  const toId = l.toIsNode ? ctx.idOf.get(l.to) : undefined;
  const glue = (n: string, v: number, sheet: number | undefined): string =>
    sheet !== undefined
      ? fcell(n, v, '_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)')
      : cell(n, v);
  const props: [string, string][] = [
    ['DojoType', l.type],
    ['DojoId', l.id],
  ];
  if (l.fromLabel) props.push(['FromPort', l.fromLabel]);
  if (l.toLabel) props.push(['ToPort', l.toLabel]);
  if (l.style) props.push(['WireClass', l.style]);

  // Local frame: origin at Begin, unrotated (Width/Height may be negative).
  const local = pts.map((p) => ({ x: p.x - b.x, y: p.y - b.y }));
  const geom =
    `<Section N="Geometry" IX="0">${cell('NoFill', 1)}${cell('NoLine', 0)}${cell('NoShow', 0)}${cell('NoSnap', 0)}` +
    local
      .map(
        (p, i) =>
          `<Row T="${i === 0 ? 'MoveTo' : 'LineTo'}" IX="${i + 1}">${cell('X', p.x)}${cell('Y', p.y)}</Row>`,
      )
      .join('') +
    '</Section>';

  if (fromId !== undefined)
    connects.push(
      `<Connect FromSheet="${id}" FromCell="BeginX" FromPart="9" ToSheet="${fromId}" ToCell="PinX" ToPart="3"/>`,
    );
  if (toId !== undefined)
    connects.push(
      `<Connect FromSheet="${id}" FromCell="EndX" FromPart="12" ToSheet="${toId}" ToCell="PinX" ToPart="3"/>`,
    );

  return (
    `<Shape ID="${id}" NameU="Dynamic connector.${id}" Name="${xmlEsc(l.label || 'Connector')}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    cell('PinX', (b.x + e.x) / 2) +
    cell('PinY', (b.y + e.y) / 2) +
    cell('Width', W) +
    cell('Height', H) +
    fcell('LocPinX', W / 2, 'Width*0.5') +
    fcell('LocPinY', H / 2, 'Height*0.5') +
    cell('Angle', 0) +
    glue('BeginX', b.x, fromId) +
    glue('BeginY', b.y, fromId) +
    glue('EndX', e.x, toId) +
    glue('EndY', e.y, toId) +
    (fromId !== undefined
      ? fcell('BegTrigger', 2, `_XFTRIGGER(Sheet.${fromId}!EventXFMod)`)
      : '') +
    (toId !== undefined
      ? fcell('EndTrigger', 2, `_XFTRIGGER(Sheet.${toId}!EventXFMod)`)
      : '') +
    cell('ObjType', 2) +
    cell('ShapeRouteStyle', l.routing === 'orthogonal' ? 1 : 16) +
    cell('ConLineRouteExt', l.routing === 'curved' ? 2 : 1) +
    cell('LineColor', l.color) +
    cell('LineWeight', l.width * PX * 0.75, ' U="PT"') +
    cell('LinePattern', linePattern(l.dash)) +
    cell('BeginArrow', 0) +
    cell('EndArrow', 0) +
    cell('FillPattern', 0) +
    layerMember(ctx, l.layer) +
    charSection('#222222', 7) +
    propsSection(props) +
    geom +
    (l.label ? `<Text>${xmlEsc(l.label)}</Text>` : '') +
    '</Shape>'
  );
}

function pageContents(page: ScenePage, ctx: PageCtx): string {
  const shapes: string[] = [];
  const connects: string[] = [];
  for (const z of page.zones) shapes.push(zoneShape(ctx, z));
  for (const n of page.nodes) shapes.push(nodeShape(ctx, n));
  for (const l of page.links) {
    shapes.push(connectorShape(ctx, l, connects));
    if (l.fromLabel)
      shapes.push(
        noteShape(
          ctx,
          l.fromLabel,
          alongFromEnd(l.points, true),
          l.color,
          l.layer,
          'Port',
        ),
      );
    if (l.toLabel)
      shapes.push(
        noteShape(
          ctx,
          l.toLabel,
          alongFromEnd(l.points, false),
          l.color,
          l.layer,
          'Port',
        ),
      );
  }
  return (
    XML_HEADER +
    `<PageContents xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">` +
    `<Shapes>${shapes.join('')}</Shapes>` +
    (connects.length ? `<Connects>${connects.join('')}</Connects>` : '') +
    '</PageContents>'
  );
}

function layerSection(page: ScenePage): string {
  return (
    '<Section N="Layer">' +
    page.layers
      .map(
        (l, i) =>
          `<Row IX="${i}">${cell('Name', l.name)}${cell('NameUniv', l.name)}${cell('Color', 255)}` +
          `${cell('Status', 0)}${cell('Visible', l.visible ? 1 : 0)}${cell('Print', 1)}${cell('Active', 0)}` +
          `${cell('Lock', 0)}${cell('Snap', 1)}${cell('Glue', 1)}${cell('ColorTrans', 0)}</Row>`,
      )
      .join('') +
    '</Section>'
  );
}

function documentXml(): string {
  // One "No Style" stylesheet carrying every default the shapes inherit.
  const style =
    `<StyleSheet ID="0" NameU="No Style" Name="No Style">` +
    cell('EnableLineProps', 1) +
    cell('EnableFillProps', 1) +
    cell('EnableTextProps', 1) +
    cell('HideForApply', 0) +
    cell('LineWeight', 0.01041666666666667) +
    cell('LineColor', '#000000') +
    cell('LinePattern', 1) +
    cell('Rounding', 0) +
    cell('LineCap', 0) +
    cell('BeginArrow', 0) +
    cell('EndArrow', 0) +
    cell('LineColorTrans', 0) +
    cell('FillForegnd', '#ffffff') +
    cell('FillBkgnd', '#ffffff') +
    cell('FillPattern', 1) +
    cell('FillForegndTrans', 0) +
    cell('FillBkgndTrans', 0) +
    cell('ShdwPattern', 0) +
    cell('LeftMargin', 0.05555555555555555) +
    cell('RightMargin', 0.05555555555555555) +
    cell('TopMargin', 0.05555555555555555) +
    cell('BottomMargin', 0.05555555555555555) +
    cell('VerticalAlign', 1) +
    cell('TextBkgnd', 0) +
    cell('TextDirection', 0) +
    charSection('#000000', 9) +
    paraSection(1) +
    `</StyleSheet>`;
  return (
    XML_HEADER +
    `<VisioDocument xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">` +
    `<DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0">` +
    `<GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings><SnapExtensions>34</SnapExtensions>` +
    `<DynamicGridEnabled>0</DynamicGridEnabled><ProtectStyles>0</ProtectStyles><ProtectShapes>0</ProtectShapes>` +
    `<ProtectMasters>0</ProtectMasters><ProtectBkgnds>0</ProtectBkgnds></DocumentSettings>` +
    `<Colors><ColorEntry IX="0" RGB="#000000"/><ColorEntry IX="1" RGB="#FFFFFF"/></Colors>` +
    `<FaceNames><FaceName NameU="Calibri" UnicodeRanges="-536859905 -1073732485 9 0" CharSets="536871423 0" Panose="2 15 5 2 2 2 4 3 2 4" Flags="325"/></FaceNames>` +
    `<StyleSheets>${style}</StyleSheets>` +
    `</VisioDocument>`
  );
}

function appXml(pages: ScenePage[]): string {
  return (
    XML_HEADER +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>Topology Dojo</Application><DocSecurity>0</DocSecurity>' +
    `<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Pages</vt:lpstr></vt:variant><vt:variant><vt:i4>${pages.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>` +
    `<TitlesOfParts><vt:vector size="${pages.length}" baseType="lpstr">${pages.map((p) => `<vt:lpstr>${xmlEsc(p.name)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts>` +
    '</Properties>'
  );
}

/** Unique, Visio-safe page names (Visio rejects duplicates). */
function pageNames(pages: ScenePage[]): string[] {
  const used = new Set<string>();
  return pages.map((p, i) => {
    const base = (p.name || `Page-${i + 1}`).slice(0, 60);
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base} (${k})`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** The whole document as a .vsdx package. */
export function documentToVsdx(doc: TopologyDocument): Uint8Array<ArrayBuffer> {
  const scene = buildScene(doc);
  const names = pageNames(scene.pages);
  const parts: Record<string, string | Uint8Array> = {};
  const overrides: Record<string, string> = {
    '/visio/document.xml': VCT.document,
    '/visio/pages/pages.xml': VCT.pages,
    '/visio/windows.xml': VCT.windows,
    '/docProps/core.xml': CT.core,
    '/docProps/app.xml': CT.app,
  };
  const defaults: Record<string, string> = { rels: CT.rels, xml: CT.xml };
  const pageEntries: string[] = [];
  const pageRels: { id: string; type: string; target: string }[] = [];
  const mediaSeq = { n: 0 };

  scene.pages.forEach((page, i) => {
    const wIn = page.width * PX;
    const hIn = page.height * PX;
    let seq = 0;
    const ctx: PageCtx = {
      heightIn: hIn,
      layerIndex: new Map(page.layers.map((l, ix) => [l.id, ix])),
      nextId: () => ++seq,
      idOf: new Map(),
      media: [],
      mediaSeq,
    };
    const file = `page${i + 1}.xml`;
    parts[`visio/pages/${file}`] = pageContents(page, ctx);
    overrides[`/visio/pages/${file}`] = VCT.page;
    if (ctx.media.length) {
      parts[`visio/pages/_rels/${file}.rels`] = relsXml(
        ctx.media.map((m) => ({
          id: m.rid,
          type: REL.image,
          target: m.target,
        })),
      );
      for (const m of ctx.media) {
        parts[`visio/media/${m.target.slice('../media/'.length)}`] = m.bytes;
        defaults[m.ext === 'jpeg' ? 'jpg' : m.ext] =
          m.ext === 'jpeg' ? CT.jpeg : m.ext === 'gif' ? CT.gif : CT.png;
      }
    }
    pageRels.push({ id: `rId${i + 1}`, type: VREL.page, target: file });
    pageEntries.push(
      `<Page ID="${i}" NameU="${xmlEsc(names[i])}" Name="${xmlEsc(names[i])}">` +
        `<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">` +
        cell('PageWidth', wIn) +
        cell('PageHeight', hIn) +
        cell('ShdwOffsetX', 0.125) +
        cell('ShdwOffsetY', -0.125) +
        cell('PageScale', 1, ' U="IN_F"') +
        cell('DrawingScale', 1, ' U="IN_F"') +
        cell('DrawingSizeType', 0) +
        cell('DrawingScaleType', 0) +
        cell('InhibitSnap', 0) +
        cell('PageLockReplace', 0, ' U="BOOL"') +
        cell('PageLockDuplicate', 0, ' U="BOOL"') +
        cell('UIVisibility', 0) +
        cell('ShdwType', 0) +
        cell('ShdwObliqueAngle', 0) +
        cell('ShdwScaleFactor', 1) +
        cell('DrawingResizeType', 1) +
        cell('PageShapeSplit', 1) +
        layerSection(page) +
        `</PageSheet><Rel r:id="rId${i + 1}"/></Page>`,
    );
  });

  parts['[Content_Types].xml'] = contentTypesXml(defaults, overrides);
  parts['_rels/.rels'] = relsXml([
    { id: 'rId1', type: VREL.document, target: 'visio/document.xml' },
    { id: 'rId2', type: REL.coreProps, target: 'docProps/core.xml' },
    { id: 'rId3', type: REL.extendedProps, target: 'docProps/app.xml' },
  ]);
  parts['docProps/core.xml'] = corePropsXml(scene.title);
  parts['docProps/app.xml'] = appXml(scene.pages);
  parts['visio/document.xml'] = documentXml();
  parts['visio/_rels/document.xml.rels'] = relsXml([
    { id: 'rId1', type: VREL.pages, target: 'pages/pages.xml' },
    { id: 'rId2', type: VREL.windows, target: 'windows.xml' },
  ]);
  parts['visio/pages/pages.xml'] =
    XML_HEADER +
    `<Pages xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">${pageEntries.join('')}</Pages>`;
  parts['visio/pages/_rels/pages.xml.rels'] = relsXml(pageRels);
  const first = scene.pages[0]!;
  parts['visio/windows.xml'] =
    XML_HEADER +
    `<Windows ClientWidth="1600" ClientHeight="900" xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">` +
    `<Window ID="0" WindowType="Drawing" WindowState="1073741824" WindowLeft="-8" WindowTop="-31" WindowWidth="1616" WindowHeight="939" ContainerType="Page" Page="0" ViewScale="-1" ViewCenterX="${r4((first.width * PX) / 2)}" ViewCenterY="${r4((first.height * PX) / 2)}">` +
    `<ShowRulers>1</ShowRulers><ShowGrid>1</ShowGrid><ShowPageBreaks>0</ShowPageBreaks><ShowGuides>1</ShowGuides><ShowConnectionPoints>1</ShowConnectionPoints>` +
    `<GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings><SnapExtensions>34</SnapExtensions><DynamicGridEnabled>0</DynamicGridEnabled>` +
    `<TabSplitterPos>0.5</TabSplitterPos></Window></Windows>`;
  return zipPackage(parts);
}
