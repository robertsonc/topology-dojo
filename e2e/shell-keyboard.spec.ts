/**
 * Who the keyboard belongs to. A focused control keeps the plain keys it
 * uses, the canvas keeps its shortcuts everywhere else, and a control that
 * was only used with the mouse never holds on to the keyboard afterwards.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  bootEditor,
  clickNode,
  nodeBox,
  statusCount,
  statusText,
  tabTo,
} from './helpers.js';

const isOn = (page: Page, selector: string): Promise<boolean> =>
  page.locator(selector).evaluate((el) => el.classList.contains('on'));

/** Pick an option in a native select the way a mouse user's hand does: open
 * it with a click, then step down to the option and confirm. */
async function pickWithMouse(
  page: Page,
  selector: string,
  steps: number,
): Promise<void> {
  await page.locator(selector).click();
  for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}

test('Space and Enter press a focused button, and its plain keys stay off the canvas', async ({
  page,
}) => {
  await bootEditor(page);
  await clickNode(page, 'fw');
  await expect.poll(() => statusCount(page, 'selected')).toBe(1);
  const nodes = await statusCount(page, 'nodes');
  const before = await nodeBox(page, 'fw');

  await tabTo(page, '#tGrid');
  expect(await isOn(page, '#tGrid')).toBe(true);
  await page.keyboard.press('Space');
  expect(await isOn(page, '#tGrid')).toBe(false);
  await page.keyboard.press('Enter');
  expect(await isOn(page, '#tGrid')).toBe(true);

  // Arrows do not nudge the selected node, Delete does not remove it, and a
  // letter does not switch tool: the keyboard is on the button.
  for (const key of ['ArrowRight', 'ArrowDown', 'Delete', 'Backspace', 'l'])
    await page.keyboard.press(key);
  await page.keyboard.press('?');
  await expect(page.locator('.help-card')).toHaveCount(0);
  expect(await statusCount(page, 'nodes')).toBe(nodes);
  expect(await nodeBox(page, 'fw')).toEqual(before);
  expect(await statusText(page, 'tool')).toBe('select');
  await expect(page.locator('#tGrid')).toBeFocused();

  // Escape still reaches the canvas: it clears the selection, and hands the
  // keyboard back so the next plain key is a shortcut again.
  await page.keyboard.press('Escape');
  await expect.poll(() => statusCount(page, 'selected')).toBe(0);
  await expect(page.locator('#tGrid')).not.toBeFocused();
  await page.keyboard.press('l');
  expect(await statusText(page, 'tool')).toBe('link');
});

test('a palette tile and a section header answer Space when focused by keyboard', async ({
  page,
}) => {
  await bootEditor(page);
  const nodes = await statusCount(page, 'nodes');
  await tabTo(page, '.pitem[data-type="router"]');
  await page.keyboard.press('Space');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(nodes + 1);

  // The new node is selected, so the inspector shows its sections.
  const section = '#inspector details[data-group="Position"]';
  const open = (): Promise<boolean> =>
    page.locator(section).evaluate((el) => (el as HTMLDetailsElement).open);
  await tabTo(page, `${section} > summary`);
  const was = await open();
  await page.keyboard.press('Space');
  expect(await open()).toBe(!was);
  // The node was not deleted or moved off by keys meant for the header.
  expect(await statusCount(page, 'nodes')).toBe(nodes + 1);
});

test('undo and redo work while a toolbar control has keyboard focus', async ({
  page,
}) => {
  await bootEditor(page);
  const nodes = await statusCount(page, 'nodes');
  await page.locator('.pitem[data-type="router"]').first().click();
  await expect.poll(() => statusCount(page, 'nodes')).toBe(nodes + 1);

  await tabTo(page, '#tSelectBy');
  await page.keyboard.press('Control+z');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(nodes);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(nodes + 1);
  await expect(page.locator('#tSelectBy')).toBeFocused();
});

test('after a mouse pick in a toolbar menu the canvas shortcuts work again', async ({
  page,
}) => {
  await bootEditor(page);
  const nodes = await statusCount(page, 'nodes');
  await clickNode(page, 'fw');
  await expect.poll(() => statusCount(page, 'selected')).toBe(1);

  // select… → same type: the firewall is the only one of its type.
  await pickWithMouse(page, '#tSelectBy', 1);
  await expect(page.locator('#tSelectBy')).not.toBeFocused();
  expect(await statusCount(page, 'selected')).toBe(1);

  // "a" is the anchor tool, not type-ahead for the menu's "all".
  await page.keyboard.press('a');
  expect(await statusText(page, 'tool')).toBe('anchor');
  expect(await statusCount(page, 'selected')).toBe(1);
  await page.keyboard.press('v');
  expect(await statusText(page, 'tool')).toBe('select');

  await page.keyboard.press('Delete');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(nodes - 1);
  await page.keyboard.press('Control+z');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(nodes);

  // arrange… → hierarchical, then H is the hand tool, not another layout.
  await pickWithMouse(page, '#tLayout', 1);
  await expect(page.locator('#tLayout')).not.toBeFocused();
  const history = await statusCount(page, 'history');
  await page.keyboard.press('h');
  expect(await isOn(page, '#ccHand')).toBe(true);
  expect(await statusCount(page, 'history')).toBe(history);
});

test('a key pressed after an export does not start another export', async ({
  page,
}) => {
  await bootEditor(page);
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));

  // export… → Mermaid (the eighth option).
  await pickWithMouse(page, '#fExport', 8);
  await expect.poll(() => downloads).toHaveLength(1);
  expect(downloads[0]).toMatch(/\.mmd$/);

  // L then V are the link and select tools. Left on the menu, "V" would be
  // type-ahead for "Visio" and download a .vsdx.
  await page.keyboard.press('l');
  expect(await statusText(page, 'tool')).toBe('link');
  await page.keyboard.press('v');
  expect(await statusText(page, 'tool')).toBe('select');
  await page.waitForTimeout(500);
  expect(downloads).toHaveLength(1);
});

test('dismissing a menu with Escape hands the keyboard back to the canvas', async ({
  page,
}) => {
  await bootEditor(page);
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));

  await page.locator('#fExport').click(); // opens the menu
  await page.keyboard.press('Escape'); // closes it without choosing
  await expect(page.locator('#fExport')).not.toBeFocused();
  await page.keyboard.press('l');
  expect(await statusText(page, 'tool')).toBe('link');
  await page.keyboard.press('v');
  expect(await statusText(page, 'tool')).toBe('select');
  await page.waitForTimeout(500);
  expect(downloads).toHaveLength(0);
});

test('a mouse click on a Properties checkbox or select leaves the shortcuts with the canvas', async ({
  page,
}) => {
  await bootEditor(page);
  // Nothing selected: the inspector shows the document and page properties.
  await page.locator('#p-attach').click();
  await expect(page.locator('#p-attach')).toBeChecked();
  expect(await isOn(page, '#tSnap')).toBe(true);
  await page.keyboard.press('g'); // toggle snap
  expect(await isOn(page, '#tSnap')).toBe(false);

  // A sheet checkbox does not re-render the panel, so focus would stay put.
  await page.locator('#p-sheet').click();
  await page.locator('#p-sheet-border').click();
  await expect(page.locator('#p-sheet-border')).not.toBeChecked();
  await page.keyboard.press('g');
  expect(await isOn(page, '#tSnap')).toBe(true);

  await pickWithMouse(page, '#p-tr', 1);
  await expect(page.locator('#p-tr')).toHaveValue('fade');
  await expect(page.locator('#p-tr')).not.toBeFocused();
  expect(await isOn(page, '#tGrid')).toBe(true);
  await page.keyboard.press('r'); // toggle grid
  expect(await isOn(page, '#tGrid')).toBe(false);
});

test('a value changed by keyboard keeps focus on its control', async ({
  page,
}) => {
  await bootEditor(page);
  await tabTo(page, '#p-tr');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#p-tr')).toHaveValue('fade');
  await expect(page.locator('#p-tr')).toBeFocused();

  await tabTo(page, '#p-sheet');
  await page.keyboard.press('Space');
  await expect(page.locator('#p-sheet')).toBeChecked();
});
