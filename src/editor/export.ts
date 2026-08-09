/**
 * Image export — wrap the browser render path into a standalone, downloadable
 * SVG, and rasterize that to PNG. Reuses the exact engine output shown on the
 * canvas (`renderPageSVG`), so an export looks identical to the editor; the only
 * additions are the `<svg>` wrapper + the dark backdrop.
 *
 * Browser-only (depends on the engine + DOM); driven from the app shell.
 */
import { renderPageSVG, type RenderOptions } from '../vendor/topology-ds.js';
import type { Page } from '../pages/model.js';

/** All four viewBox components — origins can be non-zero or negative after
 * fit-to-content/layout growth, so the backdrop must track (vx, vy). */
function viewBoxParts(viewBox: string): {
  vx: number;
  vy: number;
  vw: number;
  vh: number;
} {
  const [vx, vy, vw, vh] = viewBox.trim().split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return { vx: vx || 0, vy: vy || 0, vw: vw || 1050, vh: vh || 700 };
}

/** A complete, standalone SVG string for a page (wrapper + backdrop + art).
 * `extra` is appended after the art (e.g. a legend `<g>` in page coordinates). */
export function pageToSVG(
  page: Page,
  opts: RenderOptions = {},
  extra = '',
): string {
  const { vx, vy, vw, vh } = viewBoxParts(page.viewBox);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${page.viewBox}" width="${vw}" height="${vh}">` +
    `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#0e1613"/>` +
    renderPageSVG(page, opts) +
    extra +
    `</svg>`
  );
}

/** Rasterize an SVG string to a PNG blob at `scale`× the viewBox size. */
export function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  const m = /viewBox="([^"]*)"/.exec(svg);
  const { vw, vh } = viewBoxParts(m?.[1] ?? '');
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(vw * scale));
      canvas.height = Math.max(1, Math.round(vh * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('no 2d context'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
        'image/png',
      );
    };
    img.onerror = () => reject(new Error('failed to rasterize SVG'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

/** Trigger a browser download of a blob. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportPageSVG(
  filename: string,
  page: Page,
  opts?: RenderOptions,
  extra = '',
): void {
  downloadBlob(
    filename,
    new Blob([pageToSVG(page, opts, extra)], { type: 'image/svg+xml' }),
  );
}

export async function exportPagePNG(
  filename: string,
  page: Page,
  scale = 2,
  extra = '',
  opts: RenderOptions = {},
): Promise<void> {
  // Always rasterize a static frame (calm) so the captured image is clean.
  const blob = await svgToPngBlob(
    pageToSVG(page, { ...opts, calm: true }, extra),
    scale,
  );
  downloadBlob(filename, blob);
}
