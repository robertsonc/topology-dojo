/**
 * Compact, token-cheap views of catalog models for agents (hw-catalog
 * Phase 3: `list_hardware`, `describe_hardware`). Pure; never returns raw
 * panel geometry, and never returns provenance sources (they can name
 * internal documents) — only tiers.
 */
import {
  CAGE_KINDS,
  DATA_ROLES,
  gaEligible,
  type Catalog,
  type Model,
  type PhysicalPort,
} from './catalog.js';

/** Display name of a physical port kind ("SFP56", "RJ45"). */
const KIND_LABEL: Record<string, string> = {
  rj45: 'RJ45',
  sfp: 'SFP',
  sfp_plus: 'SFP+',
  sfp28: 'SFP28',
  sfp56: 'SFP56',
  qsfp_plus: 'QSFP+',
  qsfp28: 'QSFP28',
  qsfp56: 'QSFP56',
  qsfp_dd: 'QSFP-DD',
  osfp: 'OSFP',
  usb_a: 'USB-A',
  usb_c: 'USB-C',
  usb_micro: 'micro-USB',
  usb_mini: 'mini-USB',
  console_rj45: 'RJ45 console',
};
const kindLabel = (k: string): string => KIND_LABEL[k] ?? k.toUpperCase();

/** One speed in Mb/s as "100M" / "1G" / "2.5G". */
export function speedLabel(mbps: number): string {
  return mbps >= 1000 ? `${mbps / 1000}G` : `${mbps}M`;
}

/**
 * A speed set as one compact label: sub-gigabit speeds are dropped when the
 * port also runs at 1G or more (a 10/100/1000 copper port reads "1G"); more
 * than one remaining speed is a range ("1-50G").
 */
export function speedsLabel(speeds: readonly number[]): string {
  if (!speeds.length) return '';
  const all = [...new Set(speeds)].sort((a, b) => a - b);
  const top = all.filter((s) => s >= 1000);
  const use = top.length ? top : all;
  if (use.length === 1) return speedLabel(use[0]!);
  const lo = use[0]!;
  const hi = use[use.length - 1]!;
  if (lo >= 1000 && hi >= 1000) return `${lo / 1000}-${hi / 1000}G`;
  return `${speedLabel(lo)}-${speedLabel(hi)}`;
}

/**
 * Collapse interface names into ranges: lan0, lan1, wan0, wan1 →
 * "lan0-1,wan0-1"; 1/1/1 … 1/1/24 → "1/1/1-24". A run is the same prefix
 * with consecutive trailing numbers, in the order given.
 */
export function collapseNames(names: readonly string[]): string {
  const out: string[] = [];
  let prefix: string | null = null;
  let start = 0;
  let end = 0;
  const flush = (): void => {
    if (prefix === null) return;
    out.push(start === end ? `${prefix}${start}` : `${prefix}${start}-${end}`);
    prefix = null;
  };
  for (const name of names) {
    const m = /^(.*?)(\d+)$/.exec(name);
    if (!m) {
      flush();
      out.push(name);
      continue;
    }
    const [, p, digits] = m as unknown as [string, string, string];
    const n = Number(digits);
    // Leading zeros ("ge-0/0/01") are not a numeric run.
    if (digits.length > 1 && digits.startsWith('0')) {
      flush();
      out.push(name);
      continue;
    }
    if (prefix === p && n === end + 1) end = n;
    else {
      flush();
      prefix = p;
      start = end = n;
    }
  }
  flush();
  return out.join(',');
}

interface PortGroup {
  role: string;
  kind: string;
  speeds: number[];
  names: string[];
  tiers: Set<string>;
}

/** Interfaces grouped by role + physical kind + speeds, in catalog order. */
function groups(catalog: Catalog, model: Model): PortGroup[] {
  const phys = new Map<string, PhysicalPort>(
    catalog.platformFor(model.id).ports.map((p) => [p.id, p]),
  );
  const byKey = new Map<string, PortGroup>();
  for (const row of model.interfaces) {
    const kind = phys.get(row.physical)?.kind ?? 'unknown';
    const speeds = [...(row.speeds_mbps ?? [])].sort((a, b) => a - b);
    const k = `${row.role}|${kind}|${speeds.join(',')}`;
    let g = byKey.get(k);
    if (!g) {
      g = { role: row.role, kind, speeds, names: [], tiers: new Set() };
      byKey.set(k, g);
    }
    g.names.push(row.name);
    const prov =
      row.provenance_ref !== undefined
        ? model.provenance[row.provenance_ref]
        : undefined;
    if (prov) g.tiers.add(prov.tier);
  }
  return [...byKey.values()];
}

/**
 * "4x RJ45 1G (lan0-1,wan0-1)" / "24x RJ45 1G + 4x SFP56 1-50G": the
 * traffic-carrying ports by kind and speed. Names are listed when they are
 * fixed (not `{member}` templates) and few.
 */
export function portSummary(catalog: Catalog, model: Model): string {
  const merged = new Map<
    string,
    { kind: string; speeds: number[]; names: string[] }
  >();
  for (const g of groups(catalog, model)) {
    if (!DATA_ROLES.has(g.role) || g.role === 'mgmt') continue;
    const k = `${g.kind}|${g.speeds.join(',')}`;
    const m = merged.get(k) ?? { kind: g.kind, speeds: g.speeds, names: [] };
    m.names.push(...g.names);
    merged.set(k, m);
  }
  return [...merged.values()]
    .map((m) => {
      const head = `${m.names.length}x ${kindLabel(m.kind)} ${speedsLabel(m.speeds)}`;
      const fixed = !m.names.some((n) => n.includes('{member}'));
      return fixed && m.names.length <= 8
        ? `${head} (${collapseNames(m.names)})`
        : head;
    })
    .join(' + ');
}

export interface HardwareSummary {
  model: string;
  name: string;
  category: Model['category'];
  skus: string[];
  portSummary: string;
  /** Panel position confidence (`traced` / `schematic`). */
  confidence: string;
  gaEligible: boolean;
}

export function hardwareSummary(
  catalog: Catalog,
  model: Model,
): HardwareSummary {
  return {
    model: model.id,
    name: model.name,
    category: model.category,
    skus: (model.skus ?? []).map((s) => s.sku),
    portSummary: portSummary(catalog, model),
    confidence: catalog.platformFor(model.id).position_confidence,
    gaEligible: gaEligible(model),
  };
}

export interface HardwareQuery {
  query?: string;
  vendor?: string;
  family?: string;
  category?: string;
  limit?: number;
}

/** Models matching every given filter, by id; `total` before the limit. */
export function listHardware(
  catalog: Catalog,
  q: HardwareQuery,
): { total: number; models: HardwareSummary[] } {
  const needle = q.query?.trim().toLowerCase();
  const hits = [...catalog.models.values()]
    .filter(
      (m) =>
        (!q.vendor || m.vendor === q.vendor) &&
        (!q.family || m.family === q.family) &&
        (!q.category || m.category === q.category) &&
        (!needle ||
          [m.id, m.name, m.family, ...(m.skus ?? []).map((s) => s.sku)].some(
            (v) => v.toLowerCase().includes(needle),
          )),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    total: hits.length,
    models: hits
      .slice(0, q.limit ?? 20)
      .map((m) => hardwareSummary(catalog, m)),
  };
}

/** `describe_hardware`: everything an agent needs to wire a model. */
export function describeHardware(catalog: Catalog, modelId: string) {
  const model = catalog.models.get(modelId);
  if (!model)
    throw new Error(
      `unknown hardware model "${modelId}" (catalog ${catalog.version}); list_hardware shows the ids`,
    );
  const platform = catalog.platformFor(model.id);
  const tiers: Record<string, number> = {};
  for (const p of model.provenance) tiers[p.tier] = (tiers[p.tier] ?? 0) + 1;
  return {
    ...hardwareSummary(catalog, model),
    vendor: model.vendor,
    family: model.family,
    os: model.os,
    lifecycle: model.lifecycle ?? 'unknown',
    formFactor: platform.form_factor,
    ...(model.skus?.length
      ? {
          skuVariants: model.skus.map((s) => ({
            sku: s.sku,
            variant: s.variant,
          })),
        }
      : {}),
    ...(model.stackable
      ? {
          stackable: {
            tech: model.stackable.tech,
            maxMembers: model.stackable.max_members,
          },
        }
      : {}),
    interfaces: groups(catalog, model).map((g) => ({
      role: g.role,
      kind: kindLabel(g.kind),
      cage: CAGE_KINDS.has(g.kind),
      ...(g.speeds.length ? { speeds: speedsLabel(g.speeds) } : {}),
      count: g.names.length,
      names: collapseNames(g.names),
      tiers: [...g.tiers].sort(),
    })),
    ...(model.stackable &&
    model.interfaces.some((i) => i.name.includes('{member}'))
      ? {
          memberNote: `{member} is the ${model.stackable.tech} member number, 1-${model.stackable.max_members} (limited by the node's stackMembers)`,
        }
      : {}),
    bondGroups: (model.bond_groups ?? []).map((b) => ({
      name: b.name,
      members: b.members,
      lacp: b.lacp,
      ...(b.note ? { note: b.note } : {}),
    })),
    provenanceTiers: tiers,
    todo: model.todo ?? [],
    catalogVersion: catalog.version,
  };
}
