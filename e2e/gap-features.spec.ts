/**
 * Gap-closing features (plan phases 1–6): authoring-velocity gestures
 * (quick-add, inline label editing, quick-connect chevrons), Mermaid import,
 * PDF export, page line-jumps, and node status — driven through the real UI.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import {
  bootEditor,
  fixturesDir,
  readAutosave,
  statusCount,
} from './helpers.js';

/** Screen position of the sole selected node (from autosave + overlay CTM). */
async function nodeScreenPos(
  page: Page,
  label: string,
): Promise<{ x: number; y: number }> {
  return page.evaluate((lbl) => {
    const raw = localStorage.getItem('topology-dojo:doc');
    const doc = JSON.parse(raw!) as {
      pages: { nodes: { label?: string; x: number; y: number }[] }[];
    };
    const n = doc.pages[0]!.nodes.find((m) => m.label === lbl)!;
    const svg = document.querySelector('#overlay') as SVGSVGElement;
    const p = new DOMPoint(n.x, n.y).matrixTransform(svg.getScreenCTM()!);
    return { x: p.x, y: p.y };
  }, label);
}

/** A fresh empty document (confirm dialog accepted). */
async function newDocument(page: Page): Promise<void> {
  page.once('dialog', (d) => void d.accept());
  await page.locator('#fNew').click();
  await expect.poll(() => statusCount(page, 'nodes')).toBe(0);
}

test('double-click empty canvas quick-adds a typed node at that point', async ({
  page,
}) => {
  await bootEditor(page);
  await newDocument(page);
  const box = (await page.locator('#overlay').boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.quick-add')).toBeVisible();
  await page.keyboard.type('firewall');
  await page.keyboard.press('Enter');
  await expect.poll(() => statusCount(page, 'nodes')).toBe(1);
  await expect(page.locator('#saved')).toHaveText('✓ saved');
  const saved = await readAutosave(page);
  expect((saved!.pages[0]!.nodes[0] as { type: string }).type).toBe('firewall');
});

test('double-click a node renames it in place (Escape cancels)', async ({
  page,
}) => {
  await bootEditor(page);
  await newDocument(page);
  await page.locator('.pitem[data-type="host"]').first().click();
  await expect(page.locator('#saved')).toHaveText('✓ saved');

  const pos = await nodeScreenPos(page, 'Host');
  await page.mouse.dblclick(pos.x, pos.y);
  await expect(page.locator('.inline-label-edit')).toBeVisible();
  await expect(page.locator('.inline-label-edit')).toHaveValue('Host');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('edge-host-01');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () =>
      (await readAutosave(page))!.pages[0]!.nodes.map(
        (n) => (n as { label?: string }).label,
      ),
    )
    .toEqual(['edge-host-01']);

  // Escape cancels without committing.
  const pos2 = await nodeScreenPos(page, 'edge-host-01');
  await page.mouse.dblclick(pos2.x, pos2.y);
  await expect(page.locator('.inline-label-edit')).toBeVisible();
  await page.keyboard.type('SHOULD-NOT-STICK');
  await page.keyboard.press('Escape');
  await expect(page.locator('.inline-label-edit')).toBeHidden();
  await expect
    .poll(async () =>
      (await readAutosave(page))!.pages[0]!.nodes.map(
        (n) => (n as { label?: string }).label,
      ),
    )
    .toEqual(['edge-host-01']);
});

test('quick-connect chevron creates a connected same-type node', async ({
  page,
}) => {
  await bootEditor(page);
  await newDocument(page);
  await page.locator('.pitem[data-type="router"]').first().click();
  await expect.poll(() => statusCount(page, 'nodes')).toBe(1);
  await expect(page.locator('#saved')).toHaveText('✓ saved');

  // Hover the node to reveal the chevrons, then probe east until the cursor
  // flips to 'copy' (the chevron affordance) and click it.
  const pos = await nodeScreenPos(page, 'Router');
  await page.mouse.move(pos.x, pos.y);
  let clicked = false;
  for (let dx = 16; dx <= 90 && !clicked; dx += 4) {
    await page.mouse.move(pos.x + dx, pos.y);
    const cursor = await page.evaluate(
      () => (document.querySelector('#overlay') as SVGSVGElement).style.cursor,
    );
    if (cursor === 'copy') {
      await page.mouse.click(pos.x + dx, pos.y);
      clicked = true;
    }
  }
  expect(clicked).toBe(true);
  await expect.poll(() => statusCount(page, 'nodes')).toBe(2);
  await expect.poll(() => statusCount(page, 'links')).toBe(1);
  // The fresh node opens its inline label editor — accept the default.
  await expect(page.locator('.inline-label-edit')).toBeVisible();
  await page.keyboard.press('Enter');
});

test('opening a .mmd file imports the Mermaid flowchart', async ({ page }) => {
  await bootEditor(page);
  page.once('dialog', (d) => void d.accept()); // the convert-summary confirm
  await page
    .locator('#fInput')
    .setInputFiles(path.join(fixturesDir, 'flow.mmd'));
  await expect.poll(() => statusCount(page, 'nodes')).toBe(4);
  await expect.poll(() => statusCount(page, 'links')).toBe(3);
  await expect.poll(() => statusCount(page, 'zones')).toBe(1);
});

test('PDF export downloads a real PDF of the current frame', async ({
  page,
}) => {
  await bootEditor(page);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#fExport').selectOption('pdf-page');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const head = await new Promise<string>((resolve, reject) => {
    void download.createReadStream().then((stream) => {
      stream.once('data', (c: Buffer) => resolve(c.subarray(0, 5).toString()));
      stream.on('error', reject);
    });
  });
  expect(head).toBe('%PDF-');
});

test('page line-jumps setting renders arcs and persists', async ({ page }) => {
  await bootEditor(page);
  await page.locator('#p-jumps').selectOption('arc');
  await expect
    .poll(async () => {
      const saved = await readAutosave(page);
      return (saved!.pages[0] as { lineJumps?: string }).lineJumps;
    })
    .toBe('arc');
});
