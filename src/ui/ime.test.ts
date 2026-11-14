import { describe, expect, it } from 'vitest';
import { isImeKey } from './ime.js';

describe('isImeKey', () => {
  it('recognises a key pressed during a composition', () => {
    expect(isImeKey({ isComposing: true, keyCode: 13 })).toBe(true);
  });

  it('recognises the placeholder key code some browsers send instead', () => {
    expect(isImeKey({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeKey({ keyCode: 229 })).toBe(true);
  });

  it('lets an ordinary Enter or Escape through', () => {
    expect(isImeKey({ isComposing: false, keyCode: 13 })).toBe(false);
    expect(isImeKey({ isComposing: false, keyCode: 27 })).toBe(false);
    expect(isImeKey({})).toBe(false);
  });
});
