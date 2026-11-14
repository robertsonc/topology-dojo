/**
 * Exports and Present mode: they are drawn with what the canvas is drawn
 * with, and every export says how it went.
 */
import { expect, test, type Download, type Page } from '@playwright/test';
import { bootEditor } from './helpers.js';

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Run `action` and return the file it downloads. */
async function download(
  page: Page,
  action: () => Promise<unknown>,
): Promise<Download> {
  const pending = page.waitForEvent('download');
  await action();
  return pending;
}

const count = (text: string, colour: string): number =>
  text.toLowerCase().split(colour.toLowerCase()).length - 1;

/** The Azure preset's accent, and the engine green it replaces. */
const AZURE = '#0a84ff';
const GREEN = '#01a982';

test('the brand palette carries into SVG, flipbook and Present', async ({
  page,
}) => {
  await bootEditor(page);
  // The key (legend) is drawn over the page from the same colours.
  await page.locator('#p-legend').click();
  await page.locator('#tDisplay').click();
  await page.locator('.dp-swatch[data-id="azure"]').click();
  await page.keyboard.press('Escape');

  // The canvas is recoloured — that part always worked.
  const canvas = await page.locator('#page-canvas').innerHTML();
  expect(count(canvas, AZURE)).toBeGreaterThan(0);
  expect(count(canvas, GREEN)).toBe(0);
  // So is the key drawn on top of it.
  const overlay = await page.locator('#overlay').innerHTML();
  expect(count(overlay, GREEN)).toBe(0);

  const svg = await downloadText(
    await download(page, () => page.locator('#fSvg').click()),
  );
  expect(count(svg, AZURE)).toBeGreaterThan(0);
  expect(count(svg, GREEN)).toBe(0);

  const flipbook = await downloadText(
    await download(page, () =>
      page.locator('#fExport').selectOption('flipbook'),
    ),
  );
  const frames = flipbook.slice(flipbook.indexOf('<div class="frame'));
  expect(count(frames, AZURE)).toBeGreaterThan(0);
  expect(count(frames, GREEN)).toBe(0);

  const selection = await downloadText(
    await download(page, async () => {
      await page.keyboard.press('Control+a');
      await page.locator('#fExport').selectOption('svg-selection');
    }),
  );
  expect(count(selection, AZURE)).toBeGreaterThan(0);
  expect(count(selection, GREEN)).toBe(0);

  await page.locator('#tPresent').click();
  const stage = page.locator('#presentStage');
  await expect(stage.locator('svg').first()).toBeVisible();
  const presented = await stage.innerHTML();
  expect(count(presented, AZURE)).toBeGreaterThan(0);
  expect(count(presented, GREEN)).toBe(0);
});

test('every export in the menu reports how it went', async ({ page }) => {
  await bootEditor(page);
  const status = page.locator('#exportStatus');
  const menu = page.locator('#fExport');

  // A file export: the chip names it, and its tooltip is the file.
  const mermaid = await download(page, () => menu.selectOption('mermaid'));
  await expect(status).toHaveText('✓ exported mermaid');
  await expect(status).toHaveClass(/export-ok/);
  await expect(status).toHaveAttribute('title', mermaid.suggestedFilename());

  await download(page, () => menu.selectOption('drawio'));
  await expect(status).toHaveText('✓ exported draw.io');
  await download(page, () => menu.selectOption('vsdx'));
  await expect(status).toHaveText('✓ exported visio');
  await download(page, () => menu.selectOption('pptx'));
  await expect(status).toHaveText('✓ exported pptx');
  await download(page, () => menu.selectOption('flipbook'));
  await expect(status).toHaveText('✓ exported flipbook');

  // A slow one shows that it is working, then that it is done.
  const pdf = download(page, () => menu.selectOption('pdf-page'));
  await expect(status).toHaveText(/… exporting pdf|✓ exported pdf/);
  await pdf;
  await expect(status).toHaveText('✓ exported pdf');

  // A failure replaces the previous export's success, with the reason.
  const alerts: string[] = [];
  page.on('dialog', (d) => {
    alerts.push(d.message());
    void d.accept();
  });
  await menu.selectOption('svg-selection'); // nothing is selected
  await expect(status).toHaveText('⚠ selection export failed');
  await expect(status).toHaveClass(/export-failed/);
  await expect(status).toHaveAttribute('title', /select one or more nodes/i);
  expect(alerts).toHaveLength(1);
});

/* ── imports ───────────────────────────────────────────────────────────── */

/** A two-page draw.io file: three shapes and a connector, then one shape. */
const TWO_PAGE_DRAWIO = `<mxfile>
  <diagram name="Core"><mxGraphModel><root>
    <mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="a" value="R1" style="rounded=1" vertex="1" parent="1"><mxGeometry x="80" y="80" width="80" height="40" as="geometry"/></mxCell>
    <mxCell id="b" value="R2" style="rounded=1" vertex="1" parent="1"><mxGeometry x="280" y="80" width="80" height="40" as="geometry"/></mxCell>
    <mxCell id="c" value="R3" style="rounded=1" vertex="1" parent="1"><mxGeometry x="180" y="220" width="80" height="40" as="geometry"/></mxCell>
    <mxCell id="e" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
  </root></mxGraphModel></diagram>
  <diagram name="Edge"><mxGraphModel><root>
    <mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="d" value="S1" style="rounded=1" vertex="1" parent="1"><mxGeometry x="80" y="80" width="80" height="40" as="geometry"/></mxCell>
  </root></mxGraphModel></diagram>
</mxfile>`;

test('the import confirmation counts every page and says the diagram is replaced', async ({
  page,
}) => {
  await bootEditor(page);
  const asked: string[] = [];
  page.on('dialog', (d) => {
    asked.push(d.message());
    void d.accept();
  });
  await page.locator('#fInput').setInputFiles({
    name: 'two-pages.drawio',
    mimeType: 'application/xml',
    buffer: Buffer.from(TWO_PAGE_DRAWIO),
  });
  await expect(page.locator('#frames-ind')).toHaveText('1/2');

  expect(asked).toHaveLength(1);
  const question = asked[0]!;
  expect(question).toMatch(/^Replace the current diagram with this draw\.io/);
  expect(question).toContain('2 pages, 4 nodes and 1 link in total');
});
