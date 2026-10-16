/**
 * Derived port tables (proposal 0008, W5) — the cabling crew's work order
 * beside each device: `Port | LAG | PHY | Peer|Port`, built from the links
 * that touch the node exactly the way the legend is built from the symbols
 * in use. Nothing is authored twice: the port names are the links'
 * endpoint labels, the LAG column is their bundle names, PHY is the link
 * style's Key label (or `bandwidth`), the peer is the far node's label and
 * far port. Rows sort naturally (xe-0/0/8 before xe-0/0/10).
 *
 * A table is drawn in the page margin on the node's `portTable.side`
 * (west / east), vertically centred on the node and stacked so tables on
 * one side never overlap, kept inside the sheet border and clear of the
 * legend / title block in that corner. Document overlay like the legend,
 * so canvas, exports and the headless render agree; the layout analyzer
 * and the tiered layout read the same boxes.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';
import type { BoundsRect } from '../api/geometry.js';
import { findLinkStyle, linkStyleLabel } from '../api/link-styles.js';
import { bundleKind, endBundle } from '../api/bundles.js';
import { sheetInset } from '../api/sheet.js';
import { legendBox } from '../editor/legend.js';
import { titleBlockBox } from './sheet.js';

export const PORT_TABLE_SIDES = ['w', 'e'] as const;
export type PortTableSide = (typeof PORT_TABLE_SIDES)[number];

export interface PortTableConfig {
  /** Draw the table (the object's presence with show !== false). */
  show?: boolean;
  /** Which page margin it sits in. Default: the side the node is nearer. */
  side?: PortTableSide;
}

export interface PortTableRow {
  linkId: string;
  port: string;
  bundle: string;
  phy: string;
  peer: string;
}

export interface PortTable {
  nodeId: string;
  title: string;
  side: PortTableSide;
  rows: PortTableRow[];
  /** Column widths (px) in order: port, bundle, phy, peer. */
  cols: [number, number, number, number];
  rect: BoundsRect;
}

/** Table metrics: a 9px title strip, 8px header + body rows. */
export const PORT_TABLE = {
  titleH: 16,
  headerH: 14,
  rowH: 12,
  padX: 6,
  charW: 4.9,
  fontSize: 8,
  /** Vertical gap between stacked tables on one side. */
  gap: 10,
  /** Gap kept from the legend / title block in the same corner. */
  cornerGap: 10,
} as const;

const HEADERS = ['Port', 'LAG', 'PHY', 'Peer | Port'] as const;

/** The table config of a node, or null when off. */
export function portTableOf(node: NodeConfig): PortTableConfig | null {
  const pt = node.portTable;
  if (!pt || typeof pt !== 'object') return null;
  const cfg = pt as PortTableConfig;
  return cfg.show === false ? null : cfg;
}

/** Natural compare: digit runs compare numerically (xe-0/0/8 < xe-0/0/10). */
export function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const ta = a.match(re) ?? [];
  const tb = b.match(re) ?? [];
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const x = ta[i]!;
    const y = tb[i]!;
    const nx = /^\d/.test(x);
    const ny = /^\d/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return d;
    } else {
      const d = x.localeCompare(y);
      if (d) return d;
    }
  }
  return ta.length - tb.length;
}

/** The rows of a node's table from the links touching it, naturally sorted. */
export function portTableRows(
  doc: TopologyDocument,
  page: Page,
  node: NodeConfig,
): PortTableRow[] {
  const nodes = new Map(page.nodes.map((n) => [n.id, n]));
  const rows: PortTableRow[] = [];
  const text = (v: unknown): string =>
    typeof v === 'string' && v.trim() ? v.trim() : '';
  for (const l of page.links as LinkConfig[]) {
    const ends: ('from' | 'to')[] = [];
    if (l.from === node.id) ends.push('from');
    if (l.to === node.id) ends.push('to');
    for (const end of ends) {
      const far = end === 'from' ? 'to' : 'from';
      const port = text(end === 'from' ? l.fromLabel : l.toLabel) || '-';
      const bundleName = endBundle(l, end);
      const bundleDef = bundleName
        ? doc.bundles?.find((b) => b.id === bundleName)
        : undefined;
      const bundle = bundleName
        ? bundleKind(doc.bundles, bundleName) === 'icl'
          ? '-'
          : (bundleDef?.label ?? bundleName)
        : '-';
      const style = findLinkStyle(doc.linkStyles, l.style);
      const phy = style
        ? linkStyleLabel(style)
        : text(l.bandwidth) || text(l.transport) || '-';
      const farNode = nodes.get(l[far]);
      const farName = farNode ? text(farNode.label) || farNode.id : l[far];
      const farPort = text(far === 'from' ? l.fromLabel : l.toLabel);
      const icl =
        bundleName && bundleKind(doc.bundles, bundleName) === 'icl'
          ? ' (ICL)'
          : '';
      rows.push({
        linkId: l.id,
        port,
        bundle,
        phy,
        peer: `${farName}${farPort ? ` | ${farPort}` : ''}${icl}`,
      });
    }
  }
  rows.sort(
    (a, b) =>
      naturalCompare(a.port, b.port) || a.linkId.localeCompare(b.linkId),
  );
  return rows;
}

function colWidths(rows: PortTableRow[]): [number, number, number, number] {
  const keys = ['port', 'bundle', 'phy', 'peer'] as const;
  return keys.map((k, i) => {
    const longest = rows.reduce(
      (m, r) => Math.max(m, r[k].length),
      HEADERS[i]!.length,
    );
    return Math.ceil(longest * PORT_TABLE.charW) + PORT_TABLE.padX * 2;
  }) as [number, number, number, number];
}

/** Every port table on a page, positioned and stacked. */
export function portTables(doc: TopologyDocument, page: Page): PortTable[] {
  const [vx, vy, vw, vh] = page.viewBox.split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const inset = sheetInset(doc.sheet);
  const tables: PortTable[] = [];
  for (const n of page.nodes) {
    const cfg = portTableOf(n);
    if (!cfg) continue;
    const rows = portTableRows(doc, page, n);
    const cols = colWidths(rows);
    const w = cols.reduce((a, b) => a + b, 0);
    const h =
      PORT_TABLE.titleH +
      PORT_TABLE.headerH +
      Math.max(1, rows.length) * PORT_TABLE.rowH +
      4;
    const side: PortTableSide =
      cfg.side === 'w' || cfg.side === 'e'
        ? cfg.side
        : n.x < vx + vw / 2
          ? 'w'
          : 'e';
    const x = side === 'w' ? vx + inset : vx + vw - inset - w;
    const title =
      typeof n.label === 'string' && n.label.trim() ? n.label.trim() : n.id;
    tables.push({
      nodeId: n.id,
      title,
      side,
      rows,
      cols,
      rect: { x, y: n.y - h / 2, w, h },
    });
  }
  // Stack per side: top → bottom in node order of y, pushed down past the
  // previous table; keep inside the sheet and above the corner panel
  // (legend / title block) on that side.
  const legend = legendBox(doc, page);
  const legendPos = doc.legend?.position ?? 'tl';
  const tb = titleBlockBox(doc, page);
  for (const side of PORT_TABLE_SIDES) {
    const list = tables
      .filter((t) => t.side === side)
      .sort((a, b) => a.rect.y - b.rect.y);
    let floor = vy + vh - inset;
    if (
      legend &&
      ((side === 'w' && legendPos === 'bl') ||
        (side === 'e' && legendPos === 'br'))
    )
      floor = Math.min(
        floor,
        vy + vh - inset - legend.h - PORT_TABLE.cornerGap,
      );
    if (tb && side === 'e')
      floor = Math.min(floor, tb.y - PORT_TABLE.cornerGap);
    let ceiling = vy + inset;
    if (
      legend &&
      ((side === 'w' && legendPos === 'tl') ||
        (side === 'e' && legendPos === 'tr'))
    )
      ceiling = Math.max(ceiling, vy + inset + legend.h + PORT_TABLE.cornerGap);
    let prevBottom = -Infinity;
    for (const t of list) {
      let y = Math.max(t.rect.y, ceiling);
      if (y < prevBottom + PORT_TABLE.gap) y = prevBottom + PORT_TABLE.gap;
      t.rect.y = y;
      prevBottom = y + t.rect.h;
    }
    // Pull the stack up as a whole when it runs past the floor.
    if (list.length) {
      const over = prevBottom - floor;
      if (over > 0)
        for (const t of list) t.rect.y = Math.max(ceiling, t.rect.y - over);
    }
  }
  return tables;
}

/** Width (px) to reserve in each page margin for tables on that side. */
export function portTableReserve(
  doc: TopologyDocument,
  page: Page,
): { left: number; right: number } {
  let left = 0;
  let right = 0;
  for (const t of portTables(doc, page)) {
    const need = t.rect.w + PORT_TABLE.gap + sheetInset(doc.sheet);
    if (t.side === 'w') left = Math.max(left, need);
    else right = Math.max(right, need);
  }
  return { left, right };
}

function escXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

/** The port tables overlay `<g>` for a page, or '' when none. */
export function portTablesSVG(doc: TopologyDocument, page: Page): string {
  const tables = portTables(doc, page);
  if (!tables.length) return '';
  const M = PORT_TABLE;
  let s = `<g class="tds-port-tables" font-family="ui-monospace,monospace">`;
  for (const t of tables) {
    const { x, y, w, h } = t.rect;
    s +=
      `<g data-node-id="${escXml(t.nodeId)}">` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="rgba(20,24,32,0.86)" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>` +
      `<text x="${x + M.padX}" y="${y + 11.5}" font-size="9" font-weight="700" letter-spacing=".5" fill="#01a982">${escXml(t.title)}</text>` +
      `<line x1="${x}" y1="${y + M.titleH}" x2="${x + w}" y2="${y + M.titleH}" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>`;
    let cx = x;
    const hy = y + M.titleH + 10;
    HEADERS.forEach((hdr, i) => {
      s += `<text x="${cx + M.padX}" y="${hy}" font-size="${M.fontSize}" font-weight="700" fill="#b1b9be">${escXml(hdr)}</text>`;
      cx += t.cols[i]!;
    });
    const by = y + M.titleH + M.headerH;
    s += `<line x1="${x}" y1="${by}" x2="${x + w}" y2="${by}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
    t.rows.forEach((r, ri) => {
      const ry = by + ri * M.rowH + 9;
      let rx = x;
      ([r.port, r.bundle, r.phy, r.peer] as const).forEach((cell, i) => {
        s += `<text x="${rx + M.padX}" y="${ry}" font-size="${M.fontSize}" fill="#e6e8e9"${i === 0 ? ' data-link-id="' + escXml(r.linkId) + '"' : ''}>${escXml(cell)}</text>`;
        rx += t.cols[i]!;
      });
    });
    s += `</g>`;
  }
  return s + `</g>`;
}
