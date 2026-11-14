/**
 * Edits land where the user made them, and stay with the document they were
 * made in: an inline rename goes to the element it was opened on, and a
 * replaced document does not inherit the previous one's undo history.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  bootEditor,
  fixturesDir,
  openFixture,
  readAutosave,
  statusCount,
} from './helpers.js';

/** Node labels in the autosaved document ([] until the first save lands). */
async function labels(page: Page): Promise<(string | undefined)[]> {
  const saved = await readAutosave(page);
  return (saved?.pages[0]?.nodes ?? []).map(
    (n) => (n as { label?: string }).label,
  );
}

/** Screen position of the node with this label (autosave + overlay CTM). */
async function nodeScreenPos(
  page: Page,
  label: string,
): Promise<{ x: number; y: number }> {
  return page.evaluate((lbl) => {
    const doc = JSON.parse(localStorage.getItem('topology-dojo:doc')!) as {
      pages: { nodes: { label?: string; x: number; y: number }[] }[];
    };
    const n = doc.pages[0]!.nodes.find((m) => m.label === lbl)!;
    const svg = document.querySelector('#overlay') as SVGSVGElement;
    const p = new DOMPoint(n.x, n.y).matrixTransform(svg.getScreenCTM()!);
    return { x: p.x, y: p.y };
  }, label);
}

/** Quick-add a typed node by double-clicking empty canvas at a point. */
async function quickAdd(
  page: Page,
  at: { x: number; y: number },
  type: string,
): Promise<void> {
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.locator('.quick-add')).toBeVisible();
  await page.keyboard.type(type);
  await page.keyboard.press('Enter');
  await expect(page.locator('.quick-add')).toBeHidden();
}

test('an inline rename committed by clicking another node renames the right one', async ({
  page,
}) => {
  await bootEditor(page);
  page.once('dialog', (d) => void d.accept());
  await page.locator('#fNew').click();
  await expect.poll(() => statusCount(page, 'nodes')).toBe(0);

  const box = (await page.locator('#overlay').boundingBox())!;
  const mid = box.y + box.height / 2;
  await quickAdd(page, { x: box.x + box.width * 0.4, y: mid }, 'host');
  await quickAdd(page, { x: box.x + box.width * 0.7, y: mid }, 'router');
  await expect.poll(() => labels(page)).toEqual(['Host', 'Router']);

  const host = await nodeScreenPos(page, 'Host');
  const router = await nodeScreenPos(page, 'Router');
  await page.mouse.dblclick(host.x, host.y);
  await expect(page.locator('.inline-label-edit')).toHaveValue('Host');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Core');
  // Commit by clicking the OTHER node: it becomes the selection before the
  // editor's blur fires.
  await page.mouse.click(router.x, router.y);
  await expect(page.locator('.inline-label-edit')).toBeHidden();
  await expect.poll(() => labels(page)).toEqual(['Core', 'Router']);
});

test('a replaced document starts with no undo history', async ({ page }) => {
  await bootEditor(page);
  // The file's own node count: wait for it, so the count is not read while
  // the previous document is still on the canvas.
  const n0 = (
    JSON.parse(
      readFileSync(path.join(fixturesDir, 'spine-leaf.json'), 'utf8'),
    ) as { pages: { nodes: unknown[] }[] }
  ).pages[0]!.nodes.length;
  await openFixture(page, 'spine-leaf.json');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0);

  // Two edits, so the newest undo step differs from the file's content.
  await page.locator('.pitem[data-type="ec"]').first().click();
  await page.locator('.pitem[data-type="router"]').first().click();
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0 + 2);
  await expect(page.locator('#tUndo')).toBeEnabled();

  // Open the same file again: the same page id, a different document.
  await openFixture(page, 'spine-leaf.json');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0);
  await expect(page.locator('#tUndo')).toBeDisabled();
  await page.keyboard.press('Control+z');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(n0);
});
