/**
 * Mermaid flowchart import — a pragmatic, dependency-free parser for the
 * `flowchart` / `graph` subset (the overwhelmingly common Mermaid dialect):
 * node definitions with shape brackets, edges (with labels, dashed/thick
 * variants, chains, and `&` fan-out), and `subgraph … end` blocks (mapped to
 * zones). Everything else (classDef/class/style/click/linkStyle/comments/
 * direction statements) is skipped, with a warning for lines that look like
 * content but could not be parsed.
 *
 * The output document has no meaningful coordinates — the caller runs the
 * hierarchical auto-layout (honouring the diagram's TD/LR direction) + tidy,
 * exactly like an agent building via MCP would.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import type {
  LinkConfig,
  NodeConfig,
  ZoneConfig,
} from '../vendor/topology-ds.js';
import { layoutPage } from '../api/autolayout.js';

export interface MermaidConvertResult {
  ok: boolean;
  document?: TopologyDocument;
  warnings: string[];
  error?: string;
}

/** True when the text looks like a Mermaid flowchart (header line). */
export function detectMermaid(text: string): boolean {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    return /^(flowchart|graph)\b/i.test(line);
  }
  return false;
}

/** Mermaid shape brackets → the closest Topology Dojo vocabulary. */
const SHAPES: {
  open: string;
  close: string;
  type: string;
}[] = [
  // Order matters: longer/more specific brackets first.
  { open: '[(', close: ')]', type: 'database' },
  { open: '((', close: '))', type: 'shape:circle' },
  { open: '{{', close: '}}', type: 'shape:hexagon' },
  { open: '[[', close: ']]', type: 'shape:rectangle' },
  { open: '[/', close: '/]', type: 'shape:rectangle' },
  { open: '[\\', close: '\\]', type: 'shape:rectangle' },
  { open: '>', close: ']', type: 'shape:rectangle' },
  { open: '{', close: '}', type: 'shape:diamond' },
  { open: '(', close: ')', type: 'shape:ellipse' },
  { open: '[', close: ']', type: 'shape:rectangle' },
];

interface ParsedNode {
  id: string;
  label?: string;
  type?: string;
}

/** Parse one node token: `id`, or `id<bracket>label<bracket>`. */
function parseNodeToken(token: string): ParsedNode | null {
  const m = /^\s*([A-Za-z0-9_.-]+)\s*(.*)$/.exec(token.trim());
  if (!m) return null;
  const id = m[1]!;
  const rest = (m[2] ?? '').trim();
  if (!rest) return { id };
  for (const s of SHAPES) {
    if (rest.startsWith(s.open) && rest.endsWith(s.close)) {
      let label = rest
        .slice(s.open.length, rest.length - s.close.length)
        .trim();
      // Strip one layer of quoting (Mermaid allows "..." for special chars).
      if (label.startsWith('"') && label.endsWith('"'))
        label = label.slice(1, -1);
      return { id, label, type: s.type };
    }
  }
  return null; // trailing junk we don't understand — caller warns
}

interface ParsedEdge {
  dashed?: boolean;
  thick?: boolean;
  label?: string;
}

/**
 * Edge operators. The inline-label forms (`-- text -->`, `== text ==>`,
 * `-. text .->`) must be tried BEFORE the bare operators, or `--` would
 * greedily match and turn the label text into a node.
 * Groups: 1/2/3 = inline labels (plain/thick/dashed); 4 = bare operator;
 * 5 = pipe label after a bare operator.
 */
const EDGE_RE =
  /^\s*(?:--\s+([^->][^]*?)\s+-->|==\s+([^=>][^]*?)\s+==>|-\.\s+([^.][^]*?)\s+\.->|(-{2,3}>|={2,3}>|-\.{1,3}->|-{2,3}|={2,3})(?:\|([^|]*)\|)?)\s*/;

function edgeInfo(m: RegExpExecArray): ParsedEdge {
  const label = m[5] ?? m[1] ?? m[2] ?? m[3];
  const dashed = m[3] !== undefined || (m[4]?.includes('.') ?? false);
  const thick = m[2] !== undefined || (m[4]?.startsWith('=') ?? false);
  return {
    ...(dashed ? { dashed: true } : {}),
    ...(thick ? { thick: true } : {}),
    ...(label !== undefined && label.trim() ? { label: label.trim() } : {}),
  };
}

/** Convert Mermaid flowchart text into a laid-out TopologyDocument. */
export function convertMermaid(
  text: string,
  title?: string,
): MermaidConvertResult {
  if (!detectMermaid(text))
    return {
      ok: false,
      warnings: [],
      error:
        'not a Mermaid flowchart — the first content line must start with "flowchart" or "graph"',
    };

  const warnings: string[] = [];
  const nodes = new Map<string, NodeConfig>();
  const links: LinkConfig[] = [];
  const zones: ZoneConfig[] = [];
  /** Stack of open subgraphs (nested subgraphs join the innermost). */
  const zoneStack: ZoneConfig[] = [];
  let direction: 'TB' | 'LR' = 'TB';
  let linkSeq = 0;

  const ensureNode = (p: ParsedNode): void => {
    const existing = nodes.get(p.id);
    if (existing) {
      // A later definition can add the label/shape a bare reference lacked.
      if (p.label !== undefined) existing.label = p.label;
      if (p.type !== undefined) existing.type = p.type;
    } else {
      nodes.set(p.id, {
        id: p.id,
        type: p.type ?? 'shape:rectangle',
        x: 0,
        y: 0,
        label: p.label ?? p.id,
      });
    }
    const zone = zoneStack[zoneStack.length - 1];
    if (zone && !zone.nodes.includes(p.id)) zone.nodes.push(p.id);
  };

  /** Split a statement side on `&` (fan-in/fan-out lists). */
  const parseSide = (side: string, lineNo: number): ParsedNode[] => {
    const out: ParsedNode[] = [];
    for (const tok of splitAmp(side)) {
      const n = parseNodeToken(tok);
      if (n) out.push(n);
      else
        warnings.push(`line ${lineNo}: could not parse node "${tok.trim()}"`);
    }
    return out;
  };

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let line = lines[i]!.trim();
    if (!line || line.startsWith('%%')) continue;
    line = line.replace(/;$/, '');

    // Header (may carry the direction).
    const header = /^(?:flowchart|graph)\s*(TB|TD|BT|LR|RL)?\s*$/i.exec(line);
    if (header) {
      const d = (header[1] ?? 'TB').toUpperCase();
      direction = d === 'LR' || d === 'RL' ? 'LR' : 'TB';
      if (d === 'BT' || d === 'RL')
        warnings.push(
          `line ${lineNo}: direction ${d} approximated as ${direction}`,
        );
      continue;
    }
    // Subgraph blocks → zones.
    const sub = /^subgraph\s+([A-Za-z0-9_.-]+)?\s*(?:\[([^\]]*)\])?\s*$/i.exec(
      line,
    );
    if (sub) {
      const id = sub[1] ?? `sg${zones.length + 1}`;
      let label = sub[2] ?? sub[1] ?? `Group ${zones.length + 1}`;
      if (label.startsWith('"') && label.endsWith('"'))
        label = label.slice(1, -1);
      const zone: ZoneConfig = { id: `zone_${id}`, label, nodes: [] };
      zones.push(zone);
      zoneStack.push(zone);
      continue;
    }
    if (/^end$/i.test(line)) {
      if (zoneStack.length === 0)
        warnings.push(`line ${lineNo}: "end" with no open subgraph`);
      else zoneStack.pop();
      continue;
    }
    // Directives we deliberately skip.
    if (
      /^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/i.test(
        line,
      )
    ) {
      warnings.push(
        `line ${lineNo}: "${line.split(/\s/)[0]}" not supported — skipped`,
      );
      continue;
    }

    // Statement: node (edge node)*.
    let rest = line;
    const firstEdge = findEdge(rest);
    if (!firstEdge) {
      // A standalone node definition.
      const n = parseNodeToken(rest);
      if (n) ensureNode(n);
      else warnings.push(`line ${lineNo}: could not parse "${rest}"`);
      continue;
    }
    let prev = parseSide(rest.slice(0, firstEdge.index), lineNo);
    prev.forEach(ensureNode);
    rest = rest.slice(firstEdge.index);
    while (rest.length > 0) {
      const em = EDGE_RE.exec(rest);
      if (!em) break;
      const edge = edgeInfo(em);
      rest = rest.slice(em[0].length);
      const nextEdge = findEdge(rest);
      const sideText = nextEdge ? rest.slice(0, nextEdge.index) : rest;
      const next = parseSide(sideText, lineNo);
      next.forEach(ensureNode);
      for (const a of prev)
        for (const b of next)
          links.push({
            id: `l${++linkSeq}`,
            type: 'line',
            from: a.id,
            to: b.id,
            ...(edge.label ? { label: edge.label } : {}),
            ...(edge.dashed ? { dashed: true } : {}),
            ...(edge.thick ? { strokeWidth: 3 } : {}),
          });
      prev = next;
      rest = nextEdge ? rest.slice(nextEdge.index) : '';
    }
  }

  if (zoneStack.length > 0)
    warnings.push(`${zoneStack.length} subgraph(s) never closed with "end"`);
  if (nodes.size === 0)
    return { ok: false, warnings, error: 'no nodes found in the flowchart' };

  const page: Page = {
    id: 'p1',
    name: 'Imported flowchart',
    viewBox: '0 0 1050 700',
    nodes: [...nodes.values()],
    links,
    anchors: [],
    zones: zones.filter((z) => z.nodes.length > 0),
    flowPaths: [],
    policyMarkers: [],
  };
  layoutPage(page, { algorithm: 'hierarchical', direction });

  return {
    ok: true,
    warnings,
    document: {
      title: title ?? 'Imported Mermaid flowchart',
      pages: [page],
      customNodes: [],
    },
  };
}

/** Index of the next edge operator in a statement, or null. */
function findEdge(s: string): { index: number } | null {
  const m = /-{2,3}>?|={2,3}>?|-\.{1,3}->/.exec(s);
  return m ? { index: m.index } : null;
}

/** Split on top-level `&` (not inside brackets/quotes). */
function splitAmp(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted) {
      if ('[({'.includes(ch)) depth++;
      if ('])}'.includes(ch)) depth = Math.max(0, depth - 1);
      if (ch === '&' && depth === 0) {
        out.push(cur);
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.filter((t) => t.trim());
}
