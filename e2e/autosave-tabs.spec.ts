/**
 * Autosave is one localStorage entry shared by every tab. A tab that is merely
 * open must never write its copy over work another tab saved in the meantime.
 */
import { expect, test } from '@playwright/test';
import { bootEditor, readAutosave, statusCount } from './helpers';

test('an idle tab does not overwrite newer work from another tab', async ({
  context,
}) => {
  const idle = await context.newPage();
  await bootEditor(idle);
  const before = await statusCount(idle, 'nodes');

  // A second tab on the same document adds a node and autosaves it.
  const active = await context.newPage();
  await active.goto('/');
  await expect(active.locator('.pitem').first()).toBeVisible();
  await active.locator('.pitem').first().click();
  await expect
    .poll(async () => (await readAutosave(active))?.pages[0]?.nodes.length)
    .toBe(before + 1);

  // The idle tab is told its canvas is out of date...
  await expect(idle.locator('#saved')).toContainText('changed in another tab');
  // ...and leaving it (unchanged) writes nothing.
  await idle.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  expect((await readAutosave(active))?.pages[0]?.nodes.length).toBe(before + 1);
});

test('the out-of-date tab can load the newer version', async ({ context }) => {
  const idle = await context.newPage();
  await bootEditor(idle);
  const before = await statusCount(idle, 'nodes');

  const active = await context.newPage();
  await active.goto('/');
  await expect(active.locator('.pitem').first()).toBeVisible();
  await active.locator('.pitem').first().click();

  const chip = idle.locator('#saved');
  await expect(chip).toContainText('changed in another tab');
  await chip.click();
  await expect.poll(() => statusCount(idle, 'nodes')).toBe(before + 1);
  await expect(chip).not.toContainText('changed in another tab');
});

test('a tab still saves its own unsaved change when it is closed', async ({
  page,
}) => {
  await bootEditor(page);
  const before = await statusCount(page, 'nodes');
  await page.locator('.pitem').first().click();
  // Leave inside the 400 ms autosave debounce.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  expect((await readAutosave(page))?.pages[0]?.nodes.length).toBe(before + 1);
});
