import { describe, expect, it } from 'vitest';
import { DRAG_START_PX, isDrag } from './palette-drag.js';

describe('isDrag', () => {
  it('a press that barely moves is still a click', () => {
    expect(isDrag({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false);
    expect(isDrag({ x: 100, y: 100 }, { x: 103, y: 104 })).toBe(false); // 5 px
  });

  it('becomes a drag once the pointer is far enough, in any direction', () => {
    expect(isDrag({ x: 100, y: 100 }, { x: 100 + DRAG_START_PX, y: 100 })).toBe(
      true,
    );
    expect(isDrag({ x: 100, y: 100 }, { x: 100, y: 100 - DRAG_START_PX })).toBe(
      true,
    );
    expect(isDrag({ x: 100, y: 100 }, { x: 95, y: 96 })).toBe(true); // 6.4 px
  });
});
