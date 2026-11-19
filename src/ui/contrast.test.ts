import { describe, expect, it } from 'vitest';
import {
  INK_DARK,
  INK_LIGHT,
  contrastRatio,
  readableInkOn,
  relativeLuminance,
} from './contrast.js';

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });
  it('reads three-digit, upper-case and unprefixed hex', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 10);
    expect(relativeLuminance('FFFFFF')).toBeCloseTo(1, 10);
    expect(relativeLuminance(' #01A982 ')).toBeCloseTo(
      relativeLuminance('#01a982')!,
      10,
    );
  });
  it('rejects anything that is not a hex colour', () => {
    for (const bad of ['', 'red', '#12', '#12345', 'rgb(0,0,0)', '#gggggg'])
      expect(relativeLuminance(bad)).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('is 21 between black and white, in either order', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
  });
  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#01a982', '#01a982')).toBeCloseTo(1, 10);
  });
  it('matches the figures the token file quotes', () => {
    // src/styles/tokens.css: weak text on the back surface, and the accents.
    expect(contrastRatio('#b1b9be', '#1d1f27')).toBeCloseTo(8.26, 1);
    expect(contrastRatio('#01a982', '#1d1f27')).toBeCloseTo(5.48, 1);
    expect(contrastRatio('#03785b', '#ffffff')).toBeCloseTo(5.47, 1);
  });
  it('is null when either colour is not a hex', () => {
    expect(contrastRatio('nope', '#fff')).toBeNull();
    expect(contrastRatio('#fff', 'nope')).toBeNull();
  });
});

describe('readableInkOn', () => {
  it('puts dark ink on the default accent and on light brand colours', () => {
    expect(readableInkOn('#01a982')).toBe(INK_DARK);
    expect(readableInkOn('#e0922f')).toBe(INK_DARK); // Amber preset
    expect(readableInkOn('#ffe14d')).toBe(INK_DARK);
  });
  it('puts light ink on dark brand colours', () => {
    expect(readableInkOn('#03785b')).toBe(INK_LIGHT);
    expect(readableInkOn('#3c3aa1')).toBe(INK_LIGHT);
    expect(readableInkOn('#000000')).toBe(INK_LIGHT);
  });
  it('always picks the ink with at least 4.5:1 when one exists', () => {
    for (const bg of [
      '#01a982',
      '#0a84ff',
      '#7c6cff',
      '#e0922f',
      '#e5484d',
      '#11b3b3',
      '#6b7a8f',
    ]) {
      const ink = readableInkOn(bg)!;
      const other = ink === INK_DARK ? INK_LIGHT : INK_DARK;
      expect(contrastRatio(bg, ink)!).toBeGreaterThanOrEqual(
        contrastRatio(bg, other)!,
      );
    }
  });
  it('is null for a value that is not a hex colour', () => {
    expect(readableInkOn('var(--accent)')).toBeNull();
  });
});
