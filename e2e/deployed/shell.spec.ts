import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { expectExported, exportAs } from '../helpers.js';

// This is the same absent public share used by the HTTP smoke check.
const missingShare = 'nonexistent-smoke-probe';
const title = (page: Page) =>
  page.getByRole('textbox', { name: 'Document title' });
const nodes = (page: Page) => page.locator('#page-canvas [data-tds-node]');

async function expectCandidate(
  browser: Browser,
  baseURL: string,
): Promise<void> {
  const page = await browser.newPage();
  const healthURL = new URL('/healthz', baseURL).href;
  try {
    const response = await page.goto(healthURL, { timeout: 15_000 });
    expect(response?.url()).toBe(healthURL);
    expect(response?.status()).toBe(200);
    expect(await response!.json()).toMatchObject({
      ok: true,
      sha: process.env.E2E_DEPLOYED_SHA,
    });
  } finally {
    await page.close();
  }
}

test.beforeAll(async ({ browser, baseURL }) => {
  await expectCandidate(browser, baseURL!);
});

test.afterAll(async ({ browser, baseURL }) => {
  await expectCandidate(browser, baseURL!);
});

async function openPublicEditor(page: Page): Promise<void> {
  const alert = page.waitForEvent('dialog').then(async (dialog) => {
    const message = dialog.message();
    await dialog.accept();
    return { type: dialog.type(), message };
  });
  const path = `/v/${missingShare}`;
  const [response, reported] = await Promise.all([page.goto(path), alert]);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(path);
  expect(reported).toEqual({
    type: 'alert',
    message: 'That shared topology was not found (it may have expired).',
  });
  await expect(page.locator('#page-canvas')).toBeVisible();
}

test('author edits a second page, reloads, and exports its SVG', async ({
  page,
}) => {
  await openPublicEditor(page);
  await title(page).fill('UI acceptance topology');
  await title(page).press('Enter');

  const originalNodes = await nodes(page).count();
  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await expect(page.locator('#frames-ind')).toHaveText('2/2');
  await expect(nodes(page)).toHaveCount(0);
  await page.locator('.pitem[data-type="ec"]').first().click();
  await expect(nodes(page)).toHaveCount(1);

  const label = page.locator('#inspector input[data-key="label"]');
  await label.fill('QA Edge Router');
  await label.press('Tab');
  await expect(nodes(page)).toContainText('QA Edge Router');
  await expect(page.locator('#saved')).toHaveText('✓ saved');

  const firstPage = page.getByRole('button', { name: /^Page 1 / });
  const secondPage = page.getByRole('button', { name: /^Page 2 / });
  await firstPage.click();
  await expect(nodes(page)).toHaveCount(originalNodes);
  // Navigating to the same URL loads the staged app again in this test profile.
  await openPublicEditor(page);
  await expect(title(page)).toHaveValue('UI acceptance topology');
  await secondPage.click();
  await expect(nodes(page)).toContainText('QA Edge Router');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportAs(page, 'svg'),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
  const svg = await readFile(await download.path(), 'utf8');
  expect(svg).toContain('<svg');
  expect(svg).toContain('QA Edge Router');
  await expectExported(page, 'svg');
});

test('narrow layout keeps drawers, fit view, and keyboard presentation usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPublicEditor(page);

  const library = page.getByRole('button', { name: 'Node library' });
  const properties = page.locator('#inspector-toggle');
  await expect(library).toHaveAttribute('aria-pressed', 'false');
  await expect(properties).toHaveAttribute('aria-expanded', 'false');
  await library.click();
  await expect(page.locator('.pitem').first()).toBeVisible();
  await properties.click();
  await expect(properties).toHaveAttribute('aria-expanded', 'true');
  await expect(library).toHaveAttribute('aria-pressed', 'false');
  await properties.click();
  await page.locator('#ccFit').click();

  await page.keyboard.press('Control+k');
  const search = page.locator('.cmdk-input');
  await expect(search).toBeFocused();
  await search.fill('Present');
  await search.press('Enter');
  const presentation = page.locator('.present-root');
  await expect(presentation).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(presentation).toBeHidden();
  await expect(page.locator('#page-canvas')).toBeVisible();
  await page.locator('#ccFit').click();
});

test('signed-out navigation preserves local work when a public link is missing', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login\?go=%2F$/);
  await expect(
    page.getByRole('link', { name: 'Sign in with GitHub', exact: true }),
  ).toBeVisible();
  await openPublicEditor(page);
  await title(page).fill('My disposable topology');
  await title(page).press('Enter');
  await expect(page.locator('#saved')).toHaveText('✓ saved');

  const [missing] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/topology/${missingShare}`,
    ),
    openPublicEditor(page),
  ]);
  expect(missing.status()).toBe(404);
  await expect(title(page)).toHaveValue('My disposable topology');
  await expect(page.locator('#sharedBanner')).toBeHidden();
});
