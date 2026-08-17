import { test, expect, type Page } from '@playwright/test';
import { bootEditor, openFixture } from './helpers.js';

/**
 * Visual-regression baselines for representative diagrams (#216). Motion is
 * forced off (reduced-motion → calm mode) so frames are deterministic.
 *
 * Baselines are CANONICAL FOR CI's renderer: other environments rasterize
 * fonts slightly differently (and can differ by a pixel of layout height), so
 * run locally with `--ignore-snapshots`, and refresh baselines from the CI
 * `playwright-report` artifact's `*-actual.png` files when a change is real.
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } });

const SNAP = {
  animations: 'disabled',
  // The canvas fills the viewport-dependent stage; snapshot the drawing only.
} as const;

function canvas(page: Page) {
  return page.locator('.canvas-host').first();
}

test('sample scene (zones, flow paths, policy markers)', async ({ page }) => {
  await bootEditor(page);
  await expect(canvas(page)).toHaveScreenshot('sample-scene.png', SNAP);
});

test('spine-leaf fabric (dense hierarchical)', async ({ page }) => {
  await bootEditor(page);
  await openFixture(page, 'spine-leaf.json');
  await expect(page.locator('#saved')).toHaveText('✓ saved');
  await expect(canvas(page)).toHaveScreenshot('spine-leaf.png', SNAP);
});

test('EdgeHA fixture in light theme', async ({ page }) => {
  await bootEditor(page);
  await page.evaluate(() =>
    localStorage.setItem('topology-dojo:theme', 'light'),
  );
  await page.reload();
  await openFixture(page, 'EdgeHA_after.json');
  await expect(page.locator('#saved')).toHaveText('✓ saved');
  await expect(canvas(page)).toHaveScreenshot('edgeha-light.png', SNAP);
});

test('narrow viewport keeps core controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await bootEditor(page);
  // Icon-only toolbar controls stay present (labels hide responsively).
  await expect(page.locator('#tUndo')).toBeVisible();
  await expect(page.locator('#fSave')).toBeVisible();
  await expect(page.locator('#tSelect')).toBeVisible();
});

test('phone viewport keeps the canvas visible and usable (#221)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootEditor(page);

  const host = page.locator('.canvas-host').first();
  await expect(host).toBeVisible();
  await expect(page.locator('#page-canvas')).toBeVisible();
  await expect(page.locator('#palette')).toHaveClass(/collapsed/);
  await expect(page.locator('#inspector-wrap')).toHaveClass(/collapsed/);

  const box = await host.boundingBox();
  expect(box, 'canvas host should have a layout box').toBeTruthy();
  expect(box!.width).toBeGreaterThanOrEqual(160);
  expect(box!.height).toBeGreaterThanOrEqual(200);

  // Zoom/fit chrome sits on the canvas and must stay clickable.
  await expect(page.locator('#ccFit')).toBeVisible();
  await page.locator('#ccFit').click();

  // Opening properties as a drawer must not consume the canvas box.
  await page.locator('#inspector-toggle').click();
  await expect(page.locator('#inspector-wrap')).not.toHaveClass(/collapsed/);
  await expect(page.locator('#inspector')).toBeVisible();
  const openBox = await host.boundingBox();
  expect(openBox!.width).toBeGreaterThanOrEqual(160);
  expect(openBox!.height).toBeGreaterThanOrEqual(200);

  // Node library is an overlay; opening it still leaves a sized canvas.
  await page.locator('#palette-toggle').click();
  await expect(page.locator('.pitem').first()).toBeVisible();
  const palBox = await host.boundingBox();
  expect(palBox!.width).toBeGreaterThanOrEqual(160);
  expect(palBox!.height).toBeGreaterThanOrEqual(200);
});
