/**
 * How the fields of an annotation (zone, flow path, policy marker) are shown
 * and edited in the inspector, where the catalog's field kind alone does not
 * settle it.
 *
 * The annotation editor used to draw anything it had no special case for as
 * a text box. A boolean typed as text stores the string "false", which every
 * renderer check reads as "on"; an optional choice with no "nothing" option
 * shows its first option when nothing is stored, and cannot be cleared.
 */
import type { FieldSpec } from '../api/catalog.js';

/**
 * Boolean fields that are on unless switched off: the renderer tests them
 * with `!== false`, so an unset one behaves as ticked and must show as ticked.
 */
const ON_BY_DEFAULT = new Set(['followLinks']);

/** Whether a boolean field's checkbox is ticked for a stored value. */
export function booleanFieldChecked(key: string, value: unknown): boolean {
  return ON_BY_DEFAULT.has(key) ? value !== false : Boolean(value);
}

/** One `<option>` of an enum field's select. */
export interface EnumOption {
  value: string;
  label: string;
  selected: boolean;
}

/** What "nothing chosen" is called for an optional choice, by field key. */
const UNSET_LABELS: Readonly<Record<string, string>> = {
  backdrop: 'None',
};
/** …and for every other optional choice: the renderer's default applies. */
const UNSET_LABEL = 'Default';

/**
 * The options to draw for an enum field holding `value`.
 *
 * An optional field whose own options have no empty entry gets one, first:
 * selected while nothing is stored, and choosing it clears the field. A
 * stored value that is not among the options is listed too, so the select
 * never shows a different value from the one the document holds.
 */
export function enumFieldOptions(
  field: Pick<FieldSpec, 'key' | 'options' | 'optionLabels' | 'required'>,
  value: unknown,
): EnumOption[] {
  const options = field.options ?? [];
  const current = value === undefined || value === null ? '' : String(value);
  const out: EnumOption[] = [];
  if (!field.required && !options.includes(''))
    out.push({
      value: '',
      label: UNSET_LABELS[field.key] ?? UNSET_LABEL,
      selected: current === '',
    });
  for (const o of options)
    out.push({
      value: o,
      label: field.optionLabels?.[o] ?? o,
      selected: o === current,
    });
  if (current !== '' && !options.includes(current))
    out.push({
      value: current,
      label: `${current} (not an option)`,
      selected: true,
    });
  return out;
}

/** What an enum select's value stores: the empty choice clears the field. */
export function enumFieldValue(selected: string): string | undefined {
  return selected === '' ? undefined : selected;
}
