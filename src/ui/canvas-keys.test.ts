import { describe, expect, it } from 'vitest';
import { canvasKeyCommand } from './canvas-keys.js';

describe('canvasKeyCommand', () => {
  it('zooms with plus and minus, shifted or not, main keys or numpad', () => {
    expect(canvasKeyCommand({ key: '=', code: 'Equal' })).toBe('zoom-in');
    expect(canvasKeyCommand({ key: '+', code: 'Equal', shiftKey: true })).toBe(
      'zoom-in',
    );
    expect(canvasKeyCommand({ key: '+', code: 'NumpadAdd' })).toBe('zoom-in');
    // A keyboard where "+" is a key of its own.
    expect(canvasKeyCommand({ key: '+', code: 'BracketRight' })).toBe(
      'zoom-in',
    );
    expect(canvasKeyCommand({ key: '-', code: 'Minus' })).toBe('zoom-out');
    expect(canvasKeyCommand({ key: '-', code: 'NumpadSubtract' })).toBe(
      'zoom-out',
    );
    expect(canvasKeyCommand({ key: '_', code: 'Minus', shiftKey: true })).toBe(
      'zoom-out',
    );
  });

  it('reads Shift + digit by the physical key, whatever it types', () => {
    // US: Shift+0 types ")", Shift+1 "!", Shift+2 "@".
    expect(canvasKeyCommand({ key: ')', code: 'Digit0', shiftKey: true })).toBe(
      'zoom-100',
    );
    expect(canvasKeyCommand({ key: '!', code: 'Digit1', shiftKey: true })).toBe(
      'zoom-fit',
    );
    expect(canvasKeyCommand({ key: '@', code: 'Digit2', shiftKey: true })).toBe(
      'zoom-selection',
    );
    // German: Shift+0 types "=", which must not be read as zoom in.
    expect(canvasKeyCommand({ key: '=', code: 'Digit0', shiftKey: true })).toBe(
      'zoom-100',
    );
    // …and Shift+2 types a double quote.
    expect(canvasKeyCommand({ key: '"', code: 'Digit2', shiftKey: true })).toBe(
      'zoom-selection',
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
    expect(canvasKeyCommand({ key: 'F2', code: 'F2' })).toBe('rename');
    expect(canvasKeyCommand({ key: 'Enter', code: 'Enter' })).toBe('rename');
    expect(
      canvasKeyCommand({ key: 'Enter', code: 'Enter', shiftKey: true }),
    ).toBeNull();
  });

  it('Enter on a focused control is that control’s key, not rename', () => {
    // A button focused by a click, by script or by assistive technology:
    // Enter presses it.
    expect(canvasKeyCommand({ key: 'Enter', code: 'Enter' }, false)).toBeNull();
    // F2 presses nothing, so it renames from anywhere.
    expect(canvasKeyCommand({ key: 'F2', code: 'F2' }, false)).toBe('rename');
    // The other commands do not depend on where focus is.
    expect(canvasKeyCommand({ key: '+' }, false)).toBe('zoom-in');
    expect(canvasKeyCommand({ key: 's', ctrlKey: true }, false)).toBe('save');
  });

  it('Ctrl / Cmd + Shift + V pastes in place; plain paste is not its business', () => {
    for (const mod of ['ctrlKey', 'metaKey'] as const) {
      expect(canvasKeyCommand({ key: 'V', [mod]: true, shiftKey: true })).toBe(
        'paste-in-place',
      );
      expect(canvasKeyCommand({ key: 'v', [mod]: true })).toBeNull();
    }
  });

  it('Ctrl / Cmd + S saves and + O opens, without Shift', () => {
    for (const mod of ['ctrlKey', 'metaKey'] as const) {
      expect(canvasKeyCommand({ key: 's', [mod]: true })).toBe('save');
      expect(canvasKeyCommand({ key: 'O', [mod]: true })).toBe('open');
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
  });
});
