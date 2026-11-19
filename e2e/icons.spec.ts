/**
 * Chrome icons come from one inline SVG sprite: every icon is a `<use>` of a
 * symbol that exists and draws, takes the colour of the control it sits in,
 * and leaves the control's accessible name where it was.
 */
import { expect, test, type Page } from '@playwright/test';
import { bootEditor, clickNode } from './helpers.js';

/** What is wrong with the icons on the page right now (empty = nothing). */
async function iconProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const sprite = document.querySelector('#ui-icon-sprite');
    const where = (el: Element): string => {
      const host = el.closest('button, [id]') ?? el.parentElement!;
      return (
        (host.id && `#${host.id}`) ||
        host.getAttribute('aria-label') ||
        host.getAttribute('title') ||
        host.className
      );
    };
    for (const svg of document.querySelectorAll<SVGSVGElement>('svg.icon')) {
      const use = svg.querySelector('use');
      const id = use?.getAttribute('href')?.slice(1) ?? '';
      const symbol = id ? document.getElementById(id) : null;
      if (symbol?.tagName !== 'symbol' || !sprite?.contains(symbol)) {
        problems.push(`${where(svg)}: no symbol "${id}" in the sprite`);
        continue;
      }
      if (svg.getAttribute('aria-hidden') !== 'true')
        problems.push(`${where(svg)}: the icon is not aria-hidden`);
      // Shown icons draw something, at the icon's own size.
      const box = svg.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue; // in a hidden panel
      const drawn = (use as SVGGraphicsElement).getBBox();
      if (drawn.width <= 0 || drawn.height <= 0)
        problems.push(`${where(svg)}: "${id}" draws nothing`);
      const size = Number(svg.getAttribute('width'));
      if (
        Math.abs(box.width - size) > 0.01 ||
        Math.abs(box.height - size) > 0.01
      )
        problems.push(`${where(svg)}: ${box.width}x${box.height}, not ${size}`);
      // Drawn by stroke, in the colour of the control it sits in.
      const style = getComputedStyle(svg);
      if (style.fill !== 'none' || style.stroke !== style.color)
        problems.push(`${where(svg)}: not stroked in the text colour`);
      const button = svg.closest('button');
      if (button && style.color !== getComputedStyle(button).color)
        problems.push(`${where(svg)}: not the colour of its button`);
      // A button whose whole label is the icon is named by its attributes.
      if (
        button &&
        !button.textContent?.trim() &&
        !button.getAttribute('aria-label')?.trim()
      )
        problems.push(`${where(svg)}: an icon-only button with no aria-label`);
    }
    return problems;
  });
}

test('every chrome icon is a symbol of the one sprite', async ({ page }) => {
  await bootEditor(page);

  // One sprite, in the render tree (never display:none), taking no room.
  const sprite = page.locator('#ui-icon-sprite');
  await expect(sprite).toHaveCount(1);
  expect(
    await sprite.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return {
        display: getComputedStyle(el).display === 'none',
        hidden: el.getAttribute('aria-hidden'),
        size: [box.width, box.height],
        // Symbol ids are unique in the whole document.
        duplicates: [...el.querySelectorAll('symbol')]
          .map((s) => s.id)
          .filter((id) => document.querySelectorAll(`[id="${id}"]`).length > 1),
      };
    }),
  ).toEqual({ display: false, hidden: 'true', size: [0, 0], duplicates: [] });
  expect(
    await sprite.locator('symbol').count(),
    'the sprite has its symbols',
  ).toBeGreaterThan(50);

  // The shell as it boots: toolbar, canvas controls, panel toggles, frames,
  // the page inspector and the status bar.
  expect(await page.locator('svg.icon').count()).toBeGreaterThan(40);
  expect(await iconProblems(page)).toEqual([]);

  // A selected node: the mini style bar, arrange and format rows, metadata.
  await clickNode(page, 'fw');
  await expect(page.locator('#mbEmph .icon')).toBeVisible();
  await expect(page.locator('.arrange .icon')).toHaveCount(4);
  expect(await iconProblems(page)).toEqual([]);

  // Dialogs and the light theme draw from the same sprite.
  await page.locator('#tHelp').click();
  await expect(page.locator('#helpClose .icon')).toBeVisible();
  expect(await iconProblems(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await page.locator('#tTheme').click();
  await expect(page.locator('html')).toHaveClass(/light/);
  expect(await iconProblems(page)).toEqual([]);
});

test('an icon swap keeps the words and the accessible name', async ({
  page,
}) => {
  await bootEditor(page);
  const iconOf = (selector: string): Promise<string | null> =>
    page.locator(`${selector} .icon use`).first().getAttribute('href');

  // The theme button shows what a click switches to; its name stays put.
  const theme = page.locator('#tTheme');
  await expect(theme).toHaveAttribute(
    'aria-label',
    'Toggle light / dark theme',
  );
  expect(await iconOf('#tTheme')).toBe('#i-sun');
  await theme.click();
  expect(await iconOf('#tTheme')).toBe('#i-moon');
  await expect(theme).toHaveText('');
  await expect(theme).toHaveAttribute('title', 'Switch to dark theme');
  await expect(theme).toHaveAttribute(
    'aria-label',
    'Toggle light / dark theme',
  );

  // Panel toggles keep their word and change the icon beside it.
  const palette = page.locator('#palette-toggle');
  await expect(palette).toHaveText('nodes');
  expect(await iconOf('#palette-toggle')).toBe('#i-panel-left-close');
  await palette.click();
  await expect(palette).toHaveText('nodes');
  expect(await iconOf('#palette-toggle')).toBe('#i-panel-left-open');
  await palette.click();

  const inspector = page.locator('#inspector-toggle');
  await expect(inspector).toHaveText('hide');
  expect(await iconOf('#inspector-toggle')).toBe('#i-panel-right-close');
  await inspector.click();
  await expect(inspector).toHaveText('props');
  expect(await iconOf('#inspector-toggle')).toBe('#i-panel-right-open');
  await inspector.click();

  const minimap = page.locator('#minimap-toggle');
  await expect(minimap).toHaveText('map');
  expect(await iconOf('#minimap-toggle')).toBe('#i-chevron-down');
  await minimap.click();
  expect(await iconOf('#minimap-toggle')).toBe('#i-chevron-right');

  // The frames pill and the Problems header carry a caret of their own.
  const frames = page.locator('#frames-toggle');
  expect(await iconOf('#frames-toggle')).toBe('#i-chevron-left');
  await frames.click();
  await expect(frames).toHaveAttribute('aria-expanded', 'false');
  expect(await iconOf('#frames-toggle')).toBe('#i-chevron-right');
  await expect(frames).toContainText('1/1');
  expect(await iconOf('#problems-toggle')).toBe('#i-chevron-right');
  await page.locator('#problems-toggle').click();
  expect(await iconOf('#problems-toggle')).toBe('#i-chevron-down');

  // Menus cannot hold an icon: their placeholders are the words alone.
  for (const [menu, words] of [
    ['#fExport', 'export…'],
    ['#tLayout', 'arrange…'],
    ['#tSelectBy', 'select…'],
    ['#fTemplate', 'template…'],
  ] as const)
    await expect(page.locator(`${menu} option[value=""]`)).toHaveText(words);
});
