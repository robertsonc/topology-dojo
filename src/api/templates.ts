/**
 * Starter templates — common topologies an author (human or agent) can start
 * from instead of a blank page. Each template is just a document built with the
 * headless builder, so it doubles as an MCP scaffold and as a few-shot example.
 *
 * Four of them are PARAMETRIC (Initiative B, re-scoped against the SD-WAN
 * generator): "a spine-leaf fabric with 4 spines and 12 leaves", "hub and
 * spoke with 2 hubs and 9 sites". The contract mirrors `generateSdwan`
 * (src/connect/generate.ts):
 *
 * - every template declares its parameters (`TemplateParamSpec`: name, type,
 *   bounds, default, one line of description) — the one table the MCP
 *   `list_templates` result, the editor's dialog and the tests all read;
 * - `resolveTemplateParams` applies defaults and bounds and throws an error
 *   naming the bad field;
 * - `generateTemplate` returns `{doc, template, params, stats}` and is
 *   deterministic: the same parameters give the same document, apart from the
 *   generated page id.
 *
 * With no parameters a template builds what it always built: the default
 * values reproduce the original fixed layouts coordinate for coordinate, so
 * existing callers do not move. The one exception is the firewall of
 * `firewall-dmz`, whose label now wraps (see `EDGE_LABEL_WIDTH`).
 *
 * The parametric templates compute their own layout (the two fixed ones are
 * still positioned by `layoutDocument`). New pages draw links from an anchor
 * box (`DEFAULT_LINK_ATTACH`), and a wide fan left to route itself leaves its
 * node sideways and runs under the neighbours: so a fan wider than the
 * original template's gets more room and is pinned to the facing sides of its
 * nodes (`fromPort` / `toPort`). `src/api/templates.test.ts` holds every
 * template, at every parameter value, to a clean `validateDocument`,
 * `analyzeLayout` and `inspectPage`.
 */
import { createDocument, type LinkInput } from './builder.js';
import { layoutDocument, type LayoutAlgorithm } from './autolayout.js';
import { LAYOUT_RULES, nodeFootprint, rectGap } from './layout.js';
import type { TopologyDocument } from '../pages/model.js';

/** A whole-number parameter with inclusive bounds. */
export interface IntegerParamSpec {
  /** The key in `params`. */
  name: string;
  /** What a form calls it. */
  label: string;
  type: 'integer';
  min: number;
  max: number;
  default: number;
  /** One line: what the parameter changes. */
  description: string;
}

/** An on/off parameter. */
export interface BooleanParamSpec {
  name: string;
  label: string;
  type: 'boolean';
  default: boolean;
  description: string;
}

export type TemplateParamSpec = IntegerParamSpec | BooleanParamSpec;

/** Parameter values by name. */
export type TemplateParams = Record<string, number | boolean>;

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  /** The parameters `buildTemplate` accepts (empty: a fixed template). */
  params: TemplateParamSpec[];
}

export interface TemplateStats {
  nodes: number;
  links: number;
}

export interface TemplateResult {
  doc: TopologyDocument;
  /** The template id the document was built from. */
  template: string;
  /** Every parameter of the template, with defaults applied. */
  params: TemplateParams;
  stats: TemplateStats;
}

interface TemplateDef {
  id: string;
  name: string;
  description: string;
  params: readonly TemplateParamSpec[];
  build: (params: TemplateParams) => TopologyDocument;
}

class TemplateParamError extends Error {}

/** Build a document then position it with a layout algorithm. */
function arranged(
  b: { build: () => TopologyDocument },
  algorithm: LayoutAlgorithm,
  direction?: 'TB' | 'LR',
  spacing?: number,
): TopologyDocument {
  const doc = b.build();
  layoutDocument(doc, {
    algorithm,
    ...(direction ? { direction } : {}),
    ...(spacing !== undefined ? { spacing } : {}),
  });
  return doc;
}

/* ── geometry shared by the parametric templates ──────────────────────── */

/** The builder's standard sheet. A template grows it, never shrinks it. */
const SHEET = { w: 1050, h: 700 } as const;

const up10 = (v: number): number => Math.ceil(v / 10) * 10;

/** A viewBox at least as large as the standard sheet. */
function sheet(
  w: number,
  h: number,
): { w: number; h: number; viewBox: string } {
  const sw = Math.max(SHEET.w, up10(w));
  const sh = Math.max(SHEET.h, up10(h));
  return { w: sw, h: sh, viewBox: `0 0 ${sw} ${sh}` };
}

/** Position `i` of `count` items `pitch` apart, centred on `centre`. */
const along = (
  centre: number,
  i: number,
  count: number,
  pitch: number,
): number => Math.round(centre + (i - (count - 1) / 2) * pitch);

/** `base` alone, or `base1…baseN`: one of a kind keeps its plain name. */
function numbered(
  base: string,
  label: string,
  count: number,
): { id: string; label: string }[] {
  if (count === 1) return [{ id: base, label }];
  return Array.from({ length: count }, (_, i) => ({
    id: `${base}${i + 1}`,
    label: `${label} ${i + 1}`,
  }));
}

/** Pin a link to the facing sides of its two nodes. */
const DOWN = { fromPort: 's', toPort: 'n' } as const;
const RIGHT = { fromPort: 'e', toPort: 'w' } as const;

/* ── three-tier ───────────────────────────────────────────────────────── */

const TIER = {
  /** Node to node within a tier. */
  pitch: 88,
  /** Tier to tier while the links between them route themselves. */
  gap: 96,
  /** Tier to tier under a pinned fan: at least this… */
  fanGap: 130,
  /** …or the plain gap plus this share of the fan's sideways run. */
  fanSlope: 0.3,
  /** Page edge to the first and last tier. */
  margin: 110,
} as const;

function buildThreeTier(p: TemplateParams): TopologyDocument {
  const web = numbered('web', 'Web', p.webServers as number);
  const app = numbered('app', 'App', p.appServers as number);
  const tiers: { type: string; nodes: { id: string; label: string }[] }[] = [
    { type: 'host', nodes: [{ id: 'users', label: 'Users' }] },
    { type: 'firewall', nodes: [{ id: 'fw', label: 'Firewall' }] },
    { type: 'server', nodes: web },
    { type: 'apps', nodes: app },
    { type: 'database', nodes: [{ id: 'db', label: 'Database' }] },
  ];
  // Two tiers joined by more than a two-way fan are a wide fan or a mesh:
  // pinned, and further apart the further its links run sideways.
  const joins = tiers.slice(1).map((lower, i) => {
    const upper = tiers[i]!;
    const pinned = upper.nodes.length * lower.nodes.length > 2;
    const run =
      ((upper.nodes.length + lower.nodes.length - 2) * TIER.pitch) / 2;
    return {
      pinned,
      gap: pinned
        ? Math.max(TIER.fanGap, Math.round(TIER.gap + TIER.fanSlope * run))
        : TIER.gap,
    };
  });
  const depth = joins.reduce((sum, j) => sum + j.gap, 0);
  const page = sheet(SHEET.w, depth + 2 * TIER.margin);

  const b = createDocument('Three-tier web app').page({ name: 'Three-tier' });
  b.viewBox(page.viewBox);
  let y = (page.h - depth) / 2;
  tiers.forEach((tier, t) => {
    tier.nodes.forEach((n, i) =>
      b.node({
        id: n.id,
        type: tier.type,
        x: along(page.w / 2, i, tier.nodes.length, TIER.pitch),
        y: Math.round(y),
        label: n.label,
      }),
    );
    y += joins[t]?.gap ?? 0;
  });
  let link = 0;
  joins.forEach((join, t) => {
    for (const from of tiers[t]!.nodes)
      for (const to of tiers[t + 1]!.nodes)
        b.link({
          id: `l${++link}`,
          type: 'line',
          from: from.id,
          to: to.id,
          ...(join.pinned ? DOWN : {}),
        });
  });
  return b.build();
}

/* ── firewall + DMZ ───────────────────────────────────────────────────── */

/** DMZ servers in the order they are added. */
const DMZ_SERVERS: readonly { id: string; label: string }[] = [
  { id: 'web', label: 'DMZ web' },
  { id: 'mail', label: 'DMZ mail' },
  { id: 'dns', label: 'DMZ DNS' },
  { id: 'proxy', label: 'DMZ proxy' },
  { id: 'vpn', label: 'DMZ VPN' },
  { id: 'ftp', label: 'DMZ FTP' },
];

const DMZ = {
  /** Column to column, left to right. */
  column: 146,
  /** Node to node down the column behind the firewall. */
  row: 100,
  /** Page edge to the ends of that column. */
  margin: 90,
  /** Legs the firewall's fan routes cleanly on its own (the original's). */
  freeLegs: 3,
} as const;

/**
 * Wraps "Edge firewall" / "Internal firewall" onto two lines. On one line the
 * label is wider than the node's anchor box, and the firewall's fan runs
 * through the part that sticks out (the original template failed
 * `inspect_render` on exactly that).
 */
const EDGE_LABEL_WIDTH = 60;

function buildFirewallDmz(p: TemplateParams): TopologyDocument {
  const servers = DMZ_SERVERS.slice(0, p.dmzServers as number);
  const internalFirewall = p.internalFirewall as boolean;
  const columns = internalFirewall ? 5 : 4;
  const page = sheet(SHEET.w, servers.length * DMZ.row + 2 * DMZ.margin);
  const cy = page.h / 2;
  const x = (c: number): number => along(page.w / 2, c, columns, DMZ.column);
  // The column behind the firewall: the DMZ servers, then the way inside.
  const stackY = (k: number): number =>
    along(cy, k, servers.length + 1, DMZ.row);
  const insideY = stackY(servers.length);
  const inside = internalFirewall ? 'ifw' : 'core';

  const b = createDocument('Firewall + DMZ').page({ name: 'DMZ' });
  b.viewBox(page.viewBox);
  b.node({ id: 'inet', type: 'cloud', x: x(0), y: cy, label: 'Internet' });
  b.node({
    id: 'fw',
    type: 'firewall',
    x: x(1),
    y: cy,
    label: 'Edge firewall',
    labelWidth: EDGE_LABEL_WIDTH,
  });
  servers.forEach((s, k) =>
    b.node({ id: s.id, type: 'server', x: x(2), y: stackY(k), label: s.label }),
  );
  if (internalFirewall)
    b.node({
      id: 'ifw',
      type: 'firewall',
      x: x(2),
      y: insideY,
      label: 'Internal firewall',
      labelWidth: EDGE_LABEL_WIDTH,
    });
  // The core takes the way-inside slot, or sits beside the internal firewall;
  // the internal network is always one step up and right of the core.
  const core = internalFirewall ? 3 : 2;
  b.node({
    id: 'core',
    type: 'switchEnterprise',
    x: x(core),
    y: insideY,
    label: 'Core',
  });
  b.node({
    id: 'lan',
    type: 'host',
    x: x(core + 1),
    y: insideY - DMZ.row,
    label: 'Internal',
  });

  const pin = servers.length + 1 > DMZ.freeLegs ? RIGHT : {};
  let link = 0;
  const wire = (from: string, to: string, extra: object = {}): void => {
    b.link({ id: `l${++link}`, type: 'line', from, to, ...extra });
  };
  wire('inet', 'fw');
  for (const s of servers) wire('fw', s.id, pin);
  wire('fw', inside, pin);
  if (internalFirewall) wire('ifw', 'core');
  wire('core', 'lan');
  return b.build();
}

/* ── spine-leaf ───────────────────────────────────────────────────────── */

const FABRIC = {
  /** Leaf to leaf: as wide as the standard sheet allows, within these. */
  leafPitch: { min: 120, max: 188 },
  /** Width of the standard sheet a leaf row may fill. */
  leafRow: 830,
  /** Spine to spine, at least. */
  spinePitch: 188,
  /** A fabric this small routes its own uplinks (the original layout). */
  free: { spines: 2, leaves: 5 },
  /** Spine row to leaf row while the uplinks route themselves. */
  rowGap: 148,
  /** …and under pinned uplinks: a share of the leaf row, within these. */
  fanGap: { min: 180, max: 320, perWidth: 0.2 },
  /** Page edge to the outermost switch. */
  margin: 110,
} as const;

function buildSpineLeaf(p: TemplateParams): TopologyDocument {
  const spines = p.spines as number;
  const leaves = p.leaves as number;
  const leafPitch = Math.min(
    FABRIC.leafPitch.max,
    Math.max(FABRIC.leafPitch.min, Math.floor(FABRIC.leafRow / (leaves - 1))),
  );
  const leafRow = (leaves - 1) * leafPitch;
  // Spines spread evenly over the leaf row, so no uplink runs its full width.
  const spinePitch = Math.max(
    FABRIC.spinePitch,
    Math.round(leafRow / (spines + 1)),
  );
  // Past two spines or five leaves the far uplinks would leave their spine
  // sideways and run under the next one: pin them spine-south to leaf-north,
  // and give the fan more height the wider it is.
  const pinned = spines > FABRIC.free.spines || leaves > FABRIC.free.leaves;
  const rowGap = pinned
    ? Math.min(
        FABRIC.fanGap.max,
        Math.max(
          FABRIC.fanGap.min,
          Math.round(FABRIC.fanGap.perWidth * leafRow),
        ),
      )
    : FABRIC.rowGap;
  const page = sheet(
    Math.max(leafRow, (spines - 1) * spinePitch) + 2 * FABRIC.margin,
    SHEET.h,
  );
  const spineY = Math.round((page.h - rowGap) / 2);

  const b = createDocument('Spine-leaf fabric').page({ name: 'Fabric' });
  b.viewBox(page.viewBox);
  for (let s = 0; s < spines; s++)
    b.node({
      id: `s${s + 1}`,
      type: 'switchEnterprise',
      x: along(page.w / 2, s, spines, spinePitch),
      y: spineY,
      label: `Spine ${s + 1}`,
    });
  for (let l = 0; l < leaves; l++) {
    const leaf = `l${l + 1}`;
    b.node({
      id: leaf,
      type: 'switch',
      x: along(page.w / 2, l, leaves, leafPitch),
      y: spineY + rowGap,
      label: leaf.toUpperCase(),
    });
    for (let s = 1; s <= spines; s++)
      b.link({
        id: `${leaf}-s${s}`,
        type: 'line',
        from: `s${s}`,
        to: leaf,
        ...(pinned ? DOWN : {}),
      });
  }
  return b.build();
}

/* ── hub and spoke ────────────────────────────────────────────────────── */

const STAR = {
  /** Ring radii around one hub, and around a pair of hubs. */
  ring: { x: 250, y: 230 },
  pairRing: { x: 400, y: 250 },
  /** A hub pair sits this far either side of the centre. */
  hubOffset: 110,
  /**
   * With two hubs the sites keep to an arc above and an arc below them: a
   * site level with the hubs would tunnel to the far hub through the near
   * one. Degrees left clear at each end of an arc.
   */
  arcClear: 25,
  /** Clear space kept between neighbouring sites as the ring fills up. */
  siteGap: LAYOUT_RULES.minNodeGap + 8,
  /** The ring grows in steps of this share until the sites keep clear. */
  growth: 0.05,
  maxGrowthSteps: 100,
  /** Page edge to the ring. */
  margin: { x: 110, y: 100 },
} as const;

/** Unit-ring direction of each site, clockwise from the top. */
function siteAngles(hubs: number, sites: number): number[] {
  if (hubs === 1)
    return Array.from(
      { length: sites },
      (_, i) => (i / sites) * 2 * Math.PI - Math.PI / 2,
    );
  const clear = (STAR.arcClear * Math.PI) / 180;
  const span = Math.PI - 2 * clear;
  const top = Math.ceil(sites / 2);
  const angles: number[] = [];
  // Top arc left to right, then the bottom arc right to left.
  for (let k = 0; k < top; k++)
    angles.push(-Math.PI + clear + (span * (k + 0.5)) / top);
  for (let k = 0; k < sites - top; k++)
    angles.push(clear + (span * (k + 0.5)) / (sites - top));
  return angles;
}

function buildHubSpoke(p: TemplateParams): TopologyDocument {
  const hubs = p.hubs as number;
  const sites = p.sites as number;
  const base = hubs === 1 ? STAR.ring : STAR.pairRing;
  const angles = siteAngles(hubs, sites);
  const site = (i: number, scale: number, cx: number, cy: number) => ({
    id: `site${i + 1}`,
    type: 'ec',
    x: Math.round(cx + base.x * scale * Math.cos(angles[i]!)),
    y: Math.round(cy + base.y * scale * Math.sin(angles[i]!)),
    label: `Site ${i + 1}`,
  });
  // Grow the ring until no two sites crowd each other.
  const crowded = (scale: number): boolean => {
    const boxes = angles.map((_, i) => nodeFootprint(site(i, scale, 0, 0)));
    return boxes.some((a, i) =>
      boxes.some((c, j) => j > i && rectGap(a, c) < STAR.siteGap),
    );
  };
  let scale = 1;
  for (let step = 1; step <= STAR.maxGrowthSteps && crowded(scale); step++)
    scale = 1 + step * STAR.growth;
  const page = sheet(
    2 * (base.x * scale + STAR.margin.x),
    2 * (base.y * scale + STAR.margin.y),
  );
  const cx = page.w / 2;
  const cy = page.h / 2;

  const b = createDocument('Hub and spoke').page({ name: 'Hub & spoke' });
  b.viewBox(page.viewBox);
  const hubNodes = numbered('hub', 'Hub', hubs);
  hubNodes.forEach((h, k) =>
    b.node({
      id: h.id,
      type: 'overlayCloud',
      x: along(cx, k, hubs, 2 * STAR.hubOffset),
      y: cy,
      label: h.label,
    }),
  );
  const tunnel = (id: string, from: string, to: string): LinkInput => ({
    id,
    type: 'tunnel',
    from,
    to,
  });
  // Neighbouring hubs are joined to each other.
  for (let k = 1; k < hubs; k++)
    b.link(tunnel(`hub${k}-hub${k + 1}`, `hub${k}`, `hub${k + 1}`));
  for (let i = 0; i < sites; i++) {
    const s = site(i, scale, cx, cy);
    b.node(s);
    hubNodes.forEach((h, k) =>
      b.link(
        tunnel(hubs === 1 ? `t${i + 1}` : `t${i + 1}-${k + 1}`, h.id, s.id),
      ),
    );
  }
  return b.build();
}

/* ── the templates ────────────────────────────────────────────────────── */

const TEMPLATES: TemplateDef[] = [
  {
    id: 'three-tier',
    name: 'Three-tier web app',
    description: 'Users → firewall → web / app / database tiers.',
    params: [
      {
        name: 'webServers',
        label: 'Web servers',
        type: 'integer',
        min: 1,
        max: 6,
        default: 2,
        description: 'Web servers behind the firewall.',
      },
      {
        name: 'appServers',
        label: 'App servers',
        type: 'integer',
        min: 1,
        max: 4,
        default: 1,
        description: 'App servers; every web server reaches each one.',
      },
    ],
    build: buildThreeTier,
  },
  {
    id: 'sdwan-branch',
    name: 'SD-WAN branch',
    description: 'Branch user + Edge Connector → SASE PoP → Internet & SaaS.',
    params: [],
    build: () =>
      arranged(
        createDocument('SD-WAN branch')
          .page({ name: 'Branch' })
          .node({ id: 'user', type: 'host', x: 0, y: 0, label: 'Branch user' })
          .node({ id: 'ec', type: 'ec', x: 0, y: 0, label: 'Edge Connector' })
          .node({
            id: 'pop',
            type: 'overlayCloud',
            x: 0,
            y: 0,
            label: 'SASE PoP',
          })
          .node({ id: 'inet', type: 'cloud', x: 0, y: 0, label: 'Internet' })
          .node({ id: 'saas', type: 'saas', x: 0, y: 0, label: 'SaaS' })
          .link({ id: 'l1', type: 'line', from: 'user', to: 'ec' })
          .link({ id: 'l2', type: 'tunnel', from: 'ec', to: 'pop' })
          .link({ id: 'l3', type: 'line', from: 'pop', to: 'inet' })
          .link({ id: 'l4', type: 'line', from: 'pop', to: 'saas' }),
        'hierarchical',
        'LR',
      ),
  },
  {
    id: 'ztna',
    name: 'ZTNA user-to-app',
    description: 'User + identity → connector (private edge) → private app.',
    params: [],
    build: () =>
      arranged(
        createDocument('ZTNA user-to-app')
          .page({ name: 'ZTNA' })
          .node({ id: 'user', type: 'host', x: 0, y: 0, label: 'User' })
          .node({ id: 'id', type: 'idcard', x: 0, y: 0, label: 'Identity' })
          .node({
            id: 'pop',
            type: 'overlayCloud',
            x: 0,
            y: 0,
            label: 'ZTNA service',
          })
          .node({
            id: 'conn',
            type: 'connector',
            x: 0,
            y: 0,
            label: 'Connector',
            pe: true,
          })
          .node({ id: 'app', type: 'apps', x: 0, y: 0, label: 'Private app' })
          .link({ id: 'l1', type: 'line', from: 'user', to: 'id' })
          .link({ id: 'l2', type: 'tunnel', from: 'id', to: 'pop' })
          .link({ id: 'l3', type: 'tunnel', from: 'pop', to: 'conn' })
          .link({ id: 'l4', type: 'line', from: 'conn', to: 'app' }),
        'hierarchical',
        'LR',
      ),
  },
  {
    id: 'firewall-dmz',
    name: 'Firewall + DMZ',
    description: 'Internet → edge firewall → DMZ servers and internal network.',
    params: [
      {
        name: 'dmzServers',
        label: 'DMZ servers',
        type: 'integer',
        min: 1,
        max: DMZ_SERVERS.length,
        default: 2,
        description: 'Servers in the DMZ (web, mail, DNS, proxy, VPN, FTP).',
      },
      {
        name: 'internalFirewall',
        label: 'Internal firewall',
        type: 'boolean',
        default: false,
        description: 'Put a second firewall between the DMZ and the core.',
      },
    ],
    build: buildFirewallDmz,
  },
  {
    id: 'spine-leaf',
    name: 'Spine-leaf fabric',
    description:
      'Spine and leaf switches in a full mesh — a data-center fabric (2 × 4 by default).',
    params: [
      {
        name: 'spines',
        label: 'Spines',
        type: 'integer',
        min: 1,
        max: 4,
        default: 2,
        description: 'Spine switches; every leaf uplinks to each one.',
      },
      {
        name: 'leaves',
        label: 'Leaves',
        type: 'integer',
        min: 2,
        max: 16,
        default: 4,
        description: 'Leaf switches; the page widens past seven.',
      },
    ],
    build: buildSpineLeaf,
  },
  {
    id: 'hub-spoke',
    name: 'Hub and spoke',
    description:
      'Branch sites around a central hub over tunnels (one hub, six sites by default).',
    params: [
      {
        name: 'hubs',
        label: 'Hubs',
        type: 'integer',
        min: 1,
        max: 2,
        default: 1,
        description: 'Hubs; with two, every site tunnels to both.',
      },
      {
        name: 'sites',
        label: 'Sites',
        type: 'integer',
        min: 2,
        max: 24,
        default: 6,
        description: 'Branch sites; the page grows once they fill the ring.',
      },
    ],
    build: buildHubSpoke,
  },
];

const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

function templateDef(id: string): TemplateDef {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`unknown template "${id}"`);
  return t;
}

const info = (t: TemplateDef): TemplateInfo => ({
  id: t.id,
  name: t.name,
  description: t.description,
  params: t.params.map((p) => ({ ...p })),
});

/** List available templates (id, name, description and parameters). */
export function listTemplates(): TemplateInfo[] {
  return TEMPLATES.map(info);
}

/** One template's listing, or undefined for an unknown id. */
export function templateInfo(id: string): TemplateInfo | undefined {
  const t = BY_ID.get(id);
  return t ? info(t) : undefined;
}

/** A value as it appears in an error message: quoted, and never long. */
const shown = (v: unknown): string => {
  let s: string;
  try {
    s = JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
};

function resolve(t: TemplateDef, params: unknown): TemplateParams {
  const given = params ?? {};
  if (typeof given !== 'object' || Array.isArray(given))
    throw new TemplateParamError(
      `params must be an object of parameter values (got ${shown(params)})`,
    );
  const values = given as Record<string, unknown>;
  const names = t.params.map((p) => p.name);
  for (const key of Object.keys(values))
    if (!names.includes(key))
      throw new TemplateParamError(
        names.length
          ? `${shown(key)} is not a parameter of template "${t.id}" (it takes ${names.join(', ')})`
          : `template "${t.id}" takes no parameters (got ${shown(key)})`,
      );
  const out: TemplateParams = {};
  for (const spec of t.params) {
    const v = values[spec.name];
    if (v === undefined) out[spec.name] = spec.default;
    else if (spec.type === 'boolean') {
      if (typeof v !== 'boolean')
        throw new TemplateParamError(
          `${spec.name} must be true or false (got ${shown(v)})`,
        );
      out[spec.name] = v;
    } else {
      if (
        typeof v !== 'number' ||
        !Number.isInteger(v) ||
        v < spec.min ||
        v > spec.max
      )
        throw new TemplateParamError(
          `${spec.name} must be an integer from ${spec.min} to ${spec.max} (got ${shown(v)})`,
        );
      out[spec.name] = v;
    }
  }
  return out;
}

/**
 * Apply defaults and validate bounds for a template's parameters. Throws an
 * `Error` whose message names the bad field (or the unknown template).
 */
export function resolveTemplateParams(
  id: string,
  params?: unknown,
): TemplateParams {
  return resolve(templateDef(id), params);
}

/**
 * Build a fresh document from a template id and optional parameters, and
 * report the resolved parameters and element counts. Throws like
 * `resolveTemplateParams`.
 */
export function generateTemplate(id: string, params?: unknown): TemplateResult {
  const t = templateDef(id);
  const resolved = resolve(t, params);
  const doc = t.build(resolved);
  const page = doc.pages[0]!;
  return {
    doc,
    template: t.id,
    params: resolved,
    stats: { nodes: page.nodes.length, links: page.links.length },
  };
}

/** Build a fresh document from a template id (throws if unknown). */
export function buildTemplate(id: string, params?: unknown): TopologyDocument {
  return generateTemplate(id, params).doc;
}
