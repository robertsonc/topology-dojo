import { describe, expect, it } from 'vitest';
import {
  MENU_EDGE,
  firstEnabledIndex,
  isMenuItem,
  lastEnabledIndex,
  nextEnabledIndex,
  placeMenu,
  typeaheadIndex,
  type MenuEntry,
} from './menu.js';

const SEP: MenuEntry = { kind: 'separator' };
const head = (label: string): MenuEntry => ({ kind: 'heading', label });
const item = (label: string, disabled = false): MenuEntry => ({
  label,
  disabled,
});

describe('isMenuItem', () => {
  it('tells items from separators and headings', () => {
    expect(isMenuItem({ label: 'Copy' })).toBe(true);
    expect(isMenuItem({ kind: 'item', label: 'Copy' })).toBe(true);
    expect(isMenuItem(SEP)).toBe(false);
    expect(isMenuItem(head('Image'))).toBe(false);
    expect(isMenuItem(undefined)).toBe(false);
  });
});

describe('nextEnabledIndex', () => {
  // 0 heading, 1 Undo (disabled), 2 Redo, 3 separator, 4 Cut, 5 Copy
  // (disabled), 6 separator, 7 Paste
  const entries: MenuEntry[] = [
    head('Edit'),
    item('Undo', true),
    item('Redo'),
    SEP,
    item('Cut'),
    item('Copy', true),
    SEP,
    item('Paste'),
  ];

  it('skips separators, headings and disabled items', () => {
    expect(nextEnabledIndex(entries, 2, 1)).toBe(4);
    expect(nextEnabledIndex(entries, 4, 1)).toBe(7);
    expect(nextEnabledIndex(entries, 7, -1)).toBe(4);
    expect(nextEnabledIndex(entries, 4, -1)).toBe(2);
  });

  it('wraps around both ends', () => {
    expect(nextEnabledIndex(entries, 7, 1)).toBe(2);
    expect(nextEnabledIndex(entries, 2, -1)).toBe(7);
  });

  it('stops on disabled items when asked to (the arrow keys)', () => {
    expect(nextEnabledIndex(entries, 0, 1, true)).toBe(1);
    expect(nextEnabledIndex(entries, 4, 1, true)).toBe(5);
    expect(nextEnabledIndex(entries, 5, 1, true)).toBe(7);
    expect(nextEnabledIndex(entries, 7, 1, true)).toBe(1);
    expect(nextEnabledIndex(entries, 1, -1, true)).toBe(7);
    // Separators and headings are never a stop.
    expect(nextEnabledIndex(entries, 2, 1, true)).toBe(4);
  });

  it('starts from the matching end when nothing is current', () => {
    expect(nextEnabledIndex(entries, -1, 1)).toBe(2);
    expect(nextEnabledIndex(entries, -1, -1)).toBe(7);
    expect(nextEnabledIndex(entries, 99, 1)).toBe(2);
    expect(nextEnabledIndex(entries, 99, -1)).toBe(7);
    expect(nextEnabledIndex(entries, -1, 1, true)).toBe(1);
  });

  it('may start on a separator or a heading', () => {
    expect(nextEnabledIndex(entries, 3, 1)).toBe(4);
    expect(nextEnabledIndex(entries, 3, -1)).toBe(2);
    expect(nextEnabledIndex(entries, 0, -1)).toBe(7);
  });

  it('returns the current item when it is the only candidate', () => {
    const one: MenuEntry[] = [SEP, item('Only'), SEP, item('Off', true)];
    expect(nextEnabledIndex(one, 1, 1)).toBe(1);
    expect(nextEnabledIndex(one, 1, -1)).toBe(1);
  });

  it('returns -1 when every item is disabled, unless disabled items count', () => {
    const off: MenuEntry[] = [item('A', true), SEP, item('B', true)];
    expect(nextEnabledIndex(off, 0, 1)).toBe(-1);
    expect(nextEnabledIndex(off, -1, -1)).toBe(-1);
    expect(nextEnabledIndex(off, 0, 1, true)).toBe(2);
    expect(nextEnabledIndex(off, 2, 1, true)).toBe(0);
  });

  it('returns -1 for an empty list and for one with no items', () => {
    expect(nextEnabledIndex([], -1, 1)).toBe(-1);
    expect(nextEnabledIndex([], 0, -1, true)).toBe(-1);
    expect(nextEnabledIndex([SEP, head('H')], 0, 1, true)).toBe(-1);
  });
});

describe('firstEnabledIndex / lastEnabledIndex', () => {
  const entries: MenuEntry[] = [
    head('File'),
    item('New', true),
    item('Open'),
    SEP,
    item('Save'),
    item('Export', true),
    SEP,
  ];

  it('find the first and last enabled item', () => {
    expect(firstEnabledIndex(entries)).toBe(2);
    expect(lastEnabledIndex(entries)).toBe(4);
  });

  it('find the first and last item of any state when disabled items count', () => {
    expect(firstEnabledIndex(entries, true)).toBe(1);
    expect(lastEnabledIndex(entries, true)).toBe(5);
  });

  it('return -1 when every item is disabled', () => {
    const off: MenuEntry[] = [item('A', true), item('B', true)];
    expect(firstEnabledIndex(off)).toBe(-1);
    expect(lastEnabledIndex(off)).toBe(-1);
    expect(firstEnabledIndex(off, true)).toBe(0);
    expect(lastEnabledIndex(off, true)).toBe(1);
  });

  it('return -1 for an empty list and for one with no items', () => {
    expect(firstEnabledIndex([])).toBe(-1);
    expect(lastEnabledIndex([])).toBe(-1);
    expect(firstEnabledIndex([SEP, head('H')], true)).toBe(-1);
    expect(lastEnabledIndex([SEP, head('H')], true)).toBe(-1);
  });
});

describe('typeaheadIndex', () => {
  // 0 Cut, 1 Copy, 2 separator, 3 Paste, 4 Paste in place, 5 heading
  // "Select", 6 Select all (disabled), 7 Clear
  const entries: MenuEntry[] = [
    item('Cut'),
    item('Copy'),
    SEP,
    item('Paste'),
    item('Paste in place'),
    head('Select'),
    item('Select all', true),
    item('Clear'),
  ];

  it('finds the first label with the typed prefix, ignoring case', () => {
    expect(typeaheadIndex(entries, -1, 'p')).toBe(3);
    expect(typeaheadIndex(entries, -1, 'P')).toBe(3);
    expect(typeaheadIndex(entries, -1, 'co')).toBe(1);
    expect(typeaheadIndex(entries, -1, 'CL')).toBe(7);
  });

  it('one letter searches after the current item and wraps around', () => {
    expect(typeaheadIndex(entries, 0, 'c')).toBe(1);
    expect(typeaheadIndex(entries, 1, 'c')).toBe(7);
    expect(typeaheadIndex(entries, 7, 'c')).toBe(0);
    expect(typeaheadIndex(entries, 4, 'p')).toBe(3);
  });

  it('the same letter repeated cycles through the labels with that initial', () => {
    expect(typeaheadIndex(entries, 0, 'cc')).toBe(1);
    expect(typeaheadIndex(entries, 1, 'ccc')).toBe(7);
    expect(typeaheadIndex(entries, 7, 'cccc')).toBe(0);
  });

  it('one letter stays on the current item when it is the only match', () => {
    expect(typeaheadIndex(entries, 6, 's')).toBe(6);
  });

  it('a longer prefix keeps the current item while it still matches', () => {
    expect(typeaheadIndex(entries, 3, 'pa')).toBe(3);
    expect(typeaheadIndex(entries, 3, 'paste ')).toBe(4);
    expect(typeaheadIndex(entries, 0, 'cl')).toBe(7);
    expect(typeaheadIndex(entries, 7, 'cu')).toBe(0);
  });

  it('matches disabled items but never separators or headings', () => {
    expect(typeaheadIndex(entries, -1, 's')).toBe(6);
    expect(typeaheadIndex(entries, -1, 'sel')).toBe(6);
  });

  it('ignores leading spaces in a label', () => {
    expect(typeaheadIndex([item('  Indented')], -1, 'in')).toBe(0);
  });

  it('returns -1 when nothing matches, and for an empty buffer or list', () => {
    expect(typeaheadIndex(entries, 0, 'x')).toBe(-1);
    expect(typeaheadIndex(entries, 0, 'cx')).toBe(-1);
    expect(typeaheadIndex(entries, 0, '')).toBe(-1);
    expect(typeaheadIndex([], -1, 'a')).toBe(-1);
    expect(typeaheadIndex([SEP, head('Alpha')], -1, 'a')).toBe(-1);
  });
});

describe('placeMenu', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 240, height: 300 };
  /** A 100 x 30 trigger with its top-left corner at (left, top). */
  const trigger = (left: number, top: number) => ({
    left,
    top,
    right: left + 100,
    bottom: top + 30,
  });

  it('below-start: under the anchor, left edges together', () => {
    expect(placeMenu(trigger(200, 100), size, viewport, 'below-start')).toEqual(
      { left: 200, top: 134, placement: 'below-start' },
    );
  });

  it('below-end: under the anchor, right edges together', () => {
    expect(placeMenu(trigger(500, 100), size, viewport, 'below-end')).toEqual({
      left: 360,
      top: 134,
      placement: 'below-end',
    });
  });

  it('above-start: over the anchor, left edges together', () => {
    expect(placeMenu(trigger(200, 500), size, viewport, 'above-start')).toEqual(
      { left: 200, top: 196, placement: 'above-start' },
    );
  });

  it('above-end: over the anchor, right edges together', () => {
    expect(placeMenu(trigger(500, 500), size, viewport, 'above-end')).toEqual({
      left: 360,
      top: 196,
      placement: 'above-end',
    });
  });

  it('right-start: beside the anchor, tops together', () => {
    expect(placeMenu(trigger(200, 100), size, viewport, 'right-start')).toEqual(
      { left: 304, top: 100, placement: 'right-start' },
    );
  });

  it('defaults to below-start with a 4px gap, and takes another gap', () => {
    expect(placeMenu(trigger(200, 100), size, viewport)).toEqual({
      left: 200,
      top: 134,
      placement: 'below-start',
    });
    expect(
      placeMenu(trigger(200, 100), size, viewport, 'below-start', 0).top,
    ).toBe(130);
    // A negative gap overlaps the anchor (submenus).
    expect(
      placeMenu(trigger(200, 100), size, viewport, 'right-start', -4).left,
    ).toBe(296);
  });

  it('flips above at the bottom edge', () => {
    expect(placeMenu(trigger(200, 700), size, viewport, 'below-start')).toEqual(
      { left: 200, top: 396, placement: 'above-start' },
    );
    expect(
      placeMenu(trigger(500, 700), size, viewport, 'below-end').placement,
    ).toBe('above-end');
  });

  it('flips below at the top edge', () => {
    expect(placeMenu(trigger(200, 60), size, viewport, 'above-start')).toEqual({
      left: 200,
      top: 94,
      placement: 'below-start',
    });
    expect(
      placeMenu(trigger(500, 60), size, viewport, 'above-end').placement,
    ).toBe('below-end');
  });

  it('switches to end alignment at the right edge', () => {
    expect(placeMenu(trigger(880, 100), size, viewport, 'below-start')).toEqual(
      { left: 740, top: 134, placement: 'below-end' },
    );
  });

  it('switches to start alignment at the left edge', () => {
    expect(placeMenu(trigger(20, 100), size, viewport, 'below-end')).toEqual({
      left: 20,
      top: 134,
      placement: 'below-start',
    });
  });

  it('flips a submenu to the left at the right edge', () => {
    expect(placeMenu(trigger(800, 100), size, viewport, 'right-start')).toEqual(
      { left: 556, top: 100, placement: 'left-start' },
    );
  });

  it('flips a left-start wish back to the right at the left edge', () => {
    expect(placeMenu(trigger(100, 100), size, viewport, 'left-start')).toEqual({
      left: 204,
      top: 100,
      placement: 'right-start',
    });
    expect(placeMenu(trigger(600, 100), size, viewport, 'left-start')).toEqual({
      left: 356,
      top: 100,
      placement: 'left-start',
    });
  });

  it('slides a side menu up when it would run off the bottom', () => {
    expect(placeMenu(trigger(200, 700), size, viewport, 'right-start')).toEqual(
      { left: 304, top: 800 - MENU_EDGE - 300, placement: 'right-start' },
    );
  });

  it('opens at a point: its corner on the point, flipping near the edges', () => {
    const point = (x: number, y: number) => ({
      left: x,
      right: x,
      top: y,
      bottom: y,
    });
    expect(
      placeMenu(point(300, 200), size, viewport, 'below-start', 0),
    ).toEqual({ left: 300, top: 200, placement: 'below-start' });
    // Bottom-right corner of the viewport: the menu hangs up and to the left.
    expect(
      placeMenu(point(990, 790), size, viewport, 'below-start', 0),
    ).toEqual({ left: 750, top: 490, placement: 'above-end' });
  });

  it('keeps the wished side when neither side fits but it has more room', () => {
    const tall = { width: 240, height: 500 };
    // 462px below, 292px above: stays below and is pushed up into view.
    expect(placeMenu(trigger(200, 300), tall, viewport, 'below-start')).toEqual(
      { left: 200, top: 800 - MENU_EDGE - 500, placement: 'below-start' },
    );
    // 262px below, 492px above: flips, then is pushed down into view.
    expect(placeMenu(trigger(200, 500), tall, viewport, 'below-start')).toEqual(
      { left: 200, top: MENU_EDGE, placement: 'above-start' },
    );
  });

  it('clamps to the edge margin when the anchor is partly off screen', () => {
    expect(
      placeMenu(trigger(-60, 100), size, viewport, 'below-start').left,
    ).toBe(MENU_EDGE);
    expect(placeMenu(trigger(960, 100), size, viewport, 'below-end').left).toBe(
      1000 - MENU_EDGE - 240,
    );
  });

  it('pins a popup larger than the viewport to the top-left margin', () => {
    const small = { width: 200, height: 150 };
    const huge = { width: 400, height: 600 };
    for (const placement of [
      'below-start',
      'below-end',
      'above-start',
      'above-end',
      'right-start',
    ] as const) {
      const at = placeMenu(trigger(60, 60), huge, small, placement);
      expect({ left: at.left, top: at.top }, placement).toEqual({
        left: MENU_EDGE,
        top: MENU_EDGE,
      });
    }
  });

  it('always lands inside the viewport when the popup fits in it', () => {
    const placements = [
      'below-start',
      'below-end',
      'above-start',
      'above-end',
      'right-start',
    ] as const;
    for (const placement of placements)
      for (let left = -150; left <= 1050; left += 75)
        for (let top = -50; top <= 820; top += 58) {
          const at = placeMenu(trigger(left, top), size, viewport, placement);
          const where = `${placement} @ ${left},${top}`;
          expect(at.left, where).toBeGreaterThanOrEqual(MENU_EDGE);
          expect(at.top, where).toBeGreaterThanOrEqual(MENU_EDGE);
          expect(at.left + size.width, where).toBeLessThanOrEqual(
            viewport.width - MENU_EDGE,
          );
          expect(at.top + size.height, where).toBeLessThanOrEqual(
            viewport.height - MENU_EDGE,
          );
        }
  });
});
