/**
 * The canvas shortcuts for the view, renaming and files: the first nine
 * shortcuts decided by a pure function (once `canvasKeyCommand` of a module
 * of their own). They are rows of the key table in commands.ts now, and
 * these are the cases that pinned the reasons for them: zoom on plain keys
 * so the browser keeps its own page zoom, Shift + digit by physical key
 * because what a shifted digit types depends on the layout.
 */
import { describe, expect, it } from 'vitest';
import { matchKey, type CommandId, type KeyPress } from './commands.js';

/** The nine; each takes its key from the browser. */
const CANVAS_KEY_COMMANDS: ReadonlySet<CommandId> = new Set<CommandId>([
  'view.zoomIn',
  'view.zoomOut',
  'view.zoom100',
  'view.fit',
  'view.zoomToSelection',
  'edit.rename',
  'edit.pasteInPlace',
  'file.download',
  'file.open',
]);

/**
 * Which of the nine a key press is, or null. `focusOnCanvas` is whether
 * nothing interactive has focus (the page body or the canvas). The plain "0"
 * fits the view too, but leaves the key alone: it never was one of them.
 */
function canvasKeyCommand(e: KeyPress, focusOnCanvas = true): CommandId | null {
  const hit = matchKey(e, { focusOnCanvas, selectionCount: 0 });
  return hit?.preventDefault && CANVAS_KEY_COMMANDS.has(hit.id) ? hit.id : null;
}

describe('the canvas shortcuts in the key table', () => {
  it('zooms with plus and minus, shifted or not, main keys or numpad', () => {
    expect(canvasKeyCommand({ key: '=', code: 'Equal' })).toBe('view.zoomIn');
    expect(canvasKeyCommand({ key: '+', code: 'Equal', shiftKey: true })).toBe(
      'view.zoomIn',
    );
    expect(canvasKeyCommand({ key: '+', code: 'NumpadAdd' })).toBe(
      'view.zoomIn',
    );
    // A keyboard where "+" is a key of its own.
    expect(canvasKeyCommand({ key: '+', code: 'BracketRight' })).toBe(
      'view.zoomIn',
    );
    expect(canvasKeyCommand({ key: '-', code: 'Minus' })).toBe('view.zoomOut');
    expect(canvasKeyCommand({ key: '-', code: 'NumpadSubtract' })).toBe(
      'view.zoomOut',
    );
    expect(canvasKeyCommand({ key: '_', code: 'Minus', shiftKey: true })).toBe(
      'view.zoomOut',
    );
  });

  it('reads Shift + digit by the physical key, whatever it types', () => {
    // US: Shift+0 types ")", Shift+1 "!", Shift+2 "@".
    expect(canvasKeyCommand({ key: ')', code: 'Digit0', shiftKey: true })).toBe(
      'view.zoom100',
    );
    expect(canvasKeyCommand({ key: '!', code: 'Digit1', shiftKey: true })).toBe(
      'view.fit',
    );
    expect(canvasKeyCommand({ key: '@', code: 'Digit2', shiftKey: true })).toBe(
      'view.zoomToSelection',
    );
    // German: Shift+0 types "=", which must not be read as zoom in.
    expect(canvasKeyCommand({ key: '=', code: 'Digit0', shiftKey: true })).toBe(
      'view.zoom100',
    );
    // …and Shift+2 types a double quote.
    expect(canvasKeyCommand({ key: '"', code: 'Digit2', shiftKey: true })).toBe(
      'view.zoomToSelection',
    );
  });

  it('leaves the plain digits alone (0 already fits the view)', () => {
    for (const d of ['0', '1', '2'])
      expect(canvasKeyCommand({ key: d, code: `Digit${d}` })).toBeNull();
  });

  it("leaves the browser's own zoom keys to the browser", () => {
    for (const mod of ['ctrlKey', 'metaKey'] as const)
      for (const key of ['+', '=', '-', '0'])
        expect(canvasKeyCommand({ key, [mod]: true })).toBeNull();
  });

  it('F2 and Enter rename; Shift+Enter does not', () => {
    expect(canvasKeyCommand({ key: 'F2', code: 'F2' })).toBe('edit.rename');
    expect(canvasKeyCommand({ key: 'Enter', code: 'Enter' })).toBe(
      'edit.rename',
    );
    expect(
      canvasKeyCommand({ key: 'Enter', code: 'Enter', shiftKey: true }),
    ).toBeNull();
    expect(
      canvasKeyCommand({ key: 'F2', code: 'F2', shiftKey: true }),
    ).toBeNull();
  });

  it('Enter on a focused control is that control’s key, not rename', () => {
    // A button focused by a click, by script or by assistive technology:
    // Enter presses it.
    expect(canvasKeyCommand({ key: 'Enter', code: 'Enter' }, false)).toBeNull();
    // F2 presses nothing, so it renames from anywhere.
    expect(canvasKeyCommand({ key: 'F2', code: 'F2' }, false)).toBe(
      'edit.rename',
    );
    // The other commands do not depend on where focus is.
    expect(canvasKeyCommand({ key: '+' }, false)).toBe('view.zoomIn');
    expect(canvasKeyCommand({ key: 's', ctrlKey: true }, false)).toBe(
      'file.download',
    );
  });

  it('Ctrl / Cmd + Shift + V pastes in place; plain paste is not its business', () => {
    for (const mod of ['ctrlKey', 'metaKey'] as const) {
      expect(canvasKeyCommand({ key: 'V', [mod]: true, shiftKey: true })).toBe(
        'edit.pasteInPlace',
      );
      expect(canvasKeyCommand({ key: 'v', [mod]: true })).toBeNull();
    }
  });

  it('Ctrl / Cmd + S saves and + O opens, without Shift', () => {
    for (const mod of ['ctrlKey', 'metaKey'] as const) {
      expect(canvasKeyCommand({ key: 's', [mod]: true })).toBe('file.download');
      expect(canvasKeyCommand({ key: 'O', [mod]: true })).toBe('file.open');
      expect(
        canvasKeyCommand({ key: 's', [mod]: true, shiftKey: true }),
      ).toBeNull();
    }
  });

  it('is nothing with Alt held (format painter, AltGr characters)', () => {
    expect(
      canvasKeyCommand({ key: 'v', ctrlKey: true, altKey: true }),
    ).toBeNull();
    expect(canvasKeyCommand({ key: '+', altKey: true })).toBeNull();
    expect(
      canvasKeyCommand({
        key: 'v',
        ctrlKey: true,
        shiftKey: true,
        altKey: true,
      }),
    ).toBeNull();
  });

  it('is nothing for the keys other shortcuts own', () => {
    for (const key of [
      'v',
      'l',
      'a',
      'Delete',
      'Escape',
      ' ',
      'ArrowLeft',
      '?',
    ])
      expect(canvasKeyCommand({ key })).toBeNull();
    // …and for the ones other shortcuts take from the browser.
    for (const key of ['z', 'c', 'a', 'd'])
      expect(canvasKeyCommand({ key, ctrlKey: true })).toBeNull();
  });
});
