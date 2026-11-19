/**
 * The frames strip: renaming a frame, and the flipbook player's way out.
 */
import { expect, test, type Page } from '@playwright/test';
import { bootEditor, inspectorSection, inspectorTab } from './helpers.js';

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

  await inspectorTab(page, 'document');
  await frameName(page, 1).dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Edge');
  await page.locator('#p-title').click(); // clicking away commits
  await expect(frameName(page, 1)).toHaveText('Edge');
});

/** The strip's play button offers `action`: its icon, then the word. */
async function expectPlayButton(
  page: Page,
  action: 'play' | 'pause',
): Promise<void> {
  const button = page.locator('#playFlip');
  await expect(button).toHaveText(action);
  await expect(button.locator('.icon use')).toHaveAttribute(
    'href',
    `#i-${action}`,
  );
}

/** Two frames that each hold for 150ms, with the player running. */
async function startFastPlayback(page: Page): Promise<void> {
  await page.locator('#addPage').click();
  await expect(page.locator('#frames-ind')).toHaveText('2/2');
  for (const index of [1, 0]) {
    await page.locator(`#filmstrip [data-page="${index}"]`).click();
    await inspectorSection(page, 'Playback');
    await page.locator('#p-dur').fill('150');
    await page.locator('#p-dur').press('Tab');
  }
  await page.locator('#playFlip').click();
  await expectPlayButton(page, 'pause');
  // It really is flipping: both frames come up.
  await expect(page.locator('#frames-ind')).toHaveText('2/2');
  await expect(page.locator('#frames-ind')).toHaveText('1/2');
}

/** The player has stopped: the button offers play, and the frame stays put. */
async function expectStopped(page: Page): Promise<void> {
  await expectPlayButton(page, 'play');
  const frame = await page.locator('#frames-ind').innerText();
  await page.waitForTimeout(600); // four hold times
  expect(await page.locator('#frames-ind').innerText()).toBe(frame);
}

test('Escape stops the flipbook player', async ({ page }) => {
  await bootEditor(page);
  await startFastPlayback(page);
  await page.keyboard.press('Escape');
  await expectStopped(page);
});

test('a press on the canvas stops the flipbook player', async ({ page }) => {
  await bootEditor(page);
  await startFastPlayback(page);
  const host = (await page.locator('.canvas-host').boundingBox())!;
  await page.mouse.click(host.x + host.width - 100, host.y + 100);
  await expectStopped(page);
});

test('choosing a frame with the arrow keys stops the flipbook player', async ({
  page,
}) => {
  await bootEditor(page);
  await startFastPlayback(page);
  // Focus is still on the play button the mouse clicked; nothing is selected
  // on the canvas, so the arrows flip frames.
  await page.keyboard.press('ArrowRight');
  await expectStopped(page);
});
