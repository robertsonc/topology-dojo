/**
 * CSV import — generate a topology from tabular data (the draw.io/Lucid
 * "diagram from data" entry point, and a natural agent hand-off format).
 *
 * Accepted shapes (RFC-4180-style quoting; header rows required):
 *
 * 1. Two sections, marked by `[nodes]` and `[links]` lines:
 *
 *      [nodes]
 *      id,label,type,zone,x,y,meta.location
 *      core1,Core 1,switchEnterprise,dc,,,Building A
 *      [links]
 *      from,to,type,label,vlan
 *      core1,edge1,line,uplink,100
 *
 * 2. A single edge-list table with `from,to[,...]` headers — nodes are
 *    created implicitly as hosts.
 *
 * Node columns: id (required), label, type (unknown → host + warning),
 * zone (groups rows into zones), x/y (numbers; when absent for any node the
 * whole page is auto-laid-out), plus meta.* columns → node metadata.
 * Link columns: from/to (required), type (unknown → line + warning), label,
 * and any of vlan/subnet/bandwidth/transport.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import type {
  LinkConfig,
  NodeConfig,
  ZoneConfig,
} from '../vendor/topology-ds.js';
import { isBuiltinNodeType, isLinkType } from '../api/builtins.js';
import { isStockNodeType } from '../nodes/stock.js';
import { layoutPage } from '../api/autolayout.js';

export interface CsvConvertResult {
  ok: boolean;
  document?: TopologyDocument;
  warnings: string[];
  error?: string;
}

/** True when the text looks like importable CSV (not JSON, has a usable header). */
export function detectCsv(text: string): boolean {
  const t = text.trimStart();
  if (!t || t.startsWith('{') || t.startsWith('[{')) return false;
  const first = firstContentLine(text);
  if (!first) return false;
  if (/^\[nodes\]$/i.test(first)) return true;
  const cells = parseLine(first).map((c) => c.trim().toLowerCase());
  return cells.includes('from') && cells.includes('to');
}

function firstContentLine(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line && !line.startsWith('#')) return line;
  }
  return null;
}

/** Parse one CSV line (RFC-4180 quotes, `""` escapes). */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

interface Row {
  lineNo: number;
  cells: Record<string, string>;
}

/** Rows under a header, keyed by lower-cased header names. */
function tableRows(lines: { lineNo: number; text: string }[]): {
  header: string[];
  rows: Row[];
} {
  if (lines.length === 0) return { header: [], rows: [] };
  const header = parseLine(lines[0]!.text).map((h) => h.trim().toLowerCase());
  const rows: Row[] = [];
  for (const { lineNo, text } of lines.slice(1)) {
    const cells = parseLine(text);
    const rec: Record<string, string> = {};
    header.forEach((h, i) => {
      if (h) rec[h] = (cells[i] ?? '').trim();
    });
    rows.push({ lineNo, cells: rec });
  }
  return { header, rows };
}

/** Convert CSV text into a laid-out TopologyDocument. */
export function convertCsv(text: string, title?: string): CsvConvertResult {
  const warnings: string[] = [];
  const nodeLines: { lineNo: number; text: string }[] = [];
  const linkLines: { lineNo: number; text: string }[] = [];
  let section: 'nodes' | 'links' | null = null;

  const rawLines = text.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^\[nodes\]$/i.test(line)) {
      section = 'nodes';
      continue;
    }
    if (/^\[links\]$/i.test(line)) {
      section = 'links';
      continue;
    }
    if (section === 'nodes') nodeLines.push({ lineNo: i + 1, text: line });
    else if (section === 'links') linkLines.push({ lineNo: i + 1, text: line });
    else linkLines.push({ lineNo: i + 1, text: line }); // bare edge list
  }

  const nodes = new Map<string, NodeConfig>();
  const zones = new Map<string, ZoneConfig>();
  let sawExplicitPositionForAll = nodeLines.length > 1;

  const nodesTable = tableRows(nodeLines);
  if (nodeLines.length > 0 && !nodesTable.header.includes('id'))
    return {
      ok: false,
      warnings,
      error: 'the [nodes] section needs a header row including "id"',
    };
  for (const row of nodesTable.rows) {
    const id = row.cells.id ?? '';
    if (!id) {
      warnings.push(`line ${row.lineNo}: node row without an id — skipped`);
      continue;
    }
    if (nodes.has(id)) {
      warnings.push(`line ${row.lineNo}: duplicate node id "${id}" — skipped`);
      continue;
    }
    let type = row.cells.type || 'host';
    if (!isBuiltinNodeType(type) && !isStockNodeType(type)) {
      warnings.push(
        `line ${row.lineNo}: unknown node type "${type}" — using host`,
      );
      type = 'host';
    }
    const x = Number(row.cells.x);
    const y = Number(row.cells.y);
    const hasPos =
      row.cells.x !== undefined &&
      row.cells.x !== '' &&
      Number.isFinite(x) &&
      row.cells.y !== undefined &&
      row.cells.y !== '' &&
      Number.isFinite(y);
    if (!hasPos) sawExplicitPositionForAll = false;
    const meta: Record<string, string> = {};
    for (const [k, v] of Object.entries(row.cells))
      if (k.startsWith('meta.') && v) meta[k.slice(5)] = v;
    nodes.set(id, {
      id,
      type,
      x: hasPos ? x : 0,
      y: hasPos ? y : 0,
      label: row.cells.label || id,
      ...(Object.keys(meta).length ? { meta } : {}),
    });
    const zoneName = row.cells.zone;
    if (zoneName) {
      const z = zones.get(zoneName) ?? {
        id: `zone_${zoneName.replace(/[^\w-]/g, '_')}`,
        label: zoneName,
        nodes: [],
      };
      z.nodes.push(id);
      zones.set(zoneName, z);
    }
  }

  const links: LinkConfig[] = [];
  const linksTable = tableRows(linkLines);
  if (linkLines.length > 0) {
    if (
      !linksTable.header.includes('from') ||
      !linksTable.header.includes('to')
    )
      return {
        ok: false,
        warnings,
        error: 'the links table needs a header row including "from" and "to"',
      };
    let seq = 0;
    for (const row of linksTable.rows) {
      const from = row.cells.from ?? '';
      const to = row.cells.to ?? '';
      if (!from || !to) {
        warnings.push(`line ${row.lineNo}: link row missing from/to — skipped`);
        continue;
      }
      // Implicit endpoints (edge-list style) become hosts.
      for (const id of [from, to])
        if (!nodes.has(id)) {
          nodes.set(id, { id, type: 'host', x: 0, y: 0, label: id });
          sawExplicitPositionForAll = false;
        }
      let type = row.cells.type || 'line';
      if (!isLinkType(type)) {
        warnings.push(
          `line ${row.lineNo}: unknown link type "${type}" — using line`,
        );
        type = 'line';
      }
      links.push({
        id: `l${++seq}`,
        type,
        from,
        to,
        ...(row.cells.label ? { label: row.cells.label } : {}),
        ...(row.cells.vlan ? { vlan: row.cells.vlan } : {}),
        ...(row.cells.subnet ? { subnet: row.cells.subnet } : {}),
        ...(row.cells.bandwidth ? { bandwidth: row.cells.bandwidth } : {}),
        ...(row.cells.transport ? { transport: row.cells.transport } : {}),
      });
    }
  }

  if (nodes.size === 0)
    return { ok: false, warnings, error: 'no nodes found in the CSV' };

  const page: Page = {
    id: 'p1',
    name: 'Imported data',
    viewBox: '0 0 1050 700',
    nodes: [...nodes.values()],
    links,
    anchors: [],
    zones: [...zones.values()],
    flowPaths: [],
    policyMarkers: [],
  };
  // Only lay out when the data didn't supply a complete coordinate set.
  if (!sawExplicitPositionForAll)
    layoutPage(page, { algorithm: 'hierarchical' });

  return {
    ok: true,
    warnings,
    document: {
      title: title ?? 'Imported CSV topology',
      pages: [page],
      customNodes: [],
    },
  };
}
