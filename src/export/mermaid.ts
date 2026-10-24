/**
 * Mermaid flowchart export — the text half of the Mermaid round-trip
 * (`src/import/mermaid.ts` is the other). One page becomes one `flowchart`:
 *
 * - nodes → `id["label"]` with the bracket that best matches the shape
 *   (database `[( )]`, circle `(( ))`, hexagon `{{ }}`, diamond `{ }`,
 *   ellipse `( )`); device types ride as Mermaid classes
 *   (`class r1 router`), which the importer reads back as the node type, and
 *   a `classDef` per type keeps the accent colour in Mermaid renderers;
 * - zones → `subgraph` blocks (nested zones nest);
 * - links → `---` (solid), `-.-` (dashed), `===` (thick), labelled with
 *   `|label|`; anchors become small `(( ))` points.
 *
 * Mermaid has no coordinates, layers, port labels or metadata, so those are
 * dropped (the importer re-lays the graph out); see docs/EXPORTS.md.
 * The direction is inferred from the page's geometry (wider than tall → LR).
 *
 * DOM-free and pure.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import type { NodeConfig, ZoneConfig } from '../vendor/topology-ds.js';
import { getNodeType } from '../api/catalog.js';
import { hexColor } from './scene.js';

/** Mermaid-safe identifier, unique within the export. */
function idMaker(): (raw: string) => string {
  const seen = new Map<string, string>();
  const used = new Set<string>();
  return (raw) => {
    const hit = seen.get(raw);
    if (hit) return hit;
    let base = raw.replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z_]/.test(base)) base = `n_${base}`;
    // Mermaid keywords that cannot be node ids.
    if (
      /^(end|subgraph|graph|flowchart|class|classDef|style|click)$/i.test(base)
    )
      base = `${base}_`;
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}_${i}`;
    used.add(id);
    seen.set(raw, id);
    return id;
  };
}

/** A label as a quoted Mermaid string. */
function quote(s: string): string {
  return `"${s.replace(/"/g, '#quot;').replace(/\r?\n/g, '<br/>')}"`;
}

function bracket(n: NodeConfig, label: string): string {
  const q = quote(label);
  switch (n.type) {
    case 'database':
    case 'nas':
      return `[(${q})]`;
    case 'shape:circle':
    case 'cloud':
    case 'saas':
    case 'overlayCloud':
      return `((${q}))`;
    case 'shape:hexagon':
      return `{{${q}}}`;
    case 'shape:diamond':
      return `{${q}}`;
    case 'shape:ellipse':
    case 'host':
    case 'router':
      return `(${q})`;
    default:
      return `[${q}]`;
  }
}

/** Types the bracket alone round-trips (no class needed). */
const BRACKET_TYPES = new Set([
  'shape:rectangle',
  'shape:circle',
  'shape:hexagon',
  'shape:diamond',
  'shape:ellipse',
  'database',
]);

function direction(page: Page): 'LR' | 'TB' {
  if (page.nodes.length < 2) return 'TB';
  const xs = page.nodes.map((n) => n.x);
  const ys = page.nodes.map((n) => n.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return w > h * 1.2 ? 'LR' : 'TB';
}

/** One page as Mermaid flowchart text. */
export function pageToMermaid(page: Page): string {
  const mid = idMaker();
  const lines: string[] = [`flowchart ${direction(page)}`];
  const zones = page.zones ?? [];
  const zoneIds = new Set(zones.map((z) => z.id));

  // Each node is declared once, inside its innermost zone.
  const depth = (z: ZoneConfig, guard = 0): number =>
    z.parentZone && zoneIds.has(z.parentZone) && guard < 32
      ? depth(zones.find((p) => p.id === z.parentZone)!, guard + 1) + 1
      : 0;
  const homeOf = new Map<string, string>();
  for (const z of zones)
    for (const id of z.nodes ?? []) {
      const prev = homeOf.get(id);
      if (!prev || depth(z) > depth(zones.find((p) => p.id === prev)!))
        homeOf.set(id, z.id);
    }

  const nodeLine = (n: NodeConfig): string => {
    const label = [n.label, n.sublabel].filter(Boolean).join('\n') || n.id;
    return `${mid(n.id)}${bracket(n, label)}`;
  };
  const emitZone = (z: ZoneConfig, indent: string): void => {
    lines.push(
      `${indent}subgraph ${mid(`zone_${z.id}`)} [${quote(z.label ?? z.id)}]`,
    );
    for (const n of page.nodes)
      if (homeOf.get(n.id) === z.id) lines.push(`${indent}  ${nodeLine(n)}`);
    for (const c of zones)
      if (c.parentZone === z.id && c.id !== z.id) emitZone(c, `${indent}  `);
    lines.push(`${indent}end`);
  };
  for (const n of page.nodes)
    if (!homeOf.has(n.id)) lines.push(`  ${nodeLine(n)}`);
  for (const z of zones)
    if (!z.parentZone || !zoneIds.has(z.parentZone)) emitZone(z, '  ');
  const used = new Set(page.links.flatMap((l) => [l.from, l.to]));
  for (const a of page.anchors ?? [])
    if (used.has(a.id)) lines.push(`  ${mid(a.id)}(( ))`);

  const known = new Set([
    ...page.nodes.map((n) => n.id),
    ...(page.anchors ?? []).map((a) => a.id),
  ]);
  for (const l of page.links) {
    if (!known.has(l.from) || !known.has(l.to)) continue;
    const dashed =
      l.dashed === true || l.type === 'tunnel' || l.type === 'wireguard';
    const thick = Number(l.strokeWidth) >= 3;
    const op = dashed ? '-.-' : thick ? '===' : '---';
    const label = l.label ? `|${quote(l.label)}|` : '';
    lines.push(`  ${mid(l.from)} ${op}${label} ${mid(l.to)}`);
  }

  // Device types as classes (read back by the importer) + accent colours.
  const byType = new Map<string, { ids: string[]; color?: string }>();
  for (const n of page.nodes) {
    if (BRACKET_TYPES.has(n.type) || !getNodeType(n.type)) continue;
    if (!/^[A-Za-z][\w-]*$/.test(n.type)) continue;
    const slot = byType.get(n.type) ?? { ids: [] };
    slot.ids.push(mid(n.id));
    if (!slot.color && typeof n.color === 'string')
      slot.color = hexColor(n.color, '');
    byType.set(n.type, slot);
  }
  for (const [type, { ids, color }] of byType) {
    if (color)
      lines.push(`  classDef ${type} stroke:${color},stroke-width:2px`);
    lines.push(`  class ${ids.join(',')} ${type}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * The document as Mermaid. Mermaid has one graph per file, so a multi-page
 * document yields one flowchart per page separated by a `%% page:` comment
 * line; `pageIndex` picks a single page.
 */
export function documentToMermaid(
  doc: TopologyDocument,
  pageIndex?: number,
): string {
  if (pageIndex !== undefined) {
    const page = doc.pages[pageIndex];
    if (!page) throw new Error(`page index ${pageIndex} out of range`);
    return pageToMermaid(page);
  }
  if (doc.pages.length === 1) return pageToMermaid(doc.pages[0]!);
  return doc.pages
    .map(
      (p) => `%% page: ${p.name.replace(/\r?\n/g, ' ')}\n${pageToMermaid(p)}`,
    )
    .join('\n');
}
