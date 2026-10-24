/**
 * Wire-sheet scale (hw-catalog Phase 4). Panel geometry is in millimetres;
 * a page's viewBox is px at SHEET_DPI (96 px / in), so 1:k draws a panel
 * millimetre as 96 / 25.4 / k px — mm-accurate when the page prints on
 * its sheet size. Kept DOM-free and tiny so persistence can import it.
 */
import { SHEET_DPI } from '../api/sheet.js';

export const PANEL_SCALE_MIN = 0.5;
export const PANEL_SCALE_MAX = 50;

/** Standard drawing scales tried by the auto pick, largest drawing first. */
export const STANDARD_SCALES = [1, 2, 2.5, 4, 5, 10, 20, 50] as const;

/** Page px per panel millimetre at 1:k. */
export function pxPerMm(k: number): number {
  return SHEET_DPI / 25.4 / k;
}

/**
 * The page's scale: the author's `panelScale`, else the largest standard
 * drawing at which the widest panel fits in `fraction` of the page width.
 */
export function chooseScale(
  pageWidthPx: number,
  widestPanelMm: number,
  panelScale?: number,
  fraction = 0.45,
): number {
  if (panelScale !== undefined) return panelScale;
  if (!(widestPanelMm > 0)) return 1;
  for (const k of STANDARD_SCALES)
    if (widestPanelMm * pxPerMm(k) <= pageWidthPx * fraction) return k;
  return STANDARD_SCALES[STANDARD_SCALES.length - 1]!;
}

/** "1:2.5" */
export function scaleLabel(k: number): string {
  return `1:${Number.isInteger(k) ? k : k.toFixed(1).replace(/\.0$/, '')}`;
}
