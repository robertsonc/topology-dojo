/**
 * Key presses that belong to an input method, not to the application.
 *
 * While an IME composition is open (Japanese, Chinese, Korean and other
 * input methods build a word from several key presses), Enter confirms the
 * candidate and Escape discards it. Those key presses still reach the page as
 * keydown events. A handler that takes Enter as "commit this field" or Escape
 * as "cancel" must skip them, or it closes the field in the middle of a word.
 */

/** The part of a KeyboardEvent this check reads. */
export interface ImeKeyFacts {
  isComposing?: boolean;
  keyCode?: number;
}

/**
 * Whether a keydown is part of an IME composition. `isComposing` is the
 * standard flag; some browsers instead (or also) report the key as the
 * placeholder key code 229 while the input method has the keyboard.
 */
export function isImeKey(e: ImeKeyFacts): boolean {
  return e.isComposing === true || e.keyCode === 229;
}
