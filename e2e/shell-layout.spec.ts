/**
 * The canvas and the chrome around it: the canvas is exactly as big as its
 * stage, the rail's tools and the zoom control floating in the canvas's
 * corner are on screen and reachable, and a fit leaves the content clear of
 * the panels around it.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  bootEditor,
  inspectorTab,
  menuCommand,
  statusCount,
} from './helpers.js';

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
    // Its accessible name holds the figure it shows (label in name).
    const shown = await page.locator('#ccZoom').innerText();
    await expect(page.locator('#ccZoom')).toHaveAccessibleName(
      `Zoom ${shown} — fit view`,
    );
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

// The pages bar in a canvas column of every size: 720px is a 1,440px window
// at 200% zoom (both panels are drawers there, closed), 1,024px the
// narrowest desktop (both docked), 390px a phone. Its page controls are on screen, nothing in it is drawn
// over, and the canvas options keep the right end.
for (const viewport of [
  { width: 720, height: 450 },
  { width: 1024, height: 900 },
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}×${viewport.height}`;
  test(`the pages bar keeps its controls on screen at ${size}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await bootEditor(page);
    // Enough pages that the chips must scroll.
    for (let i = 0; i < 12; i++) await page.locator('#addPage').click();
    await expect(page.locator('#frames-ind')).toHaveText('13/13');

    const b = await boxes(page, {
      bar: '#pagesBar',
      dock: '#frames-dock',
      toggle: '#frames-toggle',
      strip: '#filmstrip',
      play: '#playFlip',
      add: '#addPage',
      opts: '.view-opts',
      minimap: '#minimap-toggle',
    });
    // Play and Add page sit either side of the chips, not in their scroller:
    // with the chips scrolled to the last page, both are still in view.
    for (const name of ['toggle', 'play', 'add'] as const) {
      expectInside(b[name]!, b.dock!);
      expect(overlaps(b[name]!, b.strip!), name).toBe(false);
    }
    expect(b.play!.right).toBeLessThanOrEqual(b.strip!.left + 0.5);
    expect(b.add!.left).toBeGreaterThanOrEqual(b.strip!.right - 0.5);
    // The canvas options are inside the bar and clear of the pages.
    expectInside(b.opts!, b.bar!);
    expectInside(b.minimap!, b.viewport!);
    expect(overlaps(b.opts!, b.dock!)).toBe(false);
    const dock = await page
      .locator('#frames-dock')
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(dock).toBeLessThanOrEqual(0);
  });
}

test('on a phone the status bar keeps the problems indicator on screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootEditor(page);
  const problems = page.locator('#sb-problems');
  await expect(problems).toBeVisible();
  const box = (await problems.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  // Nothing in the bar is cut off: what does not fit has stepped aside.
  const bar = await page
    .locator('#statusbar')
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(bar).toBeLessThanOrEqual(0);
  await expect(
    page.locator('#statusbar span', { hasText: 'nodes' }).first(),
  ).toBeVisible();
});

test('with the properties panel closed the canvas column runs to the window edge', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootEditor(page);
  await page.locator('#inspector-toggle').click();
  await expect(page.locator('#inspector-wrap')).toHaveClass(/collapsed/);
  const b = await boxes(page, {
    bar: '#pagesBar',
    area: '#canvas-area',
    toggle: '#inspector-toggle',
  });
  // No empty column is left where the panel was: the canvas and the pages
  // bar under it reach the right edge of the window.
  expect(b.bar!.right).toBeGreaterThanOrEqual(b.viewport!.right - 0.5);
  expect(b.area!.right).toBeGreaterThanOrEqual(b.viewport!.right - 0.5);
  // The toggle floats over the canvas's top-right corner, on one line, and
  // a click there reaches it.
  expectInside(b.toggle!, b.area!);
  expect(b.toggle!.bottom - b.toggle!.top).toBeLessThan(28);
  expect(await hits(page, ['inspector-toggle'])).toEqual(['inspector-toggle']);
  await page.locator('#inspector-toggle').click();
  await expect(page.locator('#inspector-wrap')).not.toHaveClass(/collapsed/);
});

test('on a phone the open library ends above the pages bar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootEditor(page);
  await page.locator('#palette-toggle').click();
  await expect(page.locator('#palette')).not.toHaveClass(/collapsed/);
  const b = await boxes(page, { palette: '#palette', bar: '#pagesBar' });
  // The bar takes two rows here; the drawer stops at its top, so the page
  // toggle under it can still be reached.
  expect(b.palette!.bottom).toBeLessThanOrEqual(b.bar!.top + 0.5);
  // A click in the middle of the toggle reaches it (or its count inside).
  const reached = await page.evaluate(() => {
    const r = document.getElementById('frames-toggle')!.getBoundingClientRect();
    const el = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return !!el?.closest('#frames-toggle');
  });
  expect(reached).toBe(true);
});

test('on a phone the document title keeps room to be read', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootEditor(page);
  // Present steps aside (it is in File and on its key) so the title is more
  // than a letter wide.
  await expect(page.locator('#tPresent')).toBeHidden();
  const title = (await page.locator('#docTitle').boundingBox())!;
  expect(title.width).toBeGreaterThanOrEqual(60);
});

test('the status bar draws the focus ring of its button whole', async ({
  page,
}) => {
  await bootEditor(page);
  // Tab onto the problems indicator, so its ring shows.
  await page.locator('#sb-problems').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator('#sb-problems')).toBeFocused();
  const fits = await page.evaluate(() => {
    const b = document.querySelector('#sb-problems')!;
    const bar = document.querySelector('#statusbar')!;
    const cs = getComputedStyle(b);
    const reach =
      parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset || '0');
    const r = b.getBoundingClientRect();
    const box = bar.getBoundingClientRect();
    // The bar clips at its padding box: inside its top border.
    const top = box.top + parseFloat(getComputedStyle(bar).borderTopWidth);
    return {
      above: r.top - reach - top,
      below: box.bottom - (r.bottom + reach),
    };
  });
  expect(fits.above).toBeGreaterThanOrEqual(0);
  expect(fits.below).toBeGreaterThanOrEqual(0);
});

// The compact layout: below 1,024px the node library and the properties
// panel are drawers over the canvas, so the canvas column always runs from
// the rail to the window's edge (a half-screen window, a zoomed laptop, a
// tablet). From 1,024px up both dock.
const RAIL_W = 44;
/** Is the panel closed? */
const closed = (page: Page, id: string): Promise<boolean> =>
  page.locator(`#${id}`).evaluate((el) => el.classList.contains('collapsed'));

for (const width of [1023, 900, 768, 720, 641]) {
  test(`below 1,024px the panels are drawers over the canvas at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await bootEditor(page);
    const sel = {
      col: '.canvas-col',
      area: '#canvas-area',
      bar: '#pagesBar',
      status: '#statusbar',
      palette: '#palette',
      inspector: '#inspector-wrap',
    };

    // With nothing stored both drawers start closed, and the canvas column
    // is the window less the rail.
    expect(await closed(page, 'palette')).toBe(true);
    expect(await closed(page, 'inspector-wrap')).toBe(true);
    await expect(page.locator('#palette-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    const start = await boxes(page, sel);
    expect(start.col!.right - start.col!.left).toBe(width - RAIL_W);
    const scene = await nodeBoxes(page);

    /** Open one drawer and check where it lies; the canvas never moves. */
    const expectDrawer = async (name: 'palette' | 'inspector') => {
      const b = await boxes(page, sel);
      expect(b.col).toEqual(start.col);
      expect(b.area).toEqual(start.area);
      expect(await nodeBoxes(page)).toEqual(scene);
      const drawer = b[name]!;
      expectInside(drawer, b.viewport!);
      expectInside(drawer, b.area!);
      expect(overlaps(drawer, b.bar!)).toBe(false);
      expect(overlaps(drawer, b.status!)).toBe(false);
      return b;
    };

    await page.locator('#palette-toggle').click();
    await expect(page.locator('#palette-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    let b = await expectDrawer('palette');
    expect(b.area!.right - b.palette!.right).toBeGreaterThanOrEqual(72);

    // Both open together: canvas still shows between them.
    await page.locator('#inspector-toggle').click();
    expect(await closed(page, 'inspector-wrap')).toBe(false);
    b = await expectDrawer('inspector');
    expect(b.inspector!.left - b.palette!.right).toBeGreaterThanOrEqual(72);

    // The properties drawer alone, as wide as the docked panel.
    await page.locator('#palette-toggle').click();
    expect(await closed(page, 'palette')).toBe(true);
    b = await expectDrawer('inspector');
    expect(b.inspector!.right - b.inspector!.left).toBe(324);
    expect(b.inspector!.left - b.area!.left).toBeGreaterThanOrEqual(72);

    // However wide the panel is asked to be, 72px of canvas still shows.
    await page.locator('#inspector').evaluate((el) => {
      el.style.width = '600px';
    });
    b = await expectDrawer('inspector');
    expect(b.inspector!.left - b.area!.left).toBeGreaterThanOrEqual(72);
    await page.locator('#inspector').evaluate((el) => {
      el.style.width = '';
    });

    // Closing it gives the canvas back as it was.
    await page.locator('#inspector-toggle').click();
    expect(await closed(page, 'inspector-wrap')).toBe(true);
    expect((await boxes(page, sel)).col).toEqual(start.col);

    // A stored choice to keep them open wins on load.
    await page.evaluate(() => {
      localStorage.setItem('tds-palette-collapsed', '0');
      localStorage.setItem('tds-inspector-collapsed', '0');
    });
    await page.reload();
    await expect(page.locator('#page-canvas')).toBeVisible();
    expect(await closed(page, 'palette')).toBe(false);
    expect(await closed(page, 'inspector-wrap')).toBe(false);
    b = await boxes(page, sel);
    expect(b.col!.right - b.col!.left).toBe(width - RAIL_W);
  });
}

test('from 1,024px up both panels dock beside the canvas, open', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await bootEditor(page);
  expect(await closed(page, 'palette')).toBe(false);
  expect(await closed(page, 'inspector-wrap')).toBe(false);
  const b = await boxes(page, {
    col: '.canvas-col',
    palette: '#palette',
    inspector: '#inspector-wrap',
  });
  const library = b.palette!.right - b.palette!.left;
  const panel = b.inspector!.right - b.inspector!.left;
  expect(library).toBe(208);
  expect(panel).toBe(324);
  // Docked: the canvas column is what the panels leave, between them.
  expect(b.col!.right - b.col!.left).toBe(1024 - RAIL_W - library - panel);
  expect(b.col!.left).toBe(b.palette!.right);
  expect(b.col!.right).toBe(b.inspector!.left);
});

test('fit view keeps the content clear of an open drawer', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await bootEditor(page);
  await page.locator('#inspector-toggle').click();
  await page.keyboard.press('0');
  let drawer = (await boxes(page, { d: '#inspector-wrap' })).d!;
  for (const n of await nodeBoxes(page))
    expect(n.right).toBeLessThanOrEqual(drawer.left);
  await page.locator('#inspector-toggle').click();

  await page.locator('#palette-toggle').click();
  await page.locator('#ccFit').click();
  drawer = (await boxes(page, { d: '#palette' })).d!;
  for (const n of await nodeBoxes(page))
    expect(n.left).toBeGreaterThanOrEqual(drawer.right);
  await expectContentVisible(page, true);
});

/** Boot the editor on clean storage that holds only `stored`. */
async function bootStored(
  page: Page,
  stored: Record<string, string>,
): Promise<void> {
  await bootEditor(page);
  await page.evaluate((all) => {
    for (const [k, v] of Object.entries(all)) localStorage.setItem(k, v);
  }, stored);
  await page.reload();
  await expect(page.locator('#page-canvas')).toBeVisible();
}

/** The drawers' inner edges: the canvas they leave showing between them. */
async function band(page: Page): Promise<{ left: number; right: number }> {
  const b = await boxes(page, { lib: '#palette', props: '#inspector-wrap' });
  return { left: b.lib!.right, right: b.props!.left };
}

for (const width of [641, 720]) {
  test(`fit view keeps the content between both open drawers at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await bootStored(page, {
      'tds-palette-collapsed': '0',
      'tds-inspector-collapsed': '0',
    });
    expect(await closed(page, 'palette')).toBe(false);
    expect(await closed(page, 'inspector-wrap')).toBe(false);
    await page.keyboard.press('0');
    const strip = await band(page);
    const nodes = await nodeBoxes(page);
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(n.left).toBeGreaterThanOrEqual(strip.left);
      expect(n.right).toBeLessThanOrEqual(strip.right);
    }
    // The zoom control's fit button is in reach beside the drawer.
    expect(await hits(page, ['ccFit'])).toEqual(['ccFit']);
  });
}

test('the zoom control and the minimap move left of an open properties drawer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await bootEditor(page);
  await page.locator('#minimap-toggle').click();
  await page.locator('#inspector-toggle').click();
  const b = await boxes(page, {
    props: '#inspector-wrap',
    ctrls: '#canvasCtrls',
    map: '#minimap-dock',
  });
  expect(b.ctrls!.right).toBeLessThanOrEqual(b.props!.left);
  expect(b.map!.right).toBeLessThanOrEqual(b.props!.left);
  expect(await hits(page, [...CONTROL_IDS, 'minimap'])).toEqual([
    ...CONTROL_IDS,
    'minimap',
  ]);
  // Closed, the drawer gives the corner back.
  await page.locator('#inspector-toggle').click();
  const area = (await boxes(page, { area: '#canvas-area' })).area!;
  const ctrls = (await boxes(page, { c: '#canvasCtrls' })).c!;
  expect(area.right - ctrls.right).toBe(10);
});

test('the selection bar keeps to the canvas between open drawers', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 800 });
  await bootStored(page, {
    'tds-palette-collapsed': '0',
    'tds-inspector-collapsed': '0',
  });
  await page.keyboard.press('0');
  // The rightmost node, beside the properties drawer.
  const node = (await nodeBoxes(page)).sort((a, c) => c.right - a.right)[0]!;
  await page.mouse.click(
    (node.left + node.right) / 2,
    (node.top + node.bottom) / 2,
  );
  const bar = page.locator('.mini-bar');
  await expect(bar).toBeVisible();
  const strip = await band(page);
  const box = (await boxes(page, { bar: '.mini-bar' })).bar!;
  expect(box.left).toBeGreaterThanOrEqual(strip.left);
  expect(box.right).toBeLessThanOrEqual(strip.right);
});

test('a press on the resize grip of a narrowed drawer keeps the stored width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 641, height: 800 });
  await bootStored(page, {
    'tds-palette-collapsed': '0',
    'tds-inspector-collapsed': '0',
    'tds-inspector-width': '480',
  });
  const widths = () =>
    page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('#inspector')!;
      return {
        drawn: panel.offsetWidth,
        asked: panel.style.width,
        stored: localStorage.getItem('tds-inspector-width'),
      };
    });
  // With the library open the drawer leaves 72px of canvas: the panel is
  // drawn narrower than the 480px chosen.
  const start = await widths();
  expect(start.drawn).toBeLessThan(480);
  const grip = (await page.locator('#inspector-resizer').boundingBox())!;
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.click(x, y);
  expect((await widths()).stored).toBe('480');

  // A drag held at the drawer's limit moves nothing, and stores nothing.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 4 });
  await page.mouse.up();
  expect(await widths()).toEqual(start);

  // Docked again, the panel is as wide as chosen.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await expect(page.locator('#page-canvas')).toBeVisible();
  expect((await widths()).drawn).toBe(480);

  // A drag that narrows the drawer stores what it draws.
  await page.setViewportSize({ width: 641, height: 800 });
  const g = (await page.locator('#inspector-resizer').boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 30, g.y + g.height / 2, {
    steps: 4,
  });
  await page.mouse.up();
  const after = await widths();
  expect(after.drawn).toBe(start.drawn - 30);
  expect(after.asked).toBe(`${after.drawn}px`);
  expect(after.stored).toBe(String(after.drawn));
});

test('crossing 1,024px keeps the selection, the tab and the sections', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await bootEditor(page);
  // A node selected, the Document tab showing, one of its sections toggled.
  const host = (await page.locator('.canvas-host').boundingBox())!;
  await page.mouse.click(host.x + 8, host.y + 8);
  const node = (await nodeBoxes(page))[0]!;
  await page.mouse.click(
    (node.left + node.right) / 2,
    (node.top + node.bottom) / 2,
  );
  expect(await statusCount(page, 'selected')).toBe(1);
  await inspectorTab(page, 'document');
  const groups = page.locator('#inspector > details.insp-group');
  await groups.last().locator('> summary').click();
  const sections = (): Promise<[string, boolean][]> =>
    groups.evaluateAll((ds) =>
      ds.map((d) => [
        (d as HTMLElement).dataset.group!,
        (d as HTMLDetailsElement).open,
      ]),
    );
  const before = await sections();
  const expectKept = async () => {
    expect(await statusCount(page, 'selected')).toBe(1);
    await expect(page.locator('#insp-tab-document')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await sections()).toEqual(before);
  };

  // Nothing stored: the panel closes as a drawer and opens again docked.
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator('#inspector-wrap')).toHaveClass(/collapsed/);
  await expectKept();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#inspector-wrap')).not.toHaveClass(/collapsed/);
  await expectKept();

  // A field being typed in is not closed under the person typing.
  const field = page.locator('#p-title');
  await field.fill('Data centre');
  await field.focus();
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator('#inspector-wrap')).not.toHaveClass(/collapsed/);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Data centre');
  await page.setViewportSize({ width: 1280, height: 800 });
  await field.blur();

  // A panel that closes while a button in it has the focus hands the focus
  // to its toggle, not to the page.
  await page.locator('#insp-tab-document').focus();
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator('#inspector-wrap')).toHaveClass(/collapsed/);
  await expect(page.locator('#inspector-toggle')).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#inspector-wrap')).not.toHaveClass(/collapsed/);

  // Kept open by choice, it stays open across the breakpoint, both ways.
  await page.locator('#inspector-toggle').click();
  await page.locator('#inspector-toggle').click();
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator('#inspector-wrap')).not.toHaveClass(/collapsed/);
  await expectKept();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#inspector-wrap')).not.toHaveClass(/collapsed/);
  await expectKept();
});

test('crossing 1,024px while a colour is typed keeps the panel open', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await bootEditor(page);
  const node = (await nodeBoxes(page))[0]!;
  await page.mouse.click(
    (node.left + node.right) / 2,
    (node.top + node.bottom) / 2,
  );
  await inspectorTab(page, 'selection');
  const colour = page.locator('#inspector .colour-btn').first();
  await colour.click();
  const hex = page.locator('#inspector .colour-pop:visible input.hex');
  await hex.fill('#12ab');
  await hex.focus();
  // The popover closes on any resize and gives the focus back to its
  // button; the panel it was typed in stays open, with the focus in it.
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator('#inspector-wrap')).not.toHaveClass(/collapsed/);
  await expect(colour).toBeFocused();
});
