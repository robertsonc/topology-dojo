/**
 * The frames strip: renaming a frame.
 */
import { expect, test, type Page } from '@playwright/test';
import { bootEditor } from './helpers.js';

const frameName = (page: Page, index: number) =>
  page.locator(`#filmstrip [data-name="${index}"]`);

test('Escape cancels a frame rename; Enter and clicking away keep it', async ({
  page,
}) => {
  await bootEditor(page);
  await expect(frameName(page, 0)).toHaveText('Frame 1');

  await frameName(page, 0).dblclick();
  await expect(page.locator('#filmstrip .frame-rename')).toBeFocused();
  await page.keyboard.type('CANCELLED');
  await page.keyboard.press('Escape');
  await expect(frameName(page, 0)).toHaveText('Frame 1');
  // The page itself was not renamed: its Properties field agrees, and so
  // does the strip once something makes it redraw.
  await expect(page.locator('#p-name')).toHaveValue('Frame 1');
  await page.locator('#addPage').click();
  await expect(frameName(page, 0)).toHaveText('Frame 1');

  await frameName(page, 0).dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Core');
  await page.keyboard.press('Enter');
  await expect(frameName(page, 0)).toHaveText('Core');

  await frameName(page, 1).dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Edge');
  await page.locator('#p-title').click(); // clicking away commits
  await expect(frameName(page, 1)).toHaveText('Edge');
});
