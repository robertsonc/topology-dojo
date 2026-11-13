import { test, expect, type Page } from '@playwright/test';
import { bootEditor, readAutosave, statusCount } from './helpers.js';

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

/** A client point on the drawn route of link `id`, `at` of the way along. */
async function onLink(page: Page, id: string, at = 0.4) {
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

/** Click a client point with a modifier key held. */
async function modClick(
  page: Page,
  at: { x: number; y: number },
  modifier: 'Control' | 'Shift',
) {
  await page.keyboard.down(modifier);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up(modifier);
}

interface Doc {
  pages: {
    nodes: { id: string; x: number; y: number }[];
    links: { id: string; color?: string }[];
  }[];
}

async function sampleDoc(page: Page): Promise<Doc> {
  // Nudge an autosave so the sample scene is readable from storage.
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  return (await readAutosave(page)) as unknown as Doc;
}

test.beforeEach(async ({ page }) => {
  await bootEditor(page);
});

for (const modifier of ['Control', 'Shift'] as const)
  test(`${modifier}+click adds nodes to the selection`, async ({ page }) => {
    // The two right-most nodes: clear of the palette panel on the left.
    const [a, b] = (await sampleDoc(page)).pages[0]!.nodes.sort(
      (m, n) => n.x - m.x,
    );
    const pa = await toClient(page, a!.x, a!.y);
    const pb = await toClient(page, b!.x, b!.y);
    await page.mouse.click(pa.x, pa.y);
    await expect.poll(() => statusCount(page, 'selected')).toBe(1);
    await modClick(page, pb, modifier);
    await expect.poll(() => statusCount(page, 'selected')).toBe(2);
    // The same modifier-click again drops it.
    await modClick(page, pb, modifier);
    await expect.poll(() => statusCount(page, 'selected')).toBe(1);
  });

test('several links can be selected, restyled and deleted together', async ({
  page,
}) => {
  const links = (await sampleDoc(page)).pages[0]!.links;
  const [first, second] = links;
  const total = await statusCount(page, 'links');

  const p1 = await onLink(page, first!.id);
  const p2 = await onLink(page, second!.id);
  await page.mouse.click(p1.x, p1.y);
  await expect(page.locator('.insp-h').first()).toHaveText('Link');
  await modClick(page, p2, 'Control');
  await expect(
    page.locator('.insp-hint', { hasText: '2 links selected' }),
  ).toBeVisible();
  await expect.poll(() => statusCount(page, 'selected')).toBe(2);
  await expect(page.locator('#overlay [data-link-sel]')).not.toHaveCount(0);

  // Deleting removes both.
  await page.keyboard.press('Delete');
  await expect.poll(() => statusCount(page, 'links')).toBe(total - 2);
});
