/**
 * The canvas and the chrome around it: the canvas is exactly as big as its
 * stage, the rail's tools and the zoom control floating in the canvas's
 * corner are on screen and reachable, and a fit leaves the content clear of
 * the panels around it.
 */
import { expect, test, type Page } from '@playwright/test';
import { bootEditor, menuCommand } from './helpers.js';

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

/** The zoom control in the canvas's bottom-right corner, in tab order. */
const CONTROL_IDS = ['ccZoomOut', 'ccZoom', 'ccZoomIn', 'ccFit'];
/** The left rail, in tab order: the tools (the hand among them), the
 * library, the command palette and the shortcut sheet. */
const RAIL_IDS = [
  'tSelect',
  'ccHand',
  'tLink',
  'tAnchor',
  'palette-toggle',
  'tCommand',
  'tHelp',
];

/** The id of what a click in the middle of each element would reach. */
async function hits(page: Page, ids: string[]): Promise<(string | null)[]> {
  return page.evaluate(
    (all) =>
      all.map((controlId) => {
        const r = document.getElementById(controlId)!.getBoundingClientRect();
        const el = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return el?.closest('[id]')?.id ?? null;
      }),
    ids,
  );
}

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
    // library and of the pages bar's chips and toggle.
    expectInside(b.ctrls!, b.viewport!);
    expectInside(b.ctrls!, b.stage!);
    expect(overlaps(b.ctrls!, b.palette!)).toBe(false);
    expect(overlaps(b.ctrls!, b.frames!)).toBe(false);
    expect(overlaps(b.ctrls!, b.pill!)).toBe(false);
    // The zoom control floats over the canvas itself.
    expectInside(b.ctrls!, b.host!);

    // Nothing is drawn over them, or over the rail's buttons: each button
    // is what a click there hits.
    const ids = [...CONTROL_IDS, ...RAIL_IDS];
    const reached = await hits(page, ids);
    ids.forEach((id, i) =>
      expect(reached[i], `a click on #${id} reaches it`).toBe(id),
    );
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
    // The same along the rail.
    await page.locator(`#${RAIL_IDS[0]}`).focus();
    for (const id of RAIL_IDS) {
      await expect(page.locator(`#${id}`)).toBeFocused();
      expect(await canvasScroll(page)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      await page.keyboard.press('Tab');
    }
    // The panels did not move with a scrolled canvas area.
    expect((await boxes(page, { p: '#palette' })).p!.top).toBe(paletteTop);
  });
}

test('the quick-add picker opens fully inside the visible canvas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootEditor(page);
  const b = await boxes(page, { stage: '.stage', host: '.canvas-host' });
  // Double-click empty canvas low on the stage, right of the sample scene
  // (above the zoom control in the corner and the pages bar under the
  // canvas, which take the stage's bottom 44px).
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
 * is open), clear of the zoom control and the minimap card floating in the
 * canvas's corner, and inside the canvas box. */
async function expectContentVisible(
  page: Page,
  paletteOpen: boolean,
): Promise<number> {
  const b = await boxes(page, {
    host: '.canvas-host',
    palette: '#palette',
    ctrls: '#canvasCtrls',
    minimap: '#minimap-dock',
  });
  const minimapOpen = await page
    .locator('#minimap-dock')
    .evaluate((el) => !el.classList.contains('collapsed'));
  const nodes = await nodeBoxes(page);
  expect(nodes.length).toBeGreaterThan(0);
  for (const n of nodes) {
    expectInside(n, b.host!);
    expect(overlaps(n, b.ctrls!)).toBe(false);
    if (minimapOpen) expect(overlaps(n, b.minimap!)).toBe(false);
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

    // The first fit, made as the editor boots: past the library, which is
    // docked beside the 44px rail and ends where the canvas starts.
    const libraryRight = (await boxes(page, { p: '#palette' })).p!.right;
    expect(libraryRight).toBe(44 + 208);
    await expect
      .poll(async () => Math.min(...(await nodeBoxes(page)).map((n) => n.left)))
      .toBeGreaterThan(libraryRight);
    await expectContentVisible(page, true);

    // Each way of asking for a fit: the shortcut, the View menu, the canvas.
    for (const fit of [
      () => page.keyboard.press('0'),
      () => menuCommand(page, 'view.fit'),
      () => page.locator('#ccFit').click(),
      () => page.locator('#ccZoom').click(),
    ]) {
      await page.locator('#ccZoomOut').click(); // move off the fitted view
      await fit();
      await expectContentVisible(page, true);
    }
    const leftWithPalette = await expectContentVisible(page, true);

    // With the minimap card open above the zoom control (it starts
    // closed), a fit keeps clear of both.
    await page.locator('#minimap-toggle').click();
    await expect(page.locator('#minimap')).toBeVisible();
    await page.keyboard.press('0');
    await expectContentVisible(page, true);
    await page.locator('#minimap-toggle').click();

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
