/**
 * The one-time "what moved" note: shown once to a browser that used the
 * editor before the new layout, never to a first-time visitor; dismissed for
 * good with "Got it"; shown again from Help ▸ What moved and the command
 * palette. It never takes the focus or a key, and stays out of present mode
 * and of a shared link's first view.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bootEditor, fixturesDir, menuCommand, statusText } from './helpers.js';

const NOTE_KEY = 'topology-dojo:shell-note';
const note = (page: Page) => page.locator('#shellNote');

/** Make this browser one that used the editor before, and open it again. */
async function returningUser(page: Page): Promise<void> {
  await page.evaluate((key) => {
    localStorage.clear();
    localStorage.setItem('tds-palette-collapsed', '0');
    localStorage.removeItem(key);
  }, NOTE_KEY);
  await page.reload();
  await expect(page.locator('#page-canvas')).toBeVisible();
}

test('a first-time visitor never sees the note, on this visit or the next', async ({
  page,
}) => {
  await bootEditor(page);
  await expect(note(page)).toBeHidden();
  // This visit has written its own keys: the next one is still not shown it.
  await page.reload();
  await expect(page.locator('#page-canvas')).toBeVisible();
  await expect(note(page)).toBeHidden();
});

test('a browser that used the editor before is shown the note, without the focus', async ({
  page,
}) => {
  await bootEditor(page);
  await returningUser(page);
  const card = page.getByRole('region', { name: 'What moved' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading')).toHaveText(
    'The editor has a new layout',
  );
  await expect(card.locator('li')).toHaveText([
    'The menus hold the File, Edit, View and Arrange commands.',
    'The tools are on the left rail.',
    'Pages, grid, snap and the minimap are on the bar under the canvas.',
    'Properties has Selection, Page and Document tabs.',
    'Ctrl/Cmd+K finds any command.',
  ]);
  await expect(card.locator('kbd.kbd')).toHaveText('Ctrl/Cmd+K');
  await expect(card.locator('#shellNoteOk')).toHaveClass(
    /\bbtn-primary\b.*\bbtn-sm\b|\bbtn-sm\b.*\bbtn-primary\b/,
  );
  await expect(card.locator('#shellNoteKeys')).toHaveText('Show shortcuts');
  await expect(card.locator('#shellNoteKeys')).toHaveClass(/\bbtn-ghost\b/);
  // It did not take the focus, and Tab reaches it after the zoom control.
  expect(
    await page.evaluate(() => document.activeElement === document.body),
  ).toBe(true);
  await page.locator('#ccFit').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#shellNoteOk')).toBeFocused();
});

test('dismissed, the note stays dismissed across a reload', async ({
  page,
}) => {
  await bootEditor(page);
  await returningUser(page);
  await expect(note(page)).toBeVisible();
  await page.locator('#shellNoteOk').click();
  await expect(note(page)).toBeHidden();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), NOTE_KEY),
  ).toBe('1');
  await page.reload();
  await expect(page.locator('#page-canvas')).toBeVisible();
  await expect(note(page)).toBeHidden();
});

test('Help ▸ What moved and the command palette show it again', async ({
  page,
}) => {
  await bootEditor(page);
  await expect(note(page)).toBeHidden();
  await menuCommand(page, 'help.whatMoved');
  await expect(note(page)).toBeVisible();
  await page.locator('#shellNoteOk').click();
  await expect(note(page)).toBeHidden();

  await page.keyboard.press('Control+k');
  await page.locator('.cmdk-input').fill('What moved');
  await page.keyboard.press('Enter');
  await expect(note(page)).toBeVisible();
});

test('the note never holds the keyboard; Show shortcuts leaves it open', async ({
  page,
}) => {
  await bootEditor(page);
  await returningUser(page);
  await expect(note(page)).toBeVisible();
  // A canvas shortcut works while it is shown.
  await page.keyboard.press('L');
  expect(await statusText(page, 'tool')).toBe('link');
  await page.keyboard.press('Escape');
  expect(await statusText(page, 'tool')).toBe('select');
  await expect(note(page)).toBeVisible();

  await page.locator('#shellNoteKeys').click();
  await expect(page.locator('.help-card')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.help-card')).toHaveCount(0);
  await expect(note(page)).toBeVisible();
  // Dismissed from the keyboard, the focus goes back to the page, where the
  // canvas's keys work.
  await page.locator('#shellNoteOk').focus();
  await page.keyboard.press('Enter');
  await expect(note(page)).toBeHidden();
  await page.keyboard.press('A');
  expect(await statusText(page, 'tool')).toBe('anchor');
});

test('the note is not shown in present mode', async ({ page }) => {
  await bootEditor(page);
  await returningUser(page);
  await expect(note(page)).toBeVisible();
  await menuCommand(page, 'view.present');
  await expect(page.locator('.present-root')).toBeVisible();
  await expect(note(page)).toBeHidden();
  // When the presentation ends, it is back where it was.
  await page.keyboard.press('Escape');
  await expect(page.locator('.present-root')).toHaveCount(0);
  await expect(note(page)).toBeVisible();
});

test('a shared link opens on its banner, without the note', async ({
  page,
}) => {
  const shared = readFileSync(
    path.join(fixturesDir, 'spine-leaf.json'),
    'utf8',
  );
  await page.route('**/api/topology/e2etest', (route) =>
    route.fulfill({ contentType: 'application/json', body: shared }),
  );
  await bootEditor(page);
  await page.evaluate((key) => localStorage.removeItem(key), NOTE_KEY);
  await page.goto('/v/e2etest');
  await expect(page.locator('#sharedBanner')).toBeVisible();
  await expect(note(page)).toBeHidden();
});

// In a window under 480px tall the note takes the canvas's height: it keeps
// clear of the zoom control and of the closed properties toggle, so every
// one of them can still be pressed, and the toggle never covers its title.
for (const size of [
  { width: 360, height: 225 },
  { width: 320, height: 256 },
  { width: 1024, height: 400 },
  { width: 844, height: 390 },
]) {
  test(`in a ${size.width}x${size.height} window the note covers no control`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await bootEditor(page);
    await returningUser(page);
    await expect(note(page)).toBeVisible();
    // The open library drawer covers the canvas's controls by design below
    // 1,024px; with it closed, only the note could.
    if (size.width < 1024) await page.locator('#palette-toggle').click();
    await expect(note(page)).toBeVisible();
    const found = await page.evaluate(() => {
      const card = document
        .getElementById('shellNote')!
        .getBoundingClientRect();
      const title = document
        .querySelector('.shell-note-title')!
        .getBoundingClientRect();
      const meet = (a: DOMRect, b: DOMRect) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
      const out: string[] = [];
      for (const id of [
        'ccZoomOut',
        'ccZoom',
        'ccZoomIn',
        'ccFit',
        'inspector-toggle',
      ]) {
        const el = document.getElementById(id)!;
        if (!el.checkVisibility()) continue;
        const r = el.getBoundingClientRect();
        if (meet(r, card)) out.push(`${id} meets the note`);
        if (meet(r, title)) out.push(`${id} meets its title`);
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        if (!hit || !el.contains(hit)) out.push(`${id} is not pressed`);
      }
      return out;
    });
    expect(found).toEqual([]);
  });
}
