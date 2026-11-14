/**
 * What a custom node type may be called.
 *
 * A custom type is registered with the renderer under its name. Registering
 * one under the name of a built-in type replaces that type's art everywhere
 * — design a triangle called "router" and every Router in every document
 * opened afterwards is a triangle, with no way back. Saving a second custom
 * type under an existing custom name replaces the first the same way.
 */

/** The name a new custom type starts with. */
export const DEFAULT_TYPE_NAME = 'myNode';

/**
 * A name based on `base` that nothing in `taken` uses: `base`, else `base2`,
 * `base3`, … So designing two types in a row without naming either gives two
 * types, not one that replaced the other.
 */
export function uniqueTypeName(base: string, taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}${n}`)) return `${base}${n}`;
}

export type TypeNameCheck =
  /** The name can be saved. `replaces` is true when a different custom type
   * already has it, so saving would replace that type: ask first. */
  | { ok: true; name: string; replaces: boolean }
  /** The name cannot be used; `message` says why, for the designer to show. */
  | { ok: false; message: string };

/**
 * Check the name typed into the Node Designer.
 *
 * `editing` is the name of the custom type being edited, or null for a new
 * one: saving a type back under its own name is always fine. `reserved` are
 * the built-in and stock type names; `custom` the document's custom types.
 */
export function checkCustomTypeName(input: {
  name: string;
  editing: string | null;
  reserved: readonly string[];
  custom: readonly string[];
}): TypeNameCheck {
  const name = input.name.trim() || DEFAULT_TYPE_NAME;
  if (input.reserved.includes(name))
    return {
      ok: false,
      message: `“${name}” is a built-in node type. Choose another name.`,
    };
  return {
    ok: true,
    name,
    replaces: name !== input.editing && input.custom.includes(name),
  };
}

/** What to ask before one custom type replaces another of the same name. */
export function replaceTypeQuestion(name: string): string {
  return `A custom node type named “${name}” already exists. Replace it with this design?`;
}
