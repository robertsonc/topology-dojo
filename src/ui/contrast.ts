/**
 * WCAG contrast arithmetic for the chrome.
 *
 * A document's brand palette can replace the chrome accent with any colour
 * (see `setChromeAccent` in `src/main.ts`). Text and icons drawn ON that
 * accent (a primary button's label, a switch's knob) then need whichever of
 * the dark or the light ink reads better against it, or a yellow brand would
 * carry white text. Pure functions: no DOM.
 */

/** Relative luminance of an sRGB colour, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h =
    m[1]!.length === 3
      ? m[1]!
          .split('')
          .map((c) => c + c)
          .join('')
      : m[1]!;
  const channel = (i: number): number => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio of two colours, 1 to 21; null if either is not a hex. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** The chrome's two inks: the darkest surface and white. */
export const INK_DARK = '#1d1f27';
export const INK_LIGHT = '#ffffff';

/**
 * The ink to draw on a fill of `background`: whichever of the two has the
 * higher contrast with it. Returns null when `background` is not a hex
 * colour, so the caller can fall back to the stylesheet's own value.
 */
export function readableInkOn(background: string): string | null {
  const dark = contrastRatio(background, INK_DARK);
  const light = contrastRatio(background, INK_LIGHT);
  if (dark === null || light === null) return null;
  return dark >= light ? INK_DARK : INK_LIGHT;
}

/** `a` mixed toward `b` by `t` (0: all `a`, 1: all `b`), channel by channel
 * in sRGB as CSS `color-mix(in srgb, …)` does; null if either is not a hex. */
export function mixHex(a: string, b: string, t: number): string | null {
  const rgb = (hex: string): number[] | null => {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const h =
      m[1]!.length === 3
        ? m[1]!
            .split('')
            .map((c) => c + c)
            .join('')
        : m[1]!;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return null;
  return (
    '#' +
    x
      .map((c, i) =>
        Math.round(c + (y[i]! - c) * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** The contrast accent-coloured text and icons need (WCAG AA, body text). */
export const ACCENT_TEXT_MIN = 4.5;

/**
 * A CSS colour as the browser computes it (`#rrggbb`, `rgb()`, `rgba()`, or
 * `color(srgb r g b / a)`, which is what a `color-mix()` computes to) as
 * 0-255 channels and an alpha; null for anything else.
 */
export function parseColour(
  css: string,
): [number, number, number, number] | null {
  const v = css.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 1];
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (fn) {
    const parts = fn[1]!
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
  }
  const srgb = /^color\(srgb\s+([^)]+)\)$/i.exec(v);
  if (srgb) {
    const parts = srgb[1]!
      .split(/[\s/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    return [parts[0]! * 255, parts[1]! * 255, parts[2]! * 255, parts[3] ?? 1];
  }
  return null;
}

/** The `#rrggbb` of 0-255 channels (an alpha, if any, is ignored). */
export function hexOf(channels: readonly number[]): string {
  return (
    '#' +
    channels
      .slice(0, 3)
      .map((n) =>
        Math.round(Math.min(255, Math.max(0, n)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/**
 * The opaque grounds accent text can sit on: each surface, and each tint
 * (a hover, a pressed button, `--accent-soft`, ...) laid over each surface.
 * Colours that cannot be read are left out.
 */
export function accentTextGrounds(
  surfaces: string[],
  tints: string[],
): string[] {
  const out: string[] = [];
  for (const surface of surfaces) {
    const under = parseColour(surface);
    if (!under || under[3] < 1) continue;
    out.push(hexOf(under));
    for (const tint of tints) {
      const top = parseColour(tint);
      if (!top) continue;
      const a = top[3];
      out.push(hexOf([0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a))));
    }
  }
  return out;
}

/**
 * The colour for accent text and icons (`--accent-fg`) under a brand accent:
 * the accent itself when it reads on every one of `grounds`, else the accent
 * mixed toward the theme's `ink` (its strongest text colour) in small steps
 * until it reaches 4.5:1 on the worst of them. A dark brand colour on the
 * dark theme lightens, a pale one on the light theme darkens; the hue stays
 * the brand's. Null when a colour is not a hex, so the caller can keep the
 * stylesheet's value.
 */
export function readableAccentText(
  accent: string,
  grounds: string | string[],
  ink: string,
): string | null {
  const all = typeof grounds === 'string' ? [grounds] : grounds;
  if (all.length === 0) return null;
  if (contrastRatio(accent, ink) === null) return null;
  if (all.some((g) => contrastRatio(ink, g) === null)) return null;
  const worst = (fg: string): number =>
    Math.min(...all.map((g) => contrastRatio(fg, g)!));
  for (let step = 0; step <= 20; step++) {
    const mixed = mixHex(accent, ink, step / 20)!;
    if (worst(mixed) >= ACCENT_TEXT_MIN) return mixed;
  }
  return mixHex(accent, ink, 1);
}
