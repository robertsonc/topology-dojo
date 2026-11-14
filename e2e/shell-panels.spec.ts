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

/* ── Node Designer ───────────────────────────────────────────────────────── */

test('a custom node type cannot take the name of a built-in type', async ({
  page,
}) => {
  await bootEditor(page);
  await page.locator('.pitem[data-type="router"]').first().click();
  await expect.poll(() => statusCount(page, 'selected')).toBe(1);
  /** The markup the built-in Router is drawn with, by any router node. */
  const routerArt = (): Promise<string> =>
    page.evaluate(() => {
      const nodes = [
        ...document.querySelectorAll('#page-canvas [data-tds-node]'),
      ];
      const added = nodes[nodes.length - 1]!;
      return added.innerHTML.replace(/id="[^"]*"/g, '');
    });
  const before = await routerArt();

  await page.locator('#pDesign').click();
  const dialog = page.locator('.nd-dialog');
  await expect(dialog).toBeVisible();
  await page.locator('#nd-name').fill('router');
  await page.locator('.nd-shape[data-shape="triangle"]').click();
  await page.locator('#nd-save').click();

  // Not saved: the dialog stays, says why, and the Router is untouched.
  await expect(dialog).toBeVisible();
  await expect(page.locator('#nd-name-msg')).toContainText(
    '“router” is a built-in node type',
  );
  await expect(page.locator('#nd-name')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(await routerArt()).toBe(before);
  await expect(page.locator('.pcustom [data-type="router"]')).toHaveCount(0);

  // A name of its own saves.
  await page.locator('#nd-name').fill('edge-router');
  await expect(page.locator('#nd-name-msg')).toBeEmpty();
  await page.locator('#nd-save').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.pcustom [data-type="edge-router"]')).toHaveCount(
    1,
  );
  expect(await routerArt()).toBe(before);
});

test('a second custom type does not silently replace the first', async ({
  page,
}) => {
  await bootEditor(page);
  // The sample scene brings a custom type of its own.
  const custom = page.locator('.pcustom .pitem[data-type]');
  const had = await custom.count();

  // Two designs saved without naming either: two types.
  await page.locator('#pDesign').click();
  await expect(page.locator('#nd-name')).toHaveValue('myNode');
  await page.locator('#nd-save').click();
  await expect(custom).toHaveCount(had + 1);
  await page.locator('#pDesign').click();
  await expect(page.locator('#nd-name')).toHaveValue('myNode2');
  await page.locator('.nd-shape[data-shape="triangle"]').click();
  await page.locator('#nd-save').click();
  await expect(custom).toHaveCount(had + 2);

  // Naming a new design after an existing type asks before replacing it.
  const asked: string[] = [];
  let answer = false;
  page.on('dialog', (d) => {
    asked.push(d.message());
    void (answer ? d.accept() : d.dismiss());
  });
  await page.locator('#pDesign').click();
  await page.locator('#nd-name').fill('myNode');
  await page.locator('#nd-save').click();
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain('“myNode” already exists');
  await expect(page.locator('.nd-dialog')).toBeVisible(); // declined: still open
  await expect(custom).toHaveCount(had + 2);

  answer = true;
  await page.locator('#nd-save').click();
  expect(asked).toHaveLength(2);
  await expect(page.locator('.nd-dialog')).toHaveCount(0);
  await expect(custom).toHaveCount(had + 2);

  // Editing a type and saving it under its own name asks nothing.
  await page.locator('.pcustom [data-edit="myNode2"]').click();
  await page.locator('#nd-save').click();
  await expect(page.locator('.nd-dialog')).toHaveCount(0);
  expect(asked).toHaveLength(2);
});
