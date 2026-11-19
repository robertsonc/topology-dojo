/**
 * The canvas shortcuts for the view, renaming and files: which of them a key
 * press is, if any.
 *
 * These nine were the first shortcuts to be decided by a pure function. The
 * decision now lives with every other shortcut in the key table of
 * `commands.ts` (`matchKey`), where the reasons are written down: zoom on
 * plain keys so the browser keeps its own page zoom, Shift + digit by
 * physical key because what a shifted digit types depends on the layout.
 * This module is that table seen through the old names, and its tests are
 * the ones that pinned those reasons.
 */
import { matchKey, type CommandId, type KeyPress } from './commands.js';

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
export type CanvasKey = KeyPress;

const CANVAS_KEY_COMMANDS: Partial<Record<CommandId, CanvasKeyCommand>> = {
  'view.zoomIn': 'zoom-in',
  'view.zoomOut': 'zoom-out',
  'view.zoom100': 'zoom-100',
  'view.fit': 'zoom-fit',
  'view.zoomToSelection': 'zoom-selection',
  'edit.rename': 'rename',
  'edit.pasteInPlace': 'paste-in-place',
  'file.download': 'save',
  'file.open': 'open',
};

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
  const hit = matchKey(e, { focusOnCanvas, selectionCount: 0 });
  // Each of the nine takes its key from the browser. The plain "0" fits the
  // view too, but leaves the key alone: it never was one of them.
  if (!hit?.preventDefault) return null;
  return CANVAS_KEY_COMMANDS[hit.id] ?? null;
}
