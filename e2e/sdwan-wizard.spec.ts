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

test('overview mode: named regions, drill down to a region page and back', async ({
  page,
}) => {
  await bootEditor(page);
  await page.selectOption('#fTemplate', '__sdwan');
  await question(page, 'Regions').getByRole('button', { name: '2' }).click();
  await page.getByLabel('Region 1 name').fill('West');
  await page.getByLabel('Region 2 branches').selectOption('2');
  await question(page, 'How much detail?')
    .getByRole('button', { name: 'Overview + region pages' })
    .click();
  await expect(page.locator('.sdw-stats')).toContainText('3 pages');

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Create diagram' }).click();
  const frames = page.locator('#filmstrip [data-page]');
  await expect(frames).toHaveCount(3);
  await expect(frames.nth(0)).toHaveClass(/\bon\b/);
  // West: 2 hubs + 4 branches; EMEA: 2 hubs + 2 branches.
  await expect.poll(() => statusCount(page, 'nodes')).toBe(10);

  // Ctrl/Cmd+click an EMEA branch tile → the EMEA device page. (EMEA sits
  // mid-canvas; West's tiles can sit under the node library at this size.)
  const ctrlClick = async (selector: string) => {
    const box = (await page.locator(selector).boundingBox())!;
    await page.keyboard.down('Control');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.up('Control');
  };
  await ctrlClick('#page-canvas [data-tds-node="ne_emea-br01"]');
  await expect(frames.nth(2)).toHaveClass(/\bon\b/);
  await expect(
    page.locator('#page-canvas [data-tds-node="ne_emea-hub01"]'),
  ).toHaveCount(1);

  // The back link returns to the overview.
  await ctrlClick('#page-canvas [data-tds-node="nav_emea_overview"]');
  await expect(frames.nth(0)).toHaveClass(/\bon\b/);
  // Following links never edits the document.
  await expect.poll(() => statusCount(page, 'nodes')).toBe(10);
});

test('cloud hub and SSE on-ramp land on the canvas with their counts', async ({
  page,
}) => {
  await bootEditor(page);
  await page.selectOption('#fTemplate', '__sdwan');
  await question(page, 'Cloud hub per region')
    .getByRole('button', { name: 'AWS' })
    .click();
  await question(page, 'SSE on-ramp')
    .getByRole('button', { name: 'From branches' })
    .click();
  // Defaults: 1 region, 2 hubs + 1 cloud hub, 4 single branches on INET.
  // Overlay: 4 branches × 3 hubs + 3 hub pairs = 15; SSE: one per branch.
  await expect(page.locator('.sdw-stats')).toHaveText(
    '7 devices · 15 overlay tunnels · 15 underlay (hidden layer) (4 to SSE) · 8 cables',
  );
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Create diagram' }).click();
  await expect(
    page.locator('#page-canvas [data-tds-node="cloudgw_amer"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('#page-canvas [data-tds-node="sse_amer"]'),
  ).toHaveCount(1);
});
