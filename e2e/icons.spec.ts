/**
 * Chrome icons come from one inline SVG sprite: every icon is a `<use>` of a
 * symbol that exists and draws at its own size, takes the colour of the text
 * it sits in, and leaves the control's accessible name where it was.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  bootEditor,
  clickLink,
  clickNode,
  inspectorSection,
  inspectorTab,
  nodeBox,
} from './helpers.js';

/**
 * What is wrong with the icons and labels on the page right now (empty =
 * nothing). Only what is in the render tree is measured: an icon in a hidden
 * panel has no box to check, and one that is merely collapsed to nothing is
 * a problem, not a hidden icon.
 */
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
      const use = svg.querySelector<SVGUseElement>('use');
      const id = use?.getAttribute('href')?.slice(1) ?? '';
      const symbol = id ? document.getElementById(id) : null;
      if (!use || symbol?.tagName !== 'symbol' || !sprite?.contains(symbol)) {
        problems.push(`${where(svg)}: no symbol "${id}" in the sprite`);
        continue;
      }
      if (svg.getAttribute('aria-hidden') !== 'true')
        problems.push(`${where(svg)}: the icon is not aria-hidden`);
      // Hidden means out of the render tree (display: none on it or above
      // it), never "has an empty box": that is an icon that failed to draw.
      if (!svg.checkVisibility()) continue;

      // It draws something, at the icon's own size.
      const box = svg.getBoundingClientRect();
      const drawn = use.getBBox();
      if (drawn.width <= 0 || drawn.height <= 0)
        problems.push(`${where(svg)}: "${id}" draws nothing`);
      const size = Number(svg.getAttribute('width'));
      if (
        Math.abs(box.width - size) > 0.01 ||
        Math.abs(box.height - size) > 0.01
      ) {
        problems.push(`${where(svg)}: ${box.width}x${box.height}, not ${size}`);
        continue;
      }

      // Drawn by stroke in the colour of the text it sits in: no rule gives
      // an icon a colour of its own. One icon is filled as well, the mini
      // style bar's star while the selection is emphasized.
      const style = getComputedStyle(svg);
      const fill = svg.closest('.mb-btn.on') ? style.color : 'none';
      if (style.fill !== fill || style.stroke !== style.color)
        problems.push(`${where(svg)}: not stroked in the text colour`);
      if (style.color !== getComputedStyle(svg.parentElement!).color)
        problems.push(`${where(svg)}: not the colour of the text around it`);

      // No box that clips its overflow cuts the drawing. The ink is the
      // shapes plus half the 2-unit stroke. Past a box that scrolls, where
      // the icon stands along that axis is the scroll position's business;
      // and an icon wholly outside a clipping box is in a collapsed panel,
      // which is hidden, not cut.
      const ctm = use.getScreenCTM()!;
      const ink = {
        left: ctm.e + (drawn.x - 1) * ctm.a,
        right: ctm.e + (drawn.x + drawn.width + 1) * ctm.a,
        top: ctm.f + (drawn.y - 1) * ctm.d,
        bottom: ctm.f + (drawn.y + drawn.height + 1) * ctm.d,
      };
      const clips = (overflow: string): boolean =>
        overflow === 'hidden' || overflow === 'clip';
      const scrolls = (overflow: string): boolean =>
        overflow === 'auto' || overflow === 'scroll';
      let across = true;
      let down = true;
      for (
        let el = svg.parentElement;
        el && (across || down);
        el = el.parentElement
      ) {
        const { overflowX, overflowY } = getComputedStyle(el);
        const clip = el.getBoundingClientRect();
        const outside =
          ink.right <= clip.left ||
          ink.left >= clip.right ||
          ink.bottom <= clip.top ||
          ink.top >= clip.bottom;
        if (outside && (clips(overflowX) || clips(overflowY))) break;
        const cut =
          (across &&
            clips(overflowX) &&
            (ink.left < clip.left - 0.1 || ink.right > clip.right + 0.1)) ||
          (down &&
            clips(overflowY) &&
            (ink.top < clip.top - 0.1 || ink.bottom > clip.bottom + 0.1));
        if (cut) {
          const name = el.id ? `#${el.id}` : `.${el.className}`;
          problems.push(`${where(svg)}: "${id}" is cut by ${name}`);
          break;
        }
        if (scrolls(overflowX)) across = false;
        if (scrolls(overflowY)) down = false;
      }

      // A button whose whole label is the icon is named by its attributes.
      const button = svg.closest('button');
      if (
        button &&
        !button.textContent?.trim() &&
        !button.getAttribute('aria-label')?.trim()
      )
        problems.push(`${where(svg)}: an icon-only button with no aria-label`);
    }

    // No control is labelled with a character where an icon belongs: a label
    // has words, and no symbol beyond the typography the chrome writes. The
    // save chip keeps its text ("✓ saved") until the next phase redesigns it.
    // (An option has no box of its own; its menu stands for it.)
    const controls = 'button, summary, option, [role="button"]';
    for (const control of document.querySelectorAll<HTMLElement>(controls)) {
      const text = control.textContent?.trim() ?? '';
      if (!text || control.id === 'saved') continue;
      const box = control.closest('select') ?? control;
      if (!box.checkVisibility()) continue;
      const glyph = /[^\0-\x7f—–…·•×“”’←↑→↓]/u.exec(text)?.[0];
      if (glyph) problems.push(`${where(control)}: "${glyph}" in its label`);
      else if (!/[\p{L}\p{N}]/u.test(text))
        problems.push(`${where(control)}: its label is only "${text}"`);
    }
    return problems;
  });
}

/** How many icons are on screen: in the render tree, with a box. */
const shownIcons = (page: Page): Promise<number> =>
  page.locator('svg.icon:visible').count();

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
  // the page inspector and the status bar. The Page tab starts with its
  // annotations list closed (the list's eight icons drew at boot before the
  // panel had tabs), so the boot count is the shell's icons without them.
  expect(await shownIcons(page), 'icons on screen at boot').toBeGreaterThan(32);
  expect(await iconProblems(page)).toEqual([]);
  // With the annotations list opened, the screen holds as many as it did.
  await inspectorSection(page, 'Annotations');
  expect(
    await shownIcons(page),
    'icons on screen with the annotations list open',
  ).toBeGreaterThan(40);
  expect(await iconProblems(page)).toEqual([]);

  // A selected node: the mini style bar, arrange and format rows, metadata.
  await clickNode(page, 'fw');
  await expect(page.locator('#mbEmph .icon')).toBeVisible();
  await expect(page.locator('.arrange .icon')).toHaveCount(4);
  expect(await iconProblems(page)).toEqual([]);

  // Dialogs and the light theme draw from the same sprite: the shortcut
  // sheet, Display settings and the two template wizards.
  await page.locator('#tHelp').click();
  await expect(page.locator('#helpClose .icon')).toBeVisible();
  expect(await iconProblems(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await page.locator('#tDisplay').click();
  await expect(page.locator('.display-pop')).toBeVisible();
  expect(await iconProblems(page)).toEqual([]);
  await page.keyboard.press('Escape');
  for (const [template, card] of [
    ['spine-leaf', '.tpw-card'],
    ['__sdwan', '.sdw-card'],
  ] as const) {
    await page.selectOption('#fTemplate', template);
    await expect(
      page.locator(`${card} [data-act="close"] .icon`),
    ).toBeVisible();
    expect(await iconProblems(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator(card)).toBeHidden();
  }
  await page.locator('#tTheme').click();
  await expect(page.locator('html')).toHaveClass(/light/);
  expect(await iconProblems(page)).toEqual([]);
});

test('an icon that is on the page but not drawn is reported', async ({
  page,
}) => {
  // The checks above are only worth something if they can fail: collapse
  // the icons of the visible chrome to nothing, as a stylesheet slip would.
  await bootEditor(page);
  const shown = await shownIcons(page);
  await page.addStyleTag({
    content: 'header.bar .icon, #canvasCtrls .icon { width: 0; height: 0; }',
  });
  const collapsed = await page
    .locator('header.bar svg.icon, #canvasCtrls svg.icon')
    .evaluateAll(
      (icons) => icons.filter((icon) => icon.checkVisibility()).length,
    );
  expect(collapsed).toBeGreaterThan(20);
  expect(await shownIcons(page)).toBe(shown - collapsed);
  const problems = await iconProblems(page);
  expect(problems).toHaveLength(collapsed);
  expect(problems).toContain('#tUndo: 0x0, not 16');
  expect(problems).toContain('#ccZoomIn: 0x0, not 16');
});

/**
 * A page with what the document the editor boots with lacks: layers, and an
 * anchor among a flow path's waypoints.
 */
const ANNOTATED_DOCUMENT = {
  title: 'Icon walk',
  layers: [
    { id: 'under', name: 'Underlay' },
    { id: 'over', name: 'Overlay', defaultVisible: false },
  ],
  pages: [
    {
      id: 'p1',
      name: 'Fabric',
      viewBox: '0 0 1050 700',
      nodes: [
        { id: 's1', type: 'router', x: 463, y: 308, label: 'Spine 1' },
        { id: 's2', type: 'router', x: 587, y: 308, label: 'Spine 2' },
        { id: 'l1', type: 'switch', x: 339, y: 392, label: 'Leaf 1' },
      ],
      links: [
        { id: 'l1-s1', type: 'line', from: 's1', to: 'l1' },
        { id: 's1-s2', type: 'line', from: 's1', to: 's2', label: 'peer' },
      ],
      anchors: [{ id: 'a1', x: 760, y: 250 }],
      zones: [{ id: 'z1', nodes: ['s1', 's2'], label: 'Spines' }],
      flowPaths: [{ id: 'f1', waypoints: ['l1', 's1', 'a1'], label: 'Flow' }],
      policyMarkers: [
        { id: 'm1', nodeId: 's2', type: 'inspect', label: 'Inspect' },
      ],
    },
  ],
  customNodes: [],
};

async function openAnnotatedDocument(page: Page): Promise<void> {
  page.on('dialog', (dialog) => void dialog.accept());
  await bootEditor(page);
  await page.locator('#fInput').setInputFiles({
    name: 'icon-walk.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(ANNOTATED_DOCUMENT)),
  });
  await expect(page.locator('#page-canvas [data-tds-node]')).toHaveCount(3);
  await inspectorTab(page, 'document');
  await inspectorSection(page, 'Layers');
  await expect(page.locator('.layer-eye')).toHaveCount(2);
}

test('icons in the rest of the inspector, the bars and the frames strip', async ({
  page,
}) => {
  await openAnnotatedDocument(page);
  const iconOf = (selector: string): Promise<string | null> =>
    page.locator(`${selector} .icon use`).first().getAttribute('href');
  const colour = (selector: string): Promise<string> =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).color);

  // The Layers section: a shown layer's eye is in the text colour, a hidden
  // one's is muted, and each is the colour of its button.
  const eyes = page.locator('.layer-eye');
  await expect(eyes.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(eyes.nth(1)).toHaveAttribute('aria-pressed', 'false');
  expect(await iconOf('.layer-eye[aria-pressed="true"]')).toBe('#i-eye');
  expect(await iconOf('.layer-eye[aria-pressed="false"]')).toBe('#i-eye-off');
  const shownEye = await colour('.layer-eye[aria-pressed="true"] .icon');
  expect(shownEye).toBe(await colour('.layer-name'));
  expect(await colour('.layer-eye[aria-pressed="false"] .icon')).not.toBe(
    shownEye,
  );
  expect(await iconProblems(page)).toEqual([]);

  // Every annotation editor open: delete buttons, the compass, and a flow's
  // waypoint chips, one of them an anchor (its icon sits in a label that
  // clips, so it is drawn at the height of that label's line).
  await inspectorTab(page, 'page');
  await inspectorSection(page, 'Annotations');
  for (const summary of await page
    .locator('#inspector details.anno > summary')
    .all())
    await summary.click();
  const anchorChip = page.locator(
    'details.anno[data-acol="flowPaths"] .refchip[data-id="a1"]',
  );
  await expect(anchorChip.locator('.reflbl')).toHaveText('a1');
  expect(await iconOf('.refchip[data-id="a1"] .reflbl')).toBe('#i-anchor');
  await expect(anchorChip.locator('.reflbl .icon')).toHaveAttribute(
    'width',
    '14',
  );
  // Three chips of two arrows and a cross, and the anchor's own icon.
  await expect(
    page.locator('details.anno[data-acol="flowPaths"] .refchip .icon:visible'),
  ).toHaveCount(10);
  expect(await iconProblems(page)).toEqual([]);

  // Two nodes selected: the toolbar's align group and the path button.
  await clickNode(page, 's1');
  const second = await nodeBox(page, 'l1');
  await page.keyboard.down('Shift');
  await page.mouse.click(
    second.x + second.width / 2,
    second.y + second.height / 2,
  );
  await page.keyboard.up('Shift');
  await expect(page.locator('#alignGroup .icon:visible')).toHaveCount(8);
  await expect(page.locator('#i-path .icon')).toBeVisible();
  expect(await iconProblems(page)).toEqual([]);

  // The path bar over the canvas.
  await page.locator('#i-path').click();
  await expect(
    page.locator('.path-bar [data-path="close"] .icon'),
  ).toBeVisible();
  expect(await iconProblems(page)).toEqual([]);
  await page.keyboard.press('Escape');

  // A selected link: its mini bar, label compass and format row.
  await page.keyboard.press('Escape');
  await clickLink(page, 's1-s2');
  await expect(page.locator('#i-swap .icon')).toBeVisible();
  await expect(
    page.locator('#inspector .compass[data-key] .icon:visible'),
  ).toHaveCount(9);
  expect(await iconProblems(page)).toEqual([]);

  // Emphasis: the star is an outline until it is on, and solid while it is,
  // so the state shows in more than the accent colour that hover has too.
  const star = page.locator('#mbEmph .icon');
  const starFill = (): Promise<string> =>
    star.evaluate((el) => getComputedStyle(el).fill);
  expect(await starFill()).toBe('none');
  await page.locator('#mbEmph').click();
  await expect(page.locator('#mbEmph')).toHaveClass(/\bon\b/);
  expect(await starFill()).toBe(await colour('#mbEmph'));
  expect(await iconProblems(page)).toEqual([]);
  await page.locator('#mbEmph').click();
  await expect(page.locator('#mbEmph')).not.toHaveClass(/\bon\b/);
  expect(await starFill()).toBe('none');

  // The frames strip: a second frame brings the play button and the delete
  // crosses; deleting it leaves the undo chip.
  await page.locator('#addPage').click();
  await expect(page.locator('.frame-x .icon')).toHaveCount(2);
  expect(await iconOf('#playFlip')).toBe('#i-play');
  expect(await iconProblems(page)).toEqual([]);
  await page.locator('#playFlip').click();
  expect(await iconOf('#playFlip')).toBe('#i-pause');
  await page.locator('#playFlip').click();
  await page.locator('.frame-x').last().click();
  await expect(page.locator('#undoDel .icon')).toBeVisible();
  expect(await iconProblems(page)).toEqual([]);

  // The presentation's own bar.
  await page.locator('#tPresent').click();
  await expect(page.locator('#presentExit .icon')).toBeVisible();
  expect(await iconProblems(page)).toEqual([]);
  await page.keyboard.press('Escape');
});

test('the account chip of a signed-in session', async ({ page }) => {
  // The hosted Worker reports the session; the dev server has none, so the
  // chip (and its two icons) is otherwise never on screen in this suite.
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => {
      const me = new URL(route.request().url()).pathname === '/api/me';
      return route.fulfill({
        status: me ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(me ? { login: 'e2e' } : { error: 'not found' }),
      });
    },
  );
  await bootEditor(page);
  const chip = page.locator('#userChip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('e2e');
  await expect(chip).toHaveAccessibleName('Account menu');
  await expect(chip.locator('.uc-dot .icon use')).toHaveAttribute(
    'href',
    '#i-account',
  );
  await expect(chip.locator('.uc-caret .icon use')).toHaveAttribute(
    'href',
    '#i-chevron-down',
  );
  // The account icon is in the accent colour of its dot, not the chip's.
  const colours = await chip.evaluate((el) => ({
    chip: getComputedStyle(el).color,
    dot: getComputedStyle(el.querySelector('.uc-dot')!).color,
    icon: getComputedStyle(el.querySelector('.uc-dot .icon')!).color,
  }));
  expect(colours.icon).toBe(colours.dot);
  expect(colours.icon).not.toBe(colours.chip);
  expect(await iconProblems(page)).toEqual([]);
});

test('a button whose plus is an icon still says "add"', async ({ page }) => {
  // The plus was a character in the button's text and so in its name; the
  // icon is hidden from assistive technology, so the name is spelled out.
  // It keeps the visible word, for anyone who speaks the label they see.
  await openAnnotatedDocument(page);
  // The Layers button is on the Document tab, the annotation buttons on the
  // Page tab.
  for (const [selector, name, word, tab, section] of [
    ['#p-layer-add', 'Add layer', 'Layer', 'document', 'Layers'],
    ['.anno-add [data-add="zone"]', 'Add zone', 'zone', 'page', 'Annotations'],
    [
      '.anno-add [data-add="flowPath"]',
      'Add flow path',
      'flow',
      'page',
      'Annotations',
    ],
    [
      '.anno-add [data-add="policyMarker"]',
      'Add marker',
      'marker',
      'page',
      'Annotations',
    ],
    ['#addPage', 'Add frame', 'frame', null, null],
  ] as const) {
    if (tab) await inspectorTab(page, tab);
    if (section) await inspectorSection(page, section);
    const button = page.locator(selector);
    await expect(button).toHaveAccessibleName(name);
    await expect(button).toHaveText(word);
    expect(name.toLowerCase()).toContain(word.toLowerCase());
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(
      1,
    );
  }
  // The titles say what each does, as before.
  await expect(page.locator('#addPage')).toHaveAttribute(
    'title',
    'Add blank frame',
  );
  await expect(page.locator('.anno-add [data-add="zone"]')).toHaveAttribute(
    'title',
    'Group selected nodes into a zone',
  );
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
