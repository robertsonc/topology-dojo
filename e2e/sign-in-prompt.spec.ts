import { test, expect } from '@playwright/test';
import { bootEditor } from './helpers.js';

/**
 * A visitor who arrives through a public share link has no session. Nothing
 * forces a sign-in, but the account chip offers one, and starting a document
 * of their own opens the prompt.
 */
test('an anonymous visitor is offered sign-in, never forced', async ({
  page,
}) => {
  // The hosted Worker answers 401 for a visitor with no session.
  await page.route(
    (url) => url.pathname === '/api/me',
    (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{}',
      }),
  );
  page.on('dialog', (dialog) => void dialog.accept());
  await bootEditor(page);

  const chip = page.locator('#userChip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/sign in/);
  const prompt = page.locator('#signInPrompt');
  await expect(prompt).toBeHidden();

  // Starting a new document opens the prompt, and the editor still works.
  await page.locator('#fNew').click();
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText(
    'Sign in to save your copy to your workspace.',
  );
  await expect(prompt.locator('#signInGo')).toHaveAttribute(
    'href',
    '/login?go=%2F',
  );
  await page.keyboard.press('Escape');
  await expect(prompt).toBeHidden();
  await page.locator('.pitem').first().click(); // still editable, signed out
  await expect(page.locator('#saved')).toHaveText('✓ saved');

  // The chip reopens it on demand.
  await chip.click();
  await expect(prompt).toBeVisible();
});

test('no sign-in chip without the hosted backend', async ({ page }) => {
  await bootEditor(page);
  await expect(page.locator('#userChip')).toBeHidden();
  page.on('dialog', (dialog) => void dialog.accept());
  await page.locator('#fNew').click();
  await expect(page.locator('#signInPrompt')).toHaveCount(0);
});
