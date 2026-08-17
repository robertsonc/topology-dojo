/**
 * Phone-width editor chrome (#221).
 *
 * At ~390px the docked properties column plus the floating node library can
 * consume the whole stage, and `overflow: hidden` on the canvas area leaves
 * no way to recover a drawing surface. These helpers decide the default
 * collapsed state; CSS at `MOBILE_LAYOUT_MQ` turns the inspector into a
 * drawer so an open panel still leaves a usable canvas.
 */

/** Matches the `@media (max-width: …)` block in `index.html`. */
export const MOBILE_LAYOUT_MAX_PX = 640;

export const MOBILE_LAYOUT_MQ = `(max-width: ${MOBILE_LAYOUT_MAX_PX}px)`;

/** True when the layout width is at or below the phone breakpoint. */
export function isMobileLayoutWidth(width: number): boolean {
  return width <= MOBILE_LAYOUT_MAX_PX;
}

/**
 * Collapse preference for the node library / properties rail.
 * `'1'` / `'0'` are explicit user choices (always honoured). `null` means
 * no stored choice — closed on a phone viewport, open on desktop.
 */
export function defaultPanelCollapsed(
  stored: string | null,
  mobile: boolean,
): boolean {
  if (stored === '1') return true;
  if (stored === '0') return false;
  return mobile;
}
