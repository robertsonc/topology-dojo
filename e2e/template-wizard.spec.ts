import { test, expect, type Page } from '@playwright/test';
import { bootEditor, statusCount } from './helpers.js';

const question = (page: Page, label: string) =>
  page.locator('.sdw-q', {
    has: page.locator(`.sdw-label:text-is("${label}")`),
  });

const choose = (page: Page, label: string, value: string) =>
  question(page, label).getByRole('button', { name: value, exact: true });

test('a parametric template asks for its parameters, previews the counts and creates the diagram', async ({
  page,
}) => {
  await bootEditor(page);
  await page.selectOption('#fTemplate', 'spine-leaf');
  const card = page.locator('.tpw-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading')).toHaveText('Spine-leaf fabric');
  // Defaults: the fabric the template always built (2 spines, 4 leaves).
  await expect(page.locator('.sdw-stats')).toHaveText('6 nodes · 8 links');
  await expect(page.locator('.sdw-preview svg')).toBeVisible();
  await expect(choose(page, 'Spines', '2')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // A short range is a row of buttons, a long one a slider.
  await choose(page, 'Spines', '4').click();
  await expect(choose(page, 'Spines', '4')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(choose(page, 'Spines', '4')).toBeFocused();
  await page.getByLabel('Leaves').fill('12');
  await expect(question(page, 'Leaves').locator('output')).toHaveText('12');
  await expect(page.locator('.sdw-stats')).toHaveText('16 nodes · 48 links');
  // The slider answers to the keyboard too.
  await page.getByLabel('Leaves').press('ArrowRight');
  await expect(page.locator('.sdw-stats')).toHaveText('17 nodes · 52 links');
  await page.getByLabel('Leaves').press('ArrowLeft');

  // Create asks the same question the template menu always asked.
  page.once('dialog', (d) => {
    expect(d.message()).toBe(
      'Start from this template? Unsaved changes are lost.',
    );
    void d.accept();
  });
  await page.getByRole('button', { name: 'Create diagram' }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => statusCount(page, 'nodes')).toBe(16);
  await expect.poll(() => statusCount(page, 'links')).toBe(48);
  await expect(page.locator('#page-canvas [data-tds-node="l12"]')).toHaveCount(
    1,
  );
});

test('Escape closes the template dialog without touching the document', async ({
  page,
}) => {
  await bootEditor(page);
  const n0 = await statusCount(page, 'nodes');
  await page.selectOption('#fTemplate', 'hub-spoke');
  await expect(page.locator('.tpw-card')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tpw-card')).toHaveCount(0);
  expect(await statusCount(page, 'nodes')).toBe(n0);

  // Declining the confirmation after Create keeps the document as well.
  await page.selectOption('#fTemplate', 'hub-spoke');
  page.once('dialog', (d) => void d.dismiss());
  await page.getByRole('button', { name: 'Create diagram' }).click();
  await expect(page.locator('.tpw-card')).toHaveCount(0);
  expect(await statusCount(page, 'nodes')).toBe(n0);
});

test('hub and spoke with two hubs and nine sites', async ({ page }) => {
  await bootEditor(page);
  await page.selectOption('#fTemplate', 'hub-spoke');
  await expect(page.locator('.sdw-stats')).toHaveText('7 nodes · 6 links');
  await choose(page, 'Hubs', '2').click();
  await page.getByLabel('Sites').fill('9');
  // Every site tunnels to both hubs, and the hubs to each other.
  await expect(page.locator('.sdw-stats')).toHaveText('11 nodes · 19 links');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Create diagram' }).click();
  await expect.poll(() => statusCount(page, 'nodes')).toBe(11);
  await expect.poll(() => statusCount(page, 'links')).toBe(19);
  for (const id of ['hub1', 'hub2', 'site9'])
    await expect(
      page.locator(`#page-canvas [data-tds-node="${id}"]`),
    ).toHaveCount(1);
});

test('a yes/no parameter: firewall + DMZ with an internal firewall', async ({
  page,
}) => {
  await bootEditor(page);
  await page.selectOption('#fTemplate', 'firewall-dmz');
  await expect(page.locator('.sdw-stats')).toHaveText('6 nodes · 5 links');
  await choose(page, 'DMZ servers', '5').click();
  await choose(page, 'Internal firewall', 'Yes').click();
  await expect(page.locator('.sdw-stats')).toHaveText('10 nodes · 9 links');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Create diagram' }).click();
  await expect.poll(() => statusCount(page, 'nodes')).toBe(10);
  await expect(page.locator('#page-canvas [data-tds-node="ifw"]')).toHaveCount(
    1,
  );
});

test('a template without parameters starts as before, with no dialog', async ({
  page,
}) => {
  await bootEditor(page);
  let asked = '';
  page.once('dialog', (d) => {
    asked = d.message();
    void d.accept();
  });
  await page.selectOption('#fTemplate', 'ztna');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(5);
  await expect.poll(() => statusCount(page, 'links')).toBe(4);
  expect(asked).toBe('Start from this template? Unsaved changes are lost.');
  await expect(page.locator('.tpw-card')).toHaveCount(0);
});
