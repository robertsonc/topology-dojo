/**
 * Cable schedule (hw-catalog Phase 3): the wire sheet installers actually
 * work from — one row per link, both ends' device / model / interface /
 * optic, the media and negotiated speed the catalog implies, bundle, layer
 * and notes (the link label plus the catalog rule codes on that cable).
 * CSV and XLSX share the rows. Pure; the XLSX is a minimal single-sheet
 * workbook built with the OPC helpers.
 */
import type { TopologyDocument } from '../pages/model.js';
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';
import { endBundle } from '../api/bundles.js';
import { isBound } from '../api/hardware.js';
import type { Catalog } from '../catalog/catalog.js';
import { speedLabel } from '../catalog/describe.js';
import { wiringReport } from '../catalog/validate.js';
import {
  CT,
  REL,
  XML_HEADER,
  contentTypesXml,
  corePropsXml,
  relsXml,
  xmlEsc,
  zipPackage,
} from './opc.js';

export const CABLE_COLUMNS = [
  'cable id',
  'A device',
  'A model',
  'A interface',
  'A optic',
  'Z device',
  'Z model',
  'Z interface',
  'Z optic',
  'media',
  'negotiated speed',
  'bundle',
  'layer',
  'notes',
] as const;

export interface CableSchedule {
  /** `CABLE_COLUMNS`, with a leading "page" column on multi-page exports. */
  columns: string[];
  rows: string[][];
}

const deviceName = (n: NodeConfig | undefined, id: string): string =>
  n?.label?.trim() || id;

function modelName(catalog: Catalog | null, n: NodeConfig | undefined): string {
  if (!n || !isBound(n)) return '';
  const m = catalog?.models.get(n.hw.model);
  const name = m?.name ?? n.hw.model;
  return n.hw.sku ? `${name} (${n.hw.sku})` : name;
}

/** The interface, else the author's port label. */
const endPort = (l: LinkConfig, end: 'from' | 'to'): string =>
  (end === 'from'
    ? l.fromInterface || l.fromLabel
    : l.toInterface || l.toLabel
  )?.trim() ?? '';

/**
 * The schedule for one page, or every page (with a "page" column when the
 * document has more than one). `catalog` is null when none is available;
 * model names then fall back to ids and media / speed stay blank.
 */
export function cableSchedule(
  doc: TopologyDocument,
  catalog: Catalog | null,
  pageIndex?: number,
): CableSchedule {
  if (pageIndex !== undefined && !doc.pages[pageIndex])
    throw new Error(`page index ${pageIndex} out of range`);
  const report = catalog ? wiringReport(doc, catalog) : null;
  const wiring = new Map(
    (report?.links ?? []).map((w) => [`${w.page}|${w.linkId}`, w]),
  );
  const codes = new Map<string, string[]>();
  for (const f of report?.findings ?? []) {
    const m = /^page\[(\d+)\]\.link '([^']*)'/.exec(f.where);
    if (!m) continue;
    const k = `${m[1]}|${m[2]}`;
    const list = codes.get(k) ?? [];
    if (!list.includes(f.code)) list.push(f.code);
    codes.set(k, list);
  }
  const layerName = new Map(
    (doc.layers ?? []).map((l) => [l.id, l.name || l.id]),
  );
  const multi = pageIndex === undefined && doc.pages.length > 1;
  const rows: string[][] = [];
  doc.pages.forEach((page, pi) => {
    if (pageIndex !== undefined && pi !== pageIndex) return;
    const nodes = new Map(page.nodes.map((n) => [n.id, n]));
    for (const l of page.links) {
      const a = nodes.get(l.from);
      const z = nodes.get(l.to);
      const w = wiring.get(`${pi}|${l.id}`);
      const bundles = [endBundle(l, 'from'), endBundle(l, 'to')];
      const notes = [l.label?.trim(), ...(codes.get(`${pi}|${l.id}`) ?? [])]
        .filter(Boolean)
        .join('; ');
      const row = [
        l.id,
        deviceName(a, l.from),
        modelName(catalog, a),
        endPort(l, 'from'),
        l.fromOptic ?? '',
        deviceName(z, l.to),
        modelName(catalog, z),
        endPort(l, 'to'),
        l.toOptic ?? '',
        w?.mediaConflict ? w.mediaConflict.join(' / ') : (w?.media ?? ''),
        w?.speedMbps ? speedLabel(w.speedMbps) : '',
        bundles[0] && bundles[1] && bundles[0] !== bundles[1]
          ? `${bundles[0]} / ${bundles[1]}`
          : (bundles[0] ?? bundles[1] ?? ''),
        l.layer ? (layerName.get(l.layer) ?? l.layer) : '',
        notes,
      ];
      rows.push(multi ? [page.name || String(pi + 1), ...row] : row);
    }
  });
  return {
    columns: multi ? ['page', ...CABLE_COLUMNS] : [...CABLE_COLUMNS],
    rows,
  };
}

/**
 * RFC 4180 CSV. A cell starting with = + - @ (or tab / CR) is prefixed
 * with a quote mark so spreadsheet apps do not evaluate it as a formula —
 * labels come from documents and may be hostile.
 */
export function cableScheduleCsv(s: CableSchedule): string {
  const cell = (v: string): string => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return (
    [s.columns, ...s.rows].map((r) => r.map(cell).join(',')).join('\r\n') +
    '\r\n'
  );
}

/** A1 column letters for a 0-based index. */
function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * A one-sheet .xlsx: bold, frozen header row with an autofilter and widths
 * sized to the content. Every cell is an inline string (never a formula).
 */
export function cableScheduleXlsx(
  s: CableSchedule,
  title: string,
  created?: Date,
): Uint8Array<ArrayBuffer> {
  const all = [s.columns, ...s.rows];
  const widths = s.columns.map((_, c) =>
    Math.min(60, Math.max(8, ...all.map((r) => (r[c] ?? '').length + 2))),
  );
  const last = `${colName(s.columns.length - 1)}${all.length}`;
  const rowsXml = all
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">` +
        r
          .map(
            (v, ci) =>
              `<c r="${colName(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}>` +
              `<is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`,
          )
          .join('') +
        '</row>',
    )
    .join('');
  const sheet =
    XML_HEADER +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rowsXml}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    '</worksheet>';
  const workbook =
    XML_HEADER +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}">` +
    '<sheets><sheet name="Cable schedule" sheetId="1" r:id="rId1"/></sheets>' +
    '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' +
    `'Cable schedule'!$A$1:$${colName(s.columns.length - 1)}$${all.length}` +
    '</definedName></definedNames>' +
    '</workbook>';
  const styles =
    XML_HEADER +
    `<styleSheet xmlns="${NS_MAIN}">` +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
  const SHEET_CT =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
  return zipPackage({
    '[Content_Types].xml': contentTypesXml(
      { rels: CT.rels, xml: CT.xml },
      {
        '/xl/workbook.xml':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
        '/xl/worksheets/sheet1.xml': SHEET_CT,
        '/xl/styles.xml':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
        '/docProps/core.xml': CT.core,
      },
    ),
    '_rels/.rels': relsXml([
      { id: 'rId1', type: REL.officeDocument, target: 'xl/workbook.xml' },
      { id: 'rId2', type: REL.coreProps, target: 'docProps/core.xml' },
    ]),
    'docProps/core.xml': corePropsXml(title, created),
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': relsXml([
      {
        id: 'rId1',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
        target: 'worksheets/sheet1.xml',
      },
      {
        id: 'rId2',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
        target: 'styles.xml',
      },
    ]),
    'xl/worksheets/sheet1.xml': sheet,
    'xl/styles.xml': styles,
  });
}
