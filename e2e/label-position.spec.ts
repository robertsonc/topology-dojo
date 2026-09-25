import { test, expect, type Page } from '@playwright/test';
import { bootEditor, readAutosave } from './helpers.js';
import type { TopologyDocument } from '../src/pages/model.js';

const fixture = {
  title: 'Label positioning',
  pages: [
    {
      id: 'p1',
      name: 'Labels',
      viewBox: '0 0 800 500',
      nodes: [
        { id: 'a', type: 'ec', x: 200, y: 200, label: 'Alpha' },
        { id: 'b', type: 'ec', x: 600, y: 200, label: 'Beta' },
      ],
      links: [{ id: 'ab', type: 'line', from: 'a', to: 'b', label: 'Uplink' }],
      anchors: [],
      zones: [],
      flowPaths: [],
      policyMarkers: [],
    },
  ],
  customNodes: [],
};

async function selectAt(page: Page, x: number, y: number) {
  const point = await page.evaluate(
    ([x, y]) => {
      const svg = document.querySelector('#overlay') as SVGSVGElement;
      const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()!);
      return { x: p.x, y: p.y };
    },
    [x, y] as const,
  );
  await page.mouse.click(point.x, point.y);
}

async function savedPage(page: Page) {
  await expect(page.locator('#saved')).toHaveText('✓ saved');
  const doc = (await readAutosave(page)) as TopologyDocument;
  return doc.pages[0]!;
}

const fineTune = (page: Page) =>
  page.locator('details[data-group="Fine Tune"]');
const offsetX = (page: Page) => page.locator('input[data-key="labelOffsetX"]');
const offsetY = (page: Page) => page.locator('input[data-key="labelOffset"]');
const cell = (page: Page, code: string) =>
  page.locator(`.compass [data-cval="${code}"]`);

test.beforeEach(async ({ page }) => {
  await bootEditor(page);
  // The floating node library overlaps Alpha after the fixture is fitted.
  await page.locator('#palette-toggle').click();
  await page.locator('#fInput').setInputFiles({
    name: 'label-position.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.locator('#page-canvas [data-tds-node="a"]')).toHaveCount(1);
  await selectAt(page, 200, 200);
  await expect(page.locator('#inspector > .insp-h').first()).toHaveText('Node');
});

test('Fine Tune hides offsets and remembers its expanded state', async ({
  page,
}) => {
  await expect(offsetX(page)).toBeHidden();
  await expect(offsetY(page)).toBeHidden();
  await fineTune(page).locator('summary').click();
  await offsetX(page).fill('12');
  await offsetY(page).fill('40');
  expect((await savedPage(page)).nodes[0]).toMatchObject({
    labelOffsetX: 12,
    labelOffset: 40,
  });

  await selectAt(page, 600, 200);
  await expect(offsetX(page)).toBeVisible();
  await selectAt(page, 200, 200);
  await expect(offsetX(page)).toHaveValue('12');
  await fineTune(page).locator('summary').click();
  await expect(offsetX(page)).toBeHidden();
  expect((await savedPage(page)).nodes[0]).toMatchObject({
    labelOffsetX: 12,
    labelOffset: 40,
  });
});

test('double-click nudges without changing placement', async ({ page }) => {
  await cell(page, 'e').click();
  await expect(cell(page, 'e')).toHaveAttribute('aria-pressed', 'true');
  await cell(page, 'n').dblclick();
  await expect(offsetX(page)).toHaveValue('34');
  await expect(offsetY(page)).toHaveValue('3');
  await expect(offsetY(page)).toBeHidden();
  await expect(cell(page, 'e')).toHaveAttribute('aria-pressed', 'true');
  expect((await savedPage(page)).nodes[0]).toMatchObject({
    labelPlacement: 'e',
    labelOffsetX: 34,
    labelOffset: 3,
  });

  await cell(page, 'n').dblclick();
  await expect(offsetY(page)).toHaveValue('2');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await selectAt(page, 200, 200);
  await expect(offsetY(page)).toHaveValue('3');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await selectAt(page, 200, 200);
  await expect(offsetY(page)).toHaveValue('');
  await expect(cell(page, 'e')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await selectAt(page, 200, 200);
  await expect(offsetY(page)).toHaveValue('3');
});

test('diagonal nudges, keyboard placement, and Auto reset', async ({
  page,
}) => {
  await fineTune(page).locator('summary').click();
  await offsetX(page).fill('12');
  await offsetY(page).fill('40');
  await cell(page, 'nw').dblclick();
  await expect(offsetX(page)).toHaveValue('11');
  await expect(offsetY(page)).toHaveValue('39');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await selectAt(page, 200, 200);
  await expect(offsetX(page)).toHaveValue('12');
  await expect(offsetY(page)).toHaveValue('40');
  await expect(offsetX(page)).toBeVisible();

  await cell(page, 'w').focus();
  await page.keyboard.press('Enter');
  await expect(cell(page, 'w')).toHaveAttribute('aria-pressed', 'true');
  await expect(offsetX(page)).toHaveValue('');
  await expect(offsetY(page)).toHaveValue('');
  await cell(page, 'sw').dblclick();
  await expect(offsetX(page)).toHaveValue('-35');
  await expect(offsetY(page)).toHaveValue('5');
  await cell(page, '').dblclick();
  await expect(offsetX(page)).toHaveValue('');
  await expect(offsetY(page)).toHaveValue('');
  const node = (await savedPage(page)).nodes[0]!;
  expect(node.labelPlacement).toBeUndefined();
  expect(node.labelOffsetX).toBeUndefined();
  expect(node.labelOffset).toBeUndefined();
});

test('link nudges accumulate, undo, and reset to Auto', async ({ page }) => {
  await selectAt(page, 400, 200);
  await expect(page.locator('#inspector > .insp-h').first()).toHaveText('Link');
  await cell(page, 'se').dblclick();
  expect((await savedPage(page)).links[0]?.labelOffset).toEqual({
    x: 1,
    y: 1,
  });
  await cell(page, 'se').dblclick();
  expect((await savedPage(page)).links[0]?.labelOffset).toEqual({
    x: 2,
    y: 2,
  });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await savedPage(page)).links[0]?.labelOffset).toEqual({
    x: 1,
    y: 1,
  });
  await cell(page, 'n').click();
  await expect(cell(page, 'n')).toHaveAttribute('aria-pressed', 'true');
  expect((await savedPage(page)).links[0]?.labelOffset).toEqual({
    x: 0,
    y: -18,
  });
  await cell(page, 'e').dblclick();
  expect((await savedPage(page)).links[0]?.labelOffset).toEqual({
    x: 1,
    y: -18,
  });
  await cell(page, '').click();
  await expect(cell(page, '')).toHaveAttribute('aria-pressed', 'true');
  expect((await savedPage(page)).links[0]?.labelOffset).toBeUndefined();
});

test('pending placement cannot edit a newly selected node', async ({
  page,
}) => {
  await cell(page, 'n').click();
  await selectAt(page, 600, 200);
  await expect(page.locator('input[data-key="label"]')).toHaveValue('Beta');
  await cell(page, 'e').click();
  await expect(cell(page, 'e')).toHaveAttribute('aria-pressed', 'true');
  const nodes = (await savedPage(page)).nodes;
  expect(nodes[0]?.labelPlacement).toBeUndefined();
  expect(nodes[1]?.labelPlacement).toBe('e');
});
