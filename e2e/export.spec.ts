import { test, expect, type Download } from '@playwright/test';
import {
  bootEditor,
  expectExported,
  openFixture,
  statusCount,
} from './helpers.js';

async function readDownloadText(download: Download): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    void download.createReadStream().then((stream) => {
      let out = '';
      stream.on('data', (c: Buffer) => (out += c.toString()));
      stream.on('end', () => resolve(out));
      stream.on('error', reject);
    });
  });
}

test('SVG export frames a non-zero-origin viewBox correctly (#206)', async ({
  page,
}) => {
  await bootEditor(page);
  await openFixture(page, 'viewbox-origin.json');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(6);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#fSvg').click();
  const download = await downloadPromise;
  const svg = await readDownloadText(download);

  expect(svg).toContain('viewBox="82 40 900 620"');
  // The backdrop must cover the actual viewBox window, not (0,0).
  expect(svg).toContain('<rect x="82" y="40" width="900" height="620"');
  await expectExported(page, 'svg');
});

test('PNG export downloads a raster or reports status (#222)', async ({
  page,
}) => {
  await bootEditor(page);
  await openFixture(page, 'viewbox-origin.json');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(6);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#fPng').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const bytes = await download.path();
  expect(bytes).toBeTruthy();
  await expectExported(page, 'png');
});

test('export failure is visible when the download cannot start (#222)', async ({
  page,
}) => {
  await bootEditor(page);
  await openFixture(page, 'viewbox-origin.json');
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error('object URL blocked');
    };
  });

  await page.locator('#fSvg').click();
  const status = page.locator('#exportStatus');
  await expect(status).toHaveText('svg export failed');
  await expect(status.locator('.icon use')).toHaveAttribute(
    'href',
    '#i-warning',
  );
  await expect(status).toHaveAttribute('title', /object URL blocked/);
  await expect(status).toHaveClass(/export-failed/);
});
