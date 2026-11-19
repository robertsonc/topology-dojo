/**
 * The properties panel's layout at a laptop size: the default view of each
 * state fits without scrolling, nothing inside the panel scrolls on its own,
 * and no text in it is under 12px. At the minimum width the tab labels still
 * read in full and nothing runs off the panel's side.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  bootEditor,
  clickLink,
  clickNode,
  inspectorTab,
  nodeBox,
  openFixture,
} from './helpers.js';

test.use({ viewport: { width: 1440, height: 900 } });

/** The panel's content height and its own height. */
async function fit(page: Page): Promise<{ content: number; box: number }> {
  return page
    .locator('#inspector')
    .evaluate((el) => ({ content: el.scrollHeight, box: el.clientHeight }));
}

async function expectFits(page: Page, state: string): Promise<void> {
  const { content, box } = await fit(page);
  expect(content, `${state}: content ${content}px in ${box}px`).toBeLessThan(
    box + 1,
  );
}

async function selectTwoNodes(page: Page): Promise<void> {
  await clickNode(page, 'fw');
  const second = await nodeBox(page, 'ec');
  await page.keyboard.down('Shift');
  await page.mouse.click(
    second.x + second.width / 2,
    second.y + second.height / 2,
  );
  await page.keyboard.up('Shift');
  await expect(page.locator('#insp-tab-selection')).toHaveText('2 nodes');
}

test.beforeEach(async ({ page }) => {
  await bootEditor(page);
});

test('nothing selected: the Page tab fits without scrolling', async ({
  page,
}) => {
  await expect(page.locator('#insp-tab-page')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expectFits(page, 'Page tab');
});

test('nothing selected: the Document tab fits without scrolling', async ({
  page,
}) => {
  await inspectorTab(page, 'document');
  await expectFits(page, 'Document tab');
});

test('one node fits without scrolling', async ({ page }) => {
  await clickNode(page, 'fw');
  await expect(page.locator('#insp-tab-selection')).toHaveText('Node');
  await expectFits(page, 'one node');
});

test('one node with type options fits on a page with the anchor box on', async ({
  page,
}) => {
  // The longest default view of a node: its type has an options section and
  // the attachment line, read from a page with the anchor box on, runs to
  // two lines.
  await inspectorTab(page, 'page');
  await page.locator('#p-attach').click();
  await expect(page.locator('#p-attach')).toBeChecked();
  for (const id of ['ec', 'user']) {
    await clickNode(page, id);
    await expect(page.locator('#insp-tab-selection')).toHaveText('Node');
    await expect(
      page.locator('#inspector details[data-group$=" options"]'),
    ).toHaveCount(1);
    await expectFits(page, `node ${id}, anchor box on`);
    await page.keyboard.press('Escape');
  }
});

test('a node with its own link attachment fits without scrolling', async ({
  page,
}) => {
  // The override adds the node's padding and ends under its switch; with a
  // type options section too (ec, user) this is a node's longest default
  // view.
  for (const id of ['fw', 'ec', 'user']) {
    await clickNode(page, id);
    const override = page.locator('#inspector input[data-key="linkAttach"]');
    await override.check();
    await expect(
      page.locator('#inspector input[data-key="linkAttach.pad"]'),
    ).toBeVisible();
    await expect(
      page.locator('#inspector input[data-key="linkAttach.distribute"]'),
    ).toBeVisible();
    await expectFits(page, `node ${id}, its own link attachment`);
    await page.keyboard.press('Escape');
  }
});

test('one link fits without scrolling', async ({ page }) => {
  await clickLink(page, 'ec-fw');
  await expect(page.locator('#insp-tab-selection')).toHaveText('Link');
  await expectFits(page, 'one link');
});

test('two nodes fit without scrolling', async ({ page }) => {
  await selectTwoNodes(page);
  await expectFits(page, 'two nodes');
});

/** Elements inside the panel that could show a scrollbar of their own. */
function nestedScrollers(page: Page): Promise<string[]> {
  return page.locator('#inspector').evaluate((panel) =>
    [...panel.querySelectorAll('*')]
      .filter((el) => {
        const s = getComputedStyle(el);
        return [s.overflowX, s.overflowY].some(
          (o) => o === 'auto' || o === 'scroll',
        );
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
  );
}

test('nothing inside the panel scrolls on its own, the emphasis list included', async ({
  page,
}) => {
  // The Page tab with the emphasis picker open, holding every element.
  await page.locator('#p-emph-choose').click();
  await expect(page.locator('#p-emph-picker')).toBeVisible();
  await expect(page.locator('#p-emph-picker .emph-row').first()).toBeVisible();
  expect(await nestedScrollers(page)).toEqual([]);
  // Ticking an element keeps the picker open, still without a scrollbar.
  await page.locator('#p-emph-picker .emph-cb').first().check();
  await expect(page.locator('#p-emph-picker')).toBeVisible();
  expect(await nestedScrollers(page)).toEqual([]);

  await inspectorTab(page, 'document');
  expect(await nestedScrollers(page)).toEqual([]);
  await clickNode(page, 'fw');
  expect(await nestedScrollers(page)).toEqual([]);
  await clickLink(page, 'ec-fw');
  expect(await nestedScrollers(page)).toEqual([]);
});

/**
 * Text in the panel (the Problems dock included) set under 12px, with every
 * section and annotation editor opened first so that all of it is drawn.
 */
async function smallText(page: Page): Promise<string[]> {
  await page.locator('#inspector').evaluate((panel) => {
    for (const d of panel.querySelectorAll('details')) d.open = true;
  });
  return page.locator('#inspector-wrap').evaluate((wrap) =>
    [...wrap.querySelectorAll<HTMLElement>('*')]
      .filter((el) => {
        if (!el.checkVisibility()) return false;
        const text = [...el.childNodes].some(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim(),
        );
        const field = el.matches('input, select, textarea, option');
        return text || field;
      })
      .map((el) => [el, parseFloat(getComputedStyle(el).fontSize)] as const)
      .filter(([, size]) => size < 12)
      .map(
        ([el, size]) =>
          `${el.tagName.toLowerCase()}.${el.className} "${(el.textContent ?? '').trim().slice(0, 24)}": ${size}px`,
      ),
  );
}

test('no text in the panel is under 12px', async ({ page }) => {
  // The Page tab, with the annotations list and its editors.
  expect(await smallText(page), 'Page tab').toEqual([]);
  await page.locator('#p-emph-choose').click();
  expect(await smallText(page), 'Page tab, emphasis').toEqual([]);
  await inspectorTab(page, 'document');
  expect(await smallText(page), 'Document tab').toEqual([]);
  await clickNode(page, 'fw');
  expect(await smallText(page), 'a node').toEqual([]);
  await page.locator('#inspector [data-colour-open]').first().click();
  await expect(page.locator('#inspector .colour-pop:visible')).toHaveCount(1);
  expect(await smallText(page), 'a node, colour popover').toEqual([]);
  await page.keyboard.press('Escape');
  await clickLink(page, 'ec-fw');
  expect(await smallText(page), 'a link').toEqual([]);
  // The Problems dock, open.
  await page.locator('#problems-toggle').click();
  expect(await smallText(page), 'Problems dock').toEqual([]);
});

/* ── At the narrowest width ──────────────────────────────────────────────── */

/** The tab labels cut short, as "label clientWidth/scrollWidth". */
function clippedTabs(page: Page): Promise<string[]> {
  return page
    .locator('#inspector-wrap .insp-tabs [role="tab"]')
    .evaluateAll((tabs) =>
      tabs
        .filter((t) => t.scrollWidth > t.clientWidth)
        .map((t) => `${t.textContent} ${t.clientWidth}/${t.scrollWidth}`),
    );
}

async function expectNoSideScroll(page: Page, state: string): Promise<void> {
  const { wide, box } = await page
    .locator('#inspector')
    .evaluate((el) => ({ wide: el.scrollWidth, box: el.clientWidth }));
  expect(wide, `${state}: content ${wide}px wide in ${box}px`).toBeLessThan(
    box + 1,
  );
}

test('at the minimum width the tabs read in full and nothing runs off the side', async ({
  page,
}) => {
  await page.evaluate(() => localStorage.setItem('tds-inspector-width', '240'));
  await page.reload();
  await expect(page.locator('#page-canvas')).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('#inspector')
        .evaluate((el) => (el as HTMLElement).offsetWidth),
    )
    .toBe(240);
  // The toggle keeps its word as its name, and its tooltip.
  await expect(page.locator('#inspector-toggle')).toHaveText('hide');
  await expect(page.locator('#inspector-toggle')).toHaveAttribute(
    'title',
    'Hide properties (P)',
  );

  expect(await clippedTabs(page), 'Page tab').toEqual([]);
  await expectNoSideScroll(page, 'Page tab');
  await inspectorTab(page, 'document');
  expect(await clippedTabs(page), 'Document tab').toEqual([]);
  await expectNoSideScroll(page, 'Document tab');
  await clickNode(page, 'fw');
  expect(await clippedTabs(page), 'one node').toEqual([]);
  await expectNoSideScroll(page, 'one node');
  await clickLink(page, 'ec-fw');
  await expectNoSideScroll(page, 'one link');
  await page.keyboard.press('Escape');
  await selectTwoNodes(page);
  expect(await clippedTabs(page), 'two nodes').toEqual([]);
  await expectNoSideScroll(page, 'two nodes');

  // A zone, with its member chips and their "add…" picker.
  await openFixture(page, 'zone-orthogonal.json');
  const z = await page.evaluate(() => {
    const svg = document.querySelector('#overlay') as SVGSVGElement;
    const p = new DOMPoint(400, 280).matrixTransform(svg.getScreenCTM()!);
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(z.x, z.y);
  await expect(page.locator('#insp-tab-selection')).toHaveText('Zone');
  await expect(page.locator('#inspector .refadd')).toBeVisible();
  expect(await clippedTabs(page), 'a zone').toEqual([]);
  await expectNoSideScroll(page, 'a zone');
});

test('a section header’s focus ring is drawn inside the panel’s scroll box', async ({
  page,
}) => {
  await bootEditor(page);
  const summary = page.locator(
    '#inspector > details.insp-group[data-group="Page"] > summary',
  );
  // From the tab row with the keyboard, so the ring shows.
  await page.locator('#insp-tab-page').focus();
  while (!(await summary.evaluate((el) => el === document.activeElement)))
    await page.keyboard.press('Tab');
  const ring = await summary.evaluate((el) => {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const panel = el.closest('#inspector')!.getBoundingClientRect();
    const out = parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth);
    return {
      style: cs.outlineStyle,
      left: box.left - Math.max(0, out),
      panelLeft: panel.left,
    };
  });
  expect(ring.style).not.toBe('none');
  expect(ring.left).toBeGreaterThanOrEqual(ring.panelLeft);
});

// A phone's properties drawer is narrow: a number keeps every digit (the
// canvas width read "105" for 1050). On a phone the spin buttons step aside;
// where they show, they take 15px of the field.
for (const width of [320, 390]) {
  test(`on a phone the canvas size fields show every digit at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await bootEditor(page);
    await page.locator('#inspector-toggle').click();
    await inspectorTab(page, 'page');
    for (const id of ['#p-w', '#p-h']) {
      const field = page.locator(id);
      await field.hover();
      await field.focus();
      const room = await field.evaluate((el) => {
        const input = el as HTMLInputElement;
        const cs = getComputedStyle(input);
        const probe = document.createElement('span');
        probe.style.font = cs.font;
        probe.style.position = 'absolute';
        probe.style.whiteSpace = 'pre';
        probe.textContent = input.value;
        document.body.append(probe);
        const text = probe.getBoundingClientRect().width;
        probe.remove();
        const spin = cs.appearance === 'textfield' ? 0 : 15;
        const inner =
          input.clientWidth -
          parseFloat(cs.paddingLeft) -
          parseFloat(cs.paddingRight) -
          spin;
        return { value: input.value, text, inner };
      });
      expect(room.value.length).toBeGreaterThan(0);
      expect(room.text, `${id} "${room.value}"`).toBeLessThanOrEqual(
        room.inner,
      );
    }
  });
}
