/**
 * Visio masters for catalog hardware (hw-catalog Phase 5). One master per
 * model (and face, and stack size), built from the platform's sanitized
 * panel glyph:
 *
 * - **Geometry**: every glyph `rect` / `circle` / `ellipse` becomes a
 *   Geometry section, expressed as fractions of the shape's Width / Height
 *   so an instance drawn at a sheet scale (1:k) scales exactly. The panel
 *   body (the rect covering most of the panel) is filled; ports and other
 *   features draw as outlines. Lossy, by design: one fill colour per shape
 *   (Visio Geometry sections share the shape's fill), and glyph text
 *   (silkscreen) is not carried — interface names travel as connection
 *   point prompts and Shape Data instead. A platform without a glyph for the
 *   face is drawn from catalog port geometry.
 * - **Connection points**: one Connection row per interface on the face
 *   (every stack member for `{member}` models), at the port centre, named
 *   from the OS-native name (`ge-0/0/1` → `ge_0_0_1`; Visio row names allow
 *   letters, digits and `_`) with the exact name as the row's Prompt.
 * - **Shape Data**: Vendor, Model, ModelId, SKU, CatalogVersion, Hostname,
 *   Confidence, GAEligible, Face.
 *
 * Masters are real size (panel millimetres → inches, 1:1). Pure; the XML is
 * assembled as strings like the rest of the Visio writer.
 */
import type { XmlElement } from '../import/xml.js';
import {
  gaEligible,
  type Catalog,
  type Model,
  type Platform,
} from '../catalog/catalog.js';
import { sanitizeSvg } from '../catalog/sanitize-svg.js';
import { XML_HEADER, xmlEsc } from './opc.js';

export const VISIO_NS = 'http://schemas.microsoft.com/office/visio/2012/main';
export const VISIO_NS_R =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const VISIO_MASTER_REL = {
  masters: 'http://schemas.microsoft.com/visio/2010/relationships/masters',
  master: 'http://schemas.microsoft.com/visio/2010/relationships/master',
};
export const VISIO_MASTER_CT = {
  masters: 'application/vnd.ms-visio.masters+xml',
  master: 'application/vnd.ms-visio.master+xml',
};

/** Gap between stacked members, mm (real size). */
const MEMBER_GAP_MM = 4;
const MM = 1 / 25.4;
const PANEL_FILL = '#23272e';
const PANEL_LINE = '#9aa4af';

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;
function cell(n: string, v: string | number, extra = ''): string {
  return `<Cell N="${n}" V="${typeof v === 'number' ? r6(v) : xmlEsc(v)}"${extra}/>`;
}
function fcell(n: string, v: number, f: string): string {
  return `<Cell N="${n}" V="${r6(v)}" F="${xmlEsc(f)}"/>`;
}

export interface MasterConnection {
  /** Visio row name (letters, digits, `_`). */
  name: string;
  /** The OS-native interface name. */
  prompt: string;
  /** Fractions of Width / Height, Visio's y-up frame. */
  fx: number;
  fy: number;
}

export interface VisioMaster {
  /** `model|face|members` — one master per combination. */
  key: string;
  modelId: string;
  /** Master ID in masters.xml (assigned by the caller). */
  id: number;
  nameU: string;
  /** Real size, inches. */
  widthIn: number;
  heightIn: number;
  connections: MasterConnection[];
  /** Connection row index by OS-native interface name. */
  connectionIndex: Map<string, number>;
  /** The master's single shape (`<Shape ID="5" …>`). */
  shapeXml: string;
  /**
   * An instance's local cells and sections at a page size (inches): text
   * box, connection points and geometry with inherited formulas.
   */
  instanceXml: (widthIn: number, heightIn: number) => string;
  /** Deterministic GUIDs (UniqueID / BaseID). */
  uniqueId: string;
  baseId: string;
}

/** A deterministic GUID-shaped id from a string (FNV-1a based). */
function guid(seed: string): string {
  let h = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h = h.map((x, k) => Math.imul(x ^ (c + k * 31), 0x01000193) >>> 0);
  }
  const hex = h.map((x) => x.toString(16).padStart(8, '0')).join('');
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`.toUpperCase();
}

/** Visio row name for an interface: letters, digits and `_`, letter first. */
export function connectionRowName(ifName: string, used: Set<string>): string {
  let base = ifName.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[A-Za-z]/.test(base)) base = `P_${base}`;
  base = base.slice(0, 40) || 'P';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base}_${i}`;
  used.add(name.toLowerCase());
  return name;
}

interface Prim {
  kind: 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
}

/** rect / circle / ellipse primitives of a sanitized glyph (no transforms). */
function glyphPrims(svg: string): Prim[] {
  const root = sanitizeSvg(svg).root;
  const out: Prim[] = [];
  const n = (el: XmlElement, k: string): number => Number(el.attrs[k] ?? 0);
  const walk = (el: XmlElement, transformed: boolean): void => {
    if (el.name === 'defs' || el.name === 'clipPath' || el.name === 'symbol')
      return;
    const t = transformed || !!el.attrs.transform;
    if (!t) {
      if (el.name === 'rect' && n(el, 'width') > 0 && n(el, 'height') > 0)
        out.push({
          kind: 'rect',
          x: n(el, 'x'),
          y: n(el, 'y'),
          w: n(el, 'width'),
          h: n(el, 'height'),
        });
      else if (el.name === 'circle' && n(el, 'r') > 0)
        out.push({
          kind: 'ellipse',
          x: n(el, 'cx') - n(el, 'r'),
          y: n(el, 'cy') - n(el, 'r'),
          w: 2 * n(el, 'r'),
          h: 2 * n(el, 'r'),
        });
      else if (el.name === 'ellipse' && n(el, 'rx') > 0 && n(el, 'ry') > 0)
        out.push({
          kind: 'ellipse',
          x: n(el, 'cx') - n(el, 'rx'),
          y: n(el, 'cy') - n(el, 'ry'),
          w: 2 * n(el, 'rx'),
          h: 2 * n(el, 'ry'),
        });
    }
    for (const c of el.children) walk(c, t);
  };
  walk(root, false);
  return out;
}

/** Primitives from catalog geometry when there is no glyph for the face. */
function geometryPrims(platform: Platform, face: 'front' | 'rear'): Prim[] {
  const { width, height } = platform.panel;
  return [
    { kind: 'rect', x: 0, y: 0, w: width, h: height },
    ...platform.ports
      .filter((p) => (p.face ?? 'front') === face)
      .map((p) => ({
        kind: 'rect' as const,
        x: p.x - (p.w ?? 6) / 2,
        y: p.y - (p.h ?? 6) / 2,
        w: p.w ?? 6,
        h: p.h ?? 6,
      })),
  ];
}

/**
 * A cell whose formula is a fraction of Width / Height, with its value
 * evaluated at size W×H. On an instance the formula is inherited from the
 * master (`F="Inh"`, how Visio itself stores instances) and only the value
 * is local — readers that do not evaluate formulas (libvisio) need it.
 */
function scaled(
  n: string,
  f: number,
  axis: 'Width' | 'Height',
  size: number,
  inherit: boolean,
): string {
  return inherit
    ? `<Cell N="${n}" V="${r6(f * size)}" F="Inh"/>`
    : fcell(n, f * size, `${axis}*${r6(f)}`);
}

/** One Geometry section; coordinates in master fractions (y up). */
function section(
  ix: number,
  p: Prim,
  filled: boolean,
  W: number,
  H: number,
  inherit: boolean,
): string {
  const head =
    `<Section N="Geometry" IX="${ix}">${cell('NoFill', filled ? 0 : 1)}` +
    `${cell('NoLine', 0)}${cell('NoShow', 0)}${cell('NoSnap', 0)}`;
  const X = (f: number, n = 'X'): string => scaled(n, f, 'Width', W, inherit);
  const Y = (f: number, n = 'Y'): string => scaled(n, f, 'Height', H, inherit);
  if (p.kind === 'ellipse') {
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    return (
      head +
      `<Row T="Ellipse" IX="1">${X(cx)}${Y(cy)}` +
      X(p.x + p.w, 'A') +
      Y(cy, 'B') +
      X(cx, 'C') +
      Y(p.y + p.h, 'D') +
      `</Row></Section>`
    );
  }
  const pts: [number, number][] = [
    [p.x, p.y],
    [p.x + p.w, p.y],
    [p.x + p.w, p.y + p.h],
    [p.x, p.y + p.h],
    [p.x, p.y],
  ];
  return (
    head +
    pts
      .map(
        ([x, y], i) =>
          `<Row T="${i === 0 ? 'MoveTo' : 'LineTo'}" IX="${i + 1}">${X(x)}${Y(y)}</Row>`,
      )
      .join('') +
    `</Section>`
  );
}

/** The face a node draws: the asked one when the catalog has art for it. */
export function masterFace(
  catalog: Catalog,
  platform: Platform,
  want: 'front' | 'rear',
): 'front' | 'rear' {
  const other = want === 'front' ? 'rear' : 'front';
  if (catalog.glyph(platform.id, want)) return want;
  if (catalog.glyph(platform.id, other)) return other;
  return platform.ports.some((p) => (p.face ?? 'front') === want)
    ? want
    : other;
}

/** Stack members a node draws for a model (as wire sheets do). */
export function masterMembers(model: Model, stackMembers?: number): number {
  return model.interfaces.some((i) => i.name.includes('{member}'))
    ? Math.max(
        1,
        Math.min(stackMembers ?? 1, model.stackable?.max_members ?? 1),
      )
    : 1;
}

export function masterKey(
  modelId: string,
  face: string,
  members: number,
): string {
  return `${modelId}|${face}|${members}`;
}

/** Build the master for a model drawn on a face with `members` chassis. */
export function buildMaster(
  catalog: Catalog,
  modelId: string,
  face: 'front' | 'rear',
  members: number,
  id: number,
): VisioMaster {
  const model = catalog.model(modelId);
  const platform = catalog.platformFor(modelId);
  const W = platform.panel.width;
  const h = platform.panel.height;
  const H = members * h + (members - 1) * MEMBER_GAP_MM;
  const glyph = catalog.glyph(platform.id, face);
  const prims = glyph ? glyphPrims(glyph) : geometryPrims(platform, face);

  // Sections: each member's primitives, fractions of the whole (y up).
  const geometry: { p: Prim; filled: boolean }[] = [];
  for (let m = 0; m < members; m++) {
    const top = m * (h + MEMBER_GAP_MM);
    let bodyDone = false;
    for (const p of prims) {
      const isBody = !bodyDone && p.kind === 'rect' && p.w * p.h >= 0.8 * W * h;
      if (isBody) bodyDone = true;
      geometry.push({
        p: {
          kind: p.kind,
          x: p.x / W,
          w: p.w / W,
          // Flip to Visio's y-up frame: the primitive's bottom edge.
          y: 1 - (top + p.y + p.h) / H,
          h: p.h / H,
        },
        filled: isBody,
      });
    }
  }

  // Connection points: every interface on the face, per member.
  const phys = new Map(platform.ports.map((p) => [p.id, p]));
  const used = new Set<string>();
  const connections: MasterConnection[] = [];
  for (let m = 1; m <= members; m++)
    for (const row of model.interfaces) {
      if (m > 1 && !row.name.includes('{member}')) continue;
      const p = phys.get(row.physical);
      if (!p || (p.face ?? 'front') !== face) continue;
      const name = row.name.replace('{member}', String(m));
      const top = (m - 1) * (h + MEMBER_GAP_MM);
      connections.push({
        name: connectionRowName(name, used),
        prompt: name,
        fx: p.x / W,
        fy: 1 - (top + p.y) / H,
      });
    }
  const connectionIndex = new Map(connections.map((c, i) => [c.prompt, i]));

  const widthIn = W * MM;
  const heightIn = H * MM;
  const props: [string, string, string][] = [
    ['Vendor', 'Vendor', model.vendor],
    ['Model', 'Model', model.name],
    ['ModelId', 'Model id', model.id],
    ['SKU', 'SKU', (model.skus ?? [])[0]?.sku ?? ''],
    ['CatalogVersion', 'Catalog version', catalog.version],
    ['Hostname', 'Hostname', ''],
    ['Confidence', 'Panel confidence', platform.position_confidence],
    ['GAEligible', 'GA eligible', gaEligible(model) ? 'yes' : 'no'],
    ['Face', 'Face', face],
  ];
  const nameU =
    `${model.name}${members > 1 ? ` x${members}` : ''}${face === 'rear' ? ' (rear)' : ''}`.slice(
      0,
      120,
    );

  const shapeXml =
    `<Shape ID="5" NameU="${xmlEsc(nameU)}" Name="${xmlEsc(nameU)}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    cell('PinX', widthIn / 2) +
    cell('PinY', heightIn / 2) +
    cell('Width', widthIn) +
    cell('Height', heightIn) +
    fcell('LocPinX', widthIn / 2, 'Width*0.5') +
    fcell('LocPinY', heightIn / 2, 'Height*0.5') +
    cell('Angle', 0) +
    cell('LineColor', PANEL_LINE) +
    cell('LineWeight', 0.5 / 72, ' U="PT"') +
    cell('FillForegnd', PANEL_FILL) +
    cell('FillPattern', 1) +
    // Hostname under the panel; Visio keeps it with the shape.
    fcell('TxtPinX', widthIn / 2, 'Width*0.5') +
    fcell('TxtPinY', -0.12, '-0.12 in') +
    fcell('TxtWidth', Math.max(widthIn, 1.5), 'MAX(Width,1.5 in)') +
    fcell('TxtHeight', 0.2, '0.2 in') +
    fcell('TxtLocPinX', Math.max(widthIn, 1.5) / 2, 'TxtWidth*0.5') +
    fcell('TxtLocPinY', 0.1, 'TxtHeight*0.5') +
    `<Section N="Character"><Row IX="0">${cell('Color', '#222222')}${cell('Size', 8 / 72, ' U="PT"')}${cell('Style', 1)}</Row></Section>` +
    `<Section N="Property">` +
    props
      .map(
        ([n, label, v]) =>
          `<Row N="${n}">${cell('Label', label)}${cell('Value', v, ' U="STR"')}${cell('Type', 0)}</Row>`,
      )
      .join('') +
    `</Section>` +
    `<Section N="Connection">` +
    connections
      .map(
        (c, i) =>
          `<Row N="${c.name}" IX="${i}">${scaled('X', c.fx, 'Width', widthIn, false)}${scaled('Y', c.fy, 'Height', heightIn, false)}` +
          `${cell('DirX', 0)}${cell('DirY', 0)}${cell('Type', 0)}${cell('AutoGen', 0)}${cell('Prompt', c.prompt, ' U="STR"')}</Row>`,
      )
      .join('') +
    `</Section>` +
    geometry
      .map((g, i) => section(i, g.p, g.filled, widthIn, heightIn, false))
      .join('') +
    `</Shape>`;

  /** An instance's local values at its size (formulas inherited). */
  const instanceXml = (w: number, hh: number): string =>
    `<Cell N="TxtPinX" V="${r6(w / 2)}" F="Inh"/>` +
    `<Cell N="TxtWidth" V="${r6(Math.max(w, 1.5))}" F="Inh"/>` +
    `<Cell N="TxtLocPinX" V="${r6(Math.max(w, 1.5) / 2)}" F="Inh"/>` +
    `<Section N="Connection">` +
    connections
      .map(
        (c, i) =>
          `<Row N="${c.name}" IX="${i}">${scaled('X', c.fx, 'Width', w, true)}${scaled('Y', c.fy, 'Height', hh, true)}</Row>`,
      )
      .join('') +
    `</Section>` +
    geometry.map((g, i) => section(i, g.p, g.filled, w, hh, true)).join('');

  return {
    key: masterKey(modelId, face, members),
    modelId,
    id,
    nameU,
    widthIn,
    heightIn,
    connections,
    connectionIndex,
    shapeXml,
    instanceXml,
    uniqueId: guid(
      `unique|${catalog.version}|${masterKey(modelId, face, members)}`,
    ),
    baseId: guid(`base|${masterKey(modelId, face, members)}`),
  };
}

/** `visio/masters/masters.xml` for a set of masters (rIdN → masterN.xml). */
export function mastersXml(masters: VisioMaster[]): string {
  return (
    XML_HEADER +
    `<Masters xmlns="${VISIO_NS}" xmlns:r="${VISIO_NS_R}" xml:space="preserve">` +
    masters
      .map(
        (m, i) =>
          `<Master ID="${m.id}" NameU="${xmlEsc(m.nameU)}" IsCustomNameU="1" Name="${xmlEsc(m.nameU)}" IsCustomName="1" ` +
          `Prompt="${xmlEsc(m.nameU)}" IconSize="1" AlignName="2" MatchByName="0" IconUpdate="1" ` +
          `UniqueID="${m.uniqueId}" BaseID="${m.baseId}" PatternFlags="0" Hidden="0" MasterType="2">` +
          `<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">${cell('PageWidth', m.widthIn)}${cell('PageHeight', m.heightIn)}` +
          `${cell('PageScale', 1, ' U="IN_F"')}${cell('DrawingScale', 1, ' U="IN_F"')}${cell('DrawingSizeType', 4)}${cell('DrawingScaleType', 0)}</PageSheet>` +
          `<Rel r:id="rId${i + 1}"/></Master>`,
      )
      .join('') +
    `</Masters>`
  );
}

/** `visio/masters/masterN.xml`. */
export function masterContentsXml(m: VisioMaster): string {
  return (
    XML_HEADER +
    `<MasterContents xmlns="${VISIO_NS}" xmlns:r="${VISIO_NS_R}" xml:space="preserve">` +
    `<Shapes>${m.shapeXml}</Shapes></MasterContents>`
  );
}
