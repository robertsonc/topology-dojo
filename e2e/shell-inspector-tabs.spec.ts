/**
 * The properties panel's three tabs (Selection, Page, Document), its
 * sections, and a node's Link attachment section.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  bootEditor,
  clickLink,
  clickNode,
  inspectorSection,
  inspectorTab,
  savedDocument,
  savedElement,
  statusCount,
} from './helpers.js';

const tab = (page: Page, name: string) => page.locator(`#insp-tab-${name}`);
const section = (page: Page, title: string) =>
  page.locator(`#inspector > details.insp-group[data-group="${title}"]`);
const isOpen = (page: Page, title: string): Promise<boolean> =>
  section(page, title).evaluate((d) => (d as HTMLDetailsElement).open);

test('the tabs are a tab list that follows the selection', async ({ page }) => {
  await bootEditor(page);
  const list = page.locator('.insp-tabs');
  await expect(list).toHaveAttribute('role', 'tablist');
  await expect(list).toHaveAttribute('aria-label', 'Properties');
  await expect(list.getByRole('tab')).toHaveText([
    'Selection',
    'Page',
    'Document',
  ]);
  const panel = page.locator('#inspector');
  await expect(panel).toHaveAttribute('role', 'tabpanel');

  // Nothing selected: the Page tab, and Selection cannot be chosen.
  await expect(tab(page, 'page')).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toHaveAttribute('aria-labelledby', 'insp-tab-page');
  await expect(tab(page, 'selection')).toHaveAttribute('aria-disabled', 'true');
  await tab(page, 'selection').dispatchEvent('click');
  await expect(tab(page, 'page')).toHaveAttribute('aria-selected', 'true');
  for (const name of ['selection', 'page', 'document'])
    await expect(tab(page, name)).toHaveAttribute('aria-controls', 'inspector');

  // Selecting brings the Selection tab forward, named for what is selected.
  await clickNode(page, 'fw');
  await expect(tab(page, 'selection')).toHaveText('Node');
  await expect(tab(page, 'selection')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'selection')).not.toHaveAttribute('aria-disabled');
  await expect(panel).toHaveAttribute('aria-labelledby', 'insp-tab-selection');
  await clickLink(page, 'ec-fw');
  await expect(tab(page, 'selection')).toHaveText('Link');

  // A tab picked by hand stays while the selection does, through redraws.
  await inspectorTab(page, 'page');
  await expect(section(page, 'Links')).toBeVisible();
  await page.locator('#p-attach').click();
  await expect(tab(page, 'page')).toHaveAttribute('aria-selected', 'true');
  await expect(section(page, 'Links')).toBeVisible();

  // Clearing the selection goes back to the tab last chosen of Page and
  // Document.
  await inspectorTab(page, 'document');
  await page.keyboard.press('Escape');
  await expect(tab(page, 'selection')).toHaveText('Selection');
  await expect(tab(page, 'document')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#p-title')).toBeVisible();
  // …and so does a reload: the choice is a view preference.
  await page.reload();
  await expect(tab(page, 'document')).toHaveAttribute('aria-selected', 'true');
  expect(
    await page.evaluate(() =>
      localStorage.getItem('topology-dojo:inspector-tab'),
    ),
  ).toBe('document');
});

test('the arrow keys, Home and End move between the tabs that can be shown', async ({
  page,
}) => {
  await bootEditor(page);
  await tab(page, 'page').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'document')).toBeFocused();
  await expect(tab(page, 'document')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#p-title')).toBeVisible();
  // Selection is skipped while nothing is selected.
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'page')).toBeFocused();
  await page.keyboard.press('End');
  await expect(tab(page, 'document')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab(page, 'page')).toBeFocused();
  await expect(page.locator('#p-name')).toBeVisible();
  // Only the tab on show is in the Tab order.
  await expect(tab(page, 'page')).toHaveAttribute('tabindex', '0');
  await expect(tab(page, 'document')).toHaveAttribute('tabindex', '-1');

  // With a node selected the arrows reach Selection, and they move the tab,
  // not the node.
  await clickNode(page, 'fw');
  await tab(page, 'selection').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, 'document')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'selection')).toBeFocused();
  await expect(tab(page, 'selection')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'page')).toHaveAttribute('aria-selected', 'true');
  expect(await statusCount(page, 'history')).toBe(0);
});

test('each tab has its sections, open or closed as they start', async ({
  page,
}) => {
  await bootEditor(page);
  const titles = (): Promise<[string, boolean][]> =>
    page
      .locator('#inspector > details.insp-group')
      .evaluateAll((ds) =>
        ds.map((d) => [
          (d as HTMLElement).dataset.group!,
          (d as HTMLDetailsElement).open,
        ]),
      );
  expect(await titles()).toEqual([
    ['Page', true],
    ['Links', true],
    ['Story', true],
    ['Playback', false],
    ['Annotations', false],
  ]);
  // The annotations list is on the Page tab only, with its count.
  await expect(section(page, 'Annotations').locator('.insp-count')).toHaveText(
    /^\d+$/,
  );
  await inspectorTab(page, 'document');
  expect(await titles()).toEqual([
    ['Document', true],
    ['Legend', true],
    ['Sheet', false],
    ['Layers', false],
  ]);
  await clickNode(page, 'fw');
  expect(await titles()).toEqual([
    ['Text', true],
    ['Style', true],
    ['Link attachment', true],
    ['Wiring', false],
    ['Position and order', false],
    ['Data', false],
  ]);
  await expect(page.locator('#inspector details.anno')).toHaveCount(0);
  await clickLink(page, 'ec-fw');
  expect((await titles()).map(([t]) => t)).toEqual([
    'Label',
    'Style',
    'Routing',
    'Wiring',
    'Animation',
    'Data',
  ]);
});

test('a section stays as the user left it, after a redraw and a reload', async ({
  page,
}) => {
  await bootEditor(page);
  await clickNode(page, 'fw');
  expect(await isOpen(page, 'Wiring')).toBe(false);
  await inspectorSection(page, 'Wiring');
  await section(page, 'Style').locator('> summary').click();
  expect(await isOpen(page, 'Style')).toBe(false);

  // Another node: the same sections, as left.
  await clickNode(page, 'ec');
  expect(await isOpen(page, 'Wiring')).toBe(true);
  expect(await isOpen(page, 'Style')).toBe(false);

  await page.reload();
  await clickNode(page, 'fw');
  expect(await isOpen(page, 'Wiring')).toBe(true);
  expect(await isOpen(page, 'Style')).toBe(false);
});

test('a node shows its link attachment, and overriding it writes the node', async ({
  page,
}) => {
  await bootEditor(page);
  // The page's own setting, as its Links section shows it.
  await inspectorSection(page, 'Links');
  if (!(await page.locator('#p-attach').isChecked()))
    await page.locator('#p-attach').check();
  await page.locator('#p-attach-pad').fill('8');
  await page.locator('#p-attach-pad').press('Tab');
  if (await page.locator('#p-attach-dist').isChecked())
    await page.locator('#p-attach-dist').uncheck();

  await clickNode(page, 'fw');
  const attach = section(page, 'Link attachment');
  await expect(attach).toBeVisible();
  // What applies now is read from the page's setting.
  const line = attach.locator('[data-link-attach-summary]');
  await expect(line).toHaveText(
    'From page: anchor box on, 8 px padding, ends not distributed.',
  );
  const override = attach.locator('input[data-key="linkAttach"]');
  await expect(override).not.toBeChecked();
  await expect(attach.locator('[data-key="linkAttach.pad"]')).toHaveCount(0);

  // The override switch is the node's own linkAttach object.
  await override.check();
  await expect
    .poll(async () => (await savedElement(page, 'nodes', 'fw')).linkAttach)
    .toEqual({});
  await expect(line).toHaveText(
    'This node: anchor box on, 8 px padding, ends not distributed.',
  );
  const pad = attach.locator('input[data-key="linkAttach.pad"]');
  await pad.fill('14');
  await expect
    .poll(async () => (await savedElement(page, 'nodes', 'fw')).linkAttach)
    .toEqual({ pad: 14 });
  await expect(line).toHaveText(/^This node: anchor box on, 14 px padding, /);
  await attach.locator('input[data-key="linkAttach.distribute"]').check();
  await expect
    .poll(async () => (await savedElement(page, 'nodes', 'fw')).linkAttach)
    .toEqual({ pad: 14, distribute: true });
  await expect(line).toHaveText(
    'This node: anchor box on, 14 px padding, ends distributed.',
  );

  await attach.locator('input[data-key="linkAttach"]').uncheck();
  await expect
    .poll(async () => savedElement(page, 'nodes', 'fw'))
    .not.toHaveProperty('linkAttach');
  await expect(line).toHaveText(
    'From page: anchor box on, 8 px padding, ends not distributed.',
  );

  // Turned off on the page, the line says so.
  await page.keyboard.press('Escape');
  await page.locator('#p-attach').uncheck();
  await clickNode(page, 'fw');
  await expect(line).toHaveText('From page: off. Links meet the icon edge.');
});

test('with a node selected, the page’s link settings are one click away', async ({
  page,
}) => {
  await bootEditor(page);
  await clickNode(page, 'fw');
  await tab(page, 'page').click();
  const links = section(page, 'Links');
  await expect(links).toBeVisible();
  expect(await isOpen(page, 'Links')).toBe(true);
  await expect(links.locator('.insp-hint')).toHaveText(
    'How links meet nodes on this page. A node can override these.',
  );
  for (const id of ['#p-attach', '#p-jumps', '#p-portlabels'])
    await expect(links.locator(id)).toBeVisible();
  if (await links.locator('#p-attach').isChecked()) {
    await expect(links.locator('#p-attach-pad')).toBeVisible();
    await expect(links.locator('#p-attach-dist')).toBeVisible();
  }
});

test('two nodes can be arranged and annotated from the Selection tab', async ({
  page,
}) => {
  await bootEditor(page);
  await clickNode(page, 'fw');
  const second = await page
    .locator('#page-canvas [data-tds-node="ec"]')
    .boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.click(
    second!.x + second!.width / 2,
    second!.y + second!.height / 2,
  );
  await page.keyboard.up('Shift');
  await expect(tab(page, 'selection')).toHaveText('2 nodes');
  const arrange = section(page, 'Arrange');
  await expect(arrange.locator('[data-align]')).toHaveCount(6);
  // Distributing needs three.
  await expect(arrange.locator('[data-dist]')).toHaveCount(2);
  for (const b of await arrange.locator('[data-dist]').all())
    await expect(b).toBeDisabled();
  const history = await statusCount(page, 'history');
  await arrange.locator('[data-align="left"]').click();
  await expect.poll(() => statusCount(page, 'history')).toBe(history + 1);

  const zones = (await savedDocument(page)).pages[0]!.zones.length;
  await section(page, 'Annotate')
    .getByRole('button', { name: 'Group into zone' })
    .click();
  await expect
    .poll(async () => (await savedDocument(page)).pages[0]!.zones.length)
    .toBe(zones + 1);
});
