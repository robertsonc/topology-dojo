import { test, expect, type Page } from '@playwright/test';
import { bootEditor, statusCount } from './helpers.js';

const question = (page: Page, label: string) =>
  page.locator('.sdw-q', {
    has: page.locator(`.sdw-label:text-is("${label}")`),
  });

test('SD-WAN wizard previews vendor-aware counts and creates the diagram', async ({
  page,
}) => {
  await bootEditor(page);
  await page.selectOption('#fTemplate', '__sdwan');
  const card = page.locator('.sdw-card');
  await expect(card).toBeVisible();
  // Defaults: EdgeConnect, 1 region, 2 hubs, 4 branches, 1 Internet link.
  await expect(page.locator('.sdw-stats')).toHaveText(
    '6 devices · 9 overlay tunnels · 9 underlay (hidden layer) · 6 cables',
  );
  await expect(page.locator('.sdw-preview svg')).toBeVisible();

  // Switching vendor relabels branch HA and changes the tunnel model.
  await question(page, 'Vendor')
    .getByRole('button', { name: 'Juniper SRX' })
    .click();
  await question(page, 'Branch edge')
    .getByRole('button', { name: 'Chassis cluster' })
    .click();
  // Tunnels: 4 branches × node0 × 2 hubs + the hub pair; no underlay plane.
  // Cables: per cluster control + fabric + one reth circuit on each node,
  // plus the two hub circuits.
  await expect(page.locator('.sdw-stats')).toHaveText(
    '10 devices · 9 tunnels · 18 cables',
  );

  // "One box per site" hides the device-only LAN question.
  await question(page, 'How much detail?')
    .getByRole('button', { name: 'One box per site' })
    .click();
  await expect(question(page, 'Branch LAN')).toHaveCount(0);

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Create diagram' }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => statusCount(page, 'nodes')).toBe(6);
  await expect.poll(() => statusCount(page, 'links')).toBe(9);
});

test('Escape closes the SD-WAN wizard without touching the document', async ({
  page,
}) => {
  await bootEditor(page);
  const n0 = await statusCount(page, 'nodes');
  await page.selectOption('#fTemplate', '__sdwan');
  await expect(page.locator('.sdw-card')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sdw-card')).toHaveCount(0);
  expect(await statusCount(page, 'nodes')).toBe(n0);
});
