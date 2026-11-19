/**
 * The selection bar over the canvas: besides the colours and page emphasis,
 * align and distribute for two or more nodes, and bring to front, send to
 * back and lock for any node or link. Each button runs its registry command
 * and is greyed out when the command cannot run.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  bootEditor,
  clickLink,
  clickNode,
  nodeBox,
  savedDocument,
  savedElement,
} from './helpers.js';

const bar = (page: Page) => page.locator('.mini-bar');
const button = (page: Page, command: string) =>
  bar(page).locator(`[data-command="${command}"]`);

async function shiftClickNode(page: Page, id: string): Promise<void> {
  const box = await nodeBox(page, id);
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up('Shift');
}

const ALIGN = [
  'arrange.alignLeft',
  'arrange.alignCenterH',
  'arrange.alignRight',
  'arrange.alignTop',
  'arrange.alignMiddleV',
  'arrange.alignBottom',
];
const DISTRIBUTE = ['arrange.distributeH', 'arrange.distributeV'];

test.beforeEach(async ({ page }) => {
  await bootEditor(page);
});

test('one node: z-order and lock, no align', async ({ page }) => {
  await clickNode(page, 'fw');
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('.mb-cmd')).toHaveCount(3);
  await expect(button(page, 'arrange.bringToFront')).toHaveAttribute(
    'aria-label',
    'Bring to front',
  );
  await expect(button(page, 'arrange.bringToFront')).toHaveAttribute(
    'title',
    'Bring to front (Ctrl/Cmd+])',
  );
  await expect(button(page, 'arrange.sendToBack')).toBeEnabled();

  // Lock says what a press does, and shows that it is on.
  const lock = button(page, 'edit.toggleLock');
  await expect(lock).toHaveAttribute('aria-label', 'Lock');
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await lock.click();
  expect((await savedElement(page, 'nodes', 'fw')).locked).toBe(true);
  await expect(lock).toHaveAttribute('aria-label', 'Unlock');
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await lock.click();
  expect((await savedElement(page, 'nodes', 'fw')).locked).not.toBe(true);

  // Send to back puts it first in the drawing order.
  await button(page, 'arrange.sendToBack').click();
  await expect
    .poll(async () => (await savedDocument(page)).pages[0]!.nodes[0])
    .toMatchObject({ id: 'fw' });
});

test('two nodes align; distribute waits for a third', async ({ page }) => {
  // Two nodes of the sample page at different heights, and a third.
  const [a, b, c] = ['user', 'inet', 'app'] as const;
  await clickNode(page, a);
  await shiftClickNode(page, b);
  for (const id of ALIGN) await expect(button(page, id), id).toBeEnabled();
  for (const id of DISTRIBUTE)
    await expect(button(page, id), id).toBeDisabled();
  // Z-order acts on one node: greyed out for two.
  await expect(button(page, 'arrange.bringToFront')).toBeDisabled();

  await button(page, 'arrange.alignTop').click();
  const y = async (id: string) =>
    (await savedElement(page, 'nodes', id)).y as number;
  await expect.poll(async () => (await y(a)) === (await y(b))).toBe(true);
  // The bar stays over the selection, inside the canvas.
  const host = (await page.locator('.canvas-host').boundingBox())!;
  const box = (await bar(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(host.x);
  expect(box.x + box.width).toBeLessThanOrEqual(host.x + host.width);

  await shiftClickNode(page, c);
  for (const id of DISTRIBUTE) await expect(button(page, id), id).toBeEnabled();
});

test('a link: z-order and lock', async ({ page }) => {
  await clickLink(page, 'lan');
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('.mb-cmd')).toHaveCount(3);
  await expect(button(page, 'arrange.alignLeft')).toHaveCount(0);
  await button(page, 'edit.toggleLock').click();
  expect((await savedElement(page, 'links', 'lan')).locked).toBe(true);
});

// A narrow canvas (a 1,024px window with both panels open, or a phone): the
// bar for every node takes a second row rather than run past the canvas.
for (const viewport of [
  { width: 1024, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`the bar stays inside the canvas at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await bootEditor(page);
    await page.locator('.canvas-host').click({ position: { x: 8, y: 8 } });
    await page.keyboard.press('Control+a');
    await expect(bar(page)).toBeVisible();
    await expect(button(page, 'edit.toggleLock')).toBeVisible();
    const host = (await page.locator('.canvas-host').boundingBox())!;
    const box = (await bar(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(host.x);
    expect(box.x + box.width).toBeLessThanOrEqual(host.x + host.width);
    // Its last button is on screen, inside the bar.
    const lock = (await button(page, 'edit.toggleLock').boundingBox())!;
    expect(lock.x + lock.width).toBeLessThanOrEqual(box.x + box.width);
  });
}
