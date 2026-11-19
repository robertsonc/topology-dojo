/**
 * Where the selection bar goes.
 *
 * The bar floats over the canvas beside what is selected. It must never sit
 * on the selection itself: a link's route carries the handles that bend it,
 * and a node's box is what a drag picks up. So the bar goes above the
 * selection, clear of it by a gap; with no room there, below it; and only
 * when the selection leaves no room on either side (it is as tall as the
 * canvas) does the bar keep to the canvas's top edge, over the selection.
 *
 * Pure: boxes in, a position out. All in the canvas host's coordinates.
 */

/** A box by its edges. */
export interface EdgeBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Room kept between the bar and the selection. */
export const SELECTION_BAR_GAP = 12;
/** Room kept between the bar and the canvas's edges. */
export const SELECTION_BAR_EDGE = 4;

export function placeSelectionBar(
  selection: EdgeBox,
  bar: { width: number; height: number },
  host: { width: number; height: number },
): { left: number; top: number } {
  const centred = (selection.left + selection.right) / 2 - bar.width / 2;
  // A bar wider than the canvas starts at its left edge.
  const left = Math.max(
    SELECTION_BAR_EDGE,
    Math.min(centred, host.width - bar.width - SELECTION_BAR_EDGE),
  );
  const above = selection.top - bar.height - SELECTION_BAR_GAP;
  const below = selection.bottom + SELECTION_BAR_GAP;
  const top =
    above >= SELECTION_BAR_EDGE
      ? above
      : below + bar.height <= host.height - SELECTION_BAR_EDGE
        ? below
        : SELECTION_BAR_EDGE;
  return { left: Math.round(left), top: Math.round(top) };
}
