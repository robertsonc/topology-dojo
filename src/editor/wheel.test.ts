import { describe, expect, it } from 'vitest';
import { fromTrackpad, wheelAction, type WheelFacts } from './wheel.js';

const wheel = (over: Partial<WheelFacts>): WheelFacts => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

/** One notch of a mouse wheel as Chrome, Edge and Safari report it. */
const NOTCH = wheel({ deltaY: 100, wheelDeltaY: -120 });
/** One notch of a mouse wheel as Firefox reports it: three lines. */
const NOTCH_LINES = wheel({ deltaY: 3, deltaMode: 1 });
/** A two-finger slide on a trackpad (Chrome, Edge, Safari). */
const SLIDE = wheel({ deltaX: 2, deltaY: 14, wheelDeltaY: -42 });
/** The same slide with no sideways travel at all. */
const SLIDE_STRAIGHT = wheel({ deltaY: 14, wheelDeltaY: -42 });
/** A trackpad slide in Firefox: pixels, no legacy field. */
const SLIDE_FIREFOX = wheel({ deltaY: 14 });
/** A trackpad pinch: Ctrl is set by the browser, travel is small. */
const PINCH = wheel({ deltaY: -4, ctrlKey: true, wheelDeltaY: 12 });

describe('fromTrackpad', () => {
  it('reads a notched wheel as a mouse', () => {
    expect(fromTrackpad(NOTCH)).toBe(false);
    expect(fromTrackpad(NOTCH_LINES)).toBe(false);
    expect(fromTrackpad(wheel({ deltaY: 1, deltaMode: 2 }))).toBe(false);
    // Several notches at once, and a wheel turned the other way.
    expect(fromTrackpad(wheel({ deltaY: 300, wheelDeltaY: -360 }))).toBe(false);
    expect(fromTrackpad(wheel({ deltaY: -100, wheelDeltaY: 120 }))).toBe(false);
  });

  it('does not read small pixel steps alone as a trackpad', () => {
    // Small travel whose legacy value is not exactly -3 times it: the rule
    // is the ratio, not the size of the step.
    expect(
      fromTrackpad(wheel({ deltaY: 4.000244140625, wheelDeltaY: -12 })),
    ).toBe(false);
  });

  it('reads pixel travel in two directions as a trackpad', () => {
    expect(fromTrackpad(SLIDE)).toBe(true);
    expect(fromTrackpad(SLIDE_STRAIGHT)).toBe(true);
    expect(fromTrackpad(SLIDE_FIREFOX)).toBe(true);
    expect(fromTrackpad(wheel({ deltaX: -30 }))).toBe(true);
  });
});

describe('wheelAction', () => {
  it('auto: a mouse wheel zooms, about a sixth per notch', () => {
    const out = wheelAction(NOTCH, 'auto', false);
    expect(out.kind).toBe('zoom');
    expect(out.kind === 'zoom' && out.factor).toBeCloseTo(1.1618, 3);
    const back = wheelAction(
      wheel({ deltaY: -100, wheelDeltaY: 120 }),
      'auto',
      false,
    );
    expect(back.kind === 'zoom' && back.factor).toBeCloseTo(1 / 1.1618, 3);
  });

  it('a wheel reported in lines zooms as much as one reported in pixels', () => {
    const lines = wheelAction(NOTCH_LINES, 'auto', false);
    const px = wheelAction(NOTCH, 'auto', false);
    expect(lines).toEqual(px);
  });

  it('auto: a trackpad slide pans by its travel', () => {
    expect(wheelAction(SLIDE, 'auto', true)).toEqual({
      kind: 'pan',
      dx: 2,
      dy: 14,
    });
  });

  it('a pinch zooms, whatever the mode, faster per pixel than a wheel', () => {
    for (const mode of ['auto', 'zoom', 'pan'] as const) {
      const out = wheelAction(PINCH, mode, true);
      expect(out.kind).toBe('zoom');
      expect(out.kind === 'zoom' && out.factor).toBeCloseTo(Math.exp(-0.04), 6);
    }
  });

  it('Ctrl or Cmd + mouse wheel zooms at the wheel rate, in every mode', () => {
    for (const key of ['ctrlKey', 'metaKey'] as const)
      for (const mode of ['auto', 'zoom', 'pan'] as const) {
        const out = wheelAction({ ...NOTCH, [key]: true }, mode, false);
        expect(out.kind === 'zoom' && out.factor).toBeCloseTo(1.1618, 3);
      }
  });

  it('Shift + wheel pans sideways, in every mode', () => {
    for (const mode of ['auto', 'zoom', 'pan'] as const) {
      // Travel left vertical by the browser…
      expect(wheelAction({ ...NOTCH, shiftKey: true }, mode, false)).toEqual({
        kind: 'pan',
        dx: 100,
        dy: 0,
      });
      // …or already turned sideways.
      expect(
        wheelAction(wheel({ deltaX: 100, shiftKey: true }), mode, false),
      ).toEqual({ kind: 'pan', dx: 100, dy: 0 });
    }
  });

  it('mode zoom: a trackpad slide zooms too', () => {
    const out = wheelAction(SLIDE, 'zoom', true);
    expect(out.kind).toBe('zoom');
    expect(out.kind === 'zoom' && out.factor).toBeCloseTo(
      Math.exp(14 * 0.0015),
      6,
    );
  });

  it('mode pan: a mouse wheel scrolls the view', () => {
    expect(wheelAction(NOTCH, 'pan', false)).toEqual({
      kind: 'pan',
      dx: 0,
      dy: 100,
    });
    expect(wheelAction(NOTCH_LINES, 'pan', false)).toEqual({
      kind: 'pan',
      dx: 0,
      dy: 100,
    });
  });
});
