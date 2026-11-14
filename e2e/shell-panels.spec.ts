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

test('the Problems dock opens when asked, and keeps hidden problems in reach', async ({
  page,
}) => {
  await bootEditor(page);
  const dock = page.locator('#problems-dock');
  const count = page.locator('#prob-count');
  const collapsed = (): Promise<boolean> =>
    dock.evaluate((el) => el.classList.contains('collapsed'));

  // A node dropped next to the sample scene raises a few problems. The dock
  // does not open by itself: its header, the status bar and the badges on
  // the canvas say they are there.
  await page.locator('.pitem[data-type="router"]').first().click();
  await expect(count).not.toHaveText('0');
  const total = Number(await count.innerText());
  await expect(page.locator('#sb-problems')).toHaveText(`⚠ ${total}`);
  expect(await collapsed()).toBe(true);
  await expect(page.locator('#problems .prob').first()).toBeHidden();

  // Opened by its header, it lists them.
  await page.locator('#problems-toggle').click();
  await expect(page.locator('#problems .prob')).toHaveCount(total);
  await expect(page.locator('#problems .prob').first()).toBeVisible();

  // Hiding every problem leaves the dock open, with the way back in view.
  for (let left = total; left > 0; left--) {
    const row = page.locator('#problems .prob').first();
    await row.hover();
    await row.locator('.prob-hide').click();
    await expect(count).toHaveText(String(left - 1));
    expect(await collapsed()).toBe(false);
  }
  await expect(page.locator('#problems-toggle')).toContainText(
    `${total} hidden`,
  );
  await expect(page.locator('#sb-problems')).toHaveText(`✓ ${total} hidden`);
  await expect(page.locator('.prob-foot')).toBeVisible();

  // "show" lists the hidden problems instead of closing the dock.
  await page.locator('#prob-show-hidden').click();
  expect(await collapsed()).toBe(false);
  await expect(page.locator('#problems .prob-hidden')).toHaveCount(total);
  await expect(page.locator('#problems .prob-hidden').first()).toBeVisible();

  // Closed by the user, the header still says problems are hidden.
  await page.locator('#problems-toggle').click();
  expect(await collapsed()).toBe(true);
  await expect(page.locator('#problems-toggle')).toContainText(
    `${total} hidden`,
  );

  // The status-bar indicator opens it again, and everything can be restored.
  await page.locator('#sb-problems').click();
  expect(await collapsed()).toBe(false);
  await page.locator('#prob-restore').click();
  await expect(count).toHaveText(String(total));
  await expect(page.locator('#problems-toggle')).not.toContainText('hidden');
  await expect(page.locator('.prob-foot')).toHaveCount(0);
});
