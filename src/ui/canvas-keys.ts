/**
 * The canvas shortcuts for the view, renaming and files: which command a key
 * press is, if any. Pure; `main.ts` runs the command.
 *
 * Zoom uses plain keys (+ and -) and Shift + a digit, not Ctrl / Cmd + plus,
 * minus and zero: those belong to the browser's own page zoom, which people
 * who need larger text rely on, and a canvas shortcut that reaches the canvas
 * from every control would take it away from them.
 *
 * The Shift + digit shortcuts are matched by physical key (`code`), because
 * the character a shifted digit types depends on the keyboard layout: Shift+0
 * is ")" on a US keyboard and "=" on a German one.
 */

export type CanvasKeyCommand =
  | 'zoom-in'
  | 'zoom-out'
  /** One page unit per pixel. */
  | 'zoom-100'
  /** Fit the whole page content in view. */
  | 'zoom-fit'
  /** Frame the selection (the whole content when nothing is selected). */
  | 'zoom-selection'
  /** Edit the label of the one selected node, link or zone. */
  | 'rename'
  /** Paste at the coordinates the clipboard was copied from. */
  | 'paste-in-place'
  /** Download the document as JSON. */
  | 'save'
  /** Open a file. */
  | 'open';

/** The part of a `KeyboardEvent` the mapping reads. */
export interface CanvasKey {
  key: string;
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * The command a key press is, or null.
 *
 * `focusOnCanvas` is whether nothing interactive has focus (the page body or
 * the canvas). Enter renames only then: on a focused button Enter is the key
 * that presses it, however the button came to be focused, and no shortcut
 * may take that away.
 */
export function canvasKeyCommand(
  e: CanvasKey,
  focusOnCanvas = true,
): CanvasKeyCommand | null {
  // Alt combinations are other commands (the format painter) or the
  // platform's own (AltGr characters, menu access keys).
  if (e.altKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (e.ctrlKey || e.metaKey) {
    if (e.shiftKey) return key === 'v' ? 'paste-in-place' : null;
    if (key === 's') return 'save';
    if (key === 'o') return 'open';
    return null;
  }

  if (e.shiftKey) {
    if (e.code === 'Digit0') return 'zoom-100';
    if (e.code === 'Digit1') return 'zoom-fit';
    if (e.code === 'Digit2') return 'zoom-selection';
  }
  // "+" is Shift+"=" on a US keyboard and its own key on many others; the
  // numpad's keys report the same characters.
  if (key === '+' || key === '=') return 'zoom-in';
  if (key === '-' || key === '_') return 'zoom-out';
  if (e.shiftKey) return null;
  if (key === 'F2') return 'rename';
  if (key === 'Enter' && focusOnCanvas) return 'rename';
  return null;
}
