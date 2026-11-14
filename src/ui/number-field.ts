/**
 * What a number typed into a Properties field means for the document.
 *
 * A number input's text is not a number yet. `Number('')` is 0, so a cleared
 * field used to store 0 — an opacity of 0 makes the element invisible while
 * the field shows its "auto" placeholder — and anything typed was stored as
 * it stood, however far outside what the renderer draws. This module decides,
 * for one field's text:
 *
 * - blank → the property is unset, so its default applies again (a required
 *   field, like a position, keeps its value instead);
 * - not a number → nothing is stored;
 * - outside the field's range → brought to the nearest end of the range;
 * - a size that must be greater than zero, given zero or less → nothing is
 *   stored (there is no nearest valid size to move it to).
 */
import type { FieldSpec } from '../api/catalog.js';

/** The values a numeric field accepts. Absent ends are unbounded. */
export interface NumberBounds {
  min?: number;
  max?: number;
  /** `min` itself is not accepted: the value must be greater than it. */
  exclusiveMin?: boolean;
}

/** A measure that must be greater than zero. */
const POSITIVE: NumberBounds = { min: 0, exclusiveMin: true };
/** A measure that may be zero. */
const NON_NEGATIVE: NumberBounds = { min: 0 };

/**
 * Bounds the renderer and validation already apply to fields whose catalog
 * entry declares no `range`. A catalog range always wins; this table only
 * keeps the inspector from storing what the rest of the app then has to
 * clamp, warn about, or cannot draw.
 */
const KNOWN_BOUNDS: Readonly<Record<string, NumberBounds>> = {
  // validate_topology warns outside 0…1.
  opacity: { min: 0, max: 1 },
  // The renderer clamps a link's label size to 0.25…4.
  labelScale: { min: 0.25, max: 4 },
  // The renderer and the document loader clamp wrap widths to 40…600.
  labelWidth: { min: 40, max: 600 },
  fontSize: POSITIVE,
  width: POSITIVE,
  shapeWidth: POSITIVE,
  shapeHeight: POSITIVE,
  shapeSize: POSITIVE,
  imageW: POSITIVE,
  imageH: POSITIVE,
  strokeWidth: POSITIVE,
  flowSpeed: POSITIVE,
  padding: NON_NEGATIVE,
  cornerRadius: NON_NEGATIVE,
  copperPorts: NON_NEGATIVE,
  fiberPorts: NON_NEGATIVE,
  flowParticles: NON_NEGATIVE,
};

/**
 * The bounds for a catalog field: its declared `range`, else what is known
 * for its key, else none. A dotted key ("linkAttach.pad") is looked up by its
 * last part.
 */
export function numberBounds(
  field: Pick<FieldSpec, 'key' | 'range'>,
): NumberBounds {
  if (field.range) return { min: field.range[0], max: field.range[1] };
  const name = field.key.slice(field.key.lastIndexOf('.') + 1);
  return KNOWN_BOUNDS[name] ?? {};
}

/**
 * The spec for an inspector key in a type's field list. A dotted key names a
 * field nested in an `object` field ("linkAttach.pad").
 */
export function findField(
  fields: readonly FieldSpec[] | undefined,
  key: string,
): FieldSpec | undefined {
  const dot = key.indexOf('.');
  if (dot < 0) return fields?.find((f) => f.key === key);
  const parent = fields?.find((f) => f.key === key.slice(0, dot));
  return parent?.fields?.find((f) => f.key === key.slice(dot + 1));
}

export type ParsedNumber =
  /** Blank: remove the property so its default applies. */
  | { kind: 'unset' }
  /** A usable number, already brought inside the bounds. */
  | { kind: 'value'; value: number }
  /** Nothing to store: leave the document as it is. */
  | { kind: 'invalid' };

/**
 * Read a number field's text.
 *
 * `required` marks a field that cannot be unset (a position): blank is then
 * invalid rather than "use the default". `badInput` is the input element's
 * own flag for text it could not read as a number ("-", "1e"); the browser
 * reports such text as an empty value, which must not be taken for blank.
 */
export function parseNumberField(
  text: string,
  bounds: NumberBounds = {},
  opts: { required?: boolean; badInput?: boolean } = {},
): ParsedNumber {
  if (opts.badInput) return { kind: 'invalid' };
  const trimmed = text.trim();
  if (trimmed === '')
    return opts.required ? { kind: 'invalid' } : { kind: 'unset' };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { kind: 'invalid' };
  const { min, max, exclusiveMin } = bounds;
  if (min !== undefined && exclusiveMin && n <= min) return { kind: 'invalid' };
  let value = n;
  if (min !== undefined && value < min) value = min;
  if (max !== undefined && value > max) value = max;
  return { kind: 'value', value };
}

/** `min` / `max` / `step` attributes for a number input with these bounds. */
export function boundsAttrs(bounds: NumberBounds): string {
  if (bounds.min === undefined && bounds.max === undefined) return '';
  return (
    (bounds.min !== undefined ? ` min="${bounds.min}"` : '') +
    (bounds.max !== undefined ? ` max="${bounds.max}"` : '') +
    // Bounded fields are often fractional (an opacity of 0.5); without this
    // the browser flags anything off the whole-number grid as invalid.
    ' step="any"'
  );
}

/** A number as a field shows it: empty when the property is unset. */
export function numberFieldText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : '';
}
