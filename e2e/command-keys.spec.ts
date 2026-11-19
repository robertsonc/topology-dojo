/**
 * What each canvas key runs, pressed through the real handler: the bindings
 * no other spec presses, which keys the canvas takes from the browser and
 * which it leaves, and the rules between them (a Ctrl/Cmd combination never
 * also runs the plain key, Shift and Alt are not read by the single-key
 * shortcuts, arrows flip frames only with nothing selected). The mapping
 * itself is unit-tested in src/ui/commands.test.ts; this is the wiring.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  bootEditor,
  clickLink,
  clickNode,
  nodeBox,
  savedDocument,
  savedElement,
  statusCount,
  statusText,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await bootEditor(page);
});

const hasClass = (
  page: Page,
  selector: string,
  name: string,
): Promise<boolean> =>
  page
    .locator(selector)
    .evaluate((el, cls) => el.classList.contains(cls), name);

/**
 * Note, for every key press from here on, whether the shell took the key
 * (called preventDefault). The listener is added after the shell's own, on
 * the same target, so it runs after it.
 */
async function watchKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: boolean[] = [];
    (window as unknown as { keyLog: boolean[] }).keyLog = log;
    window.addEventListener('keydown', (e) => log.push(e.defaultPrevented));
  });
}

/** Press `key`; whether the shell took it. */
async function taken(page: Page, key: string): Promise<boolean> {
  await page.evaluate(() => {
    (window as unknown as { keyLog: boolean[] }).keyLog.length = 0;
  });
  await page.keyboard.press(key);
  const log = await page.evaluate(
    () => (window as unknown as { keyLog: boolean[] }).keyLog,
  );
  // Modifier keys go down first; the last keydown is the key itself.
  expect(log.length, `"${key}" reached the page`).toBeGreaterThan(0);
  return log.at(-1)!;
}

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

const nodeIds = async (page: Page): Promise<string[]> =>
  (await savedDocument(page)).pages[0]!.nodes.map((n) => n.id);

test('the canvas takes the keys it binds and leaves the others to the browser', async ({
  page,
}) => {
  await watchKeys(page);

  // Nothing selected. Left alone: the single keys, the brackets, Escape, the
  // arrows (they flip frames, or do nothing) and a Ctrl combination the
  // editor does not bind.
  const left = [
    ...['g', 'g', 'r', 'r', 'm', 'm', 'b', 'b', 'p', 'p', 'f', 'f', 'c', 'c'],
    ...['t', 'T', '0', 'l', 'a', 'v', 'h', 'h', ']', '[', 'Escape'],
    ...['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'],
    ...['Control+g', 'Control+k', 'Control+Shift+s', 'Control+0'],
  ];
  for (const key of left) expect(await taken(page, key), key).toBe(false);

  // Taken, whether or not the command has anything to act on.
  const consumed = [
    ...['Delete', 'Backspace', 'F2', 'Enter', '+', '=', '-', '_'],
    ...['Shift+Digit0', 'Shift+Digit1', 'Shift+Digit2'],
    ...['Control+z', 'Control+Shift+z', 'Control+y', 'Control+c', 'Control+x'],
    ...['Control+v', 'Control+Shift+v', 'Control+d', 'Control+l'],
    ...['Control+]', 'Control+[', 'Control+Alt+c', 'Control+Alt+v'],
    ...['Meta+z', 'Meta+d'],
  ];
  for (const key of consumed) expect(await taken(page, key), key).toBe(true);

  // Select all: taken; with a selection the arrows are taken too (they nudge).
  expect(await taken(page, 'Control+a')).toBe(true);
  expect(await statusCount(page, 'selected')).toBeGreaterThan(1);
  for (const key of ['ArrowRight', 'Shift+ArrowLeft', 'ArrowUp', 'ArrowDown'])
    expect(await taken(page, key), key).toBe(true);
  expect(await taken(page, 'Escape')).toBe(false);
  expect(await statusCount(page, 'selected')).toBe(0);
});

test('Ctrl/Cmd+S downloads the document, +O asks for a file, ? opens the shortcut sheet', async ({
  page,
}) => {
  await watchKeys(page);
  const download = page.waitForEvent('download');
  expect(await taken(page, 'Control+s')).toBe(true);
  expect((await download).suggestedFilename()).toMatch(/\.json$/);

  const chooser = page.waitForEvent('filechooser');
  expect(await taken(page, 'Control+o')).toBe(true);
  expect((await chooser).element()).toBeTruthy();

  expect(await taken(page, '?')).toBe(true);
  await expect(page.locator('.help-card')).toBeVisible();
});

test('the single keys toggle the panels, the grid, snap, Calm and the hand', async ({
  page,
}) => {
  const toggles: [key: string, selector: string, cls: string][] = [
    ['m', '#minimap-dock', 'collapsed'],
    ['b', '#palette', 'collapsed'],
    ['p', '#inspector-wrap', 'collapsed'],
    ['f', '#frames-dock', 'collapsed'],
    ['c', '#tCalm', 'on'],
    ['r', '#tGrid', 'on'],
    ['g', '#tSnap', 'on'],
    ['h', '#ccHand', 'on'],
  ];
  for (const [key, selector, cls] of toggles) {
    const before = await hasClass(page, selector, cls);
    await page.keyboard.press(key);
    expect(await hasClass(page, selector, cls), key).toBe(!before);
    // The capital (Shift or Caps Lock) is the same key.
    await page.keyboard.press(key.toUpperCase());
    expect(await hasClass(page, selector, cls), key).toBe(before);
    // Alt is not read either.
    await page.keyboard.press(`Alt+${key}`);
    expect(await hasClass(page, selector, cls), `Alt+${key}`).toBe(!before);
    await page.keyboard.press(key);
  }
  await page.keyboard.press('f');
  await expect(page.locator('#frames-toggle')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.locator('#frames-toggle')).toHaveAttribute(
    'title',
    'Show pages (F)',
  );
});

test('Escape goes back to the Select tool and leaves Hand mode', async ({
  page,
}) => {
  await page.keyboard.press('L');
  expect(await statusText(page, 'tool')).toBe('link');
  await page.keyboard.press('Escape');
  expect(await statusText(page, 'tool')).toBe('select');

  await page.keyboard.press('A');
  expect(await statusText(page, 'tool')).toBe('anchor');
  await page.keyboard.press('V');
  expect(await statusText(page, 'tool')).toBe('select');

  await page.keyboard.press('h');
  expect(await hasClass(page, '#ccHand', 'on')).toBe(true);
  await page.keyboard.press('Escape');
  expect(await hasClass(page, '#ccHand', 'on')).toBe(false);
});

test('a Ctrl combination never also runs the single-key shortcut', async ({
  page,
}) => {
  await clickNode(page, 'fw');
  // Ctrl+A selects all and does not pick the anchor tool.
  await page.keyboard.press('Control+Shift+a');
  expect(await statusCount(page, 'selected')).toBeGreaterThan(1);
  expect(await statusText(page, 'tool')).toBe('select');
  // Ctrl+C does not toggle Calm; Ctrl+L does not pick the link tool.
  const calm = await hasClass(page, '#tCalm', 'on');
  await page.keyboard.press('Control+c');
  expect(await hasClass(page, '#tCalm', 'on')).toBe(calm);
  await page.keyboard.press('Control+l');
  await page.keyboard.press('Control+l');
  expect(await statusText(page, 'tool')).toBe('select');
  // An unbound one does nothing here: Ctrl+G does not toggle snap.
  const snap = await hasClass(page, '#tSnap', 'on');
  await page.keyboard.press('Control+g');
  expect(await hasClass(page, '#tSnap', 'on')).toBe(snap);
  // Ctrl+F opens Find and leaves the frames strip open.
  await page.keyboard.press('Control+f');
  await expect(page.locator('.find input')).toBeFocused();
  expect(await hasClass(page, '#frames-dock', 'collapsed')).toBe(false);
});

test('arrows nudge the selection by 1, and by 10 with Shift', async ({
  page,
}) => {
  await clickNode(page, 'fw');
  const start = await savedElementAfterTouch(page, 'fw');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('ArrowLeft');
  const moved = await savedElement(page, 'nodes', 'fw');
  expect([moved.x, moved.y]).toEqual([
    (start.x as number) + 1 + 10 - 1,
    (start.y as number) - 1 + 10,
  ]);
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('ArrowDown');
  const back = await savedElement(page, 'nodes', 'fw');
  expect([back.x, back.y]).toEqual([start.x, start.y]);
});

/** A node as stored, read after an edit that leaves it where it was (a tab
 * that has changed nothing has saved nothing). */
async function savedElementAfterTouch(page: Page, id: string) {
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  return savedElement(page, 'nodes', id);
}

test('Backspace deletes, Ctrl+Y redoes, Ctrl+X cuts and Ctrl+V pastes it back', async ({
  page,
}) => {
  const nodes = await statusCount(page, 'nodes');
  await clickNode(page, 'fw');
  await page.keyboard.press('Shift+Backspace');
  expect(await statusCount(page, 'nodes')).toBe(nodes - 1);
  await page.keyboard.press('Control+z');
  expect(await statusCount(page, 'nodes')).toBe(nodes);
  await page.keyboard.press('Control+y');
  expect(await statusCount(page, 'nodes')).toBe(nodes - 1);
  await page.keyboard.press('Meta+z');
  expect(await statusCount(page, 'nodes')).toBe(nodes);
  await page.keyboard.press('Meta+Shift+z');
  expect(await statusCount(page, 'nodes')).toBe(nodes - 1);
  await page.keyboard.press('Control+Alt+z'); // Alt is not read: undo
  expect(await statusCount(page, 'nodes')).toBe(nodes);

  await clickNode(page, 'app');
  await page.keyboard.press('Control+x');
  expect(await statusCount(page, 'nodes')).toBe(nodes - 1);
  await page.keyboard.press('Control+v');
  expect(await statusCount(page, 'nodes')).toBe(nodes);
  await page.keyboard.press('Control+Shift+d'); // Shift is not read: duplicate
  expect(await statusCount(page, 'nodes')).toBe(nodes + 1);
});

test('Ctrl+L locks and unlocks; the brackets reorder', async ({ page }) => {
  await clickNode(page, 'user');
  await page.keyboard.press('Control+l');
  expect((await savedElement(page, 'nodes', 'user')).locked).toBe(true);
  await page.keyboard.press('Control+l');
  expect((await savedElement(page, 'nodes', 'user')).locked).not.toBe(true);

  const order = await nodeIds(page);
  expect(order[0]).toBe('user');
  await page.keyboard.press(']');
  expect(await nodeIds(page)).toEqual([order[1], 'user', ...order.slice(2)]);
  await page.keyboard.press('Control+]');
  expect(await nodeIds(page)).toEqual([...order.slice(1), 'user']);
  await page.keyboard.press('[');
  expect(await nodeIds(page)).toEqual([
    ...order.slice(1, -1),
    'user',
    order.at(-1),
  ]);
  await page.keyboard.press('Control+[');
  expect(await nodeIds(page)).toEqual(order);
});

test('Ctrl+Alt+C and +V carry the format, not the selection', async ({
  page,
}) => {
  const nodes = await statusCount(page, 'nodes');
  await clickNode(page, 'app');
  const app = await savedElementAfterTouch(page, 'app');
  await page.keyboard.press('Control+Alt+c');
  await clickNode(page, 'fw');
  await page.keyboard.press('Control+Alt+v');
  expect((await savedElement(page, 'nodes', 'fw')).color).toBe(app.color);
  // Nothing was copied to the clipboard on the way: a paste adds nothing.
  await page.keyboard.press('Control+v');
  expect(await statusCount(page, 'nodes')).toBe(nodes);
});

test('arrows flip frames only while nothing is selected', async ({ page }) => {
  const ind = page.locator('#frames-ind');
  await page.locator('#addPage').click();
  await expect(ind).toHaveText('2/2');
  await page.keyboard.press('ArrowLeft');
  await expect(ind).toHaveText('1/2');
  await page.keyboard.press('ArrowRight');
  await expect(ind).toHaveText('2/2');
  await page.keyboard.press('ArrowRight'); // there is no third frame
  await expect(ind).toHaveText('2/2');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(ind).toHaveText('1/2');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await expect(ind).toHaveText('1/2');

  // A selected link has nothing to nudge, and still keeps the frame.
  await clickLink(page, 'lan');
  await expect.poll(() => statusCount(page, 'selected')).toBe(1);
  await page.keyboard.press('ArrowRight');
  await expect(ind).toHaveText('1/2');
});

test('Enter on a button that was clicked presses it and renames nothing', async ({
  page,
}) => {
  await clickNode(page, 'fw');
  await page.locator('#tGrid').click();
  expect(await hasClass(page, '#tGrid', 'on')).toBe(false);
  await page.keyboard.press('Enter');
  expect(await hasClass(page, '#tGrid', 'on')).toBe(true);
  await expect(page.locator('.inline-label-edit')).toHaveCount(0);
  // F2 presses nothing, so it renames from there.
  await page.keyboard.press('F2');
  await expect(page.locator('.inline-label-edit')).toHaveValue('SRX');
});

/** The open context menu, top to bottom: each item's label (with "(off)"
 * when it is disabled) and a "-" per separator. */
const menuRows = (page: Page): Promise<string[]> =>
  page.locator('.ctx-menu > *').evaluateAll((els) =>
    els.map((el) => {
      if (el.classList.contains('ctx-sep')) return '-';
      const off = (el as HTMLButtonElement).disabled ? ' (off)' : '';
      return `${el.textContent}${off}`;
    }),
  );

test('the context menus list the same commands in the same order', async ({
  page,
}) => {
  const fw = await nodeBox(page, 'fw');
  await page.mouse.click(fw.x + fw.width / 2, fw.y + fw.height / 2, {
    button: 'right',
  });
  await expect(page.locator('.ctx-menu')).toBeVisible();
  expect(await menuRows(page)).toEqual([
    'Rename',
    'Duplicate',
    'Cut',
    'Copy',
    'Copy as image',
    'Copy format',
    'Paste format (off)',
    '-',
    'Emphasize on this page',
    'Group into zone',
    'Save as stencil…',
    'Add policy marker',
    '-',
    'Bring to front',
    'Send to back',
    '-',
    'Lock',
    'Delete',
  ]);
  // Copy format, then Lock: the format is there to paste, the label flips.
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Copy format' }).click();
  await page.mouse.click(fw.x + fw.width / 2, fw.y + fw.height / 2, {
    button: 'right',
  });
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Lock' }).click();
  await page.mouse.click(fw.x + fw.width / 2, fw.y + fw.height / 2, {
    button: 'right',
  });
  const rows = await menuRows(page);
  expect(rows).toContain('Paste format');
  expect(rows).toContain('Unlock');
  expect(rows).not.toContain('Lock');
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Unlock' }).click();
  expect((await savedElement(page, 'nodes', 'fw')).locked).not.toBe(true);

  // Several nodes: no Rename (there is no one label), z-order has no target.
  await page.keyboard.press('Control+a');
  await page.mouse.click(fw.x + fw.width / 2, fw.y + fw.height / 2, {
    button: 'right',
  });
  const many = await menuRows(page);
  expect(many[0]).toBe('Duplicate');
  expect(many).toContain('Copy format (off)');
  expect(many).toContain('Bring to front (off)');
  expect(many).toContain('Send to back (off)');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await clickLink(page, 'lan');
  const lan = await page.evaluate(() => {
    const g = document.querySelector('#page-canvas g[data-tds-link="lan"]')!;
    const el = g.querySelector<SVGGeometryElement>('path, line')!;
    const q = el.getPointAtLength(el.getTotalLength() * 0.4);
    const p = new DOMPoint(q.x, q.y).matrixTransform(el.getScreenCTM()!);
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(lan.x, lan.y, { button: 'right' });
  await expect(page.locator('.ctx-menu')).toBeVisible();
  expect(await menuRows(page)).toEqual([
    'Swap endpoints',
    'Straighten (clear bends) (off)',
    'Copy format',
    'Paste format (off)',
    'Emphasize on this page',
    '-',
    'Bring to front',
    'Send to back',
    '-',
    'Lock',
    'Delete',
  ]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const empty = await toClient(page, 700, 560);
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  await expect(page.locator('.ctx-menu')).toBeVisible();
  expect(await menuRows(page)).toEqual([
    'Paste here (off)',
    'Paste in place (off)',
    'Select all',
    'Copy page as image',
    '-',
    'Tidy layout',
    'Balance layout',
    'Auto-place labels',
    'Fit page to content',
  ]);
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Select all' }).click();
  expect(await statusCount(page, 'selected')).toBeGreaterThan(1);
});
