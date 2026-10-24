/**
 * Server-side raster exports — resvg renders the engine SVG to PNG (with the
 * print DPI stamped) and a minimal PDF writer places each frame on its paper.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nodeRasterizer, NODE_MAX_PIXELS } from '../server/raster.js';
import { renderDocumentToSVG } from '../server/render.js';
import { exportPdf, exportPng, paperFor } from './print.js';
import { isPng, pngDpi, withPngDpi } from './png.js';
import { boundedScale } from './raster.js';
import { sampleDocument, type TopologyDocument } from '../pages/model.js';

const render = renderDocumentToSVG;
const fixture = (name: string): TopologyDocument =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)),
      'utf8',
    ),
  ) as TopologyDocument;

describe('exportPng', () => {
  it('renders the sample at 2× with a 192-DPI stamp by default', async () => {
    const r = await nodeRasterizer();
    const out = exportPng(sampleDocument(), 0, render, r, {
      maxPixels: NODE_MAX_PIXELS,
    });
    expect(isPng(out.png)).toBe(true);
    expect(out.width).toBe(2100);
    expect(out.height).toBe(1400);
    expect(pngDpi(out.png)).toBe(192);
    expect(out.reduced).toBe(false);
  });

  it('prints a sheet-sized page true at the requested DPI', async () => {
    const r = await nodeRasterizer();
    const doc = fixture('venue-distribution-leaf.json'); // ANSI C sheet
    const out = exportPng(doc, 0, render, r, {
      dpi: 100,
      maxPixels: NODE_MAX_PIXELS,
    });
    expect(out.width).toBe(2200); // 22 in × 100 DPI
    expect(out.height).toBe(1700);
    expect(pngDpi(out.png)).toBe(100);
  }, 20_000);

  it('scales down within the pixel budget and says so', async () => {
    const r = await nodeRasterizer();
    const out = exportPng(sampleDocument(), 0, render, r, {
      dpi: 600,
      maxPixels: 1_000_000,
    });
    expect(out.reduced).toBe(true);
    expect(out.width * out.height).toBeLessThanOrEqual(1_000_000);
    expect(out.dpi).toBeLessThan(600);
  });

  it('rejects an out-of-range page', async () => {
    const r = await nodeRasterizer();
    expect(() =>
      exportPng(sampleDocument(), 4, render, r, { maxPixels: 1e6 }),
    ).toThrow(/out of range/);
  });
});

describe('exportPdf', () => {
  it('writes one page per frame on the chosen paper', async () => {
    const r = await nodeRasterizer();
    const doc = sampleDocument();
    doc.pages.push({ ...doc.pages[0]!, id: 'p2', name: 'Two' });
    const out = exportPdf(doc, 'all', render, r, {
      paper: 'ansi-b',
      dpi: 72,
      maxPixels: NODE_MAX_PIXELS,
    });
    const text = new TextDecoder('latin1').decode(out.pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(out.pages).toBe(2);
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(text).toContain('/MediaBox [0 0 1224 792]'); // 17 × 11 in
    // xref offsets point at their objects.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const first = /0000000000 65535 f \n(\d{10})/.exec(text)![1]!;
    expect(text.slice(Number(first), Number(first) + 7)).toBe('1 0 obj');
  });

  it('defaults to the document sheet paper', () => {
    const doc = fixture('venue-distribution-leaf.json');
    expect(paperFor(doc, undefined, undefined)).toEqual({ w: 1584, h: 1224 });
    expect(paperFor(doc, 'fit', undefined)).toBeNull();
    expect(() => paperFor(doc, 'letter', undefined)).toThrow(/unknown paper/);
  });
});

describe('png helpers', () => {
  it('round-trips a pHYs stamp', () => {
    const png = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
      0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0, 73, 69, 78,
      68, 0xae, 0x42, 0x60, 0x82,
    ]);
    expect(pngDpi(png)).toBeNull();
    expect(pngDpi(withPngDpi(png, 300))).toBe(300);
  });

  it('boundedScale keeps the request when it fits', () => {
    expect(boundedScale({ w: 100, h: 100 }, 2, 1e6)).toEqual({
      scale: 2,
      reduced: false,
    });
    expect(boundedScale({ w: 1000, h: 1000 }, 4, 1e6).reduced).toBe(true);
  });
});
