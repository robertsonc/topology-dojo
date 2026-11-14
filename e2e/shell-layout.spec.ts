/**
 * The canvas and the chrome floating over it: the canvas is exactly as big as
 * its stage, the on-canvas view controls are on screen and reachable, and a
 * fit leaves the content clear of the panels around it.
 */
import { expect, test, type Page } from '@playwright/test';
import { bootEditor } from './helpers.js';

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Viewport boxes of the named elements, plus the viewport itself. */
async function boxes(
  page: Page,
  selectors: Record<string, string>,
): Promise<Record<string, Box>> {
  return page.evaluate((sel) => {
    const out: Record<string, Box> = {
      viewport: { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
    };
    for (const [name, s] of Object.entries(sel)) {
      const r = document.querySelector(s)!.getBoundingClientRect();
      out[name] = {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      };
    }
    return out;
  }, selectors);
}

function expectInside(inner: Box, outer: Box): void {
  expect(inner.left).toBeGreaterThanOrEqual(outer.left - 0.5);
  expect(inner.top).toBeGreaterThanOrEqual(outer.top - 0.5);
  expect(inner.right).toBeLessThanOrEqual(outer.right + 0.5);
  expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + 0.5);
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

/** How far each scrollable ancestor of the canvas has been scrolled. */
async function canvasScroll(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    ['.stage', '#canvas-area', '.tds-root', '.canvas-host'].flatMap((s) => {
      const el = document.querySelector(s)!;
      return [el.scrollTop, el.scrollLeft];
    }),
  );
}

const CONTROL_IDS = ['ccHand', 'ccZoomIn', 'ccZoom', 'ccZoomOut', 'ccFit'];

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]) {
  const size = `${viewport.width}×${viewport.height}`;

  test(`the canvas fits its stage and the view controls are on screen at ${size}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await bootEditor(page);

    const b = await boxes(page, {
      stage: '.stage',
      host: '.canvas-host',
      ctrls: '#canvasCtrls',
      palette: '#palette',
      frames: '#frames-dock .filmstrip',
      pill: '#frames-toggle',
    });
    // The canvas is as tall as the stage it sits in, not the whole window.
    expectInside(b.host!, b.stage!);
    // The controls are inside the window and the stage, clear of the node
    // library and of the frames strip.
    expectInside(b.ctrls!, b.viewport!);
    expectInside(b.ctrls!, b.stage!);
    expect(overlaps(b.ctrls!, b.palette!)).toBe(false);
    expect(overlaps(b.ctrls!, b.frames!)).toBe(false);
    expect(overlaps(b.ctrls!, b.pill!)).toBe(false);

    // Nothing is drawn over them: each button is what a click there hits.
    for (const id of CONTROL_IDS) {
      const hit = await page.evaluate((controlId) => {
        const r = document.getElementById(controlId)!.getBoundingClientRect();
        const el = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return el?.id ?? null;
      }, id);
      expect(hit, `a click on #${id} reaches it`).toBe(id);
    }
    // They work: zooming in changes the zoom readout.
    const before = await page.locator('#ccZoom').innerText();
    await page.locator('#ccZoomIn').click();
    await expect(page.locator('#ccZoom')).not.toHaveText(before);
  });

  test(`tabbing through the view controls never scrolls the canvas at ${size}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await bootEditor(page);
    const paletteTop = (await boxes(page, { p: '#palette' })).p!.top;

    await page.locator(`#${CONTROL_IDS[0]}`).focus();
    for (const id of CONTROL_IDS) {
      await expect(page.locator(`#${id}`)).toBeFocused();
      expect(await canvasScroll(page)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      await page.keyboard.press('Tab');
    }
    for (const id of [...CONTROL_IDS].reverse()) {
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator(`#${id}`)).toBeFocused();
      expect(await canvasScroll(page)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    }
    // The floating panels did not move with a scrolled canvas area.
    expect((await boxes(page, { p: '#palette' })).p!.top).toBe(paletteTop);
  });
}

test('the quick-add picker opens fully inside the visible canvas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootEditor(page);
  const b = await boxes(page, { stage: '.stage', host: '.canvas-host' });
  // Double-click empty canvas low on the stage, right of the sample scene.
  await page.mouse.dblclick(b.host!.right - 80, b.stage!.bottom - 110);
  await expect(page.locator('.quick-add')).toBeVisible();
  const pop = (await boxes(page, { pop: '.quick-add' })).pop!;
  expectInside(pop, b.stage!);
  expectInside(pop, b.viewport!);
});

/** Viewport boxes of every node drawn on the canvas. */
async function nodeBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('#page-canvas [data-tds-node]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }),
  );
}

/** Every node is on the visible canvas: right of the node library (when it
 * is open), above the bottom band and inside the canvas box. */
async function expectContentVisible(
  page: Page,
  paletteOpen: boolean,
): Promise<number> {
  const b = await boxes(page, {
    host: '.canvas-host',
    palette: '#palette',
    dock: '#canvas-dock',
  });
  const nodes = await nodeBoxes(page);
  expect(nodes.length).toBeGreaterThan(0);
  for (const n of nodes) {
    expectInside(n, b.host!);
    expect(n.bottom).toBeLessThanOrEqual(b.dock!.top);
    if (paletteOpen) expect(n.left).toBeGreaterThanOrEqual(b.palette!.right);
  }
  return Math.min(...nodes.map((n) => n.left));
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]) {
  test(`fit view keeps the content clear of the node library at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await bootEditor(page);

    // The first fit, made as the editor boots.
    await expect
      .poll(async () => Math.min(...(await nodeBoxes(page)).map((n) => n.left)))
      .toBeGreaterThan(174);
    await expectContentVisible(page, true);

    // Each way of asking for a fit: the shortcut, the toolbar, the canvas.
    for (const fit of [
      () => page.keyboard.press('0'),
      () => page.locator('#tFit').click(),
      () => page.locator('#ccFit').click(),
      () => page.locator('#ccZoom').click(),
    ]) {
      await page.locator('#ccZoomOut').click(); // move off the fitted view
      await fit();
      await expectContentVisible(page, true);
    }
    const leftWithPalette = await expectContentVisible(page, true);

    // A frame switch fits the new frame the same way.
    await page.locator('#dupPage').click();
    await expect(page.locator('#frames-ind')).toHaveText('2/2');
    await expectContentVisible(page, true);

    // With the library collapsed its edge is free again and the content
    // moves back into it.
    await page.locator('#palette-toggle').click();
    await page.keyboard.press('0');
    const leftWithout = await expectContentVisible(page, false);
    expect(leftWithout).toBeLessThan(leftWithPalette);
  });
}
