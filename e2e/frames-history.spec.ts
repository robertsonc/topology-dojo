import { test, expect } from '@playwright/test';
import { bootEditor, statusCount } from './helpers.js';

test('undo history survives a frame switch (#204)', async ({ page }) => {
  await bootEditor(page);
  const n0 = await statusCount(page, 'nodes');

  await page.locator('.pitem[data-type="ec"]').first().click();
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0 + 1);

  // Away to a fresh frame and back again.
  const frames = page.locator('#filmstrip [data-page]');
  const f0 = await frames.count();
  await page.locator('#addPage').click();
  await expect(frames).toHaveCount(f0 + 1);
  await expect.poll(() => statusCount(page, 'nodes')).toBe(0);
  await frames.first().click();
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0 + 1);

  // The edit made before the round-trip is still undoable.
  await page.keyboard.press('Control+z');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0);
});

test('a deleted frame is recoverable from the strip (#204)', async ({
  page,
}) => {
  await bootEditor(page);
  const frames = page.locator('#filmstrip [data-page]');
  const f0 = await frames.count();

  // A blank frame deletes without confirmation, then offers undo.
  await page.locator('#addPage').click();
  await expect(frames).toHaveCount(f0 + 1);
  await page
    .locator('#filmstrip [data-page]')
    .last()
    .locator('.frame-x')
    .click();
  await expect(frames).toHaveCount(f0);

  await page.locator('#undoDel').click();
  await expect(frames).toHaveCount(f0 + 1);
});
