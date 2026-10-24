/**
 * Print-true raster exports (PNG / PDF) shared by every server runtime.
 *
 * Page geometry is CSS pixels (1/96 in). When the document sets a standard
 * sheet size (`doc.sheet`, ANSI A–E / A4–A1), the page viewBox IS the paper
 * at 96 px/in, so rendering at `dpi / 96` and placing the bitmap on that
 * paper prints at true scale. Any frame can also be fitted onto a chosen
 * paper size; the render resolution is then picked so the fitted image
 * lands at the requested DPI.
 */
import type { TopologyDocument } from '../pages/model.js';
import type { RenderOptions } from '../render/core.js';
import {
  SHEET_SIZES,
  sheetPaperPt,
  type SheetOrientation,
} from '../api/sheet.js';
import { boundedScale, svgSize, type Rasterizer } from './raster.js';
import { withPngDpi } from './png.js';
import { buildRasterPdf, type PdfImagePage } from './pdf.js';

export type RenderPage = (
  doc: TopologyDocument,
  pageIndex: number,
  opts: RenderOptions,
) => string;

export interface PrintOptions {
  /** Target print resolution (72–600). Default 150 on paper, else 2× scale. */
  dpi?: number;
  /** Paper to fit onto: a standard sheet id, or 'fit' (frame at true size). */
  paper?: string;
  orientation?: SheetOrientation;
  render?: RenderOptions;
  /** Pixel budget per page; larger renders are scaled down (reported). */
  maxPixels: number;
}

export const DEFAULT_PRINT_DPI = 150;
export const MIN_DPI = 72;
export const MAX_DPI = 600;

/** The paper (points) a page prints on, or null to print at frame size. */
export function paperFor(
  doc: TopologyDocument,
  paper: string | undefined,
  orientation: SheetOrientation | undefined,
): { w: number; h: number } | null {
  if (paper && paper !== 'fit') {
    if (!(paper in SHEET_SIZES))
      throw new Error(`unknown paper size "${paper}"`);
    return sheetPaperPt(
      paper,
      orientation ?? doc.sheet?.orientation ?? 'landscape',
    );
  }
  if (paper === 'fit') return null;
  return sheetPaperPt(doc.sheet?.size, doc.sheet?.orientation);
}

function clampDpi(dpi: number | undefined): number | undefined {
  if (dpi === undefined) return undefined;
  if (!Number.isFinite(dpi)) throw new Error('dpi must be a number');
  return Math.min(MAX_DPI, Math.max(MIN_DPI, dpi));
}

/** Scale that makes a frame of `size` px land at `dpi` on `paper` (points). */
function scaleFor(
  size: { w: number; h: number },
  paper: { w: number; h: number } | null,
  dpi: number,
): number {
  // Fitted width in inches: on paper, the fit factor; else the CSS size.
  const inches = paper
    ? (Math.min(paper.w / size.w, paper.h / size.h) * size.w) / 72
    : size.w / 96;
  return (dpi * inches) / size.w;
}

function pageIndices(
  doc: TopologyDocument,
  pageIndex: number | 'all' | undefined,
): number[] {
  if (pageIndex === 'all') return doc.pages.map((_, i) => i);
  const i = pageIndex ?? 0;
  if (!doc.pages[i]) throw new Error(`page index ${i} out of range`);
  return [i];
}

export interface PngExport {
  png: Uint8Array;
  width: number;
  height: number;
  dpi: number;
  /** True when the pixel budget forced a lower resolution than asked. */
  reduced: boolean;
}

/** One page as a PNG with its print resolution stamped. */
export function exportPng(
  doc: TopologyDocument,
  pageIndex: number | undefined,
  render: RenderPage,
  rasterizer: Rasterizer,
  opts: PrintOptions,
): PngExport {
  const [index] = pageIndices(doc, pageIndex);
  const svg = render(doc, index!, { ...(opts.render ?? {}), calm: true });
  const size = svgSize(svg);
  const paper = paperFor(doc, opts.paper, opts.orientation);
  const asked = clampDpi(opts.dpi);
  // Without a paper or a DPI, keep the browser export's 2× (stamped 192).
  const dpi = asked ?? (paper ? DEFAULT_PRINT_DPI : 192);
  const want = scaleFor(size, paper, dpi);
  const { scale, reduced } = boundedScale(size, want, opts.maxPixels);
  const out = rasterizer.rasterizePng(svg, scale);
  const effective = Math.round((dpi * scale) / want);
  return {
    png: withPngDpi(out.png, effective),
    width: out.width,
    height: out.height,
    dpi: effective,
    reduced,
  };
}

export interface PdfExport {
  pdf: Uint8Array;
  pages: number;
  dpi: number;
  paper: { w: number; h: number }[];
  reduced: boolean;
}

/** Pages (one or all) as a multi-page raster PDF on their paper. */
export function exportPdf(
  doc: TopologyDocument,
  pageIndex: number | 'all' | undefined,
  render: RenderPage,
  rasterizer: Rasterizer,
  opts: PrintOptions,
): PdfExport {
  const indices = pageIndices(doc, pageIndex ?? 'all');
  const paperOpt = paperFor(doc, opts.paper, opts.orientation);
  const dpi = clampDpi(opts.dpi) ?? DEFAULT_PRINT_DPI;
  const pages: PdfImagePage[] = [];
  let reduced = false;
  let minDpi = dpi;
  for (const i of indices) {
    const svg = render(doc, i, { ...(opts.render ?? {}), calm: true });
    const size = svgSize(svg);
    // No paper: print the frame at its true CSS size (96 px = 1 in = 72 pt).
    const paper = paperOpt ?? { w: size.w * 0.75, h: size.h * 0.75 };
    const want = scaleFor(size, paper, dpi);
    const b = boundedScale(size, want, opts.maxPixels);
    if (b.reduced) {
      reduced = true;
      minDpi = Math.min(minDpi, Math.round((dpi * b.scale) / want));
    }
    pages.push({ image: rasterizer.rasterize(svg, b.scale), paper });
  }
  return {
    pdf: buildRasterPdf(pages, { title: doc.title, creator: 'Topology Dojo' }),
    pages: pages.length,
    dpi: minDpi,
    paper: pages.map((p) => p.paper),
    reduced,
  };
}
