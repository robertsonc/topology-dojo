import type { FieldSpec } from '../../api/catalog.js';
import {
  numberBounds,
  numberFieldText,
  parseNumberField,
} from '../number-field.js';

/**
 * Wire one number input. Each keystroke is read by `parseNumberField`: a
 * cleared field unsets the property (`undefined`), an out-of-range number is
 * clamped, and text that is no usable number stores nothing. Leaving the
 * field then shows what is stored, so a clamped or refused entry does not
 * linger looking as if it had been accepted.
 */
export function wireNumberInput(
  el: HTMLInputElement,
  spec: FieldSpec | undefined,
  set: (val: number | undefined) => void,
  stored: () => unknown,
): void {
  const bounds = spec ? numberBounds(spec) : {};
  el.addEventListener('input', () => {
    const parsed = parseNumberField(el.value, bounds, {
      required: spec?.required,
      badInput: el.validity.badInput,
    });
    if (parsed.kind === 'invalid') return;
    set(parsed.kind === 'value' ? parsed.value : undefined);
  });
  el.addEventListener('change', () => {
    el.value = numberFieldText(stored());
  });
}
