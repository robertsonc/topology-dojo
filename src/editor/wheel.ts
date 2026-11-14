/**
 * What a wheel event means on the canvas.
 *
 * The browser sends the same `wheel` event for three different things: a
 * mouse wheel turned a notch, two fingers sliding on a trackpad, and two
 * fingers pinching on a trackpad (which arrives with `ctrlKey` set). Diagram
 * tools read them the same way everywhere: a pinch zooms, a two-finger slide
 * pans, and Ctrl / Cmd + wheel zooms. A bare mouse wheel is the one that
 * differs between tools; here it zooms, as it always has, unless the user
 * sets the wheel to pan.
 *
 * Telling a mouse wheel from a trackpad is a guess: the event does not say
 * which device sent it. The guess used here is the common one (see
 * `fromTrackpad`), it is made once per burst of events so a gesture never
 * changes meaning half way, and `WheelMode` lets the user overrule it.
 *
 * Pure and DOM-free; `Editor` feeds it the events.
 */

/** What a plain wheel event (no Ctrl / Cmd / Shift) does. */
export type WheelMode =
  /** Guess the device: a mouse wheel zooms, a trackpad pans. */
  | 'auto'
  /** Always zoom at the cursor (the behaviour before trackpads were told apart). */
  | 'zoom'
  /** Always scroll the view; zoom with Ctrl / Cmd + wheel or a pinch. */
  | 'pan';

/** The part of a `WheelEvent` the decision reads. */
export interface WheelFacts {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** The legacy `wheelDeltaY`, where the browser still reports it. */
  wheelDeltaY?: number;
}

export type WheelAction =
  /** Zoom at the cursor by `factor` (the view's size is multiplied by it). */
  | { kind: 'zoom'; factor: number }
  /** Move the view by this many CSS pixels. */
  | { kind: 'pan'; dx: number; dy: number };

/** CSS pixels one "line" and one "page" of wheel travel stand for. */
const LINE_PX = 100 / 3;
const PAGE_PX = 800;

/** Zoom per pixel of wheel travel: a notch (100 px) is about 16%. */
const WHEEL_ZOOM = 0.0015;
/** Zoom per pixel of a pinch, whose travel is a few pixels per event. */
const PINCH_ZOOM = 0.01;

/** The event's travel in CSS pixels, whatever unit it was reported in. */
function pixels(e: WheelFacts): { x: number; y: number } {
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1;
  return { x: e.deltaX * unit, y: e.deltaY * unit };
}

/**
 * Whether the event most likely came from a trackpad (or another device that
 * scrolls by pixels in two directions) rather than a notched mouse wheel.
 *
 * - Travel reported in lines or pages is a mouse wheel.
 * - Sideways travel is a trackpad: a wheel turns one way.
 * - Where the browser still reports the legacy `wheelDeltaY`, a trackpad's is
 *   exactly -3 × `deltaY`, and a mouse wheel's is a multiple of 120 that is
 *   not (Chrome, Edge and Safari).
 * - Otherwise (Firefox) pixel travel is a trackpad.
 */
export function fromTrackpad(e: WheelFacts): boolean {
  if (e.deltaMode !== 0) return false;
  if (e.deltaX !== 0) return true;
  if (typeof e.wheelDeltaY === 'number' && e.wheelDeltaY !== 0)
    return e.wheelDeltaY === -3 * e.deltaY;
  return true;
}

/**
 * What a wheel event does.
 *
 * `trackpad` is the device guess for the burst of events this one belongs to
 * (the caller makes it with `fromTrackpad` on the burst's first event and
 * keeps it while events keep coming).
 */
export function wheelAction(
  e: WheelFacts,
  mode: WheelMode,
  trackpad: boolean,
): WheelAction {
  const px = pixels(e);
  // Ctrl / Cmd + wheel, and a trackpad pinch (which the browser reports as
  // Ctrl + wheel), always zoom.
  if (e.ctrlKey || e.metaKey) {
    const rate = trackpad ? PINCH_ZOOM : WHEEL_ZOOM;
    return { kind: 'zoom', factor: Math.exp(px.y * rate) };
  }
  // Shift + wheel always pans sideways. Some browsers already turn the travel
  // sideways for Shift; others leave it vertical.
  if (e.shiftKey) return { kind: 'pan', dx: px.x !== 0 ? px.x : px.y, dy: 0 };
  const pan = mode === 'pan' || (mode === 'auto' && trackpad);
  return pan
    ? { kind: 'pan', dx: px.x, dy: px.y }
    : { kind: 'zoom', factor: Math.exp(px.y * WHEEL_ZOOM) };
}

/** Wheel events closer together than this belong to one gesture. */
export const WHEEL_BURST_MS = 200;
