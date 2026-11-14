/**
 * How much of the canvas the floating panels cover, so "fit view" frames the
 * part of the canvas a person can actually see.
 *
 * The canvas runs edge to edge under the chrome: the node library floats over
 * its left edge, the bottom band (frames strip + view controls) over its
 * bottom edge, and on a phone the properties drawer over its right edge.
 * Content fitted to the whole canvas box would land under those panels.
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
  /** The bottom band: frames strip and view controls. */
  dock?: PanelBox | null;
}): FitInsets {
  const { canvas, palette, inspector, dock } = panels;
  const width = Math.max(0, canvas.right - canvas.left);
  const height = Math.max(0, canvas.bottom - canvas.top);
  // How far a panel reaches into the canvas from its edge, plus the gap. A
  // panel docked just outside the canvas reaches in by nothing and still gets
  // the gap, so content never touches the edge it sits against.
  const reach = (px: number): number => Math.max(0, px + FIT_GAP);

  let left = palette ? reach(palette.right - canvas.left) : 0;
  let right = inspector ? reach(canvas.right - inspector.left) : 0;
  let bottom = dock ? reach(canvas.bottom - dock.top) : 0;

  // Keep most of the canvas for the content. When the side panels together
  // ask for more than their share, both give way in proportion.
  const sideCap = width * MAX_SHARE;
  if (left + right > sideCap) {
    const scale = left + right > 0 ? sideCap / (left + right) : 0;
    left *= scale;
    right *= scale;
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
