import { describe, expect, it } from 'vitest';
import {
  placeSelectionBar,
  SELECTION_BAR_EDGE,
  SELECTION_BAR_GAP,
} from './selection-bar-place.js';

const host = { width: 700, height: 600 };
const bar = { width: 300, height: 34 };

/** Whether the placed bar and the selection share any point. */
function overlaps(
  at: { left: number; top: number },
  selection: { left: number; top: number; right: number; bottom: number },
): boolean {
  return (
    at.left < selection.right &&
    at.left + bar.width > selection.left &&
    at.top < selection.bottom &&
    at.top + bar.height > selection.top
  );
}

describe('placeSelectionBar', () => {
  it('sits above the selection, centred on it and clear of it by the gap', () => {
    const selection = { left: 300, top: 200, right: 400, bottom: 260 };
    const at = placeSelectionBar(selection, bar, host);
    expect(at).toEqual({
      left: 350 - bar.width / 2,
      top: 200 - bar.height - SELECTION_BAR_GAP,
    });
    expect(overlaps(at, selection)).toBe(false);
  });

  it('goes below a selection that leaves no room above', () => {
    const selection = { left: 300, top: 20, right: 400, bottom: 80 };
    const at = placeSelectionBar(selection, bar, host);
    expect(at.top).toBe(80 + SELECTION_BAR_GAP);
    expect(overlaps(at, selection)).toBe(false);
  });

  it('keeps to the top edge only when neither side has room', () => {
    const selection = { left: 300, top: 20, right: 400, bottom: 590 };
    const at = placeSelectionBar(selection, bar, host);
    expect(at.top).toBe(SELECTION_BAR_EDGE);
  });

  it('never covers a selection that has room above or below', () => {
    // Every selection box on a coarse grid that leaves room for the bar on
    // one side at least.
    const need = bar.height + SELECTION_BAR_GAP + SELECTION_BAR_EDGE;
    for (let top = 0; top <= 560; top += 20)
      for (let height = 10; top + height <= host.height; height += 30)
        for (let left = -100; left <= 700; left += 100) {
          const selection = {
            left,
            top,
            right: left + 120,
            bottom: top + height,
          };
          const room =
            selection.top >= need || host.height - selection.bottom >= need;
          if (!room) continue;
          const at = placeSelectionBar(selection, bar, host);
          expect(overlaps(at, selection), JSON.stringify(selection)).toBe(
            false,
          );
        }
  });

  it('stays inside the canvas from side to side', () => {
    for (const left of [-200, 0, 350, 650, 900]) {
      const at = placeSelectionBar(
        { left, top: 300, right: left + 40, bottom: 340 },
        bar,
        host,
      );
      expect(at.left).toBeGreaterThanOrEqual(SELECTION_BAR_EDGE);
      expect(at.left + bar.width).toBeLessThanOrEqual(
        host.width - SELECTION_BAR_EDGE,
      );
    }
  });

  it('starts a bar wider than the canvas at the left edge', () => {
    const at = placeSelectionBar(
      { left: 100, top: 300, right: 200, bottom: 340 },
      { width: 500, height: 34 },
      { width: 400, height: 600 },
    );
    expect(at.left).toBe(SELECTION_BAR_EDGE);
  });
});
