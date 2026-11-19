import { describe, expect, it } from 'vitest';
import { rangeFill } from './range.js';

describe('the shared slider', () => {
  it('fills the track up to the value', () => {
    expect(rangeFill(0, 100, 0)).toBe('0.00%');
    expect(rangeFill(0, 100, 25)).toBe('25.00%');
    expect(rangeFill(2, 16, 9)).toBe('50.00%');
    expect(rangeFill(0, 1, 0.333)).toBe('33.30%');
    expect(rangeFill(-10, 10, 10)).toBe('100.00%');
  });

  it('stays inside the track for a value outside the range', () => {
    expect(rangeFill(0, 10, -5)).toBe('0.00%');
    expect(rangeFill(0, 10, 50)).toBe('100.00%');
  });

  it('draws no fill for a range with no length or a number it cannot read', () => {
    expect(rangeFill(5, 5, 5)).toBe('0%');
    expect(rangeFill(10, 0, 5)).toBe('0%');
    expect(rangeFill(Number.NaN, 10, 5)).toBe('0%');
    expect(rangeFill(0, Number.POSITIVE_INFINITY, 5)).toBe('0%');
  });
});
