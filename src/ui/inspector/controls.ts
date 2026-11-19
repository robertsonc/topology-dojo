/**
 * The properties panel draws its native controls with the shared control
 * classes (`src/styles/controls.css`): text, number and select fields are
 * `.field` (numbers also `.data`, the mono face), booleans are `.switch`.
 * The panel's markup comes from many builders (the catalog's fields, the
 * page and document tabs, the annotation editors, metadata), so the classes
 * are given here, in one place, after each draw, rather than repeated in
 * every template; a builder that sets its own class keeps it.
 */

/** Checkboxes that are list ticks, not on/off settings: left as they are. */
const LIST_TICKS = '.emph-cb';

export function adoptSharedControls(root: ParentNode): void {
  root
    .querySelectorAll<HTMLInputElement>(
      'input:not([type="checkbox"]):not([type="range"]):not([type="hidden"])',
    )
    .forEach((el) => {
      el.classList.add('field');
      if (el.type === 'number') el.classList.add('data');
    });
  root
    .querySelectorAll<HTMLElement>('select, textarea')
    .forEach((el) => el.classList.add('field'));
  root
    .querySelectorAll<HTMLInputElement>(
      `input[type="checkbox"]:not(${LIST_TICKS})`,
    )
    .forEach((el) => el.classList.add('switch'));
}
