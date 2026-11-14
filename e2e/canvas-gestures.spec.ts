import { test, expect, type Page } from '@playwright/test';
import { bootEditor, openFixture, statusCount } from './helpers.js';

/**
 * Canvas gestures that depend on what the browser actually draws and
 * delivers, beyond what the editor's unit harness can fake:
 * - a node's caption, measured from the rendered text, owns its presses;
 * - a link's port label is found inside the link's own rendered group;
 * - the "+" handle of an orthogonal link sits on the measured route, and a
 *   click on it adds no bend;
 * - a right-click keeps a multi-link selection for the context menu;
 * - a drag whose release never reaches the page stops following the pointer.
 *
 * Fixture: spine-leaf page with thin `switch` leaves (L1–L4), zone z1 and an
 * orthogonal link `orth` l1 → s2. Nothing here reads the autosave: state is
 * read from the status bar, the inspector and the rendered canvas.
 */

/** Page (user-space) point → client point via the overlay's CTM. */
async function toClient(page: Page, x: number, y: number) {
  return page.evaluate(
    ([x, y]) => {
      const svg = document.querySelector('#overlay') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()!);
      return { x: p.x, y: p.y };
    },
    [x, y] as const,
  );
}

/** Centre (client) of the rendered text reading exactly `text`. */
async function textCentre(page: Page, text: string) {
  const at = await page.evaluate((text) => {
    for (const t of document.querySelectorAll('#page-canvas text')) {
      const s = t.getAttribute('data-tds-label') ?? t.textContent ?? '';
      if (s.trim() !== text) continue;
      const r = t.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  }, text);
  expect(at, `rendered text "${text}"`).not.toBeNull();
  return at!;
}

/** A client point on the drawn route of link `id`, `at` of the way along. */
async function onLink(page: Page, id: string, at = 0.5) {
  return page.evaluate(
    ([id, at]) => {
      const g = document.querySelector(
        `#page-canvas g[data-tds-link="${id}"]`,
      )!;
      const el = [...g.querySelectorAll<SVGGeometryElement>('path, line')].sort(
        (a, b) => b.getTotalLength() - a.getTotalLength(),
      )[0]!;
      const q = el.getPointAtLength(el.getTotalLength() * at);
      const p = new DOMPoint(q.x, q.y).matrixTransform(el.getScreenCTM()!);
      return { x: p.x, y: p.y };
    },
    [id, at] as const,
  );
}

/** Where node `id` is drawn (client rect centre of its group). */
async function nodeAt(page: Page, id: string) {
  return page.evaluate((id) => {
    const r = document
      .querySelector(`#page-canvas g[data-tds-node="${id}"]`)!
      .getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  }, id);
}

const heading = (page: Page) => page.locator('.insp-h').first();

test.beforeEach(async ({ page }) => {
  await bootEditor(page);
  await openFixture(page, 'zone-orthogonal.json');
  await expect(
    page.locator('#page-canvas g[data-tds-link="orth"]'),
  ).toHaveCount(1);
});

test('a click on a node caption selects the node; a double-click renames it', async ({
  page,
}) => {
  const nodes = await statusCount(page, 'nodes');
  const links = await statusCount(page, 'links');
  const centre = await toClient(page, 711, 392); // L4, a thin switch
  const caption = await textCentre(page, 'L4');
  // Hover the node first, as a pointer travelling to its caption does: that
  // is what brings up its connection dots and quick-connect chevrons.
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.move(caption.x, caption.y, { steps: 4 });
  await page.mouse.click(caption.x, caption.y);
  await expect(heading(page)).toHaveText(/node/i);
  await expect(page.locator('input[data-key="label"]')).toHaveValue('L4');
  expect(await statusCount(page, 'nodes')).toBe(nodes);
  expect(await statusCount(page, 'links')).toBe(links);
  expect(await statusCount(page, 'history')).toBe(0);

  await page.mouse.dblclick(caption.x, caption.y);
  await expect(page.locator('.inline-label-edit')).toHaveValue('L4');
  await page.keyboard.press('Escape');
  expect(await statusCount(page, 'nodes')).toBe(nodes);
});

test('a thin node, zoomed out, drags by its centre instead of starting a link', async ({
  page,
}) => {
  const links = await statusCount(page, 'links');
  // Zoom out until the 16-unit-tall switch is about as tall as a connection
  // dot's grab area used to be (the wheel zooms about the pointer).
  const mid = await toClient(page, 525, 350);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.wheel(0, 700);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (document.querySelector('#overlay') as SVGSVGElement).getScreenCTM()!
            .a,
      ),
    )
    .toBeLessThan(1.2);

  const from = await toClient(page, 711, 392);
  const before = await nodeAt(page, 'l4');
  await page.mouse.move(from.x, from.y - 60);
  await page.mouse.move(from.x, from.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => nodeAt(page, 'l4')).not.toEqual(before);
  expect(await statusCount(page, 'links')).toBe(links);
  await expect(page.locator('.quick-add')).toHaveCount(0);
});

test('double-clicking a port label edits that end of the link', async ({
  page,
}) => {
  const mid = await onLink(page, 'orth', 0.5);
  await page.mouse.click(mid.x, mid.y);
  await expect(heading(page)).toHaveText(/link/i);
  const field = page.locator('input[data-key="fromLabel"]');
  await field.fill('ge-0/0/1');
  await field.blur();
  await page.keyboard.press('Escape'); // deselect
  await expect(heading(page)).not.toHaveText(/link/i);

  const label = await textCentre(page, 'ge-0/0/1');
  await page.mouse.dblclick(label.x, label.y);
  await expect(page.locator('.inline-label-edit')).toHaveValue('ge-0/0/1');
  await expect(page.locator('.quick-add')).toHaveCount(0);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('et-0/0/9');
  await page.keyboard.press('Enter');
  // The owner link is selected, and only its "from" port label changed.
  await expect(page.locator('input[data-key="fromLabel"]')).toHaveValue(
    'et-0/0/9',
  );
  await expect(page.locator('input[data-key="label"]')).toHaveValue('');
});

test('the "+" handle sits on the drawn route; a click adds no bend, a drag does', async ({
  page,
}) => {
  const pick = await onLink(page, 'orth', 0.25);
  await page.mouse.click(pick.x, pick.y);
  const plus = page.locator('#overlay circle[data-wp-add="0"]');
  await expect(plus).toHaveCount(1);
  const box = (await plus.boundingBox())!;
  const handle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // On the orthogonal route as drawn, not on the l1 → s2 diagonal.
  const offRoute = await page.evaluate((h) => {
    const g = document.querySelector('#page-canvas g[data-tds-link="orth"]')!;
    const el = [...g.querySelectorAll<SVGGeometryElement>('path, line')].sort(
      (a, b) => b.getTotalLength() - a.getTotalLength(),
    )[0]!;
    const m = el.getScreenCTM()!;
    const len = el.getTotalLength();
    let best = Infinity;
    for (let i = 0; i <= 400; i++) {
      const q = el.getPointAtLength((len * i) / 400);
      const p = new DOMPoint(q.x, q.y).matrixTransform(m);
      best = Math.min(best, Math.hypot(p.x - h.x, p.y - h.y));
    }
    return best;
  }, handle);
  expect(offRoute).toBeLessThan(2);

  await page.mouse.click(handle.x, handle.y);
  await expect(page.locator('#overlay rect[data-wp]')).toHaveCount(0);
  expect(await statusCount(page, 'history')).toBe(0);

  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 30, handle.y - 40, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('#overlay rect[data-wp]')).toHaveCount(1);
  expect(await statusCount(page, 'history')).toBe(1);
  // The inspector learned about the bend without reselecting the link.
  await expect(page.locator('#i-straighten')).toHaveCount(1);
});

test('a right-click on one of several selected links keeps them all', async ({
  page,
}) => {
  const links = await statusCount(page, 'links');
  const a = await onLink(page, 'l4-s1', 0.7);
  const b = await onLink(page, 'l4-s2', 0.7);
  await page.mouse.click(a.x, a.y);
  await page.keyboard.down('Control');
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Control');
  await expect.poll(() => statusCount(page, 'selected')).toBe(2);

  await page.mouse.click(b.x, b.y, { button: 'right' });
  await expect(page.locator('.ctx-menu')).toBeVisible();
  expect(await statusCount(page, 'selected')).toBe(2);
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Delete' }).click();
  await expect.poll(() => statusCount(page, 'links')).toBe(links - 2);
});

test('a drag whose release never arrives stops following the pointer', async ({
  page,
  context,
}) => {
  // The button comes up over another window: the page sees a blur and then
  // plain mouse moves with no button held, and never a pointerup.
  const cdp = await context.newCDPSession(page);
  const move = (x: number, y: number, buttons: number) =>
    cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      buttons,
      button: buttons ? 'left' : 'none',
    });
  const at = await toClient(page, 711, 392);
  const start = await nodeAt(page, 'l4');
  await move(at.x, at.y, 0);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: at.x,
    y: at.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await move(at.x + 30, at.y + 30, 1);
  await move(at.x + 60, at.y + 60, 1);
  await expect.poll(() => nodeAt(page, 'l4')).not.toEqual(start);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const dropped = await nodeAt(page, 'l4');

  for (const [dx, dy] of [
    [-120, -80],
    [-200, -140],
    [-260, -200],
  ] as const)
    await move(at.x + dx, at.y + dy, 0);
  await page.waitForTimeout(150);
  expect(await nodeAt(page, 'l4')).toEqual(dropped);
  // The drag was committed where it stood, as one undo step.
  expect(await statusCount(page, 'history')).toBe(1);
});
