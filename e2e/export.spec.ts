import { test, expect } from '@playwright/test';
import { bootEditor, openFixture, statusCount } from './helpers.js';

test('SVG export frames a non-zero-origin viewBox correctly (#206)', async ({
  page,
}) => {
  await bootEditor(page);
  await openFixture(page, 'viewbox-origin.json');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(6);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#fSvg').click();
  const download = await downloadPromise;
  const svg = await new Promise<string>((resolve, reject) => {
    void download.createReadStream().then((stream) => {
      let out = '';
      stream.on('data', (c: Buffer) => (out += c.toString()));
      stream.on('end', () => resolve(out));
      stream.on('error', reject);
    });
  });

  expect(svg).toContain('viewBox="82 40 900 620"');
  // The backdrop must cover the actual viewBox window, not (0,0).
  expect(svg).toContain('<rect x="82" y="40" width="900" height="620"');
});
