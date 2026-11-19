import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACCENT_TEXT_MIN,
  INK_DARK,
  INK_LIGHT,
  contrastRatio,
  mixHex,
  readableAccentText,
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

describe('mixHex', () => {
  it('mixes channel by channel in sRGB', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#ff0000', '#0000ff', 0.25)).toBe('#bf0040');
  });
  it('rejects anything that is not a hex colour', () => {
    expect(mixHex('red', '#ffffff', 0.5)).toBeNull();
  });
});

describe('readableAccentText', () => {
  // Each theme's front surface and strongest text, as tokens.css sets them.
  const tokens = readFileSync(
    new URL('../styles/tokens.css', import.meta.url),
    'utf8',
  );
  const value = (block: string, name: string): string => {
    const start = tokens.indexOf(`${block} {`);
    const body = tokens.slice(start, tokens.indexOf('\n}', start));
    return new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(body)![1]!;
  };
  const THEMES = {
    dark: {
      surface: value(':root', '--surface-front'),
      ink: value(':root', '--fg-strong'),
    },
    light: {
      surface: value(':root.light', '--surface-front'),
      ink: value(':root.light', '--fg-strong'),
    },
  };
  const ACCENTS = {
    dark: '#1b2a6b', // a navy brand colour
    pale: '#f3e7a1', // a pale yellow
    mid: '#0a84ff', // the Azure preset
  };

  for (const [theme, { surface, ink }] of Object.entries(THEMES))
    for (const [kind, accent] of Object.entries(ACCENTS))
      it(`a ${kind} accent reads as text on the ${theme} theme`, () => {
        const fg = readableAccentText(accent, surface, ink)!;
        expect(contrastRatio(fg, surface)).toBeGreaterThanOrEqual(
          ACCENT_TEXT_MIN,
        );
        // Moved toward the ink only as far as it had to: one step less
        // would not read (or it is the accent itself).
        if (fg !== accent) {
          const t = [...Array(21).keys()]
            .map((i) => i / 20)
            .find((step) => mixHex(accent, ink, step) === fg)!;
          expect(t).toBeGreaterThan(0);
          expect(
            contrastRatio(mixHex(accent, ink, t - 0.05)!, surface),
          ).toBeLessThan(ACCENT_TEXT_MIN);
        }
      });

  it('keeps an accent that already reads', () => {
    expect(readableAccentText('#ffffff', '#000000', '#ffffff')).toBe('#ffffff');
  });
  it('lightens a dark accent on the dark theme, darkens a pale one on the light', () => {
    const dark = readableAccentText(
      ACCENTS.dark,
      THEMES.dark.surface,
      THEMES.dark.ink,
    )!;
    expect(relativeLuminance(dark)!).toBeGreaterThan(
      relativeLuminance(ACCENTS.dark)!,
    );
    const pale = readableAccentText(
      ACCENTS.pale,
      THEMES.light.surface,
      THEMES.light.ink,
    )!;
    expect(relativeLuminance(pale)!).toBeLessThan(
      relativeLuminance(ACCENTS.pale)!,
    );
  });
  it('gives null for a colour that is not a hex', () => {
    expect(readableAccentText('teal', '#ffffff', '#000000')).toBeNull();
  });
});
