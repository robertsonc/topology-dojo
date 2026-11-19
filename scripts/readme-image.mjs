#!/usr/bin/env node
/**
 * Regenerates the README's lead image, docs/images/editor-sdwan.png: the
 * editor showing a generated three-region SD-WAN fabric, in the dark theme,
 * from browser storage holding only the theme and the dismissed "what moved" note, at 1440 x 900 CSS pixels and device scale
 * factor 2 (a 2880 x 1800 image).
 *
 * It drives a running dev server and nothing else. It is not part of any
 * gate; run it by hand when the editor's look changes.
 *
 * Usage (from the repository root):
 *   npm run dev -- --port 5173        # in another terminal
 *   node scripts/readme-image.mjs http://localhost:5173/
 *
 * The scene is what the Generate SD-WAN wizard builds with: "One box per
 * site", three regions, two independent hubs per region, four branches per
 * region, one Internet WAN link per branch, a single edge at each branch, and
 * the region-continents map backdrop. The hubs of the regions are meshed (the
 * wizard's default). The page is fitted to the content, the node library and
 * the properties panel are closed, the view is fitted to the page, and
 * nothing is selected.
 *
 * Set CHROMIUM_PATH to a Chromium executable to use that browser instead of
 * the one Playwright installed.
 */
/* global console, process, URL, localStorage */
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'docs',
  'images',
  'editor-sdwan.png',
);

const arg = process.argv[2];
if (!arg) {
  console.error('usage: node scripts/readme-image.mjs <dev server URL>');
  process.exit(2);
}
const url = new URL(arg).href;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
);
try {
  // A new context has empty storage; the theme is set before the page runs.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await context.addInitScript(() => {
    localStorage.setItem('topology-dojo:theme', 'dark');
    // A stored theme counts as a past visit, which would show the one-time
    // "what moved" note over the canvas; the image is of the editor itself.
    localStorage.setItem('topology-dojo:shell-note', '1');
  });
  const page = await context.newPage();
  // The wizard asks to replace the current diagram with a browser confirm.
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
  await page.waitForSelector('#topbar');

  // Open the wizard from the command palette.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Generate SD-WAN');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: /Generate SD-WAN/ });
  await dialog.waitFor();

  // Choose one button of a group by the group's label.
  const choose = async (label, option) => {
    const section = dialog
      .locator('.section-label', { hasText: label })
      .first();
    await section
      .locator('xpath=following-sibling::*[1]')
      .getByRole('button', { name: option, exact: true })
      .click();
  };
  await choose('How much detail?', 'One box per site');
  await choose('Regions', '3');
  await choose('Hubs per region', '2 (independent)');
  await choose('Map backdrop', 'Region continents');
  await dialog.getByRole('button', { name: 'Create diagram' }).click();
  await dialog.waitFor({ state: 'hidden' });

  // Fit the page to its content. Then close the node library and the
  // properties panel, so the diagram, which is what the image is for, gets
  // the width; fit the view to the page, let it settle, and take the shot.
  await page.getByRole('button', { name: 'Fit to content' }).first().click();
  await page.click('#palette-toggle');
  await page.click('#inspector-toggle');
  await page.click('#ccFit');
  await page.waitForTimeout(1500);
  await page.mouse.move(700, 880);
  await page.screenshot({ path: OUT });
  console.log(`wrote ${OUT}`);
} finally {
  await browser.close();
}
