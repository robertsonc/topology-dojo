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
import type { CustomNodeSpec } from '../nodes/spec.js';

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
  | 'refs';

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
const NODE_COMMON: FieldSpec[] = [
  { key: 'label', label: 'Label', kind: 'string' },
  { key: 'sublabel', label: 'Sublabel', kind: 'string' },
  { key: 'color', label: 'Color', kind: 'color' },
  { key: 'locked', label: 'Locked', kind: 'boolean' },
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
      } satisfies NodeTypeInfo,
    ];
  }),
);

/* ── link catalog ─────────────────────────────────────────────────── */

const LINK_COMMON: FieldSpec[] = [
  { key: 'color', label: 'Color', kind: 'color' },
  { key: 'label', label: 'Label', kind: 'string' },
  { key: 'fromLabel', label: 'From port label', kind: 'string' },
  { key: 'toLabel', label: 'To port label', kind: 'string' },
  { key: 'strokeWidth', label: 'Stroke width', kind: 'number' },
  { key: 'opacity', label: 'Opacity', kind: 'number' },
  {
    key: 'lineStyle',
    label: 'Routing',
    kind: 'enum',
    options: ['straight', 'orthogonal', 'curved'],
  },
  { key: 'cornerRadius', label: 'Corner radius', kind: 'number' },
  { key: 'waypoints', label: 'Waypoints', kind: 'points' },
  {
    key: 'dots',
    label: 'Animated particles',
    kind: 'boolean',
    animation: true,
  },
  { key: 'locked', label: 'Locked', kind: 'boolean' },
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

/** All node types (built-in + the document's custom types). */
export function nodeCatalog(
  customNodes: CustomNodeSpec[] = [],
): NodeTypeInfo[] {
  return [...Object.values(NODE_CATALOG), ...customNodes.map(customNodeInfo)];
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

export function getAnnotationType(
  kind: AnnotationKind,
): AnnotationTypeInfo | undefined {
  return ANNOTATION_CATALOG[kind];
}
