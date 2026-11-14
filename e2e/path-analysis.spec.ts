/**
 * "Analyze path": two selected nodes, the routes between them over the links
 * the frame draws. Asking changes nothing; the bar's three actions each keep
 * the route in a different way.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  bootEditor,
  clickLink,
  clickNode,
  nodeBox,
  savedDocument,
} from './helpers.js';

/** Select two nodes of the sample scene, the first being the path's start. */
async function selectPair(page: Page, from: string, to: string): Promise<void> {
  await clickNode(page, from);
  const box = await nodeBox(page, to);
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up('Shift');
}

/** Ids the canvas draws with the emphasis glow. */
const spotlit = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '#page-canvas g[filter="url(#tds-emphasis)"]',
      ),
    ]
      .map(
        (g) =>
          g.getAttribute('data-tds-node') ?? g.getAttribute('data-tds-link'),
      )
      .filter((id): id is string => id !== null)
      .sort(),
  );

const bar = (page: Page) => page.locator('.path-bar');
const action = (page: Page, key: string) =>
  page.locator(`.path-bar [data-path="${key}"]`);

// user - ec - hub - app, over the links lan, overlay and hub-app.
const ROUTE = ['app', 'ec', 'hub', 'hub-app', 'lan', 'overlay', 'user'];
const TITLE = 'Path: User -> App · 3 hops via EC-Branch, EC-Hub';

test('tracing a path spotlights it without changing the document', async ({
  page,
}) => {
  await bootEditor(page);
  await selectPair(page, 'user', 'app');

  // Offered for exactly two nodes, in Properties.
  await page.locator('#i-path').click();
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('.path-title')).toHaveText(TITLE);
  expect(await spotlit(page)).toEqual(ROUTE);

  // One route: nothing to step through.
  await expect(action(page, 'prev')).toBeHidden();
  await expect(action(page, 'next')).toBeHidden();

  // A read: no change was reported (the save chip is still blank) and the
  // stored frame has no emphasis.
  await expect(page.locator('#saved')).toHaveText('');
  const stored = await page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem('topology-dojo:doc')!) as {
          pages: { emphasis?: string[] }[];
        }
      ).pages[0]!.emphasis ?? null,
  );
  expect(stored).toBeNull();

  // Escape closes the bar and the spotlight goes with it.
  await page.keyboard.press('Escape');
  await expect(bar(page)).toHaveCount(0);
  expect(await spotlit(page)).toEqual([]);
});

test('the route can be kept as emphasis, as a flow, or as a new frame', async ({
  page,
}) => {
  await bootEditor(page);
  await selectPair(page, 'user', 'app');
  await page.locator('#i-path').click();

  // Emphasize: stored on the frame, one undo step.
  await action(page, 'keep').click();
  expect(
    [...((await savedDocument(page)).pages[0]!.emphasis as string[])].sort(),
  ).toEqual(ROUTE);
  // Undo works from where the click left focus, on the bar's button.
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await savedDocument(page)).pages[0]!.emphasis ?? null)
    .toBeNull();

  // Add flow: a flow path along the route, start to end.
  await page.keyboard.press('Escape'); // closes the bar, clears the selection
  await expect(bar(page)).toHaveCount(0);
  await selectPair(page, 'user', 'app');
  await page.locator('#i-path').click();
  const flowsBefore = (await savedDocument(page)).pages[0]!.flowPaths.length;
  await action(page, 'flow').click();
  await expect
    .poll(async () => (await savedDocument(page)).pages[0]!.flowPaths.length)
    .toBe(flowsBefore + 1);
  const flow = (await savedDocument(page)).pages[0]!.flowPaths.at(-1)!;
  expect(flow.waypoints).toEqual(['user', 'ec', 'hub', 'app']);
  expect(flow.label).toBe('User -> App · 3 hops');

  // New frame: a copy with the route spotlit and captioned; the bar closes.
  await action(page, 'frame').click();
  await expect(bar(page)).toHaveCount(0);
  const doc = await savedDocument(page);
  expect(doc.pages).toHaveLength(2);
  expect(doc.pages[1]!.name).toBe('Path: User -> App · 3 hops');
  expect(doc.pages[1]!.caption).toBe(TITLE);
  expect([...(doc.pages[1]!.emphasis as string[])].sort()).toEqual(ROUTE);
  // The frame it was made from is as it was.
  expect(doc.pages[0]!.emphasis ?? null).toBeNull();
  // The new frame is the one on show, drawn with its own emphasis.
  expect(await spotlit(page)).toEqual(ROUTE);
});

test('two nodes with no drawn path between them say why', async ({ page }) => {
  await bootEditor(page);
  await selectPair(page, 'user', 'sensor1');
  await page.locator('#i-path').click();

  await expect(bar(page).locator('.path-title')).toHaveText(
    'No drawn path joins User and Sensor.',
  );
  await expect(bar(page).locator('.path-notes')).toHaveText(
    'Sensor has no usable link on this frame.',
  );
  // Nothing to keep: only "trace the other way" and close are offered.
  for (const key of ['keep', 'flow', 'frame'])
    await expect(action(page, key)).toBeHidden();
  expect(await spotlit(page)).toEqual([]);

  await action(page, 'close').click();
  await expect(bar(page)).toHaveCount(0);
});

test('the path is traced again when the diagram changes', async ({ page }) => {
  await bootEditor(page);
  await selectPair(page, 'user', 'app');
  await page.locator('#i-path').click();
  await expect(bar(page).locator('.path-title')).toHaveText(TITLE);

  // Remove the only link between the branch and the hub.
  await clickLink(page, 'overlay');
  await page.keyboard.press('Delete');
  await expect(bar(page).locator('.path-title')).toHaveText(
    'No drawn path joins User and App.',
  );
  expect(await spotlit(page)).toEqual([]);

  // Undo puts the link, and the route, back.
  await page.keyboard.press('Control+z');
  await expect(bar(page).locator('.path-title')).toHaveText(TITLE);
  expect(await spotlit(page)).toEqual(ROUTE);
});

test('the context menu offers it for two nodes, and only for two', async ({
  page,
}) => {
  await bootEditor(page);
  const item = page.locator('.ctx-menu .ctx-item', { hasText: 'Analyze path' });

  await clickNode(page, 'user');
  const one = await nodeBox(page, 'user');
  await page.mouse.click(one.x + one.width / 2, one.y + one.height / 2, {
    button: 'right',
  });
  await expect(page.locator('.ctx-menu')).toBeVisible();
  await expect(item).toHaveCount(0);
  await page.keyboard.press('Escape');

  await selectPair(page, 'user', 'inet');
  const two = await nodeBox(page, 'inet');
  await page.mouse.click(two.x + two.width / 2, two.y + two.height / 2, {
    button: 'right',
  });
  await item.click();
  await expect(bar(page).locator('.path-title')).toHaveText(
    'Path: User -> Internet · 3 hops via EC-Branch, SRX',
  );

  // Traced the other way round, the route starts at the other node.
  await action(page, 'swap').click();
  await expect(bar(page).locator('.path-title')).toHaveText(
    'Path: Internet -> User · 3 hops via SRX, EC-Branch',
  );
});
