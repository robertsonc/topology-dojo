/**
 * The floating panels around the canvas: popovers that get out of the way,
 * the Problems dock, the save chip.
 */
import { expect, test } from '@playwright/test';
import { bootEditor, clickNode, statusCount } from './helpers.js';

test('pressing the canvas closes Display settings and the shortcuts work again', async ({
  page,
}) => {
  await bootEditor(page);
  const nodes = await statusCount(page, 'nodes');
  const pop = page.locator('.display-pop');

  await page.locator('#tDisplay').click();
  await expect(pop).toBeVisible();
  // Using the popover's own controls keeps it open.
  await page.locator('#dpGlass').click();
  await expect(pop).toBeVisible();

  // Pressing a node on the canvas is working on the canvas: the popover
  // closes, the node is selected, and Delete reaches it.
  await clickNode(page, 'fw');
  await expect(pop).toBeHidden();
  await expect(page.locator('#tDisplay')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect.poll(() => statusCount(page, 'selected')).toBe(1);
  await page.keyboard.press('Delete');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(nodes - 1);

  // The button still toggles it, and Escape still closes it.
  await page.locator('#tDisplay').click();
  await expect(pop).toBeVisible();
  await page.locator('#tDisplay').click();
  await expect(pop).toBeHidden();
  await page.locator('#tDisplay').click();
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
});

test('pressing the canvas closes the sign-in prompt', async ({ page }) => {
  // The hosted Worker answers 401 for a visitor with no session.
  await page.route(
    (url) => url.pathname === '/api/me',
    (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{}',
      }),
  );
  await bootEditor(page);
  const prompt = page.locator('#signInPrompt');
  await page.locator('#userChip').click();
  await expect(prompt).toBeVisible();

  await clickNode(page, 'fw');
  await expect(prompt).toBeHidden();
  await expect.poll(() => statusCount(page, 'selected')).toBe(1);
});
