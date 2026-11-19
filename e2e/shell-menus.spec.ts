/**
 * The top bar's menus: the menu bar works from the keyboard alone and with
 * a pointer, folds into one menu in a narrow window, and the bar never
 * scrolls sideways, whoever is signed in.
 */
import { expect, test, type Page } from '@playwright/test';
import { bootEditor, savedDocument, tabTo } from './helpers.js';

const top = (page: Page, menu: string) =>
  page.locator(`#menubar [data-menu="${menu}"]`);
const focusedItem = (page: Page) =>
  page.locator('.menu-layer [role^="menuitem"]:focus');
const isOn = (page: Page, selector: string): Promise<boolean> =>
  page.locator(selector).evaluate((el) => el.classList.contains('on'));

/** Answer /api/me as the hosted Worker does for a signed-in owner, so that
 * every chip of the top bar shows. */
async function signIn(page: Page, login = 'e2e-owner'): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => {
      const me = new URL(route.request().url()).pathname === '/api/me';
      return route.fulfill({
        status: me ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(
          me ? { login, admin: true } : { error: 'not found' },
        ),
      });
    },
  );
}

test('a menu is opened, walked and used with the keyboard alone', async ({
  page,
}) => {
  await bootEditor(page);
  expect(await isOn(page, '#tGrid')).toBe(true);

  // Tab reaches the bar on File; the arrows move along it without opening.
  await tabTo(page, '#menubar [data-menu="file"]');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(top(page, 'view')).toBeFocused();
  await expect(page.locator('.menu-layer')).toHaveCount(0);

  // ArrowDown opens View on its first item; Enter runs it.
  await page.keyboard.press('ArrowDown');
  await expect(top(page, 'view')).toHaveAttribute('aria-expanded', 'true');
  await expect(focusedItem(page)).toHaveAttribute(
    'data-command',
    'view.toggleGrid',
  );
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu-layer')).toHaveCount(0);
  expect(await isOn(page, '#tGrid')).toBe(false);
  // Focus is back on the menu's button.
  await expect(top(page, 'view')).toBeFocused();
  await expect(top(page, 'view')).toHaveAttribute('aria-expanded', 'false');

  // The item now shows the grid as off; Space runs it again.
  await page.keyboard.press('ArrowDown');
  await expect(focusedItem(page)).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press(' ');
  await expect(page.locator('.menu-layer')).toHaveCount(0);
  expect(await isOn(page, '#tGrid')).toBe(true);
  await expect(top(page, 'view')).toBeFocused();
});

test('with a menu open, Left and Right open the neighbouring menus', async ({
  page,
}) => {
  await bootEditor(page);
  await tabTo(page, '#menubar [data-menu="file"]');
  await page.keyboard.press('Enter');
  await expect(top(page, 'file')).toHaveAttribute('aria-expanded', 'true');
  await expect(focusedItem(page)).toHaveAttribute('data-command', 'file.new');

  await page.keyboard.press('ArrowRight');
  await expect(top(page, 'edit')).toHaveAttribute('aria-expanded', 'true');
  await expect(top(page, 'file')).toHaveAttribute('aria-expanded', 'false');
  // Its first item that can run now: nothing has been done to undo yet.
  await expect(focusedItem(page)).toHaveAttribute('data-command', 'edit.cut');
  await expect(page.locator('.menu-layer .menu')).toHaveCount(1);

  // Left goes back, and from the first menu wraps round to the last.
  await page.keyboard.press('ArrowLeft');
  await expect(top(page, 'file')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(top(page, 'help')).toHaveAttribute('aria-expanded', 'true');
  await expect(focusedItem(page)).toHaveAttribute(
    'data-command',
    'help.shortcuts',
  );

  // Escape closes it and puts focus back on its button.
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-layer')).toHaveCount(0);
  await expect(top(page, 'help')).toBeFocused();
});

test('a submenu opens with Right and closes with Left', async ({ page }) => {
  await bootEditor(page);
  await tabTo(page, '#menubar [data-menu="file"]');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const parent = focusedItem(page);
  await expect(parent).toHaveText(/New from template/);
  await expect(parent).toHaveAttribute('aria-haspopup', 'menu');

  await page.keyboard.press('ArrowRight');
  const menus = page.locator('.menu-layer .menu');
  await expect(menus).toHaveCount(2);
  await expect(focusedItem(page)).toHaveAttribute(
    'data-command',
    /^file\.template\./,
  );
  // Every starter template, then the SD-WAN generator.
  await expect(menus.nth(1).locator('[role="menuitem"]').last()).toHaveText(
    'Generate SD-WAN…',
  );

  await page.keyboard.press('ArrowLeft');
  await expect(menus).toHaveCount(1);
  await expect(focusedItem(page)).toHaveText(/New from template/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-layer')).toHaveCount(0);
  await expect(top(page, 'file')).toBeFocused();
});

test('a pointer opens a menu, moves across the bar and closes it outside', async ({
  page,
}) => {
  await bootEditor(page);
  await top(page, 'edit').click();
  await expect(top(page, 'edit')).toHaveAttribute('aria-expanded', 'true');
  // With a menu open, pointing at another menu opens that one instead.
  await top(page, 'arrange').hover();
  await expect(top(page, 'arrange')).toHaveAttribute('aria-expanded', 'true');
  await expect(top(page, 'edit')).toHaveAttribute('aria-expanded', 'false');
  await expect(
    page.locator('.menu [data-command="arrange.tidy"]'),
  ).toBeVisible();

  // A press outside, on the canvas, closes it.
  const host = (await page.locator('.canvas-host').boundingBox())!;
  await page.mouse.click(host.x + host.width - 60, host.y + host.height - 140);
  await expect(page.locator('.menu-layer')).toHaveCount(0);
  await expect(top(page, 'arrange')).toHaveAttribute('aria-expanded', 'false');

  // A second press on a menu's button closes it.
  await top(page, 'view').click();
  await expect(page.locator('.menu-layer .menu')).toHaveCount(1);
  await top(page, 'view').click();
  await expect(page.locator('.menu-layer')).toHaveCount(0);
});

test('the title in the top bar is the document title', async ({ page }) => {
  await bootEditor(page);
  const title = page.locator('#docTitle');
  await expect(title).toHaveValue(await page.locator('#p-title').inputValue());
  await title.fill('Branch office');
  // The page properties show it, and it is saved with the document.
  await expect(page.locator('#p-title')).toHaveValue('Branch office');
  expect((await savedDocument(page)).title).toBe('Branch office');
  // And the other way round.
  await page.locator('#p-title').fill('Campus');
  await expect(title).toHaveValue('Campus');
  expect((await savedDocument(page)).title).toBe('Campus');
});

for (const width of [1024, 1280, 1440, 1920]) {
  test(`the top bar never scrolls sideways at ${width}px, signed in`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await signIn(page);
    await bootEditor(page);
    // Every chip of a signed-in owner is showing.
    for (const id of ['#fShare', '#workspaceChip', '#userChip'])
      await expect(page.locator(id), id).toBeVisible();

    const bar = await page.locator('#topbar').evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      height: el.getBoundingClientRect().height,
    }));
    expect(bar.scroll).toBeLessThanOrEqual(bar.client);
    expect(bar.height).toBe(44);

    // At 1,100px and below the five menus are one Menu button.
    const folded = width <= 1100;
    await expect(page.locator('#menuMore')).toBeVisible({ visible: folded });
    for (const menu of ['file', 'edit', 'view', 'arrange', 'help'])
      await expect(top(page, menu)).toBeVisible({ visible: !folded });
  });
}

test('the folded menu holds the five menus as submenus', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await bootEditor(page);
  const more = page.locator('#menuMore');
  await tabTo(page, '#menuMore');
  await page.keyboard.press('ArrowDown');
  const menus = page.locator('.menu-layer .menu');
  await expect(menus.first().locator('[role="menuitem"]')).toHaveText([
    'File',
    'Edit',
    'View',
    'Arrange',
    'Help',
  ]);
  // View ▸ Grid, from the keyboard.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(focusedItem(page)).toHaveAttribute(
    'data-command',
    'view.toggleGrid',
  );
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu-layer')).toHaveCount(0);
  expect(await isOn(page, '#tGrid')).toBe(false);
  await expect(more).toBeFocused();
});
