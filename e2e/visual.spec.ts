import { test, expect, type Page } from '@playwright/test';
import { bootEditor, openFixture } from './helpers.js';

/**
 * Visual-regression baselines for representative diagrams (#216). Motion is
 * forced off (reduced-motion → calm mode) so frames are deterministic.
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
