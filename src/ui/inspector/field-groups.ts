/**
 * How the catalog's fields of a node or a link are laid out in sections.
 *
 * The grouping is data: each section names the catalog keys it shows, in
 * order, whether it starts open, which number fields share one two-up row,
 * and which fields sit in a nested section of their own. The section marked
 * `rest` takes every field no other section names, under the type's own
 * name ("Firewall options"), so a field added to the catalog is never lost
 * from the panel. A key that a type does not have is skipped.
 *
 * `planSections` is pure: it decides what goes where, and the panel draws
 * each field with its usual control.
 */
import type { FieldSpec } from '../../api/catalog.js';

/**
 * Two fields (numbers, text or choices) drawn side by side in one row, each
 * named by its own label for assistive technology.
 */
export interface FieldPair {
  /** The row's label. */
  label: string;
  keys: readonly [string, string];
  /** What an empty text or number field of the pair shows. */
  placeholders?: readonly [string, string];
}

export interface FieldGroup {
  title: string;
  /** The catalog keys, in the order they are shown. */
  keys: readonly string[];
  /** Whether the section starts open (defaults to closed). */
  open?: boolean;
  /** Fields drawn two to a row. */
  pairs?: readonly FieldPair[];
  /** Fields of this section kept in a nested section, closed at first. */
  nested?: { title: string; keys: readonly string[] };
  /** The section for every field no section names; titled by the type. */
  rest?: true;
}

/**
 * Fields the Selection tab's header shows instead of a section: the lock is
 * the header's toggle. No section takes them, the type's own neither.
 */
export const HEADER_KEYS: readonly string[] = ['locked'];

/** The section that takes every field no other section names. */
const REST: FieldGroup = { title: '', keys: [], rest: true };

/** Node fields, in the sections of the Selection tab. */
export const NODE_GROUPS: readonly FieldGroup[] = [
  {
    title: 'Text',
    keys: [
      'label',
      'sublabel',
      'labelPlacement',
      'labelOffsetX',
      'labelOffset',
      'labelWidth',
      'labelColor',
    ],
    pairs: [{ label: 'Offset', keys: ['labelOffsetX', 'labelOffset'] }],
    nested: {
      title: 'Fine tune',
      keys: ['labelOffsetX', 'labelOffset', 'labelWidth'],
    },
    open: true,
  },
  { title: 'Style', keys: ['color', 'status', 'opacity'], open: true },
  { title: 'Link attachment', keys: ['linkAttach'], open: true },
  { title: 'Wiring', keys: ['tier', 'portLabels', 'portTable'] },
  REST,
  {
    title: 'Position and order',
    keys: ['x', 'y'],
    pairs: [{ label: 'Position', keys: ['x', 'y'] }],
  },
  { title: 'Data', keys: ['meta', 'href', 'tooltip', 'layer', 'source'] },
];

/** Link fields, the same way. */
export const LINK_GROUPS: readonly FieldGroup[] = [
  {
    title: 'Label',
    keys: [
      'label',
      'labelOffset',
      'fromLabel',
      'toLabel',
      'labelScale',
      'labelWidth',
    ],
    pairs: [
      { label: 'Ports', keys: ['fromLabel', 'toLabel'] },
      { label: 'Size, width', keys: ['labelScale', 'labelWidth'] },
    ],
    open: true,
  },
  {
    title: 'Style',
    keys: ['color', 'strokeWidth', 'dashed', 'opacity'],
    pairs: [{ label: 'Width, opacity', keys: ['strokeWidth', 'opacity'] }],
    open: true,
  },
  {
    title: 'Routing',
    keys: [
      'lineStyle',
      'fromPort',
      'toPort',
      'cornerRadius',
      'fromPortOffset',
      'toPortOffset',
      'waypoints',
    ],
    pairs: [
      {
        label: 'Routing',
        keys: ['lineStyle', 'cornerRadius'],
        placeholders: ['', 'radius'],
      },
      { label: 'Sides', keys: ['fromPort', 'toPort'] },
      { label: 'Side offsets', keys: ['fromPortOffset', 'toPortOffset'] },
    ],
    open: true,
  },
  {
    title: 'Wiring',
    keys: [
      'style',
      'fromInterface',
      'toInterface',
      'fromOptic',
      'toOptic',
      'fromBundle',
      'toBundle',
      'bandwidth',
      'transport',
      'vlan',
      'subnet',
      'showMeta',
    ],
  },
  {
    title: 'Animation',
    keys: ['dots', 'flowSpeed', 'flowParticles', 'reverseFlow'],
  },
  REST,
  { title: 'Data', keys: ['href', 'tooltip', 'layer', 'source'] },
];

/** One thing in a section: a field, a two-up row, or a nested section. */
export type PlannedItem =
  | { kind: 'field'; field: FieldSpec }
  | {
      kind: 'pair';
      label: string;
      fields: readonly [FieldSpec, FieldSpec];
      placeholders?: readonly [string, string];
    }
  | { kind: 'nested'; title: string; items: PlannedItem[] };

export interface PlannedSection {
  title: string;
  /** Whether it starts open (before what the user last chose). */
  open: boolean;
  items: PlannedItem[];
  /** The fields of the section, flat, in order (for counts). */
  fields: FieldSpec[];
}

/** The title of the section that holds a type's own fields. */
export function typeOptionsTitle(typeLabel: string): string {
  return `${typeLabel} options`;
}

/**
 * Lay a type's fields out in `groups`. Sections with none of their fields
 * on this type are left out; every field of the type lands in exactly one
 * section, apart from those the header shows (`header`).
 */
export function planSections(
  fields: readonly FieldSpec[],
  groups: readonly FieldGroup[],
  typeLabel: string,
  header: readonly string[] = HEADER_KEYS,
): PlannedSection[] {
  const byKey = new Map(fields.map((f) => [f.key, f] as const));
  const named = new Set([...header, ...groups.flatMap((g) => g.keys)]);
  const sections: PlannedSection[] = [];
  for (const g of groups) {
    const specs = g.rest
      ? fields.filter((f) => !named.has(f.key))
      : g.keys
          .map((k) => byKey.get(k))
          .filter((f): f is FieldSpec => Boolean(f));
    if (!specs.length) continue;
    sections.push({
      title: g.rest ? typeOptionsTitle(typeLabel) : g.title,
      open: g.open ?? false,
      items: planItems(specs, g),
      fields: specs,
    });
  }
  return sections;
}

function planItems(specs: FieldSpec[], g: FieldGroup): PlannedItem[] {
  const nestedKeys = new Set(g.nested?.keys ?? []);
  const inner = specs.filter((f) => nestedKeys.has(f.key));
  const outer = specs.filter((f) => !nestedKeys.has(f.key));
  const items = itemsOf(outer, g.pairs ?? []);
  if (!inner.length) return items;
  // The nested section sits where its first field comes in the group.
  const first = specs.indexOf(inner[0]!);
  const at = items.findIndex((item) => specs.indexOf(firstField(item)) > first);
  const nested: PlannedItem = {
    kind: 'nested',
    title: g.nested!.title,
    items: itemsOf(inner, g.pairs ?? []),
  };
  items.splice(at < 0 ? items.length : at, 0, nested);
  return items;
}

function firstField(item: PlannedItem): FieldSpec {
  if (item.kind === 'field') return item.field;
  if (item.kind === 'pair') return item.fields[0];
  return firstField(item.items[0]!);
}

/** The kinds of field a two-up row can hold: one plain control each. */
const PAIRABLE = new Set(['number', 'string', 'enum']);

/**
 * Fields in order, a pair in one row where both of its fields are here and
 * each has a plain control (no compass, no textarea).
 */
function itemsOf(
  list: readonly FieldSpec[],
  pairs: readonly FieldPair[],
): PlannedItem[] {
  const out: PlannedItem[] = [];
  const done = new Set<string>();
  const field = (key: string): FieldSpec | undefined =>
    list.find(
      (f) => f.key === key && PAIRABLE.has(f.kind) && !f.widget && !f.multiline,
    );
  const pairable = (p: FieldPair): boolean => p.keys.every((k) => field(k));
  for (const f of list) {
    if (done.has(f.key)) continue;
    const pair = pairs.find((p) => p.keys.includes(f.key) && pairable(p));
    if (pair) {
      out.push({
        kind: 'pair',
        label: pair.label,
        fields: [field(pair.keys[0])!, field(pair.keys[1])!],
        ...(pair.placeholders ? { placeholders: pair.placeholders } : {}),
      });
      pair.keys.forEach((k) => done.add(k));
    } else {
      out.push({ kind: 'field', field: f });
      done.add(f.key);
    }
  }
  return out;
}
