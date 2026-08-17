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

/** How long the object URL stays alive after a programmatic download click.
 * Chrome starts the download asynchronously; revoking in the same turn as
 * `a.click()` (and clicking a detached `<a>`) can drop the download with no
 * error — the #222 Chrome QA symptom. */
export const DOWNLOAD_URL_TTL_MS = 2_000;

/** Give up if the browser never finishes decoding the SVG into a bitmap. */
const PNG_RASTERIZE_TIMEOUT_MS = 20_000;

/** Rasterize an SVG string to a PNG blob at `scale`× the viewBox size. */
export function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  if (!svg.includes('<svg')) {
    return Promise.reject(new Error('SVG export produced invalid markup'));
  }
  const m = /viewBox="([^"]*)"/.exec(svg);
  const { vw, vh } = viewBoxParts(m?.[1] ?? '');
  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = globalThis.setTimeout(() => {
      finish(() => reject(new Error('PNG rasterization timed out')));
    }, PNG_RASTERIZE_TIMEOUT_MS);
    img.onload = () => {
      finish(() => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(vw * scale));
          canvas.height = Math.max(1, Math.round(vh * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('no 2d context'));
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error('toBlob returned null'));
          }, 'image/png');
        } catch (err) {
          reject(
            err instanceof Error ? err : new Error('PNG rasterization failed'),
          );
        }
      });
    };
    img.onerror = () =>
      finish(() => reject(new Error('failed to rasterize SVG')));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

/** Trigger a browser download of a blob.
 * The anchor is inserted into the document and the object URL is kept alive
 * briefly so the UA can start the download (#222). Throws if the file cannot
 * be offered — callers must surface that to the user. */
export function downloadBlob(filename: string, blob: Blob): void {
  const name = filename.trim();
  if (!name) throw new Error('Export filename is missing.');
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error('Export produced an empty file.');
  }
  const doc = document;
  if (!doc?.body) {
    throw new Error('Download requires a browser document.');
  }
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.setAttribute('data-export-download', name);
  a.style.display = 'none';
  doc.body.appendChild(a);
  a.click();
  globalThis.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, DOWNLOAD_URL_TTL_MS);
}

export function exportPageSVG(
  filename: string,
  page: Page,
  opts?: RenderOptions,
  extra = '',
): void {
  const svg = pageToSVG(page, opts, extra);
  if (!svg.includes('<svg')) {
    throw new Error('SVG export produced invalid markup');
  }
  downloadBlob(filename, new Blob([svg], { type: 'image/svg+xml' }));
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
