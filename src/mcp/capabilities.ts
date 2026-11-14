/**
 * The full capability catalog as `describe_capabilities` returns it: every
 * field defined ONCE, and each type listing field keys.
 *
 * The raw catalog repeats a complete field definition on every type that has
 * the field. With 85 node types sharing a few dozen fields that was ~170 KB of
 * definitions for 54 distinct ones — the whole reply was 212 KB, most of an
 * agent's context for one call. Here a field's definition appears once under
 * `nodeFields.defs` / `linkFields.defs`, the keys every listed type has are
 * named once under `common`, and a type's `fields` holds only its extra keys.
 */
import type { FieldSpec, LinkTypeInfo, NodeTypeInfo } from '../api/catalog.js';

/** A field definition without its key (the key is the map key) or GUI hints. */
export type FieldDef = Omit<FieldSpec, 'key' | 'widget'>;

/** A field reference: its key, or the whole definition where this type's
 * differs from the shared one (same key, different meaning). */
export type FieldRef = string | (FieldDef & { key: string });

export interface FieldTable {
  /** Field keys every listed type has (empty when one type is listed). */
  common: string[];
  /** One definition per field key. */
  defs: Record<string, FieldDef>;
}

export interface CompactNodeType {
  type: string;
  label: string;
  category: string;
  custom?: true;
  /** Editable fields beyond `nodeFields.common`. */
  fields: FieldRef[];
}

export interface CompactLinkType {
  type: string;
  label: string;
  animated?: true;
  /** Editable fields beyond `linkFields.common`. */
  fields: FieldRef[];
}

function def(spec: FieldSpec): FieldDef {
  // `widget` only tells the inspector how to draw the control.
  const {
    key: _key,
    widget: _widget,
    ...rest
  } = spec as FieldSpec & {
    widget?: unknown;
  };
  return rest;
}

function compactFields(types: readonly { fields: FieldSpec[] }[]): {
  table: FieldTable;
  refs: FieldRef[][];
} {
  const defs: Record<string, FieldDef> = {};
  const shape = new Map<string, string>();
  for (const type of types)
    for (const spec of type.fields)
      if (!(spec.key in defs)) {
        defs[spec.key] = def(spec);
        shape.set(spec.key, JSON.stringify(defs[spec.key]));
      }
  // Keys present, with the shared definition, on every listed type.
  const common =
    types.length < 2
      ? []
      : Object.keys(defs).filter((key) =>
          types.every((type) =>
            type.fields.some(
              (spec) =>
                spec.key === key &&
                JSON.stringify(def(spec)) === shape.get(key),
            ),
          ),
        );
  const shared = new Set(common);
  const refs = types.map((type) =>
    type.fields
      .filter((spec) => !shared.has(spec.key))
      .map((spec): FieldRef => {
        const own = def(spec);
        return JSON.stringify(own) === shape.get(spec.key)
          ? spec.key
          : { key: spec.key, ...own };
      }),
  );
  return { table: { common, defs }, refs };
}

export const COMPACT_CATALOG_NOTE =
  'A type’s editable fields are nodeFields.common (or linkFields.common) plus its own `fields`. ' +
  'Each is a field key defined in nodeFields.defs / linkFields.defs; an entry given as an object is that type’s own definition of the key.';

/** The catalog with field definitions de-duplicated (see the module doc). */
export function compactCatalog(
  nodes: readonly NodeTypeInfo[],
  links: readonly LinkTypeInfo[],
): {
  nodeFields: FieldTable;
  linkFields: FieldTable;
  nodeTypes: CompactNodeType[];
  linkTypes: CompactLinkType[];
} {
  const n = compactFields(nodes);
  const l = compactFields(links);
  return {
    nodeFields: n.table,
    linkFields: l.table,
    nodeTypes: nodes.map((info, i) => ({
      type: info.type,
      label: info.label,
      category: info.category,
      ...(info.custom ? { custom: true as const } : {}),
      fields: n.refs[i]!,
    })),
    linkTypes: links.map((info, i) => ({
      type: info.type,
      label: info.label,
      ...(info.animated ? { animated: true as const } : {}),
      fields: l.refs[i]!,
    })),
  };
}

/** Rebuild one type's full field definitions from the compact form. */
export function expandFields(
  table: FieldTable,
  fields: readonly FieldRef[],
): (FieldDef & { key: string })[] {
  return [...table.common, ...fields].map((ref) =>
    typeof ref === 'string' ? { key: ref, ...table.defs[ref]! } : ref,
  );
}
