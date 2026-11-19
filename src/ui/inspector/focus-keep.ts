/**
 * Keeping keyboard focus across a redraw of the properties panel.
 *
 * The panel draws itself from markup, so every control is replaced each time
 * it redraws: after a command run from the panel (the lock toggle, the "more"
 * menu, a swatch) the focused control would be gone and focus would fall to
 * the page. `markFocus` notes which control had focus before the redraw, by
 * its id or its `data-*` attributes and its place among the controls that
 * share them, together with a text field's caret; `restoreFocus` puts focus on
 * the same control of the new markup (only while the keyboard is driving:
 * see `markFocus`). When that control is no longer drawn (the selection was
 * deleted, say), focus goes to `fallback` instead, so it never ends up on the
 * page.
 */

export interface FocusMark {
  selector: string;
  index: number;
  start: number | null;
  end: number | null;
}

/** A selector for the control that matches it in the next drawing too. */
function selectorFor(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const attrs = el
    .getAttributeNames()
    .filter((name) => name.startsWith('data-'))
    .map((name) => `[${name}="${CSS.escape(el.getAttribute(name) ?? '')}"]`)
    .join('');
  return el.tagName.toLowerCase() + attrs;
}

function caret(el: HTMLElement): [number | null, number | null] {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement))
    return [null, null];
  try {
    return [el.selectionStart, el.selectionEnd];
  } catch {
    // Number fields and the like have no caret to read.
    return [null, null];
  }
}

/**
 * Note the control under `root` that has focus, if one does and the keyboard
 * is driving it. A control a pointer clicked is let go, as it always was: the
 * shell's shortcuts go back to the canvas once the panel redraws.
 */
export function markFocus(root: HTMLElement): FocusMark | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === root || !root.contains(el))
    return null;
  if (!el.matches(':focus-visible')) return null;
  const selector = selectorFor(el);
  const index = [...root.querySelectorAll(selector)].indexOf(el);
  const [start, end] = caret(el);
  return { selector, index: Math.max(0, index), start, end };
}

/**
 * Focus the control `mark` names under `root`, or `fallback` when it is not
 * drawn any more. Nothing happens when there was no mark, or when something
 * already holds focus again (a control that focuses itself as it is wired).
 */
export function restoreFocus(
  root: HTMLElement,
  mark: FocusMark | null,
  fallback: () => HTMLElement | null,
): void {
  if (!mark) return;
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  const el = root.querySelectorAll<HTMLElement>(mark.selector)[mark.index];
  el?.focus({ preventScroll: true });
  if (el && document.activeElement === el) {
    if (
      mark.start !== null &&
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
    ) {
      try {
        el.setSelectionRange(mark.start, mark.end ?? mark.start);
      } catch {
        // The field's kind changed to one without a caret.
      }
    }
    return;
  }
  fallback()?.focus({ preventScroll: true });
}
