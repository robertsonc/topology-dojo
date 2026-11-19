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
