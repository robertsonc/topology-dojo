/**
 * The properties column at its narrower widths.
 *
 * At the default width (300px) and above, the tab row has room for the
 * three tabs and the "hide" toggle with its word. Below it the toggle keeps
 * its icon only (its word stays as its name, for assistive technology), so
 * the tab labels are not cut short. The column carries the class `narrow`
 * while the panel is under that width, whatever set it: a stored width, the
 * resizer, or a small screen.
 */

/** The panel width under which the column is narrow. */
export const NARROW_BELOW = 300;

export function isNarrow(width: number): boolean {
  return width > 0 && width < NARROW_BELOW;
}

/** Keep `column`'s `narrow` class in step with `panel`'s drawn width. */
export function watchPanelWidth(panel: HTMLElement, column: HTMLElement): void {
  const update = (): void => {
    const width = panel.offsetWidth;
    // A hidden panel (the column collapsed) keeps the class it had.
    if (width > 0) column.classList.toggle('narrow', isNarrow(width));
  };
  new ResizeObserver(update).observe(panel);
  update();
}
