import { test, expect } from '@playwright/test';
import { bootEditor, readAutosave, statusCount } from './helpers.js';

test('add, delete, undo/redo a node on the canvas', async ({ page }) => {
  await bootEditor(page);
  const n0 = await statusCount(page, 'nodes');

  // Palette click drops a node at the view centre and selects it.
  await page.locator('.pitem[data-type="ec"]').first().click();
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0 + 1);

  await page.keyboard.press('Delete');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0);

  await page.keyboard.press('Control+z');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0 + 1);

  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0);
});

test('autosave persists edits across a reload', async ({ page }) => {
  await bootEditor(page);
  const n0 = await statusCount(page, 'nodes');

  await page.locator('.pitem[data-type="ec"]').first().click();
  // Debounced autosave lands and the chip reports honestly (#203).
  await expect(page.locator('#saved')).toHaveText('✓ saved');
  const saved = await readAutosave(page);
  expect(saved?.pages[0]?.nodes).toHaveLength(n0 + 1);

  await page.reload();
  await expect(page.locator('.pitem').first()).toBeVisible();
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0 + 1);
});
