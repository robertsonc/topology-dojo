/**
 * The shared slider (`<input type="range" class="range">`, styled in
 * src/styles/controls.css).
 *
 * A styled track has no fill of its own outside Firefox, so the stylesheet
 * draws the part before the thumb from `--range-fill`, and these helpers keep
 * that property in step with the value.
 */

/** How much of a slider lies before its thumb, as a CSS percentage. */
export function rangeFill(min: number, max: number, value: number): string {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min))
    return '0%';
  const share = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return `${(share * 100).toFixed(2)}%`;
}

/** Fill one slider's track up to its current value. */
export function paintRange(input: HTMLInputElement): void {
  // An unset min or max reads as "" (0): the element's own defaults apply.
  const min = input.min === '' ? 0 : Number(input.min);
  const max = input.max === '' ? 100 : Number(input.max);
  input.style.setProperty(
    '--range-fill',
    rangeFill(min, max, Number(input.value)),
  );
}

/** Fill every slider under `root`: after a render, and after a value is set
 * from script (an `input` event repaints the one that moved). */
export function paintRanges(root: ParentNode): void {
  for (const input of root.querySelectorAll<HTMLInputElement>(
    'input[type="range"]',
  ))
    paintRange(input);
}
