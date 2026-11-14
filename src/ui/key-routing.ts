/**
 * Who a key press belongs to: the canvas (its single-key shortcuts — V, L,
 * Delete, the arrows, Space to pan…) or the control that has focus.
 *
 * One rule, so the toolbar, the palette, the inspector and the canvas can
 * never disagree about it:
 *
 * - A text field has the keyboard entirely: typing "v" is a letter, Escape and
 *   Ctrl+Z are the field's own.
 * - A control that holds a value (a select, a checkbox, a radio, a slider)
 *   keeps the plain keys it uses to change that value — arrows, letters,
 *   Space, Enter, Delete — so they never also nudge or delete on the canvas.
 * - A control that plain keys activate (a button, a section header, a link)
 *   keeps them while the user is moving around by keyboard, so Space and
 *   Enter press the focused button. A button that was only clicked is not
 *   holding the keyboard: the shortcuts stay with the canvas.
 * - Escape and Ctrl/Cmd combinations reach the canvas from any control, so
 *   undo, redo, copy, paste and find never depend on where focus was left.
 *   Escape also hands the keyboard back to the canvas.
 *
 * The functions here are pure; `main.ts` feeds them what the DOM says.
 */

/** What kind of thing has keyboard focus. */
export type FocusKind =
  /** Nothing interactive: the page body, the canvas, plain content. */
  | 'canvas'
  /** A field text is typed into. */
  | 'text'
  /** A control holding a value that plain keys change. */
  | 'value'
  /** A control that plain keys activate. */
  | 'action';

/** The facts about the focused element that decide its kind. */
export interface FocusFacts {
  /** The element's tag name, in any case. */
  tag: string;
  /** An `<input>`'s type. */
  type?: string | null;
  /** Whether the element is (inside) editable content. */
  editable?: boolean;
  /** The ARIA role, if one is set. */
  role?: string | null;
  /** Whether a tabindex attribute makes the element focusable. */
  tabindex?: boolean;
  /** Whether an `<a>` has an href (a link without one is plain text). */
  href?: boolean;
}

/** Input types that are pressed, not typed into. */
const BUTTON_INPUTS = new Set(['button', 'submit', 'reset', 'image']);
/** Input types that hold a value plain keys step through or toggle. */
const VALUE_INPUTS = new Set(['checkbox', 'radio', 'range', 'color', 'file']);

export function focusKind(el: FocusFacts | null | undefined): FocusKind {
  if (!el) return 'canvas';
  if (el.editable) return 'text';
  const tag = el.tag.toUpperCase();
  if (tag === 'TEXTAREA') return 'text';
  if (tag === 'INPUT') {
    const type = (el.type ?? 'text').toLowerCase();
    if (BUTTON_INPUTS.has(type)) return 'action';
    if (VALUE_INPUTS.has(type)) return 'value';
    return 'text'; // text, search, number, url, date… and any unknown type
  }
  if (tag === 'SELECT') return 'value';
  if (tag === 'BUTTON' || tag === 'SUMMARY') return 'action';
  if (tag === 'A' && el.href) return 'action';
  // A custom widget: something made focusable and given a role.
  if (el.role || el.tabindex) return 'action';
  return 'canvas';
}

/** The facts about a key press that decide where it goes. */
export interface KeyFacts {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** `'canvas'`: run the canvas shortcut. `'focus'`: leave the key to the
 * focused control, untouched. */
export type KeyRoute = 'canvas' | 'focus';

/**
 * Route one key press.
 *
 * `keyboardNav` is whether the user is moving focus by keyboard: true once
 * Tab has moved it, false once a pointer has been pressed.
 */
export function routeKey(
  key: KeyFacts,
  focus: FocusKind,
  keyboardNav: boolean,
): KeyRoute {
  if (focus === 'canvas') return 'canvas';
  if (focus === 'text') return 'focus';
  if (key.key === 'Escape' || key.ctrlKey || key.metaKey) return 'canvas';
  if (focus === 'value') return 'focus';
  return keyboardNav ? 'focus' : 'canvas';
}

/**
 * Whether a control should give focus back to the canvas now that its value
 * was changed. A select or a checkbox picked with the pointer would otherwise
 * keep the keyboard, and the next shortcut — Delete, V — would go to it (a
 * select even reads "V" as type-ahead and picks an option). A change the
 * control's own keys made keeps focus where the keyboard user left it, and a
 * control inside an open dialog keeps focus inside the dialog.
 *
 * `byKeyboard` is whether the last key pressed, with no pointer press since,
 * went to this control — the arrow that stepped the select, the Space that
 * ticked the box.
 */
export function releasesFocusAfterChange(change: {
  focus: FocusFacts;
  byKeyboard: boolean;
  overlayOpen: boolean;
}): boolean {
  if (change.overlayOpen || change.byKeyboard) return false;
  const tag = change.focus.tag.toUpperCase();
  if (tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (change.focus.type ?? '').toLowerCase();
  return type === 'checkbox' || type === 'radio';
}

/**
 * Whether Escape should also take focus off the control it was pressed on.
 * Escape is the one plain key that always reaches the canvas, so it is also
 * the way back to it: after Escape the keyboard is the canvas's again, for a
 * keyboard user who had tabbed to a button as much as for a pointer user who
 * left focus on a menu or a slider. (Tab resumes from where focus was.) A
 * text field keeps its focus — Escape there is the field's own key.
 */
export function escapeReleasesFocus(focus: FocusKind): boolean {
  return focus === 'value' || focus === 'action';
}
