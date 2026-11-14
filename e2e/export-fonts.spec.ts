/**
 * Exports use the canvas typeface. The canvas gets its font from page CSS; a
 * standalone SVG, and the SVG the browser rasterizes for PNG/PDF, do not see
 * page CSS and used to draw every label in the default serif.
 */
import { expect, test, type Download, type Page } from '@playwright/test';
import { bootEditor, statusCount } from './helpers.js';

const WIDE = 'MMMMMMMMMMMMMMMM';
const NARROW = 'iiiiiiiiiiiiiiii';

/** Two nodes whose labels have the same length but very different glyphs. */
const documentJson = JSON.stringify({
  title: 'fonts',
  customNodes: [],
  pages: [
    {
      id: 'p1',
      name: 'Frame 1',
      viewBox: '0 0 1050 700',
      nodes: [
        { id: 'wide', type: 'router', x: 525, y: 200, label: WIDE },
        { id: 'narrow', type: 'router', x: 525, y: 500, label: NARROW },
      ],
      links: [],
      anchors: [],
      zones: [],
      flowPaths: [],
      policyMarkers: [],
    },
  ],
});

async function open(page: Page): Promise<void> {
  await bootEditor(page);
  await page.locator('#fInput').setInputFiles({
    name: 'fonts.json',
    mimeType: 'application/json',
    buffer: Buffer.from(documentJson),
  });
  await expect.poll(() => statusCount(page, 'nodes')).toBe(2);
}

async function bytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

test('the SVG export names the diagram typeface on its root', async ({
  page,
}) => {
  await open(page);
  const downloading = page.waitForEvent('download');
  await page.locator('#fSvg').click();
  const svg = (await bytes(await downloading)).toString();
  expect(/^<svg\b[^>]*>/.exec(svg)![0]).toContain(
    `font-family="'JetBrains Mono', ui-monospace`,
  );
});

test('the PNG export draws labels in a fixed-width face', async ({ page }) => {
  await open(page);
  const downloading = page.waitForEvent('download');
  await page.locator('#fPng').click();
  const png = await bytes(await downloading);

  // Measure each label's drawn width in the PNG (2× the page). In a
  // fixed-width face 16 "M" and 16 "i" span the same width; in the default
  // serif the "i" run is about a third of the "M" run.
  const widths = await page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const scale = bitmap.width / 1050;
    /** Horizontal extent of bright (label) pixels in the band under a node. */
    const span = (nodeY: number): number => {
      const top = Math.round((nodeY + 15) * scale);
      const height = Math.round(13 * scale);
      const { data } = ctx.getImageData(0, top, bitmap.width, height);
      let min = Infinity;
      let max = -Infinity;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < bitmap.width; x++) {
          const i = (y * bitmap.width + x) * 4;
          if (data[i]! > 170 && data[i + 1]! > 170 && data[i + 2]! > 170) {
            if (x < min) min = x;
            if (x > max) max = x;
          }
        }
      return max - min;
    };
    return { wide: span(200), narrow: span(500), scale };
  }, png.toString('base64'));

  expect(widths.wide).toBeGreaterThan(40 * widths.scale);
  // Same advance per glyph; the "i" run only loses the side bearings of its
  // first and last glyph.
  expect(widths.narrow / widths.wide).toBeGreaterThan(0.85);
});
