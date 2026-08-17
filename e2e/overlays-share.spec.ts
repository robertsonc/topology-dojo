import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  bootEditor,
  fixturesDir,
  readAutosave,
  statusCount,
} from './helpers.js';

test('canvas shortcuts stay inert while the help dialog is open (#209)', async ({
  page,
}) => {
  await bootEditor(page);
  const n0 = await statusCount(page, 'nodes');
  await page.locator('.pitem[data-type="ec"]').first().click();
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0 + 1);

  // The new node is selected; Delete inside the dialog must not reach it.
  await page.keyboard.press('?');
  await expect(page.locator('.help-card')).toBeVisible();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Escape');
  await expect(page.locator('.help-card')).toHaveCount(0);
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0 + 1);
});

test('a share link opens as a shared copy without touching local work (#202)', async ({
  page,
}) => {
  const shared = readFileSync(
    path.join(fixturesDir, 'spine-leaf.json'),
    'utf8',
  );

  // Establish local work first: one edit, autosaved.
  await bootEditor(page);
  const n0 = await statusCount(page, 'nodes');
  await page.locator('.pitem[data-type="ec"]').first().click();
  await expect(page.locator('#saved')).toHaveText('✓ saved');

  // Open a colleague's share link (worker API mocked out).
  await page.route('**/api/topology/e2etest', (route) =>
    route.fulfill({ contentType: 'application/json', body: shared }),
  );
  await page.goto('/v/e2etest');
  await expect(page.locator('#sharedBanner')).toBeVisible();
  await expect(page.locator('#sharedBanner')).toContainText(
    'This link is public',
  );
  await expect(page.locator('#sharedUnpublish')).toBeVisible();

  // The local autosave still holds the user's own document; the shared copy
  // lives in its own slot.
  const local = await readAutosave(page);
  expect(local?.pages[0]?.nodes).toHaveLength(n0 + 1);
  const sharedSlot = await readAutosave(page, 'shared');
  expect(sharedSlot?.title).toContain('Spine-leaf');

  // Returning restores the user's document and dismisses the banner.
  await page.locator('#sharedBack').click();
  await expect(page.locator('#sharedBanner')).toBeHidden();
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0 + 1);
});
