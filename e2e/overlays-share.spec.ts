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
  // The banner's actions are the shell's shared buttons, in sentence case.
  for (const button of await page.locator('#sharedBanner button').all())
    await expect(button).toHaveClass(/\bbtn\b/);
  await expect(page.locator('#sharedBanner button')).toHaveText([
    'Keep this copy',
    'Back to my document',
    'Unpublish link',
  ]);

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

test('the shared-copy banner’s Unpublish link reads at 4.5:1 in both themes, at rest and on hover', async ({
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
  /** Its words against its own fill, which must be opaque: the banner under
   * it is tinted by the accent. */
  const reading = () =>
    page.locator('#sharedUnpublish').evaluate((el) => {
      const cs = getComputedStyle(el);
      const ctx = document.createElement('canvas').getContext('2d')!;
      const rgba = (css: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      const lum = ([r, g, b]: number[]) => {
        const c = [r!, g!, b!].map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
      };
      const fg = rgba(cs.color);
      const bg = rgba(cs.backgroundColor);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return { alpha: bg[3], ratio: (hi! + 0.05) / (lo! + 0.05) };
    });
  for (const theme of ['dark', 'light']) {
    await page.evaluate(
      (t) => localStorage.setItem('topology-dojo:theme', t),
      theme,
    );
    await page.goto('/v/e2etest');
    await expect(page.locator('#sharedUnpublish')).toBeVisible();
    await page.mouse.move(0, 400);
    const rest = await reading();
    await page.locator('#sharedUnpublish').hover();
    await expect
      .poll(async () => (await reading()).alpha, { timeout: 2000 })
      .toBe(255);
    const hover = await reading();
    for (const [state, r] of [
      ['at rest', rest],
      ['on hover', hover],
    ] as const) {
      expect(r.alpha, `${theme}, ${state}: its fill is opaque`).toBe(255);
      expect(r.ratio, `${theme}, ${state}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
