import { test, expect } from '@playwright/test';
import { bootEditor } from './helpers.js';

/**
 * The Problems dock: a row names elements the way the canvas does, a click
 * rings everything the problem refers to, and a problem can be hidden.
 */
test('a problem names its elements, rings them on click, and can be hidden', async ({
  page,
}) => {
  await bootEditor(page);
  // Two nodes dropped from the palette land near each other and unconnected,
  // which raises layout and validation warnings about them.
  await page.locator('.pitem').first().click();
  await page.locator('.pitem').first().click();

  const count = page.locator('#prob-count');
  await expect(count).not.toHaveText('0');
  const total = Number(await count.innerText());

  // The long-message dock takes the inspector's width, not its own.
  const dock = await page.locator('#problems-dock').boundingBox();
  const inspector = await page.locator('#inspector').boundingBox();
  expect(dock!.width).toBeLessThanOrEqual(inspector!.width + 2);

  // A problem about one element says which, by its label.
  await expect(
    page.locator('#problems .prob', { hasText: 'unconnected node' }).first(),
  ).toContainText('node “Ec”');

  // An overlap is about two nodes: both get a ring, and the row reads in
  // labels and a page name rather than generated ids.
  const row = page.locator('#problems .prob', { hasText: 'overlap' }).first();
  await expect(row.locator('.prob-where')).toContainText('Page 1');
  await expect(row.locator('.prob-msg')).not.toContainText(/"n[a-z0-9]{8,}"/);
  await row.locator('.prob-go').click();
  await expect(page.locator('#overlay [data-spotlight="node"]')).toHaveCount(2);
  // The rings clear on Escape.
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay [data-spotlight]')).toHaveCount(0);

  // Hide it: the count drops, the footer says so, and it survives a reload.
  await row.hover();
  await row.locator('.prob-hide').click();
  await expect(count).toHaveText(String(total - 1));
  await expect(page.locator('.prob-foot')).toContainText('1 hidden');
  await expect(page.locator('#saved')).toHaveText('✓ saved');
  await page.reload();
  await expect(page.locator('#prob-count')).toHaveText(String(total - 1));

  await page.locator('#prob-restore').click();
  await expect(page.locator('#prob-count')).toHaveText(String(total));
  await expect(page.locator('.prob-foot')).toHaveCount(0);
});
