/**
 * Interactions every diagram editor has, and what each does here: dragging a
 * shape out of the library, the zoom keys, wheel and trackpad, F2 to rename,
 * paste in place and "Paste here".
 */
import { expect, test, type Page } from '@playwright/test';
import {
  bootEditor,
  clickNode,
  linkPoint,
  nodeBox,
  savedDocument,
  statusText,
} from './helpers.js';

/** A page (user-space) point as a client point. */
async function toClient(page: Page, x: number, y: number) {
  return page.evaluate(
    ([px, py]) => {
      const svg = document.querySelector<SVGSVGElement>('#overlay')!;
      const p = new DOMPoint(px, py).matrixTransform(svg.getScreenCTM()!);
      return { x: p.x, y: p.y };
    },
    [x, y] as const,
  );
}

/** Press a library tile and drag it to a client point, without releasing. */
async function dragTile(
  page: Page,
  type: string,
  to: { x: number; y: number },
): Promise<void> {
  const tile = page.locator(`#palette-list .pitem[data-type="${type}"]`);
  await tile.first().scrollIntoViewIfNeeded();
  const box = (await tile.first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
}

const nodes = async (page: Page) => (await savedDocument(page)).pages[0]!.nodes;
const links = async (page: Page) => (await savedDocument(page)).pages[0]!.links;

/** The zoom the status bar reports, as a number of percent. */
const zoom = async (page: Page): Promise<number> =>
  Number((await statusText(page, 'zoom')).replace('%', ''));

/** The canvas's view window, in page units. */
const view = (page: Page): Promise<number[]> =>
  page.evaluate(() =>
    document
      .querySelector('#page-canvas')!
      .getAttribute('viewBox')!
      .split(/\s+/)
      .map(Number),
  );

/** Send one wheel event to the canvas, at its middle. */
async function wheel(
  page: Page,
  init: Record<string, number | boolean>,
): Promise<void> {
  await page.evaluate((init) => {
    const overlay = document.querySelector('#overlay')!;
    const r = overlay.getBoundingClientRect();
    overlay.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        ...init,
      }),
    );
  }, init);
}

test.beforeEach(async ({ page }) => {
  await bootEditor(page);
});

/* ── library drag and drop ───────────────────────────────────────────────── */

test('a library tile dragged onto the canvas lands where it is dropped', async ({
  page,
}) => {
  const drop = await toClient(page, 700, 560); // empty canvas
  await dragTile(page, 'router', drop);
  // The ghost is under the pointer and says a drop is possible here.
  await expect(page.locator('.pdrag-ghost.can-drop')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.pdrag-ghost')).toHaveCount(0);

  const all = await nodes(page);
  expect(all).toHaveLength(8);
  const added = all.at(-1)!;
  expect(added.type).toBe('router');
  // On the grid nearest the drop point.
  expect(Math.abs((added.x as number) - 700)).toBeLessThanOrEqual(10);
  expect(Math.abs((added.y as number) - 560)).toBeLessThanOrEqual(10);
  // Selected, ready to be renamed or moved.
  expect(await statusText(page, 'selected')).toBe('1');
});

test('dropped on a link, the node is inserted into the link', async ({
  page,
}) => {
  const on = await linkPoint(page, 'breakout', 0.5); // SRX to Internet
  await dragTile(page, 'router', on);
  // The link is marked as the drop target while the tile is over it.
  await expect(
    page.locator('#overlay [data-drop-link="breakout"]'),
  ).toHaveCount(1);
  await expect(page.locator('.pdrag-ghost.on-link')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('#overlay [data-drop-link]')).toHaveCount(0);

  const added = (await nodes(page)).at(-1)!;
  expect(added.type).toBe('router');
  const after = await links(page);
  expect(after).toHaveLength(6);
  // SRX — new — Internet: the link keeps its id as the first half.
  const first = after.find((l) => l.id === 'breakout')!;
  expect([first.from, first.to]).toEqual(['fw', added.id]);
  const second = after.find((l) => l.from === added.id)!;
  expect(second.to).toBe('inet');
  expect(second.type).toBe(first.type);

  // One undo puts the link back as it was.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await links(page)).length).toBe(5);
  const restored = (await links(page)).find((l) => l.id === 'breakout')!;
  expect([restored.from, restored.to]).toEqual(['fw', 'inet']);
});

test('a drag that is cancelled or released off the canvas adds nothing', async ({
  page,
}) => {
  const drop = await toClient(page, 700, 560);

  // Escape during the drag.
  await dragTile(page, 'router', drop);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pdrag-ghost')).toHaveCount(0);
  await page.mouse.up();

  // Released over the Properties panel.
  const panel = (await page.locator('#inspector').boundingBox())!;
  await dragTile(page, 'router', {
    x: panel.x + panel.width / 2,
    y: panel.y + 40,
  });
  await expect(page.locator('.pdrag-ghost')).toBeVisible();
  await expect(page.locator('.pdrag-ghost.can-drop')).toHaveCount(0);
  await page.mouse.up();

  // Nothing was added, so nothing was saved.
  await expect(page.locator('#saved')).toHaveText('');
  await expect(page.locator('#page-canvas [data-tds-node]')).toHaveCount(7);

  // A plain click on the tile still adds one node.
  await page
    .locator('#palette-list .pitem[data-type="router"]')
    .first()
    .click();
  expect(await nodes(page)).toHaveLength(8);
});

/* ── zoom ────────────────────────────────────────────────────────────────── */

test('the zoom keys: in, out, 100%, fit and zoom to selection', async ({
  page,
}) => {
  const fit = await zoom(page);
  await page.keyboard.press('+');
  expect(await zoom(page)).toBeGreaterThan(fit);
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  expect(await zoom(page)).toBeLessThan(fit);

  await page.keyboard.press('Shift+Digit0');
  expect(await zoom(page)).toBe(100);
  await page.keyboard.press('Shift+Digit1');
  expect(await zoom(page)).toBe(fit);

  // Zoom to selection: one node is centred, at 100% at most.
  await page.keyboard.press('-');
  await clickNode(page, 'app');
  await page.keyboard.press('Shift+Digit2');
  expect(await zoom(page)).toBe(100);
  const box = await nodeBox(page, 'app');
  const canvas = (await page.locator('#overlay').boundingBox())!;
  const centreX = box.x + box.width / 2;
  // In view, clear of the node library on the left.
  const library = (await page.locator('#palette').boundingBox())!;
  expect(centreX).toBeGreaterThan(library.x + library.width);
  expect(centreX).toBeLessThan(canvas.x + canvas.width);

  // With nothing selected it fits everything.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+Digit2');
  expect(await zoom(page)).toBe(fit);
});

test('a mouse wheel zooms, a trackpad slide pans, a pinch zooms', async ({
  page,
}) => {
  const z0 = await zoom(page);
  // A first slide settles the view on the canvas element's exact aspect (it
  // is re-fitted to it on every change), so the next one can be measured.
  await wheel(page, { deltaX: 1, deltaY: 1 });
  const v0 = await view(page);

  // Two fingers sliding: travel in both directions, in pixels.
  await wheel(page, { deltaX: 30, deltaY: 60 });
  expect(await zoom(page)).toBe(z0);
  const v1 = await view(page);
  expect(v1[2]).toBeCloseTo(v0[2]!, 6); // same size: no zoom
  expect(v1[0]! - v0[0]!).toBeGreaterThan(0); // moved right
  expect(v1[1]! - v0[1]!).toBeGreaterThan(0); // and down
  // Twice as far down as across, as the fingers moved.
  expect((v1[1]! - v0[1]!) / (v1[0]! - v0[0]!)).toBeCloseTo(2, 3);

  // A pinch (the browser reports it as Ctrl + wheel) zooms in.
  await wheel(page, { deltaY: -20, ctrlKey: true });
  const z1 = await zoom(page);
  expect(z1).toBeGreaterThan(z0);

  // After a pause, a notch of a mouse wheel zooms too.
  await page.waitForTimeout(300);
  await wheel(page, { deltaY: -100 });
  expect(await zoom(page)).toBeGreaterThan(z1);

  // Shift + wheel pans sideways and leaves the zoom alone.
  await page.waitForTimeout(300);
  const z2 = await zoom(page);
  const v2 = await view(page);
  await wheel(page, { deltaY: 100, shiftKey: true });
  const v3 = await view(page);
  expect(await zoom(page)).toBe(z2);
  expect(v3[0]! - v2[0]!).toBeGreaterThan(0);
  expect(Math.abs(v3[1]! - v2[1]!)).toBeLessThan(1);
});

test('the wheel can be set to always pan, and the choice is remembered', async ({
  page,
}) => {
  await page.locator('#tDisplay').click();
  await page.locator('#dpWheel').selectOption('pan');
  await page.keyboard.press('Escape');

  const z0 = await zoom(page);
  const v0 = await view(page);
  await wheel(page, { deltaY: 100 }); // a mouse wheel notch
  expect(await zoom(page)).toBe(z0);
  expect((await view(page))[1]! - v0[1]!).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator('#page-canvas [data-tds-node]')).toHaveCount(7);
  await page.locator('#tDisplay').click();
  await expect(page.locator('#dpWheel')).toHaveValue('pan');
});

/* ── rename ──────────────────────────────────────────────────────────────── */

test('F2 or Enter renames what is selected', async ({ page }) => {
  await clickNode(page, 'fw');
  await page.keyboard.press('F2');
  const input = page.locator('.inline-label-edit');
  await expect(input).toHaveValue('SRX');
  await input.fill('Edge FW');
  await page.keyboard.press('Enter');
  await expect(input).toBeHidden();
  expect((await nodes(page)).find((n) => n.id === 'fw')!.label).toBe('Edge FW');

  // Enter opens it too; Escape leaves the label as it was.
  await clickNode(page, 'fw');
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue('Edge FW');
  await input.fill('discarded');
  await page.keyboard.press('Escape');
  await expect(input).toBeHidden();
  expect((await nodes(page)).find((n) => n.id === 'fw')!.label).toBe('Edge FW');

  // With nothing selected there is nothing to rename.
  await page.keyboard.press('Escape');
  await page.keyboard.press('F2');
  await expect(input).toBeHidden();
});

/* ── paste ───────────────────────────────────────────────────────────────── */

test('paste in place puts the copy at the same position on another frame', async ({
  page,
}) => {
  await clickNode(page, 'app');
  await page.keyboard.press('Control+c');
  await page.locator('#addPage').click();
  await page.keyboard.press('Control+Shift+v');

  const doc = await savedDocument(page);
  const original = doc.pages[0]!.nodes.find((n) => n.id === 'app')!;
  expect(doc.pages[1]!.nodes).toHaveLength(1);
  const copy = doc.pages[1]!.nodes[0]!;
  expect([copy.x, copy.y]).toEqual([original.x, original.y]);
  expect(copy.label).toBe(original.label);
});

test('"Paste here" puts the copy at the point that was right-clicked', async ({
  page,
}) => {
  await clickNode(page, 'app');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Escape');

  const at = await toClient(page, 700, 560); // empty canvas
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Paste here' }).click();

  const all = await nodes(page);
  expect(all).toHaveLength(8);
  const copy = all.at(-1)!;
  expect(copy.label).toBe('App');
  expect(Math.abs((copy.x as number) - 700)).toBeLessThanOrEqual(10);
  expect(Math.abs((copy.y as number) - 560)).toBeLessThanOrEqual(10);

  // The keyboard paste still lands a step from the original, in view.
  await page.keyboard.press('Control+v');
  const again = (await nodes(page)).at(-1)!;
  const original = all.find((n) => n.id === 'app')!;
  expect([again.x, again.y]).toEqual([
    (original.x as number) + 24,
    (original.y as number) + 24,
  ]);
});

/* ── find ────────────────────────────────────────────────────────────────── */

test('Find reaches links, zones and other frames, and jumps to the match', async ({
  page,
}) => {
  // A second frame with one renamed node, then back to the first.
  await page.locator('#addPage').click();
  await page
    .locator('#palette-list .pitem[data-type="router"]')
    .first()
    .click();
  await page.keyboard.press('F2');
  await page.locator('.inline-label-edit').fill('Core-9');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('#filmstrip [data-page="0"]').click();
  await expect(page.locator('#page-canvas [data-tds-node]')).toHaveCount(7);

  const find = page.locator('.find');
  const items = find.locator('.find-item');
  await page.keyboard.press('Control+f');

  // A link, by its label.
  await find.locator('input').fill('ipsec');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('IPsec Overlay');
  await expect(items.first()).toContainText('tunnel link');
  await page.keyboard.press('Enter');
  await expect(find).toHaveCount(0);
  await expect(page.locator('#inspector > .insp-h').first()).toHaveText('Link');

  // A zone, by its label.
  await page.keyboard.press('Control+f');
  await find.locator('input').fill('branch');
  await expect(items.filter({ hasText: 'zone' })).toHaveCount(1);
  await items.filter({ hasText: 'zone' }).click();
  await expect(page.locator('#inspector > .insp-h').first()).toHaveText('Zone');

  // A node on the other frame: the row names the frame, and choosing it
  // goes there with the node selected.
  await page.keyboard.press('Control+f');
  await find.locator('input').fill('core-9');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Frame 2');
  await page.keyboard.press('Enter');
  await expect(page.locator('#page-canvas [data-tds-node]')).toHaveCount(1);
  await expect(page.locator('#inspector > .insp-h').first()).toHaveText('Node');
  expect(await statusText(page, 'selected')).toBe('1');
});
