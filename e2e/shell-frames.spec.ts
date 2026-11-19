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
  await expect(button).toHaveText(action, { ignoreCase: true });
  await expect(button).toHaveAccessibleName(action, { ignoreCase: true });
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

test('the page chips work from the keyboard', async ({ page }) => {
  await bootEditor(page);
  await page.locator('#addPage').click();
  await page.locator('#addPage').click();
  await expect(page.locator('#frames-ind')).toHaveText('3/3');
  const chip = (index: number) =>
    page.locator(`#filmstrip [data-page="${index}"] .frame-sel`);
  // Each chip is a button named for its page; the current one says so.
  await expect(chip(0)).toHaveAccessibleName('Page 1 Frame 1');
  await expect(chip(2)).toHaveAttribute('aria-current', 'page');
  await expect(chip(0)).not.toHaveAttribute('aria-current', /.*/);

  // Tab reaches the first chip from the play button, then its delete
  // button, then the next chip.
  await page.locator('#playFlip').focus();
  await page.keyboard.press('Tab');
  await expect(chip(0)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-del="0"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(chip(1)).toBeFocused();

  // Enter goes to that page and leaves focus on its chip.
  await page.keyboard.press('Enter');
  await expect(page.locator('#frames-ind')).toHaveText('2/3');
  await expect(chip(1)).toHaveAttribute('aria-current', 'page');
  await expect(chip(2)).not.toHaveAttribute('aria-current', /.*/);
  await expect(chip(1)).toBeFocused();

  // F2 renames it; Enter keeps the name and gives focus back to the chip.
  await page.keyboard.press('F2');
  await expect(page.locator('#filmstrip .frame-rename')).toBeFocused();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Core');
  await page.keyboard.press('Enter');
  await expect(frameName(page, 1)).toHaveText('Core');
  await expect(chip(1)).toBeFocused();
  // Escape cancels a rename the same way.
  await page.keyboard.press('F2');
  await page.keyboard.type('CANCELLED');
  await page.keyboard.press('Escape');
  await expect(frameName(page, 1)).toHaveText('Core');
  await expect(chip(1)).toBeFocused();
});

test('adding, duplicating and deleting a page from the keyboard keeps the focus in the pages bar', async ({
  page,
}) => {
  await bootEditor(page);
  const chip = (index: number) =>
    page.locator(`#filmstrip [data-page="${index}"] .frame-sel`);
  // Add page and Duplicate page keep the focus on themselves, so the next
  // Tab moves on in the bar's order.
  await page.locator('#addPage').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#frames-ind')).toHaveText('2/2');
  await expect(page.locator('#addPage')).toBeFocused();
  await page.locator('#dupPage').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#frames-ind')).toHaveText('3/3');
  await expect(page.locator('#dupPage')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#addPage')).toBeFocused();

  // Deleting a page moves the focus to the chip that takes its place.
  await page.locator('[data-del="1"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#frames-ind')).toHaveText(/\/2$/);
  await expect(chip(1)).toBeFocused();
  // Undo delete, once used, gives way to the current page's chip.
  await page.locator('#undoDel').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#frames-ind')).toHaveText(/\/3$/);
  await expect(page.locator('#undoDel')).toHaveCount(0);
  await expect(
    page.locator('#pagesBar .frame-sel[aria-current="page"]'),
  ).toBeFocused();
});

test('after a pointer press on Add page or Duplicate page, Enter does not press it again', async ({
  page,
}) => {
  await bootEditor(page);
  const focusedTag = () => page.evaluate(() => document.activeElement?.tagName);
  await page.locator('#addPage').click();
  await expect(page.locator('#frames-ind')).toHaveText('2/2');
  expect(await focusedTag()).toBe('BODY');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('#frames-ind')).toHaveText('2/2');
  expect(await focusedTag()).toBe('BODY');

  await page.locator('#dupPage').click();
  await expect(page.locator('#frames-ind')).toHaveText('3/3');
  await page.keyboard.press('Enter');
  await expect(page.locator('#frames-ind')).toHaveText('3/3');
  expect(await focusedTag()).toBe('BODY');
});

test('a page chip reached by Tab scrolls wholly into the strip', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootEditor(page);
  for (let i = 1; i < 12; i++) await page.locator('#addPage').click();
  await expect(page.locator('#frames-ind')).toHaveText('12/12');
  await page.locator('#filmstrip [data-page="0"] .frame-sel').click();
  await page.locator('#playFlip').focus();
  const hidden: string[] = [];
  for (let stop = 0; stop < 24; stop++) {
    await page.keyboard.press('Tab');
    // As it is drawn: a frame after the key.
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => done(null))),
    );
    const seen = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const strip = document.getElementById('filmstrip')!;
      if (!strip.contains(el)) return null;
      const r = el.getBoundingClientRect();
      const s = strip.getBoundingClientRect();
      const left = s.left + strip.clientLeft;
      const right = left + strip.clientWidth;
      // The focus ring (2px, 2px out) included.
      return r.left - 4 >= left - 0.5 && r.right + 4 <= right + 0.5
        ? ''
        : (el.getAttribute('aria-label') ?? el.textContent ?? '');
    });
    if (seen === null) break;
    if (seen) hidden.push(seen);
  }
  expect(hidden).toEqual([]);
});
