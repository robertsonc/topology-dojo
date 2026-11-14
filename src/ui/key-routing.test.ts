import { describe, expect, it } from 'vitest';
import {
  escapeReleasesFocus,
  focusKind,
  releasesFocusAfterChange,
  routeKey,
  type FocusKind,
} from './key-routing.js';

/** Keys the canvas uses on their own: tools, delete, nudge, pan, fit. */
const PLAIN_KEYS = [
  'v',
  'L',
  'a',
  'Delete',
  'Backspace',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  ' ',
  'Enter',
  '0',
  '?',
  '[',
];

describe('focusKind', () => {
  it('treats the page body and plain content as the canvas', () => {
    expect(focusKind(null)).toBe('canvas');
    expect(focusKind({ tag: 'BODY' })).toBe('canvas');
    expect(focusKind({ tag: 'div' })).toBe('canvas');
    expect(focusKind({ tag: 'svg' })).toBe('canvas');
  });

  it('recognises every field text is typed into', () => {
    for (const type of ['text', 'search', 'number', 'url', 'email', 'date'])
      expect(focusKind({ tag: 'INPUT', type })).toBe('text');
    // An input with no type attribute is a text input.
    expect(focusKind({ tag: 'INPUT' })).toBe('text');
    expect(focusKind({ tag: 'INPUT', type: null })).toBe('text');
    expect(focusKind({ tag: 'TEXTAREA' })).toBe('text');
    expect(focusKind({ tag: 'DIV', editable: true })).toBe('text');
  });

  it('recognises controls that hold a value', () => {
    expect(focusKind({ tag: 'SELECT' })).toBe('value');
    for (const type of ['checkbox', 'radio', 'range', 'color', 'file'])
      expect(focusKind({ tag: 'INPUT', type })).toBe('value');
  });

  it('recognises controls that are pressed', () => {
    expect(focusKind({ tag: 'BUTTON' })).toBe('action');
    expect(focusKind({ tag: 'SUMMARY' })).toBe('action');
    expect(focusKind({ tag: 'A', href: true })).toBe('action');
    expect(focusKind({ tag: 'INPUT', type: 'button' })).toBe('action');
    expect(focusKind({ tag: 'INPUT', type: 'submit' })).toBe('action');
    // The save chip: a span made into a button.
    expect(focusKind({ tag: 'SPAN', role: 'button', tabindex: true })).toBe(
      'action',
    );
    expect(focusKind({ tag: 'DIV', tabindex: true })).toBe('action');
  });

  it('does not treat a link without an href as a control', () => {
    expect(focusKind({ tag: 'A' })).toBe('canvas');
  });

  it('is not fooled by tag or type case', () => {
    expect(focusKind({ tag: 'select' })).toBe('value');
    expect(focusKind({ tag: 'input', type: 'CHECKBOX' })).toBe('value');
  });
});

describe('routeKey', () => {
  it('gives every key to the canvas when nothing interactive has focus', () => {
    for (const key of [...PLAIN_KEYS, 'Escape'])
      expect(routeKey({ key }, 'canvas', true)).toBe('canvas');
    expect(routeKey({ key: 'z', ctrlKey: true }, 'canvas', false)).toBe(
      'canvas',
    );
  });

  it('leaves every key, Escape and Ctrl+Z included, to a text field', () => {
    for (const nav of [true, false]) {
      for (const key of [...PLAIN_KEYS, 'Escape'])
        expect(routeKey({ key }, 'text', nav)).toBe('focus');
      expect(routeKey({ key: 'z', ctrlKey: true }, 'text', nav)).toBe('focus');
      expect(routeKey({ key: 'v', metaKey: true }, 'text', nav)).toBe('focus');
    }
  });

  it('leaves plain keys to a select, checkbox or slider however it was focused', () => {
    for (const nav of [true, false])
      for (const key of PLAIN_KEYS)
        expect(routeKey({ key }, 'value', nav)).toBe('focus');
  });

  it('leaves plain keys to a button the keyboard moved focus to', () => {
    for (const key of PLAIN_KEYS)
      expect(routeKey({ key }, 'action', true)).toBe('focus');
  });

  it('keeps the shortcuts on the canvas after a button was only clicked', () => {
    for (const key of PLAIN_KEYS)
      expect(routeKey({ key }, 'action', false)).toBe('canvas');
  });

  it('lets Escape and Ctrl/Cmd combinations through from any control', () => {
    const controls: FocusKind[] = ['value', 'action'];
    for (const focus of controls)
      for (const nav of [true, false]) {
        expect(routeKey({ key: 'Escape' }, focus, nav)).toBe('canvas');
        expect(routeKey({ key: 'z', ctrlKey: true }, focus, nav)).toBe(
          'canvas',
        );
        expect(routeKey({ key: 'Z', metaKey: true }, focus, nav)).toBe(
          'canvas',
        );
        expect(routeKey({ key: 'c', ctrlKey: true }, focus, nav)).toBe(
          'canvas',
        );
        expect(routeKey({ key: 'v', metaKey: true }, focus, nav)).toBe(
          'canvas',
        );
        expect(routeKey({ key: 'f', ctrlKey: true }, focus, nav)).toBe(
          'canvas',
        );
      }
  });
});

describe('releasesFocusAfterChange', () => {
  const select = { tag: 'SELECT' };
  const checkbox = { tag: 'INPUT', type: 'checkbox' };

  it('hands the keyboard back after a pointer pick in a select or checkbox', () => {
    for (const focus of [select, checkbox, { tag: 'INPUT', type: 'radio' }])
      expect(
        releasesFocusAfterChange({
          focus,
          byKeyboard: false,
          overlayOpen: false,
        }),
      ).toBe(true);
  });

  it("leaves focus where the control's own keys changed the value", () => {
    for (const focus of [select, checkbox])
      expect(
        releasesFocusAfterChange({
          focus,
          byKeyboard: true,
          overlayOpen: false,
        }),
      ).toBe(false);
  });

  it('keeps focus inside an open dialog', () => {
    expect(
      releasesFocusAfterChange({
        focus: select,
        byKeyboard: false,
        overlayOpen: true,
      }),
    ).toBe(false);
  });

  it('leaves text fields and sliders focused: they are still in use', () => {
    for (const type of ['text', 'number', 'range', 'color'])
      expect(
        releasesFocusAfterChange({
          focus: { tag: 'INPUT', type },
          byKeyboard: false,
          overlayOpen: false,
        }),
      ).toBe(false);
    expect(
      releasesFocusAfterChange({
        focus: { tag: 'TEXTAREA' },
        byKeyboard: false,
        overlayOpen: false,
      }),
    ).toBe(false);
  });
});

describe('escapeReleasesFocus', () => {
  it('hands the keyboard back to the canvas from any control', () => {
    expect(escapeReleasesFocus('value')).toBe(true);
    expect(escapeReleasesFocus('action')).toBe(true);
  });

  it('leaves a text field focused, and has nothing to release on the canvas', () => {
    expect(escapeReleasesFocus('text')).toBe(false);
    expect(escapeReleasesFocus('canvas')).toBe(false);
  });
});
