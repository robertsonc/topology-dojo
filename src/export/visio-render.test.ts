/**
 * The `.vsdx` wire sheet through a real Visio reader (hw-catalog Phase 5):
 * LibreOffice headless (libvisio) converts the export to PDF; the PDF must
 * parse with the right page count and size, and page 1 rasterized at low
 * DPI must match a reviewed golden. The catalog sheet (one wire-sheet page
 * per seed model) proves every model master renders; a `.vssx` has no
 * pages for LibreOffice to draw, so the stencil is checked structurally in
 * `visio-masters.test.ts`.
 *
 * Skipped where `soffice` is missing; CI's `visio` job installs it and sets
 * REQUIRE_LIBREOFFICE=1 so a missing reader fails instead of skipping.
 * Real Visio is checked by hand (see the Phase 5 sitrep).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildBundle, loadCatalogDir } from '../catalog/build.js';
import { Catalog } from '../catalog/catalog.js';
import { branchWiresheetDoc } from '../render/wiresheet-fixtures.js';
import { decodePng } from '../testing/png-decode.js';
import {
  catalogSheetDoc,
  hasCommand,
  pdfInfo,
  pdfPagePng,
  sofficeToPdf,
} from '../testing/visio.js';
import { documentToVsdx } from './vsdx.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const goldenDir = fileURLToPath(new URL('./__goldens__/', import.meta.url));
const catalog = new Catalog(buildBundle(loadCatalogDir(`${root}catalog/data`)));

const have = ['soffice', 'pdfinfo', 'pdftoppm'].every(hasCommand);
if (!have && process.env.REQUIRE_LIBREOFFICE === '1')
  throw new Error(
    'REQUIRE_LIBREOFFICE=1 but soffice / poppler-utils are missing',
  );

/** Low-DPI raster compare: layout, not font hinting. */
function compare(png: Buffer, name: string): void {
  const file = `${goldenDir}${name}`;
  if (process.env.UPDATE_GOLDENS === '1') writeFileSync(file, png);
  if (!existsSync(file))
    throw new Error(
      `missing golden ${file} — run with UPDATE_GOLDENS=1 and review it`,
    );
  const want = decodePng(readFileSync(file));
  const got = decodePng(png);
  expect([got.width, got.height]).toEqual([want.width, want.height]);
  let diff = 0;
  let off = 0;
  for (let i = 0; i < got.pixels.length; i += 4) {
    const d = Math.max(
      Math.abs(got.pixels[i]! - want.pixels[i]!),
      Math.abs(got.pixels[i + 1]! - want.pixels[i + 1]!),
      Math.abs(got.pixels[i + 2]! - want.pixels[i + 2]!),
    );
    diff += d;
    if (d > 48) off++;
  }
  const n = got.pixels.length / 4;
  expect(diff / n).toBeLessThan(2);
  expect(off / n).toBeLessThan(0.01);
}

describe.skipIf(!have)('.vsdx in LibreOffice (libvisio)', () => {
  it('the branch wire sheet converts: 1 page, ANSI B, matches the golden', () => {
    const vsdx = documentToVsdx(branchWiresheetDoc(), {
      hardware: { catalog },
    });
    const pdf = sofficeToPdf(vsdx, 'vsdx');
    const info = pdfInfo(pdf);
    expect(info.pages).toBe(1);
    expect(info.size[0]).toBeCloseTo(1224, 0);
    expect(info.size[1]).toBeCloseTo(792, 0);
    compare(pdfPagePng(pdf, 24), 'vsdx-branch-wiresheet.png');
  }, 240_000);

  it('the catalog sheet converts: one page per seed model', () => {
    const doc = catalogSheetDoc(catalog);
    const pdf = sofficeToPdf(
      documentToVsdx(doc, { hardware: { catalog } }),
      'vsdx',
    );
    expect(pdfInfo(pdf).pages).toBe(catalog.models.size);
    expect(doc.pages).toHaveLength(catalog.models.size);
    // Every page draws something besides the white sheet (its master).
    for (let p = 1; p <= doc.pages.length; p++) {
      const img = decodePng(pdfPagePng(pdf, 12, p));
      let ink = 0;
      for (let i = 0; i < img.pixels.length; i += 4)
        if (img.pixels[i]! < 128) ink++;
      expect(ink, doc.pages[p - 1]!.id).toBeGreaterThan(20);
    }
  }, 240_000);
});
