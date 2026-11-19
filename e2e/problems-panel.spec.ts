import { test, expect } from '@playwright/test';
import {
  bootEditor,
  clickNode,
  inspectorSection,
  inspectorTab,
} from './helpers.js';

/**
 * The Problems dock: a row names elements the way the canvas does, a click
 * rings everything the problem refers to, and a problem can be hidden.
 */
test('a problem names its elements, rings them on click, and can be hidden', async ({
  page,
}) => {
  await bootEditor(page);
  // A node from the palette and a duplicate of it: unconnected, and one grid
  // step apart, so they overlap. That raises a validation warning about each
  // and a layout warning about the pair. (A second palette click no longer
  // lands on the first node, so the overlap comes from a duplicate.)
  await page.locator('.pitem').first().click();
  await page.keyboard.press('Control+d');

  const count = page.locator('#prob-count');
  await expect(count).not.toHaveText('0');
  const total = Number(await count.innerText());
  // The dock stays closed until it is asked for: its header shows the count.
  await page.locator('#problems-toggle').click();

  // The long-message dock takes the inspector's width, not its own.
  const dock = await page.locator('#problems-dock').boundingBox();
  const inspector = await page.locator('#inspector').boundingBox();
  expect(dock!.width).toBeLessThanOrEqual(inspector!.width + 2);

  // A problem about one element says which, by its label.
  await expect(
    page.locator('#problems .prob', { hasText: 'unconnected node' }).first(),
  ).toContainText('node “Ec”');

  // An overlap is about two nodes: both get a ring, and the row reads in
  // labels and a page name rather than generated ids.
  const row = page.locator('#problems .prob', { hasText: 'overlap' }).first();
  await expect(row.locator('.prob-where')).toContainText('Page 1');
  await expect(row.locator('.prob-msg')).not.toContainText(/"n[a-z0-9]{8,}"/);
  await row.locator('.prob-go').click();
  await expect(page.locator('#overlay [data-spotlight="node"]')).toHaveCount(2);
  // The rings clear on Escape.
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay [data-spotlight]')).toHaveCount(0);

  // Hide it: the count drops, the footer says so, and it survives a reload.
  await row.hover();
  await row.locator('.prob-hide').click();
  await expect(count).toHaveText(String(total - 1));
  await expect(page.locator('.prob-foot')).toContainText('1 hidden');
  await expect(page.locator('#saved')).toHaveText('✓ saved');
  await page.reload();
  await expect(page.locator('#prob-count')).toHaveText(String(total - 1));

  await page.locator('#prob-restore').click();
  await expect(page.locator('#prob-count')).toHaveText(String(total));
  await expect(page.locator('.prob-foot')).toHaveCount(0);
});

// A problem about one field of an element: the jump shows the element's tab,
// opens the section the field is in and puts the focus on the field.
test('a jump to a problem about a field opens its section and focuses it', async ({
  page,
}) => {
  await bootEditor(page);
  await clickNode(page, 'fw');
  await inspectorSection(page, 'Data');
  const href = page.locator('#inspector [data-key="href"]');
  await href.fill('ftp://example.com/fw');
  await href.press('Enter');
  await expect(page.locator('#saved')).toHaveText('✓ saved');

  // Somewhere else in the panel: the section closed, another tab on show.
  const data = page.locator('#inspector details.insp-group[data-group="Data"]');
  await data.locator('> summary').click();
  await expect(data).not.toHaveAttribute('open', '');
  await inspectorTab(page, 'page');

  await page.locator('#problems-toggle').click();
  await page
    .locator('#problems .prob', { hasText: 'not an http(s) URL' })
    .locator('.prob-go')
    .click();
  await expect(page.locator('#insp-tab-selection')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(data).toHaveAttribute('open', '');
  await expect(href).toBeFocused();
  await expect(href).toHaveValue('ftp://example.com/fw');
});
