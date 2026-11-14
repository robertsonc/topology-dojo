/**
 * The options of the inspector's Type dropdown.
 *
 * The dropdown used to list every type by its raw id, in one flat run of
 * eighty-odd entries ("switchEnterprise", "shape:rectangle", …), while the
 * node library beside it shows the same types by label under category
 * headings. The dropdown now reads the way the library does.
 */

/** The part of a catalog entry the dropdown needs. */
export interface TypeChoice {
  type: string;
  label: string;
  /** The library heading it sits under; absent for types without one. */
  category?: string;
}

export interface TypeOption {
  value: string;
  label: string;
  selected: boolean;
}

/** A run of options under one heading (`null` = no heading). */
export interface TypeOptionGroup {
  group: string | null;
  options: TypeOption[];
}

/**
 * Group the catalog's types for the dropdown, in catalog order: categories
 * appear in the order their first type does, as in the node library. A
 * current type the catalog does not know (a removed custom type, a type from
 * a newer file) is listed first under its raw id, so the dropdown never shows
 * a different type from the one the element has.
 */
export function typeOptionGroups(
  current: string,
  choices: readonly TypeChoice[],
): TypeOptionGroup[] {
  const groups: TypeOptionGroup[] = [];
  const byName = new Map<string | null, TypeOptionGroup>();
  if (!choices.some((c) => c.type === current)) {
    const unknown: TypeOptionGroup = {
      group: null,
      options: [{ value: current, label: current, selected: true }],
    };
    groups.push(unknown);
    byName.set(null, unknown);
  }
  for (const c of choices) {
    const name = c.category ?? null;
    let group = byName.get(name);
    if (!group) {
      group = { group: name, options: [] };
      byName.set(name, group);
      groups.push(group);
    }
    group.options.push({
      value: c.type,
      label: c.label,
      selected: c.type === current,
    });
  }
  return groups;
}
