/**
 * How much of the canvas the floating panels cover, so "fit view" frames the
 * part of the canvas a person can actually see.
 *
 * Most of the chrome is docked around the canvas: the rail and the node
 * library on its left, the pages bar under it, the properties panel on its
 * right. What still floats over it is the zoom control in its bottom-right
 * corner, with the minimap card above it when that is open, and below
 * 1,024px the library and properties drawers over its edges. Content fitted
 * to the whole canvas box would land under those.
 */

/** A box in viewport pixels (the part of a DOMRect this module reads). */
export interface PanelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Pixels of the canvas, per edge, that a fit should leave free. */
export interface FitInsets {
  left: number;
  right: number;
  bottom: number;
}

/** Breathing room between fitted content and the panel beside it. */
export const FIT_GAP = 12;

/** A fit never gives up more than this share of the canvas, per axis. */
const MAX_SHARE = 0.6;

/** The narrowest strip a fit keeps for the content between two drawers. */
export const MIN_FIT_BAND = 24;

/**
 * The insets for a fit. Pass the box of each panel that is currently open and
 * floating over the canvas; leave out (or pass null for) a panel that is
 * collapsed, since a collapsed panel is a small pill that costs nothing.
 */
export function fitInsets(panels: {
  canvas: PanelBox;
  /** The open node library, on the left edge. */
  palette?: PanelBox | null;
  /** The open properties panel, on the right edge. */
  inspector?: PanelBox | null;
  /** What floats in the canvas's bottom-right corner: the zoom control, or
   * the zoom control and the minimap card above it (their joint box). */
  corner?: PanelBox | null;
  /** The library and the properties panel are drawers over the canvas (the
   * compact layout above a phone): the fit clears what they cover whole,
   * however little canvas they leave between them. */
  drawers?: boolean;
}): FitInsets {
  const { canvas, palette, inspector, corner, drawers = false } = panels;
  const width = Math.max(0, canvas.right - canvas.left);
  const height = Math.max(0, canvas.bottom - canvas.top);
  // How far a panel reaches into the canvas from its edge, plus the gap. A
  // panel docked just outside the canvas reaches in by nothing and still gets
  // the gap, so content never touches the edge it sits against.
  const reach = (px: number): number => Math.max(0, px + FIT_GAP);

  let left = palette ? reach(palette.right - canvas.left) : 0;
  let right = inspector ? reach(canvas.right - inspector.left) : 0;
  let bottom = 0;
  // What the drawers cover is kept whole, short of the narrowest strip.
  let keepLeft = 0;
  let keepRight = 0;
  if (drawers) {
    const most = Math.max(0, width - MIN_FIT_BAND);
    const scale = left + right > most ? most / (left + right) : 1;
    keepLeft = left = left * scale;
    keepRight = right = right * scale;
  }
  // A corner card can be cleared by giving up a strip on the right or a band
  // at the bottom. It takes whichever costs the smaller share of its axis:
  // the low, wide zoom control takes a band at the bottom, the tall minimap
  // card above it a strip on the right.
  if (corner && width > 0 && height > 0) {
    const toRight = reach(canvas.right - corner.left);
    const toBottom = reach(canvas.bottom - corner.top);
    // Beside a drawer, a strip costs only what it adds to the drawer's.
    const strip = toRight - keepRight;
    if (strip / width < toBottom / height) right = Math.max(right, toRight);
    else bottom = toBottom;
  }

  // Keep most of the canvas for the content. When the side panels together
  // ask for more than their share, both give way in proportion; what the
  // drawers cover does not give way.
  const sideCap = Math.max(width * MAX_SHARE, keepLeft + keepRight);
  if (left + right > sideCap) {
    const flex = left - keepLeft + (right - keepRight);
    const scale = flex > 0 ? (sideCap - keepLeft - keepRight) / flex : 0;
    left = keepLeft + (left - keepLeft) * scale;
    right = keepRight + (right - keepRight) * scale;
  }
  bottom = Math.min(bottom, height * MAX_SHARE);
  return { left, right, bottom };
}

/**
 * The editor's fit understands a right and a bottom inset only: it scales the
 * content to the canvas minus those, and centres it in what remains, measured
 * from the canvas's left edge. To honour a left inset through that interface,
 * the left inset is folded into the right one (so the scale is right) and the
 * fitted view is then moved by `leftInsetShift`.
 */
export function editorInsets(insets: FitInsets): {
  right: number;
  bottom: number;
} {
  return { right: insets.left + insets.right, bottom: insets.bottom };
}

/**
 * How far, in page units, to move a fitted view so its content sits `left`
 * pixels further right — past the panel on the left edge. `viewWidth` is the
 * width of the fitted view in page units and `canvasWidth` the canvas's width
 * in pixels; together they give the fit's scale.
 */
export function leftInsetShift(
  viewWidth: number,
  canvasWidth: number,
  left: number,
): number {
  if (!(canvasWidth > 0) || !(left > 0)) return 0;
  return (left * viewWidth) / canvasWidth;
}
