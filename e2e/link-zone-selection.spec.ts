import { test, expect, type Page } from '@playwright/test';
import { bootEditor, openFixture, readAutosave } from './helpers.js';

/**
 * Selection ergonomics for links and zones:
 * - a link is picked where it is DRAWN (an orthogonal auto-route), not along
 *   the hidden centre-to-centre diagonal;
 * - a selected link's end can be re-attached by dragging its handle onto
 *   another node, or via the inspector's From/To pickers;
 * - zones are the bottom layer: a drag inside one rubber-bands its nodes, a
 *   click on a node's caption selects the node, a bare click selects the zone.
 *
 * Fixture: spine-leaf page with zone z1 around s1/s2/l1 and an orthogonal
 * link `orth` l1 → s2.
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

const heading = (page: Page) => page.locator('.insp-h').first();

async function linkOrth(page: Page) {
  await expect(page.locator('#saved')).toHaveText('✓ saved');
  const doc = (await readAutosave(page)) as unknown as {
    pages: { links: { id: string; from: string; to: string }[] }[];
  };
  return doc.pages[0]!.links.find((l) => l.id === 'orth')!;
}

test.beforeEach(async ({ page }) => {
  await bootEditor(page);
  await openFixture(page, 'zone-orthogonal.json');
  await expect(
    page.locator('#page-canvas g[data-tds-link="orth"]'),
  ).toHaveCount(1);
});

test('an orthogonal link is selected by clicking its drawn route', async ({
  page,
}) => {
  // A point a quarter of the way along the rendered route — on the L's
  // vertical leg, well away from the l1 → s2 diagonal.
  const pt = await page.evaluate(() => {
    const g = document.querySelector('#page-canvas g[data-tds-link="orth"]')!;
    const el = [...g.querySelectorAll<SVGGeometryElement>('path, line')].sort(
      (a, b) => b.getTotalLength() - a.getTotalLength(),
    )[0]!;
    const q = el.getPointAtLength(el.getTotalLength() * 0.25);
    const p = new DOMPoint(q.x, q.y).matrixTransform(el.getScreenCTM()!);
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(pt.x, pt.y);
  await expect(heading(page)).toHaveText(/link/i);
  await expect(page.locator('#i-from')).toHaveValue('l1');
  await expect(page.locator('#i-to')).toHaveValue('s2');
});

test('dragging a link end handle onto another node re-attaches it', async ({
  page,
}) => {
  const mid = await page.evaluate(() => {
    const g = document.querySelector('#page-canvas g[data-tds-link="orth"]')!;
    const el = [...g.querySelectorAll<SVGGeometryElement>('path, line')].sort(
      (a, b) => b.getTotalLength() - a.getTotalLength(),
    )[0]!;
    const q = el.getPointAtLength(el.getTotalLength() * 0.5);
    const p = new DOMPoint(q.x, q.y).matrixTransform(el.getScreenCTM()!);
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(mid.x, mid.y);
  const handle = page.locator('#overlay circle[data-link-end="to"]');
  await expect(handle).toHaveCount(1);
  const box = (await handle.boundingBox())!;
  const l4 = await toClient(page, 711, 392);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(l4.x, l4.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#i-to')).toHaveValue('l4');
  expect(await linkOrth(page)).toMatchObject({ from: 'l1', to: 'l4' });

  // The inspector picker re-attaches the other end; undo reverts it.
  await page.locator('#i-from').selectOption('s1');
  expect(await linkOrth(page)).toMatchObject({ from: 's1', to: 'l4' });
  await page.keyboard.press('Control+z');
  await expect(page.locator('#i-from')).toHaveValue('l1');
});

test('zones stay behind: marquee inside a zone, caption click, zone click', async ({
  page,
}) => {
  // Drag from empty space inside z1 → rubber-bands L2 + L3, not the zone.
  const a = await toClient(page, 420, 360);
  const b = await toClient(page, 610, 420);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect(heading(page)).toHaveText(/selection \(2 nodes\)/i);

  // Clicking L2's caption (below its thin glyph) selects the node.
  const cap = await toClient(page, 463, 414);
  await page.mouse.click(cap.x, cap.y);
  await expect(heading(page)).toHaveText(/node/i);

  // A plain click on the zone's empty space still selects the zone.
  const z = await toClient(page, 400, 280);
  await page.mouse.click(z.x, z.y);
  await expect(heading(page)).toHaveText(/zone/i);
});
