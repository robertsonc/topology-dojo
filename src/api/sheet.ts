/**
 * Sheet frame + title block (proposal 0008, W6) — the drawing-sheet
 * conventions a printed wiring diagram carries: a standard paper size, a
 * border, the document title centred at the top, and a title block in the
 * bottom-right corner (sheet name, drawn by, revision, date, size, logo).
 *
 * `doc.sheet` is document metadata, not diagram vocabulary: every field is
 * reachable from the headless API (`set_sheet`, `document.patch`) and the
 * renderer draws it as an overlay in page coordinates, so the canvas, every
 * export and the public viewer agree. Absent = no frame (today's render).
 */

/** Standard sheet sizes, landscape, in inches (width × height). */
export const SHEET_SIZES = {
  'ansi-a': [11, 8.5],
  'ansi-b': [17, 11],
  'ansi-c': [22, 17],
  'ansi-d': [34, 22],
  'ansi-e': [44, 34],
  a4: [11.69, 8.27],
  a3: [16.54, 11.69],
  a2: [23.39, 16.54],
  a1: [33.11, 23.39],
} as const;
export type SheetSize = keyof typeof SHEET_SIZES;
export const SHEET_SIZE_IDS = Object.keys(SHEET_SIZES) as SheetSize[];
/** Human names for the size ids (the GUI dropdown / MCP descriptions). */
export const SHEET_SIZE_LABELS: Readonly<Record<SheetSize, string>> = {
  'ansi-a': 'ANSI A (11 × 8.5 in)',
  'ansi-b': 'ANSI B (17 × 11 in)',
  'ansi-c': 'ANSI C (22 × 17 in)',
  'ansi-d': 'ANSI D (34 × 22 in)',
  'ansi-e': 'ANSI E (44 × 34 in)',
  a4: 'A4 (297 × 210 mm)',
  a3: 'A3 (420 × 297 mm)',
  a2: 'A2 (594 × 420 mm)',
  a1: 'A1 (841 × 594 mm)',
};
export const SHEET_ORIENTATIONS = ['landscape', 'portrait'] as const;
export type SheetOrientation = (typeof SHEET_ORIENTATIONS)[number];
/** Page pixels per inch when a size sets the viewBox. */
export const SHEET_DPI = 96;
/** Border inset from the page edge, px. */
export const SHEET_MARGIN = 24;
/** Max title-block fields (Drawn by / Revision / Date / Size / …). */
export const SHEET_MAX_FIELDS = 8;

export interface SheetField {
  label: string;
  value: string;
}

export interface SheetTitleBlock {
  /** Draw the block (default true when the object is present). */
  show?: boolean;
  /** Second line under the document title (e.g. the sheet name). */
  subtitle?: string;
  /** Label / value pairs, laid out two per row. */
  fields?: SheetField[];
  /** https image drawn at the block's right end (a logo). */
  logoHref?: string;
  /**
   * Render-time only, never stored: note lines the wire-sheet renderer adds
   * under the fields (scale, schematic models). parseDoc drops it.
   */
  notes?: string[];
}

export interface SheetConfig {
  /** A standard size sets the page viewBox at SHEET_DPI; 'custom' keeps it. */
  size?: SheetSize | 'custom';
  orientation?: SheetOrientation;
  /** Draw the border line inset by SHEET_MARGIN (default true). */
  border?: boolean;
  /** Draw the document title at the top (default true). */
  title?: boolean;
  titleBlock?: SheetTitleBlock;
}

/** The viewBox for a standard size, or null for 'custom' / unknown. */
export function sheetViewBox(
  size: string | undefined,
  orientation: SheetOrientation = 'landscape',
): string | null {
  const dims = (SHEET_SIZES as Record<string, readonly [number, number]>)[
    size ?? ''
  ];
  if (!dims) return null;
  let [w, h] = dims;
  if (orientation === 'portrait') [w, h] = [h, w];
  return `0 0 ${Math.round(w * SHEET_DPI)} ${Math.round(h * SHEET_DPI)}`;
}

/** Paper size in PDF points (1/72 in) for a standard size, or null. */
export function sheetPaperPt(
  size: string | undefined,
  orientation: SheetOrientation = 'landscape',
): { w: number; h: number } | null {
  const dims = (SHEET_SIZES as Record<string, readonly [number, number]>)[
    size ?? ''
  ];
  if (!dims) return null;
  let [w, h] = dims;
  if (orientation === 'portrait') [w, h] = [h, w];
  return { w: Math.round(w * 72), h: Math.round(h * 72) };
}

/** Whether a sheet draws a border (the frame the legend keeps inside). */
export function sheetHasBorder(sheet: SheetConfig | undefined): boolean {
  return !!sheet && sheet.border !== false;
}

/** The inset other overlays (legend, port tables) keep from the page edge. */
export function sheetInset(sheet: SheetConfig | undefined): number {
  return sheetHasBorder(sheet) ? SHEET_MARGIN + 8 : 16;
}
