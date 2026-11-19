/**
 * The compact layout: below 1,024px the panels are drawers (#221, proposal
 * 0013).
 *
 * Docked, the node library (208px beside the 44px rail) and the properties
 * panel (300px and its padding) leave the canvas what is left of the
 * window: 144px at 720px. So from `COMPACT_LAYOUT_MAX_PX` down both panels
 * float over the canvas as drawers instead, and the canvas column always
 * runs from the rail to the window's right edge. From 1,024px up both dock,
 * as the top bar already treats 1,024px as the narrowest desktop.
 *
 * What moves at this breakpoint, and what stays a phone rule:
 *
 * - At 1,023px and below (here, and the `@media (max-width: 1023px)` blocks
 *   of `src/styles/shell.css` and `src/styles/inspector.css`): the library
 *   and the properties panel leave their grid columns and float as drawers
 *   over the canvas, clear of the pages bar and the status bar; with no
 *   stored choice both start closed.
 * - At 640px and below (the `@media (max-width: 640px)` blocks): the
 *   phone's own tightening. The top bar's gaps, the hidden Present button
 *   and logo, the pages bar's gaps, the narrower drawers (the library at
 *   most the stage less 116px, the properties panel 240px), the closed
 *   properties toggle inset from the corner, and the canvas's minimum box.
 * - The top bar folds on its own widths (1,360 / 1,100 / 1,023 / 760px) and
 *   the status bar at 700px and 400px; neither depends on this breakpoint.
 *
 * The stylesheet's drawer rules and this number must agree; a unit test
 * reads the media queries from the CSS to keep them so.
 */

/** The widest window that lays the panels out as drawers. */
export const COMPACT_LAYOUT_MAX_PX = 1023;

export const COMPACT_LAYOUT_MQ = `(max-width: ${COMPACT_LAYOUT_MAX_PX}px)`;

/** The widest window laid out as a phone (the 640px blocks above). */
export const PHONE_LAYOUT_MAX_PX = 640;

export const PHONE_LAYOUT_MQ = `(max-width: ${PHONE_LAYOUT_MAX_PX}px)`;

/** True when the layout width is at or below the compact breakpoint. */
export function isCompactLayoutWidth(width: number): boolean {
  return width <= COMPACT_LAYOUT_MAX_PX;
}

/**
 * True for the compact layout above a phone (641-1,023px), where the
 * drawers keep at least 72px of canvas between them: there, fit view clears
 * what they cover whole, the selection's mini bar keeps to the canvas they
 * leave showing, and the zoom control and the minimap move left of an open
 * properties drawer (the `(min-width: 641px) and (max-width: 1023px)` blocks).
 * A phone's drawers can cover the canvas between them, and keep the phone's
 * own rules.
 */
export function isCompactAbovePhone(width: number): boolean {
  return width > PHONE_LAYOUT_MAX_PX && isCompactLayoutWidth(width);
}

/**
 * Collapse preference for the node library / properties panel.
 * `'1'` / `'0'` are explicit user choices (always honoured). `null` means
 * no stored choice: a drawer starts closed, a docked panel open.
 */
export function defaultPanelCollapsed(
  stored: string | null,
  compact: boolean,
): boolean {
  if (stored === '1') return true;
  if (stored === '0') return false;
  return compact;
}

/** The least canvas two open drawers may leave between them. */
export const DRAWER_MIN_CANVAS_PX = 160;

/**
 * Whether opening one drawer should close the other: always on a phone
 * (640px and below), and wherever the two open drawers would leave less than
 * `DRAWER_MIN_CANVAS_PX` of canvas between them. `between` is the canvas
 * width the two leave showing (negative when they overlap). Only the
 * compact layout has drawers; docked panels never close each other. Closing
 * by this rule is not the person's choice, so it is never stored.
 */
export function drawersCrowd(width: number, between: number): boolean {
  if (!isCompactLayoutWidth(width)) return false;
  return width <= PHONE_LAYOUT_MAX_PX || between < DRAWER_MIN_CANVAS_PX;
}

/**
 * Whether two drawers that are both open, with neither just opened (at load,
 * or as the window narrows), should be shown as one. On a phone the two
 * cover each other and the whole canvas, so only one is shown; above a phone
 * they keep at least 72px of canvas and stay as the person left them.
 */
export function drawersCrowdAtRest(width: number): boolean {
  return width <= PHONE_LAYOUT_MAX_PX;
}
