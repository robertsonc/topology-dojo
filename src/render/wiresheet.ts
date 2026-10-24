/**
 * Wire-sheet pages (hw-catalog Phase 4). A page with `view: "wiresheet"`
 * draws every hardware-bound node as its real panel — the platform glyph
 * for `hw.face`, at a page scale of 1:k (mm-accurate on ANSI / ISO sheets)
 * — with cables plugged into the true port positions. Unbound nodes draw
 * exactly as on a logical page.
 *
 * It is a render-time transform: the stored document never changes. The
 * transform hands the engine a page where
 *
 * - each bound node is a panel node (`tds-panel--…` type, whose plugin
 *   draws the pre-built panel art and whose hit box is the panel), with
 *   its engine label suppressed (the overlay draws the header instead, so
 *   the anchor box is the bare panel);
 * - each cable end on a resolvable port is pinned to the panel's nearest
 *   top / bottom edge exactly above / below the port (`fromPort` +
 *   `fromPortOffset` under `linkAttach {pad: 0}`), and gets a waypoint at
 *   the end of a short perpendicular lead, so the cable leaves the panel
 *   straight whatever the line style;
 *
 * and draws an overlay on top: the plug (port → edge), a port pill with
 * the interface name on the lead, the hostname / model header, and badges
 * (SCHEMATIC on schematic panels, NOT TO SCALE on relative-unit panels).
 * Unused ports are muted inside the panel art. Notes (scale, schematic
 * models, face / geometry fallbacks) go into the sheet's title block, or a
 * small notes box when the document has none.
 *
 * Glyphs are sanitized again here before drawing (the bundle copy is
 * sanitized at build time too): nothing unsanitized is ever rendered.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';
import { isBound } from '../api/hardware.js';
import { resolveLinkStyle } from '../api/link-styles.js';
import type {
  Catalog,
  Model,
  Platform,
  ResolvedInterface,
} from '../catalog/catalog.js';
import { sanitizeSvg } from '../catalog/sanitize-svg.js';
import type { XmlElement } from '../import/xml.js';
import { sheetInset } from '../api/sheet.js';
import { registerHitBox } from './hit-boxes.js';
import { chooseScale, pxPerMm, scaleLabel } from './wiresheet-scale.js';

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the wire-sheet transform needs from the server. */
export interface WiresheetHardware {
  /** The catalog the document is judged against (its pin, else latest). */
  catalog: Catalog;
}

export interface PanelPlacement {
  nodeId: string;
  model: Model;
  platform: Platform;
  face: 'front' | 'rear';
  /** The face shown is not the one asked for (no glyph for that face). */
  faceFallback: boolean;
  /** Drawn from catalog geometry: the bundle has no glyph for the face. */
  geometryOnly: boolean;
  schematic: boolean;
  /** Panel units are relative, not millimetres: not to scale. */
  relative: boolean;
  /** Chassis drawn: the stack members (VSF / VC), stacked top to bottom. */
  members: number;
  /** One member's panel height (px) and the gap between members. */
  memberH: number;
  gap: number;
  /** The whole panel (all members) on the page. */
  rect: Rect;
  /** Page px per panel unit. */
  unit: number;
  /** Engine node type of the panel. */
  type: string;
}

export interface WiresheetEnd {
  linkId: string;
  end: 'from' | 'to';
  nodeId: string;
  interface: string;
  physicalId: string;
  /** Port centre on the page. */
  port: Pt;
  /** Where the cable leaves the panel edge. */
  edge: Pt;
  side: 'n' | 's';
  /** End of the perpendicular lead (the cable's first waypoint). */
  lead: Pt;
  /** The port pill. */
  pill: Rect;
  color: string;
}

export interface WiresheetFinding {
  kind:
    | 'port-missing' // interface resolves, but the platform has no such port: a catalog bug
    | 'off-face' // the port is on the face not shown
    | 'unresolved'; // no interface yet, or not one on the model
  where: string;
  message: string;
}

export interface WiresheetLayout {
  scale: number;
  panels: PanelPlacement[];
  ends: WiresheetEnd[];
  findings: WiresheetFinding[];
  notes: string[];
  /** The page handed to the engine. */
  page: Page;
  /** The page the document overlays (port tables, legend, sheet) draw on. */
  overlayPage: Page;
  /** Approximate cable routes by link id (the engine's final path may differ at unbound ends). */
  routes: Map<string, Pt[]>;
  /** Cable label boxes and panel header boxes drawn by the overlay. */
  labels: Rect[];
  headers: Rect[];
  /** The document with title-block notes added (for the overlays). */
  doc: TopologyDocument;
  /** Overlay drawn over the engine art. */
  overlay: string;
  /** Panel node types this page uses: type → { art per node, hit box }. */
  types: Map<string, { rx: number; ry: number }>;
}

/** Lead length past the pill, and pill metrics (match the W4 pills). */
const PILL = { width: 12, fontSize: 7, charW: 4.4, padAlong: 4, gap: 3 };
const LEAD_EXTRA = 8;
const PILL_FILL = '#e6e8e9';
const PILL_TEXT = '#141820';
const BADGE = '#deb146';
const HEADER = '#e6e8e9';
// The engine's default link colour (links without a colour draw in it).
const DEFAULT_CABLE = '#01a982';

const esc = (s: string): string =>
  s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
const r2 = (n: number): number => Math.round(n * 100) / 100;

const pillLen = (label: string): number =>
  Math.max(18, label.length * PILL.charW + PILL.padAlong * 2);

/** Whether a page renders as a wire sheet (and has something to draw). */
export function isWiresheetPage(page: Page): boolean {
  return page.view === 'wiresheet' && page.nodes.some(isBound);
}

/** Whether any page of a document needs the catalog to render. */
export function docNeedsHardware(doc: TopologyDocument): boolean {
  return doc.pages.some(isWiresheetPage);
}

// ---- glyph instantiation ---------------------------------------------

const parsedGlyphs = new Map<string, XmlElement>();
function glyphTree(svg: string): XmlElement {
  let t = parsedGlyphs.get(svg);
  if (!t) {
    t = sanitizeSvg(svg).root;
    if (parsedGlyphs.size > 64) parsedGlyphs.clear();
    parsedGlyphs.set(svg, t);
  }
  return t;
}

/** Serialize glyph children with ids prefixed and unused ports muted. */
function glyphInner(
  root: XmlElement,
  prefix: string,
  used: ReadonlySet<string>,
): string {
  const ref = (v: string): string =>
    v
      .replace(/url\(\s*#([^)\s]+)\s*\)/g, `url(#${prefix}$1)`)
      .replace(/^#(.+)$/, `#${prefix}$1`);
  const ser = (el: XmlElement): string => {
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(el.attrs)) {
      if (k === 'xmlns' || k === 'xmlns:xlink') continue;
      attrs[k] =
        k === 'id'
          ? `${prefix}${v}`
          : k === 'href' || k === 'xlink:href' || v.includes('url(')
            ? ref(v)
            : v;
    }
    const port = el.attrs['data-port'];
    if (port !== undefined && !used.has(port)) attrs.opacity = '0.35';
    const a = Object.entries(attrs)
      .map(([k, v]) => ` ${k}="${esc(v)}"`)
      .join('');
    const text = el.text.trim() ? esc(el.text.trim()) : '';
    const inner = text + el.children.map(ser).join('');
    return inner
      ? `<${el.name}${a}>${inner}</${el.name}>`
      : `<${el.name}${a}/>`;
  };
  return root.children.map(ser).join('');
}

/** Panel art from geometry alone (no glyph for the face). */
function geometryArt(
  platform: Platform,
  face: 'front' | 'rear',
  used: ReadonlySet<string>,
): string {
  const { width, height } = platform.panel;
  let s =
    `<rect x="0.4" y="0.4" width="${r2(width - 0.8)}" height="${r2(height - 0.8)}" rx="2" ` +
    `fill="#23272e" stroke="#59626e" stroke-width="0.5"/>`;
  for (const p of platform.ports) {
    if ((p.face ?? 'front') !== face) continue;
    s +=
      `<rect x="${r2(p.x - (p.w ?? 6) / 2)}" y="${r2(p.y - (p.h ?? 6) / 2)}" width="${p.w ?? 6}" height="${p.h ?? 6}" rx="0.6" ` +
      `fill="#0f1115" stroke="#c9d1d9" stroke-width="0.4"${used.has(p.id) ? '' : ' opacity="0.35"'}/>`;
  }
  return s;
}

// ---- layout ----------------------------------------------------------

function panelType(
  platform: string,
  face: string,
  scale: number,
  members: number,
): string {
  return `tds-panel--${platform}--${face}--${String(scale).replace('.', '_')}--${members}`;
}

/** Gap between stacked members (px): leads only ever leave the outer edges. */
const MEMBER_GAP = 10;

/** Top of member `m` (1-based). */
function memberTop(p: PanelPlacement, m: number): number {
  return p.rect.y + (m - 1) * (p.memberH + p.gap);
}

/**
 * The wire-sheet layout of one page, or null when the page is not a wire
 * sheet (or binds nothing the catalog knows).
 */
export function wiresheetLayout(
  doc: TopologyDocument,
  page: Page,
  hw: WiresheetHardware,
): WiresheetLayout | null {
  if (!isWiresheetPage(page)) return null;
  const { catalog } = hw;
  const [vx, vy, vw, vh] = page.viewBox.split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];

  const bound = page.nodes.filter(
    (n): n is NodeConfig & { hw: NonNullable<NodeConfig['hw']> } =>
      isBound(n) && catalog.models.has(n.hw.model),
  );
  if (!bound.length) return null;
  const widest = Math.max(
    ...bound.map((n) => catalog.platformFor(n.hw.model).panel.width),
  );
  const scale = chooseScale(vw, widest, page.panelScale);
  const unit = pxPerMm(scale);

  // Panels.
  const panels = new Map<string, PanelPlacement>();
  for (const n of bound) {
    const model = catalog.model(n.hw.model);
    const platform = catalog.platformFor(model.id);
    const want = n.hw.face ?? 'front';
    const other = want === 'front' ? 'rear' : 'front';
    const face = catalog.glyph(platform.id, want)
      ? want
      : catalog.glyph(platform.id, other)
        ? other
        : platform.ports.some((p) => (p.face ?? 'front') === want)
          ? want
          : other;
    const w = platform.panel.width * unit;
    const memberH = platform.panel.height * unit;
    // A stack draws one chassis per member (only for `{member}` models).
    const members = model.interfaces.some((i) => i.name.includes('{member}'))
      ? Math.max(
          1,
          Math.min(n.hw.stackMembers ?? 1, model.stackable?.max_members ?? 1),
        )
      : 1;
    const h = members * memberH + (members - 1) * MEMBER_GAP;
    panels.set(n.id, {
      nodeId: n.id,
      model,
      platform,
      face,
      faceFallback: face !== want,
      geometryOnly: !catalog.glyph(platform.id, face),
      schematic: platform.position_confidence === 'schematic',
      relative: platform.panel.units !== 'mm',
      members,
      memberH,
      gap: MEMBER_GAP,
      rect: { x: n.x - w / 2, y: n.y - h / 2, w, h },
      unit,
      type: panelType(platform.id, face, scale, members),
    });
  }

  // Cable ends.
  const findings: WiresheetFinding[] = [];
  const ends: WiresheetEnd[] = [];
  const nodes = new Map(page.nodes.map((n) => [n.id, n]));
  for (const l of page.links) {
    const style = resolveLinkStyle(l, doc.linkStyles);
    for (const end of ['from', 'to'] as const) {
      const p = panels.get(l[end]);
      if (!p) continue;
      const where = `link '${l.id}' end ${l[end]}`;
      const ifName = end === 'from' ? l.fromInterface : l.toInterface;
      let r: ResolvedInterface | null = null;
      try {
        r = ifName ? catalog.resolveInterface(p.model.id, ifName) : null;
      } catch (err) {
        // The catalog checker forbids this; report it, never crash a render.
        findings.push({
          kind: 'port-missing',
          where,
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (!r) {
        findings.push({
          kind: 'unresolved',
          where,
          message: ifName
            ? `"${ifName}" is not an interface on ${p.model.id}; the cable attaches to the panel edge`
            : 'no interface yet; the cable attaches to the panel edge',
        });
        continue;
      }
      const phys = p.platform.ports.find((q) => q.id === r.physicalId);
      if (!phys) {
        findings.push({
          kind: 'port-missing',
          where,
          message: `${r.name} maps to physical port "${r.physicalId}", which ${p.platform.id} does not have`,
        });
        continue;
      }
      if ((phys.face ?? 'front') !== p.face) {
        findings.push({
          kind: 'off-face',
          where,
          message: `${r.name} is on the ${phys.face ?? 'front'} face; the sheet shows the ${p.face}`,
        });
        continue;
      }
      const member = r.member ?? 1;
      if (member > p.members) {
        findings.push({
          kind: 'unresolved',
          where,
          message: `${r.name} is on member ${member}; the sheet draws ${p.members}`,
        });
        continue;
      }
      const mTop = memberTop(p, member);
      const port = {
        x: p.rect.x + phys.x * p.unit,
        y: mTop + phys.y * p.unit,
      };
      // The nearest outer edge: a single chassis by port row; a stack
      // leaves member 1 by the top and the last member by the bottom.
      // A mid-height port (35-65 %: a single-row panel) leaves toward the
      // far end instead, so it never wraps around its own chassis.
      const far = nodes.get(end === 'from' ? l.to : l.from);
      const rel = phys.y / p.platform.panel.height;
      const top =
        p.members > 1 && (member === 1 || member === p.members)
          ? member === 1
          : rel > 0.35 && rel < 0.65 && far
            ? far.y <= p.rect.y + p.rect.h / 2
            : rel <= 0.5;
      const side = top ? 'n' : 's';
      const edge = {
        x: port.x,
        y: top ? mTop : mTop + p.memberH,
      };
      const len = pillLen(r.name);
      const dir = top ? -1 : 1;
      const lead = {
        x: port.x,
        y: edge.y + dir * (PILL.gap + len + LEAD_EXTRA),
      };
      const py0 = edge.y + dir * PILL.gap;
      const py1 = py0 + dir * len;
      ends.push({
        linkId: l.id,
        end,
        nodeId: l[end],
        interface: r.name,
        physicalId: `${member}|${phys.id}`,
        port,
        edge,
        side,
        lead,
        pill: {
          x: port.x - PILL.width / 2,
          y: Math.min(py0, py1),
          w: PILL.width,
          h: len,
        },
        color: style.color ?? DEFAULT_CABLE,
      });
    }
  }

  // The page for the engine.
  const routes = new Map<string, Pt[]>();
  const centre = (id: string): Pt => {
    const n = nodes.get(id);
    return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
  };
  // A lead leaving the panel away from the far end detours around the
  // panel's nearer side to its far edge, so the cable never crosses it.
  const detourCount = new Map<string, number>();
  const detour = (p: PanelPlacement, e: WiresheetEnd, toward: Pt): Pt[] => {
    const away =
      e.side === 's' ? toward.y < p.rect.y : toward.y > p.rect.y + p.rect.h;
    if (!away) return [];
    const left = toward.x < p.rect.x + p.rect.w / 2;
    const k = `${p.nodeId}|${left ? 'l' : 'r'}`;
    const i = detourCount.get(k) ?? 0;
    detourCount.set(k, i + 1);
    const d = 16 + i * 7;
    const sideX = left ? p.rect.x - d : p.rect.x + p.rect.w + d;
    const beyond = e.side === 's' ? p.rect.y - d : p.rect.y + p.rect.h + d;
    return [
      { x: sideX, y: e.lead.y },
      { x: sideX, y: beyond },
    ];
  };
  const byEnd = new Map(ends.map((e) => [`${e.linkId}|${e.end}`, e]));
  const usedPorts = new Map<string, Set<string>>();
  for (const e of ends) {
    const s = usedPorts.get(e.nodeId) ?? new Set();
    s.add(e.physicalId);
    usedPorts.set(e.nodeId, s);
  }
  const types = new Map<string, { rx: number; ry: number }>();
  let prefixN = 0;
  const { portLabels: _pills, ...pageRest } = page;
  const enginePage: Page = {
    ...pageRest,
    nodes: page.nodes.map((n) => {
      const p = panels.get(n.id);
      if (!p) return n;
      const box = { rx: p.rect.w / 2, ry: p.rect.h / 2 };
      types.set(p.type, box);
      // The TS mirrors (attachment, zones, inspect) size the panel too.
      registerHitBox(p.type, box);
      const usedAll = usedPorts.get(n.id) ?? new Set<string>();
      const glyph = catalog.glyph(p.platform.id, p.face);
      const ux = p.rect.w / p.platform.panel.width;
      const uy = p.memberH / p.platform.panel.height;
      let art = `<g class="tds-panel" data-node="${esc(n.id)}">`;
      for (let m = 1; m <= p.members; m++) {
        const used = new Set(
          [...usedAll]
            .filter((k) => k.startsWith(`${m}|`))
            .map((k) => k.slice(k.indexOf('|') + 1)),
        );
        const body = glyph
          ? glyphInner(glyphTree(glyph), `ws${prefixN++}-`, used)
          : geometryArt(p.platform, p.face, used);
        const ty = -p.rect.h / 2 + (m - 1) * (p.memberH + p.gap);
        art +=
          `<g transform="translate(${r2(-p.rect.w / 2)} ${r2(ty)}) scale(${r2(ux * 1000) / 1000} ${r2(uy * 1000) / 1000})">` +
          body +
          `</g>`;
        if (p.members > 1)
          art +=
            `<text x="${r2(-p.rect.w / 2 - 6)}" y="${r2(ty + p.memberH / 2 + 3)}" text-anchor="end" font-size="9" ` +
            `font-family="ui-monospace,monospace" fill="#b1b9be">${m}</text>`;
      }
      art += `</g>`;
      const { label: _label, sublabel: _sub, ...rest } = n;
      return {
        ...rest,
        type: p.type,
        label: '',
        linkAttach: { pad: 0 },
        __wsArt: art,
      } as NodeConfig;
    }),
    links: page.links.map((l) => {
      const a = byEnd.get(`${l.id}|from`);
      const z = byEnd.get(`${l.id}|to`);
      if (!a && !z) return l;
      const out: LinkConfig = { ...l };
      const wps = [...(l.waypoints ?? [])];
      if (a) {
        const p = panels.get(a.nodeId)!;
        out.fromPort = a.side;
        out.fromPortOffset =
          (a.edge.x - (p.rect.x + p.rect.w / 2)) / (p.rect.w / 2);
        delete out.fromLabel;
        delete out.fromInterface;
        const toward = wps[0] ?? z?.lead ?? centre(l.to);
        wps.unshift(a.lead, ...detour(p, a, toward));
      }
      if (z) {
        const p = panels.get(z.nodeId)!;
        out.toPort = z.side;
        out.toPortOffset =
          (z.edge.x - (p.rect.x + p.rect.w / 2)) / (p.rect.w / 2);
        delete out.toLabel;
        delete out.toInterface;
        const toward = wps[wps.length - 1] ?? a?.lead ?? centre(l.from);
        wps.push(...detour(p, z, toward).reverse(), z.lead);
      }
      out.waypoints = wps;
      // The cable label is drawn on the route by the overlay.
      if (out.label) delete out.label;
      const start = a ? a.edge : centre(l.from);
      const finish = z ? z.edge : centre(l.to);
      const pts = [start, ...wps, finish];
      routes.set(
        l.id,
        l.lineStyle === 'orthogonal'
          ? pts.flatMap((q, i) =>
              i === 0 ? [q] : [{ x: q.x, y: pts[i - 1]!.y }, q],
            )
          : pts,
      );
      return out;
    }),
  };
  // Document overlays (port tables, legend, sheet) see the panels with the
  // stored links, so tables keep their interface names.
  const overlayPage: Page = { ...enginePage, links: page.links };

  // Notes.
  const notes: string[] = [`Panels at ${scaleLabel(scale)}`];
  const list = (pred: (p: PanelPlacement) => boolean): string =>
    [
      ...new Set([...panels.values()].filter(pred).map((p) => p.model.name)),
    ].join(', ');
  const schematic = list((p) => p.schematic);
  if (schematic)
    notes.push(`SCHEMATIC (port positions approximate): ${schematic}`);
  const relative = list((p) => p.relative);
  if (relative) notes.push(`Not to scale (relative units): ${relative}`);
  const faces = [
    ...new Map(
      [...panels.values()]
        .filter((p) => p.faceFallback)
        .map((p) => [p.model.id, p] as const),
    ).values(),
  ];
  for (const p of faces)
    notes.push(
      `${p.model.name}: ${p.face} face shown (no ${p.face === 'front' ? 'rear' : 'front'} art)`,
    );
  const geo = list((p) => p.geometryOnly);
  if (geo)
    notes.push(
      `Drawn from catalog geometry (no panel art in catalog ${catalog.version}): ${geo}`,
    );

  // Overlay.
  const labels: Rect[] = [];
  const headers: Rect[] = [];
  let ov = `<g class="tds-wiresheet" font-family="ui-monospace,monospace">`;
  for (const e of ends) {
    ov +=
      `<line x1="${r2(e.port.x)}" y1="${r2(e.port.y)}" x2="${r2(e.edge.x)}" y2="${r2(e.edge.y)}" ` +
      `stroke="${esc(e.color)}" stroke-width="2" stroke-linecap="round"/>` +
      `<circle cx="${r2(e.port.x)}" cy="${r2(e.port.y)}" r="2.2" fill="${esc(e.color)}"/>`;
  }
  for (const e of ends) {
    const { x, y, w, h } = e.pill;
    const cx = x + w / 2;
    const cy = y + h / 2;
    ov +=
      `<g class="tds-ws-pill" data-link="${esc(e.linkId)}"><rect x="${r2(x)}" y="${r2(y)}" width="${w}" height="${r2(h)}" rx="${PILL.width / 2}" fill="${PILL_FILL}" stroke="${esc(e.color)}" stroke-width="1"/>` +
      `<text x="${r2(cx)}" y="${r2(cy + PILL.fontSize * 0.36)}" text-anchor="middle" font-size="${PILL.fontSize}" font-weight="600" fill="${PILL_TEXT}" transform="rotate(-90 ${r2(cx)} ${r2(cy)})">${esc(e.interface)}</text></g>`;
  }
  // Cable labels at the middle of the longest leg of the route.
  for (const l of page.links) {
    const route = routes.get(l.id);
    const text = l.label?.trim();
    if (!route || !text) continue;
    let best = 0;
    let at = route[0]!;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!;
      const b = route[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > best) {
        best = len;
        at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    }
    const lw = text.length * 5.4 + 12;
    labels.push({ x: at.x - lw / 2, y: at.y - 7, w: lw, h: 14 });
    ov +=
      `<g class="tds-ws-label" data-link="${esc(l.id)}"><rect x="${r2(at.x - lw / 2)}" y="${r2(at.y - 7)}" width="${r2(lw)}" height="14" rx="3" fill="${PILL_FILL}"/>` +
      `<text x="${r2(at.x)}" y="${r2(at.y + 3)}" text-anchor="middle" font-size="8.5" font-weight="600" fill="${PILL_TEXT}">${esc(text)}</text></g>`;
  }
  for (const p of panels.values()) {
    const n = nodes.get(p.nodeId)!;
    const name = n.label?.trim() || n.id;
    const sku = n.hw?.sku ? ` (${n.hw.sku})` : '';
    const sub = `${p.model.name}${sku}${p.face === 'rear' ? ' · rear' : ''}`;
    const { x, y, w, h } = p.rect;
    // Header: the first spot — below, above, right of, left of the panel,
    // then below its leads — that stays on the page and clear of every
    // pill, panel (with its badge row), cable label and earlier header.
    const hw = Math.max(name.length * 7, sub.length * 5.6);
    const maxLead = Math.max(
      0,
      ...ends
        .filter((e) => e.nodeId === p.nodeId && e.side === 's')
        .map((e) => e.lead.y - (y + h)),
    );
    const spots: (Rect & { end?: boolean })[] = [
      { x, y: y + h + 4, w: hw, h: 26 },
      { x, y: y - 30, w: hw, h: 26 },
      { x: x + w + 10, y: y + h / 2 - 13, w: hw, h: 26 },
      { x: x - 10 - hw, y: y + h / 2 - 13, w: hw, h: 26, end: true },
      { x, y: y + h + maxLead + 6, w: hw, h: 26 },
    ];
    const inset = sheetInset(doc.sheet);
    const hit = (a: Rect, b: Rect): boolean =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const blockers: Rect[] = [
      ...ends.map((e) => e.pill),
      ...[...panels.values()].map((q) => ({
        x: q.rect.x,
        y: q.rect.y - 16,
        w: q.rect.w,
        h: q.rect.h + 16,
      })),
      ...headers,
      ...labels,
      ...[...routes.values()].flatMap((r) =>
        r.slice(1).map((b, i) => {
          const a = r[i]!;
          return {
            x: Math.min(a.x, b.x) - 2,
            y: Math.min(a.y, b.y) - 2,
            w: Math.abs(b.x - a.x) + 4,
            h: Math.abs(b.y - a.y) + 4,
          };
        }),
      ),
    ];
    const fits = (r: Rect): boolean =>
      r.x >= vx + inset &&
      r.y >= vy + inset &&
      r.x + r.w <= vx + vw - inset &&
      r.y + r.h <= vy + vh - inset &&
      !blockers.some((b) => hit(b, r));
    const spot = spots.find(fits) ?? spots[0]!;
    const right = !!spot.end;
    const tx = right ? spot.x + spot.w : spot.x;
    const anchor = right ? ' text-anchor="end"' : '';
    headers.push(spot);
    ov +=
      `<g class="tds-ws-header" data-node="${esc(p.nodeId)}"><text x="${r2(tx)}" y="${r2(spot.y + 11)}"${anchor} font-size="11" font-weight="700" fill="${HEADER}">${esc(name)}</text>` +
      `<text x="${r2(tx)}" y="${r2(spot.y + 23)}"${anchor} font-size="9" fill="#b1b9be">${esc(sub)}</text></g>`;
    const badges = [
      ...(p.schematic ? ['SCHEMATIC'] : []),
      ...(p.relative ? ['NOT TO SCALE'] : []),
      ...(p.geometryOnly ? ['GEOMETRY ONLY'] : []),
    ];
    let bx = x + w;
    for (const b of badges) {
      const bw = b.length * 5.6 + 10;
      bx -= bw;
      ov +=
        `<g class="tds-ws-badge"><rect x="${r2(bx)}" y="${r2(y - 15)}" width="${r2(bw)}" height="12" rx="2" fill="none" stroke="${BADGE}" stroke-width="1"/>` +
        `<text x="${r2(bx + bw / 2)}" y="${r2(y - 6)}" text-anchor="middle" font-size="8" font-weight="700" letter-spacing=".6" fill="${BADGE}">${b}</text></g>`;
      bx -= 4;
    }
  }

  // Notes into the title block, else a notes box at the bottom-left.
  let outDoc = doc;
  const tb = doc.sheet?.titleBlock;
  if (doc.sheet && tb && tb.show !== false) {
    outDoc = {
      ...doc,
      sheet: { ...doc.sheet, titleBlock: { ...tb, notes } },
    };
  } else {
    const inset = sheetInset(doc.sheet);
    const lineH = 12;
    const bw = Math.max(...notes.map((s) => s.length)) * 5.4 + 16;
    const bh = notes.length * lineH + 10;
    // The first corner clear of panels, headers, pills, cable labels,
    // routes and unbound nodes (bottom-left first, where notes go).
    const corners = [
      { x: vx + inset, y: vy + vh - inset - bh },
      { x: vx + vw - inset - bw, y: vy + vh - inset - bh },
      { x: vx + inset, y: vy + inset },
      { x: vx + vw - inset - bw, y: vy + inset },
    ];
    const busy: Rect[] = [
      ...[...panels.values()].map((q) => ({
        ...q.rect,
        y: q.rect.y - 16,
        h: q.rect.h + 16,
      })),
      ...headers,
      ...labels,
      ...ends.map((e) => e.pill),
      ...page.nodes
        .filter((n) => !panels.has(n.id))
        .map((n) => ({ x: n.x - 40, y: n.y - 40, w: 80, h: 90 })),
      ...[...routes.values()].flatMap((r) =>
        r.slice(1).map((b, i) => {
          const a = r[i]!;
          return {
            x: Math.min(a.x, b.x) - 2,
            y: Math.min(a.y, b.y) - 2,
            w: Math.abs(b.x - a.x) + 4,
            h: Math.abs(b.y - a.y) + 4,
          };
        }),
      ),
    ];
    const free = (c: { x: number; y: number }): boolean =>
      !busy.some(
        (b) =>
          c.x < b.x + b.w &&
          b.x < c.x + bw &&
          c.y < b.y + b.h &&
          b.y < c.y + bh,
      );
    const { x: bx, y: by } = corners.find(free) ?? corners[0]!;
    ov +=
      `<g class="tds-ws-notes"><rect x="${r2(bx)}" y="${r2(by)}" width="${r2(bw)}" height="${bh}" rx="4" fill="rgba(20,24,32,0.86)" stroke="rgba(255,255,255,0.14)"/>` +
      notes
        .map(
          (s, i) =>
            `<text x="${r2(bx + 8)}" y="${r2(by + 15 + i * lineH)}" font-size="9" fill="${HEADER}">${esc(s)}</text>`,
        )
        .join('') +
      `</g>`;
  }
  ov += `</g>`;

  return {
    scale,
    panels: [...panels.values()],
    ends,
    findings,
    notes,
    page: enginePage,
    overlayPage,
    routes,
    labels,
    headers,
    doc: outDoc,
    overlay: ov,
    types,
  };
}
