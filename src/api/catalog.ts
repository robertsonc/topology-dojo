/**
 * Capability catalog — the machine-readable schema of everything a topology can
 * express: every node type and link type with its editable fields (including
 * animation). This is the discoverable surface an MCP server / agent reads to
 * know "what can I set", and the source of truth the GUI and validation align to.
 *
 * Adding a node/link type means adding an entry here — a parity test asserts the
 * catalog covers the whole built-in vocabulary, so nothing can be UI-only.
 */
import { BUILTIN_NODE_TYPES, LINK_TYPES } from './builtins.js';
import { POLICY_MARKER_TYPES } from './markers.js';
import { LAYER_KINDS } from './layers.js';
import type { CustomNodeSpec } from '../nodes/spec.js';
import { STOCK_NODE_LABELS, STOCK_NODE_SPECS } from '../nodes/stock.js';

export type FieldKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'color'
  | 'enum'
  | 'point'
  | 'points'
  /** A single id reference to another element (node, anchor, zone…). */
  | 'ref'
  /** An ordered list of id references. */
  | 'refs'
  /** A flat key/value map (string/number/boolean values) — e.g. node metadata. */
  | 'record';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  /** Allowed values for `kind: 'enum'`. */
  options?: readonly string[];
  /** True for fields that drive motion (e.g. animated flow particles). */
  animation?: boolean;
  /** Hint that the field is required for the type to render meaningfully. */
  required?: boolean;
}

export interface NodeTypeInfo {
  type: string;
  label: string;
  category: string;
  custom: boolean;
  fields: FieldSpec[];
  /** Search aliases (Phase 4 node library) — synonyms/abbreviations a user
   * might type that aren't in the type/label (e.g. "fw" → firewall). */
  keywords?: string[];
}

export interface LinkTypeInfo {
  type: string;
  label: string;
  /** Whether this type animates (flow particles) by default / supports it. */
  animated: boolean;
  fields: FieldSpec[];
}

/** The page-level annotation kinds (zones, flow paths, policy markers). */
export type AnnotationKind = 'zone' | 'flowPath' | 'policyMarker';

export interface AnnotationTypeInfo {
  kind: AnnotationKind;
  label: string;
  /** The page array the elements live in (the document contract surface). */
  collection: 'zones' | 'flowPaths' | 'policyMarkers';
  fields: FieldSpec[];
}

/* ── shared field sets ────────────────────────────────────────────── */

const POSITION: FieldSpec[] = [
  { key: 'x', label: 'X', kind: 'number', required: true },
  { key: 'y', label: 'Y', kind: 'number', required: true },
];
/** Every element kind can opt into a declared document layer. */
const LAYER_FIELD: FieldSpec = { key: 'layer', label: 'Layer', kind: 'ref' };
/** Every element kind (except anchors) can carry an external source identity. */
const SOURCE_FIELD: FieldSpec = {
  key: 'source',
  label: 'Source ref',
  kind: 'record',
};
const NODE_COMMON: FieldSpec[] = [
  { key: 'label', label: 'Label', kind: 'string' },
  { key: 'sublabel', label: 'Sublabel', kind: 'string' },
  { key: 'color', label: 'Color', kind: 'color' },
  { key: 'opacity', label: 'Opacity', kind: 'number' },
  { key: 'labelColor', label: 'Label color', kind: 'color' },
  { key: 'labelOffset', label: 'Label offset', kind: 'number' },
  { key: 'locked', label: 'Locked', kind: 'boolean' },
  { key: 'meta', label: 'Metadata', kind: 'record' },
  LAYER_FIELD,
  SOURCE_FIELD,
];

/** Per-type extra fields, keyed by node type (common + position are added). */
const NODE_EXTRAS: Record<string, FieldSpec[]> = {
  ec: [
    {
      key: 'variant',
      label: 'Variant',
      kind: 'enum',
      options: [
        'generic',
        'virtual',
        'physical',
        'aws',
        'azure',
        'gcp',
        'oracle',
        'axis',
      ],
    },
  ],
  cloud: [
    { key: 'sub1', label: 'Subtitle 1', kind: 'string' },
    { key: 'sub2', label: 'Subtitle 2', kind: 'string' },
    {
      key: 'innerClouds',
      label: 'Inner clouds',
      kind: 'enum',
      options: ['both', 'left', 'right', 'none'],
    },
  ],
  host: [
    { key: 'managed', label: 'Managed', kind: 'boolean' },
    { key: 'agent', label: 'Agent', kind: 'boolean' },
    { key: 'agentColor', label: 'Agent color', kind: 'color' },
  ],
  connector: [{ key: 'pe', label: 'Private Edge', kind: 'boolean' }],
  saas: [{ key: 'logoUrl', label: 'Logo URL', kind: 'string' }],
  idcard: [
    { key: 'mode', label: 'Mode', kind: 'enum', options: ['id', 'auth'] },
    { key: 'user', label: 'User', kind: 'string' },
    { key: 'host', label: 'Host', kind: 'string' },
    { key: 'role', label: 'Role', kind: 'string' },
  ],
  switchEnterprise: [
    { key: 'copperPorts', label: 'Copper ports', kind: 'number' },
    { key: 'fiberPorts', label: 'Fiber ports', kind: 'number' },
  ],
  overlayCloud: [{ key: 'padding', label: 'Padding', kind: 'number' }],
  text: [
    { key: 'fontSize', label: 'Font size', kind: 'number' },
    { key: 'fontWeight', label: 'Font weight', kind: 'string' },
  ],
};

const NODE_CATEGORY: Record<string, string> = {
  ec: 'Edge',
  connector: 'Edge',
  router: 'Network',
  switch: 'Network',
  switchEnterprise: 'Network',
  ap: 'Network',
  firewall: 'Security',
  idcard: 'Security',
  cloud: 'Cloud',
  saas: 'Cloud',
  overlayCloud: 'Cloud',
  server: 'Compute',
  apps: 'Compute',
  database: 'Compute',
  host: 'Endpoint',
  text: 'Annotation',
};

/** Search aliases per built-in type (Phase 4) — abbreviations / synonyms. */
const NODE_KEYWORDS: Record<string, string[]> = {
  ec: ['edge connect', 'branch', 'sd-wan', 'sdwan', 'gateway', 'axis'],
  connector: ['private edge', 'ztna', 'sse', 'axis'],
  router: ['gateway', 'l3', 'routing'],
  switch: ['l2', 'switching', 'lan'],
  switchEnterprise: ['l2', 'core switch', 'distribution', 'access switch'],
  ap: ['access point', 'wifi', 'wireless'],
  firewall: ['fw', 'security', 'ngfw', 'srx'],
  idcard: ['identity', 'sase', 'user', 'auth', 'id'],
  cloud: ['internet', 'wan', 'aws', 'azure', 'gcp', 'public cloud'],
  saas: ['software as a service', 'app', 'o365', 'salesforce'],
  overlayCloud: ['overlay', 'vpn cloud', 'tunnel cloud'],
  server: ['compute', 'vm', 'host server'],
  apps: ['application', 'app server', 'workload'],
  database: ['db', 'data', 'sql', 'storage'],
  host: ['user', 'endpoint', 'pc', 'laptop', 'client'],
  text: ['label', 'note', 'annotation', 'caption'],
};

function titleCase(s: string): string {
  return s
    .replace(/^shape:/, '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase());
}

/* ── node catalog ─────────────────────────────────────────────────── */

const NODE_CATALOG: Record<string, NodeTypeInfo> = Object.fromEntries(
  BUILTIN_NODE_TYPES.map((type) => {
    const shape = type.startsWith('shape:');
    const fields = shape
      ? [
          ...POSITION,
          { key: 'label', label: 'Label', kind: 'string' as const },
          { key: 'color', label: 'Color', kind: 'color' as const },
          { key: 'shapeSize', label: 'Size', kind: 'number' as const },
          { key: 'locked', label: 'Locked', kind: 'boolean' as const },
          LAYER_FIELD,
          SOURCE_FIELD,
        ]
      : [...POSITION, ...NODE_COMMON, ...(NODE_EXTRAS[type] ?? [])];
    return [
      type,
      {
        type,
        label: titleCase(type),
        category: shape ? 'Shape' : (NODE_CATEGORY[type] ?? 'Other'),
        custom: false,
        fields,
        ...(NODE_KEYWORDS[type] ? { keywords: NODE_KEYWORDS[type] } : {}),
      } satisfies NodeTypeInfo,
    ];
  }),
);

/* ── link catalog ─────────────────────────────────────────────────── */

const LINK_COMMON: FieldSpec[] = [
  { key: 'color', label: 'Color', kind: 'color' },
  { key: 'label', label: 'Label', kind: 'string' },
  { key: 'fromLabel', label: 'From interface (A)', kind: 'string' },
  { key: 'toLabel', label: 'To interface (Z)', kind: 'string' },
  // B.2 first-class link metadata — renderable on the wire (see showMeta).
  // Stable per-field properties a future data feed can populate.
  { key: 'vlan', label: 'VLAN', kind: 'string' },
  { key: 'subnet', label: 'Subnet', kind: 'string' },
  { key: 'bandwidth', label: 'Bandwidth', kind: 'string' },
  { key: 'transport', label: 'Transport', kind: 'string' },
  { key: 'showMeta', label: 'Show metadata on wire', kind: 'boolean' },
  { key: 'strokeWidth', label: 'Stroke width', kind: 'number' },
  { key: 'opacity', label: 'Opacity', kind: 'number' },
  {
    key: 'lineStyle',
    label: 'Routing',
    kind: 'enum',
    options: ['straight', 'orthogonal', 'curved'],
  },
  { key: 'cornerRadius', label: 'Corner radius', kind: 'number' },
  // A.5 ports: pin an endpoint to a node side/corner. Empty = auto-boundary
  // (A.4): the endpoint attaches to the perimeter facing the other end.
  {
    key: 'fromPort',
    label: 'From port (side)',
    kind: 'enum',
    options: ['', 'n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'],
  },
  {
    key: 'toPort',
    label: 'To port (side)',
    kind: 'enum',
    options: ['', 'n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'],
  },
  { key: 'waypoints', label: 'Waypoints', kind: 'points' },
  {
    key: 'dots',
    label: 'Animated particles',
    kind: 'boolean',
    animation: true,
  },
  {
    key: 'flowSpeed',
    label: 'Flow speed (s)',
    kind: 'number',
    animation: true,
  },
  {
    key: 'flowParticles',
    label: 'Flow particles',
    kind: 'number',
    animation: true,
  },
  {
    key: 'reverseFlow',
    label: 'Reverse flow',
    kind: 'boolean',
    animation: true,
  },
  { key: 'locked', label: 'Locked', kind: 'boolean' },
  LAYER_FIELD,
  SOURCE_FIELD,
];

/** Per-type extra link fields. */
const LINK_EXTRAS: Record<string, FieldSpec[]> = {
  line: [{ key: 'dashed', label: 'Dashed', kind: 'boolean' }],
  blocked: [{ key: 'reason', label: 'Reason', kind: 'string' }],
  flow: [
    { key: 'path', label: 'Custom path', kind: 'string' },
    { key: 'sublabel', label: 'Sublabel', kind: 'string' },
  ],
  packet: [{ key: 'sublabel', label: 'Sublabel', kind: 'string' }],
};

/** Link types whose default visual includes motion. */
const ANIMATED_LINKS = new Set([
  'tunnel',
  'wireguard',
  'flow',
  'packet',
  'wifi',
  'poe',
  'optical',
]);

const LINK_CATALOG: Record<string, LinkTypeInfo> = Object.fromEntries(
  LINK_TYPES.map((type) => [
    type,
    {
      type,
      label: titleCase(type),
      animated: ANIMATED_LINKS.has(type),
      fields: [...LINK_COMMON, ...(LINK_EXTRAS[type] ?? [])],
    } satisfies LinkTypeInfo,
  ]),
);

/* ── annotation catalog (zones / flow paths / policy markers) ──────── */

const ANNOTATION_CATALOG: Record<AnnotationKind, AnnotationTypeInfo> = {
  zone: {
    kind: 'zone',
    label: 'Zone',
    collection: 'zones',
    fields: [
      { key: 'label', label: 'Label', kind: 'string' },
      { key: 'sublabel', label: 'Sublabel', kind: 'string' },
      { key: 'description', label: 'Description', kind: 'string' },
      { key: 'nodes', label: 'Member nodes', kind: 'refs', required: true },
      { key: 'color', label: 'Color', kind: 'color' },
      {
        key: 'borderStyle',
        label: 'Border',
        kind: 'enum',
        options: ['dashed', 'solid', 'dotted'],
      },
      { key: 'padding', label: 'Padding', kind: 'number' },
      {
        key: 'labelAlign',
        label: 'Label align',
        kind: 'enum',
        options: ['left', 'center', 'right'],
      },
      { key: 'parentZone', label: 'Parent zone', kind: 'ref' },
      LAYER_FIELD,
      SOURCE_FIELD,
    ],
  },
  flowPath: {
    kind: 'flowPath',
    label: 'Flow path',
    collection: 'flowPaths',
    fields: [
      { key: 'label', label: 'Label', kind: 'string' },
      { key: 'waypoints', label: 'Waypoints', kind: 'refs', required: true },
      { key: 'color', label: 'Color', kind: 'color' },
      {
        key: 'animation',
        label: 'Animation',
        kind: 'enum',
        options: ['particles', 'dashed', 'pulse'],
        animation: true,
      },
      {
        key: 'speed',
        label: 'Speed',
        kind: 'enum',
        options: ['slow', 'medium', 'fast'],
        animation: true,
      },
      {
        key: 'direction',
        label: 'Direction',
        kind: 'enum',
        options: ['forward', 'reverse', 'bidirectional'],
        animation: true,
      },
      { key: 'width', label: 'Width', kind: 'number' },
      { key: 'opacity', label: 'Opacity', kind: 'number' },
      LAYER_FIELD,
      SOURCE_FIELD,
    ],
  },
  policyMarker: {
    kind: 'policyMarker',
    label: 'Policy marker',
    collection: 'policyMarkers',
    fields: [
      {
        key: 'type',
        label: 'Type',
        kind: 'enum',
        required: true,
        options: POLICY_MARKER_TYPES,
      },
      { key: 'nodeId', label: 'On node', kind: 'ref', required: true },
      { key: 'label', label: 'Label', kind: 'string' },
      { key: 'color', label: 'Color', kind: 'color' },
      { key: 'icon', label: 'Icon (override)', kind: 'string' },
      {
        key: 'align',
        label: 'Placement',
        kind: 'enum',
        options: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'C'],
      },
      { key: 'flowPathId', label: 'Flow path', kind: 'ref' },
      LAYER_FIELD,
      SOURCE_FIELD,
    ],
  },
};

/* ── public catalog API ───────────────────────────────────────────── */

/** Describe a custom node type (instance-overridable fields; spec defines the art). */
export function customNodeInfo(spec: CustomNodeSpec): NodeTypeInfo {
  return {
    type: spec.typeName,
    label: spec.typeName,
    category: 'Custom',
    custom: true,
    fields: [...POSITION, ...NODE_COMMON],
  };
}

/**
 * Stock cloud-native types — shipped with the app (not per-document), so they
 * present as built-ins under the Cloud category rather than user custom nodes.
 */
const STOCK_NODE_CATALOG: Record<string, NodeTypeInfo> = Object.fromEntries(
  STOCK_NODE_SPECS.map((spec) => [
    spec.typeName,
    {
      type: spec.typeName,
      label: STOCK_NODE_LABELS[spec.typeName] ?? spec.typeName,
      category: 'Cloud',
      custom: false,
      fields: [...POSITION, ...NODE_COMMON],
    } satisfies NodeTypeInfo,
  ]),
);

/** All node types (built-in + stock cloud + the document's custom types). */
export function nodeCatalog(
  customNodes: CustomNodeSpec[] = [],
): NodeTypeInfo[] {
  return [
    ...Object.values(NODE_CATALOG),
    ...Object.values(STOCK_NODE_CATALOG),
    ...customNodes.map(customNodeInfo),
  ];
}

/**
 * Filter the node library by a free-text query (Phase 4). Matches the query's
 * whitespace-separated terms (AND) against each type's type/label/category and
 * search aliases, case-insensitively. An empty query returns the full catalog
 * unchanged — so callers can use it as the single source of palette entries.
 */
export function filterNodeCatalog(
  query: string,
  customNodes: CustomNodeSpec[] = [],
): NodeTypeInfo[] {
  const all = nodeCatalog(customNodes);
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return all;
  return all.filter((info) => {
    const hay = [info.type, info.label, info.category, ...(info.keywords ?? [])]
      .join(' ')
      .toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** All link types. */
export function linkCatalog(): LinkTypeInfo[] {
  return Object.values(LINK_CATALOG);
}

export function getNodeType(
  type: string,
  customNodes: CustomNodeSpec[] = [],
): NodeTypeInfo | undefined {
  return (
    NODE_CATALOG[type] ??
    STOCK_NODE_CATALOG[type] ??
    customNodes.filter((c) => c.typeName === type).map(customNodeInfo)[0]
  );
}

export function getLinkType(type: string): LinkTypeInfo | undefined {
  return LINK_CATALOG[type];
}

/** All page-level annotation kinds (zones, flow paths, policy markers). */
export function annotationCatalog(): AnnotationTypeInfo[] {
  return Object.values(ANNOTATION_CATALOG);
}

/** The document-layer vocabulary: semantic kinds + a LayerDef's fields. */
export interface LayerCatalogInfo {
  kinds: readonly string[];
  fields: FieldSpec[];
}

export function layerCatalog(): LayerCatalogInfo {
  return {
    kinds: LAYER_KINDS,
    fields: [
      { key: 'name', label: 'Name', kind: 'string' },
      { key: 'kind', label: 'Kind', kind: 'enum', options: LAYER_KINDS },
      { key: 'color', label: 'Color', kind: 'color' },
      { key: 'defaultVisible', label: 'Visible by default', kind: 'boolean' },
    ],
  };
}

export function getAnnotationType(
  kind: AnnotationKind,
): AnnotationTypeInfo | undefined {
  return ANNOTATION_CATALOG[kind];
}
