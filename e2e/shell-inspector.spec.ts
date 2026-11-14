/**
 * The Properties inspector: what a field stores is what it shows, and what it
 * shows keeps up with the canvas.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  bootEditor,
  clickLink,
  clickNode,
  savedDocument,
  savedElement,
} from './helpers.js';

const field = (page: Page, key: string) =>
  page.locator(`#inspector input[data-key="${key}"]`);

/** How strongly a node is drawn on the canvas (1 = fully opaque). */
const drawnOpacity = (page: Page, id: string): Promise<string> =>
  page.evaluate(
    (nodeId) =>
      getComputedStyle(
        document.querySelector(`#page-canvas [data-tds-node="${nodeId}"]`)!,
      ).opacity,
    id,
  );

test('clearing a number field removes the property instead of storing 0', async ({
  page,
}) => {
  await bootEditor(page);

  // A node's opacity: cleared, it is unset and the node is drawn in full.
  await clickNode(page, 'fw');
  await field(page, 'opacity').fill('0.5');
  expect((await savedElement(page, 'nodes', 'fw')).opacity).toBe(0.5);
  await field(page, 'opacity').fill('');
  expect(await savedElement(page, 'nodes', 'fw')).not.toHaveProperty('opacity');
  expect(await drawnOpacity(page, 'fw')).toBe('1');
  await expect(field(page, 'opacity')).toHaveValue('');

  // A link's stroke width and opacity.
  await clickLink(page, 'ec-fw');
  for (const key of ['strokeWidth', 'opacity']) {
    await field(page, key).fill('0.7');
    expect((await savedElement(page, 'links', 'ec-fw'))[key]).toBe(0.7);
    await field(page, key).fill('');
    expect(await savedElement(page, 'links', 'ec-fw')).not.toHaveProperty(key);
  }

  // A zone's padding, in the annotations list.
  await page.keyboard.press('Escape');
  const zone = page.locator('#inspector details.anno[data-acol="zones"]');
  await zone.locator('summary').click();
  const zoneId = (await zone.getAttribute('data-aid'))!;
  const padding = zone.locator('input[data-akey="padding"]');
  await padding.fill('30');
  expect((await savedElement(page, 'zones', zoneId)).padding).toBe(30);
  await padding.fill('');
  expect(await savedElement(page, 'zones', zoneId)).not.toHaveProperty(
    'padding',
  );
});

test('a number outside what the field allows is clamped or refused', async ({
  page,
}) => {
  await bootEditor(page);
  await clickNode(page, 'fw');

  // Opacity is 0…1: the inputs say so, and a value outside is clamped.
  await expect(field(page, 'opacity')).toHaveAttribute('min', '0');
  await expect(field(page, 'opacity')).toHaveAttribute('max', '1');
  await field(page, 'opacity').fill('5');
  expect((await savedElement(page, 'nodes', 'fw')).opacity).toBe(1);
  await field(page, 'opacity').fill('-1');
  expect((await savedElement(page, 'nodes', 'fw')).opacity).toBe(0);
  // Leaving the field shows what was stored, not what was typed.
  await field(page, 'opacity').press('Tab');
  await expect(field(page, 'opacity')).toHaveValue('0');

  // Label width is 40…600.
  await field(page, 'labelWidth').fill('99999');
  expect((await savedElement(page, 'nodes', 'fw')).labelWidth).toBe(600);
  await field(page, 'labelWidth').fill('-50');
  expect((await savedElement(page, 'nodes', 'fw')).labelWidth).toBe(40);

  // A shape's size must be positive: zero and negatives are not stored.
  await page.keyboard.press('Escape');
  await page.locator('.pitem[data-type="shape:rectangle"]').first().click();
  await field(page, 'shapeWidth').fill('80');
  const shapeId = (await savedDocument(page)).pages[0]!.nodes.at(-1)!.id;
  expect((await savedElement(page, 'nodes', shapeId)).shapeWidth).toBe(80);
  for (const bad of ['-50', '0']) {
    await field(page, 'shapeWidth').fill(bad);
    await field(page, 'shapeHeight').fill(bad);
  }
  await field(page, 'shapeHeight').press('Tab');
  // Something else is edited after, so the autosave is known to be current.
  await field(page, 'shapeSize').fill('40');
  const shape = await savedElement(page, 'nodes', shapeId);
  expect(shape.shapeSize).toBe(40);
  expect(shape.shapeWidth).toBe(80);
  expect(shape).not.toHaveProperty('shapeHeight');
  await expect(field(page, 'shapeWidth')).toHaveValue('80');
  await expect(field(page, 'shapeHeight')).toHaveValue('');

  // A text node's font size likewise.
  await page.keyboard.press('Escape');
  await page.locator('.pitem[data-type="text"]').first().click();
  await field(page, 'fontSize').fill('0');
  await field(page, 'fontSize').fill('-5');
  await field(page, 'padding').fill('4');
  const text = (await savedDocument(page)).pages[0]!.nodes.at(-1)!;
  expect(text.padding).toBe(4);
  expect(text).not.toHaveProperty('fontSize');
});

test('a required position keeps its value when its field is cleared', async ({
  page,
}) => {
  await bootEditor(page);
  await clickNode(page, 'fw');
  await page
    .locator('#inspector details[data-group="Position"] > summary')
    .click();
  await field(page, 'y').fill('310');
  const before = await savedElement(page, 'nodes', 'fw');
  expect(before.y).toBe(310);

  await field(page, 'x').fill('');
  await field(page, 'x').press('Tab');
  await expect(field(page, 'x')).toHaveValue(String(before.x));
  await field(page, 'y').fill('320');
  const after = await savedElement(page, 'nodes', 'fw');
  expect(after.y).toBe(320);
  expect(after.x).toBe(before.x);
});

test('a blank or non-positive canvas size is ignored', async ({ page }) => {
  await bootEditor(page);
  const width = page.locator('#p-w');
  const height = page.locator('#p-h');
  await width.fill('1200');
  await width.press('Tab');
  expect((await savedDocument(page)).pages[0]!.viewBox).toBe('0 0 1200 700');

  for (const bad of ['', '0', '-500']) {
    await width.fill(bad);
    await width.press('Tab');
    await expect(width).toHaveValue('1200');
    await height.fill(bad);
    await height.press('Tab');
    await expect(height).toHaveValue('700');
  }
  // A following valid edit saves, and shows the size never changed between.
  await height.fill('800');
  await height.press('Tab');
  expect((await savedDocument(page)).pages[0]!.viewBox).toBe('0 0 1200 800');
});

/* ── annotation editors (zones, flow paths, policy markers) ──────────────── */

/** The editor for the first annotation of a kind, opened. */
async function openAnnotation(page: Page, collection: string) {
  const editor = page
    .locator(`#inspector details.anno[data-acol="${collection}"]`)
    .first();
  if (!(await editor.evaluate((d) => (d as HTMLDetailsElement).open)))
    await editor.locator('summary').click();
  return { editor, id: (await editor.getAttribute('data-aid'))! };
}

test('a boolean annotation field is a checkbox that stores a boolean', async ({
  page,
}) => {
  await bootEditor(page);
  const { editor, id } = await openAnnotation(page, 'flowPaths');
  const follow = editor.locator('[data-akey="followLinks"]');
  await expect(follow).toHaveAttribute('type', 'checkbox');
  // A flow path follows its links unless told not to: unset shows ticked.
  await expect(follow).toBeChecked();

  await follow.uncheck();
  expect((await savedElement(page, 'flowPaths', id)).followLinks).toBe(false);
  await follow.check();
  expect((await savedElement(page, 'flowPaths', id)).followLinks).toBe(true);
});

test('a zone map backdrop is "None" until one is chosen, and can go back', async ({
  page,
}) => {
  await bootEditor(page);
  const { editor, id } = await openAnnotation(page, 'zones');
  const backdrop = editor.locator('select[data-akey="backdrop"]');
  await expect(backdrop).toHaveValue('');
  await expect(backdrop.locator('option:checked')).toHaveText('None');

  await backdrop.selectOption('world');
  expect((await savedElement(page, 'zones', id)).backdrop).toBe('world');
  // (The editor stays open across the change, so the same select is there.)
  await backdrop.selectOption('');
  expect(await savedElement(page, 'zones', id)).not.toHaveProperty('backdrop');
});

test('an annotation editor stays open through its own swatch, compass and chip clicks', async ({
  page,
}) => {
  await bootEditor(page);
  const isOpen = (collection: string): Promise<boolean> =>
    page
      .locator(`#inspector details.anno[data-acol="${collection}"]`)
      .first()
      .evaluate((d) => (d as HTMLDetailsElement).open);

  const flow = await openAnnotation(page, 'flowPaths');
  await flow.editor
    .locator('[data-aswatch="color"] [data-color="#7764fc"]')
    .click();
  expect((await savedElement(page, 'flowPaths', flow.id)).color).toBe(
    '#7764fc',
  );
  expect(await isOpen('flowPaths')).toBe(true);

  await page
    .locator('#inspector details.anno[data-acol="flowPaths"]')
    .first()
    .locator('.compass [data-cval="n"]')
    .click();
  expect(await isOpen('flowPaths')).toBe(true);

  await page
    .locator('#inspector details.anno[data-acol="flowPaths"]')
    .first()
    .locator('.refchip [data-refmove="1"]')
    .first()
    .click();
  expect(await isOpen('flowPaths')).toBe(true);

  const marker = await openAnnotation(page, 'policyMarkers');
  await marker.editor
    .locator('[data-aswatch="color"] [data-color="#01a982"]')
    .click();
  expect(await isOpen('policyMarkers')).toBe(true);
  // The flow path's editor, opened earlier, was not shut by that either.
  expect(await isOpen('flowPaths')).toBe(true);

  // A collapsed group stays collapsed too.
  const group = page.locator(
    '#inspector details.anno-group[data-agroup="zones"]',
  );
  await group.locator('> summary').click();
  await page
    .locator('#inspector details.anno[data-acol="policyMarkers"]')
    .first()
    .locator('[data-aswatch="color"] [data-color="#65aef9"]')
    .click();
  expect(await group.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(
    false,
  );
});
