/**
 * The shell's budgets (proposal 0013): how many controls the top bar, the
 * left rail and the pages bar's right end hold; that no text in the shell is
 * under 12px; and that the document never scrolls sideways. Scroll
 * containers inside the properties panel are budgeted in
 * shell-inspector-layout.spec.ts.
 *
 * Every number here is a design decision. A test that fails because a
 * control was added, a font made smaller or a row made wider is doing its
 * job: raising a number is a change to the design, to be agreed as one, not
 * a fix to the test.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  bootEditor,
  clickLink,
  clickNode,
  menuCommand,
  newFromTemplate,
} from './helpers.js';

/** Answer the hosted Worker's API for a signed-in owner (an admin), so
 * every chip of the top bar shows, with empty lists where a panel asks for
 * one and "not found" for the rest. */
async function signIn(page: Page, login = 'e2e-owner'): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const json = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      if (path === '/api/me') return json({ login, admin: true });
      if (path === '/api/share' && request.method() === 'GET')
        return json({ shares: [] });
      if (path === '/api/workspaces' && request.method() === 'GET')
        return json([]);
      return json({ error: 'not found' }, 404);
    },
  );
}

/** Boot signed in, in `theme`, and wait for the account chip. */
async function bootSignedIn(
  page: Page,
  theme: 'dark' | 'light' = 'dark',
): Promise<void> {
  await signIn(page);
  await bootEditor(page);
  if (theme === 'light') {
    await page.evaluate(() =>
      localStorage.setItem('topology-dojo:theme', 'light'),
    );
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\blight\b/);
  }
  await expect(page.locator('#userChip')).toBeVisible();
}

/* ── Controls ──────────────────────────────────────────────────────────── */

/** The visible controls in `selector`, each by its id (a menu of the menu
 * bar by its menu), in document order. */
function controls(page: Page, selector: string): Promise<string[]> {
  return page
    .locator(selector)
    .evaluate((root) =>
      [
        ...root.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ]
        .filter((el) => el.checkVisibility())
        .map((el) => el.id || `menu:${el.dataset.menu ?? el.className}`),
    );
}

// The top bar, signed in as an admin with every chip showing, at 1,440px:
// the five menus, the title, history, tidy and its menu, Present, Export,
// Share, the workspace chip and the account chip. 15 controls.
const TOP_BAR = [
  'menu:file',
  'menu:edit',
  'menu:view',
  'menu:arrange',
  'menu:help',
  'docTitle',
  'tUndo',
  'tRedo',
  'tTidy',
  'tTidyMenu',
  'tPresent',
  'fExportBtn',
  'fShare',
  'workspaceChip',
  'userChip',
];
const TOP_BAR_BUDGET = 15;

// The left rail: the four tools, the library toggle, the command palette and
// the shortcut sheet. 7 controls.
const RAIL = [
  'tSelect',
  'ccHand',
  'tLink',
  'tAnchor',
  'palette-toggle',
  'tCommand',
  'tHelp',
];
const RAIL_BUDGET = 7;

// The right end of the pages bar: grid, snap, calm, Display settings and the
// minimap. 5 controls.
const PAGES_BAR_END = ['tGrid', 'tSnap', 'tCalm', 'tDisplay', 'minimap-toggle'];
const PAGES_BAR_END_BUDGET = 5;

test('the top bar, the rail and the pages bar hold no more controls than their budgets', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootSignedIn(page);
  await expect(page.locator('#fShare')).toBeVisible();
  await expect(page.locator('#workspaceChip')).toBeVisible();

  const top = await controls(page, '.topbar');
  expect(top.length, `top bar: ${top.join(', ')}`).toBeLessThanOrEqual(
    TOP_BAR_BUDGET,
  );
  expect(top.filter((id) => !TOP_BAR.includes(id))).toEqual([]);

  const rail = await controls(page, '#rail');
  expect(rail.length, `rail: ${rail.join(', ')}`).toBeLessThanOrEqual(
    RAIL_BUDGET,
  );
  expect(rail.filter((id) => !RAIL.includes(id))).toEqual([]);

  const end = await controls(page, '#pagesBar .view-opts');
  expect(end.length, `pages bar: ${end.join(', ')}`).toBeLessThanOrEqual(
    PAGES_BAR_END_BUDGET,
  );
  expect(end.filter((id) => !PAGES_BAR_END.includes(id))).toEqual([]);
});

/* ── Text size ─────────────────────────────────────────────────────────── */

// No text in the shell is under 12px, in either theme, at a laptop's size
// or a phone's.
const MIN_TEXT_PX = 12;

/**
 * Every visible text node of the shell, and every field, set under 12px.
 * Text inside an SVG is a drawing of the diagram (the canvas, the minimap,
 * a preview, the presentation), which scales with its zoom: it is left out.
 */
async function smallText(page: Page, state: string): Promise<string[]> {
  return page.evaluate(
    ([min, label]) => {
      const text = [...document.querySelectorAll<HTMLElement>('body *')].filter(
        (el) => {
          if (el.closest('svg') || !el.checkVisibility()) return false;
          const box = el.getBoundingClientRect();
          // Visually hidden text (a live region) is read, not seen.
          if (box.width <= 1 || box.height <= 1) return false;
          if (el.matches('input, select, textarea')) return true;
          return [...el.childNodes].some(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim(),
          );
        },
      );
      // A walk that saw nothing has checked nothing.
      if (text.length === 0) return [`${label}: no text to walk`];
      return text
        .map((el) => [el, parseFloat(getComputedStyle(el).fontSize)] as const)
        .filter(([, size]) => size < min)
        .map(
          ([el, size]) =>
            `${label}: ${el.tagName.toLowerCase()}#${el.id}.${el.className} "${(el.textContent ?? '').trim().slice(0, 24)}" ${size}px`,
        );
    },
    [MIN_TEXT_PX, state] as const,
  );
}

const VIEWPORTS = [
  { name: 'laptop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;
const THEMES = ['dark', 'light'] as const;

const phone = (page: Page): boolean => page.viewportSize()!.width <= 640;

/** Run a command of the account chip's menu. */
async function accountCommand(page: Page, id: string): Promise<void> {
  await page.locator('#userChip').click();
  await page.locator(`.menu-layer [data-command="${id}"]`).click();
}

/** Close what is open with Escape until `selector` is gone. */
async function escapeFrom(page: Page, selector: string): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator(selector)).toHaveCount(0);
}

for (const vp of VIEWPORTS)
  for (const theme of THEMES) {
    const where = `${vp.name}, ${theme}`;

    test.describe(`no text under 12px (${where})`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      test(`the editor: at boot, a selection, the palette, Display settings, the sheet, the note (${where})`, async ({
        page,
      }) => {
        await bootSignedIn(page, theme);
        const found = await smallText(page, 'at boot');

        await clickNode(page, 'fw');
        found.push(...(await smallText(page, 'a node selected')));
        await clickLink(page, 'ec-fw');
        found.push(...(await smallText(page, 'a link selected')));
        await page.keyboard.press('Escape');

        await page.keyboard.press('Control+k');
        await expect(page.locator('.cmdk-input')).toBeVisible();
        found.push(...(await smallText(page, 'command palette')));
        await escapeFrom(page, '.cmdk-input');

        await page.locator('#tDisplay').click();
        await expect(page.locator('.display-pop')).toBeVisible();
        found.push(...(await smallText(page, 'Display settings')));
        await page.keyboard.press('Escape');
        await expect(page.locator('.display-pop')).toBeHidden();

        await page.keyboard.press('?');
        await expect(page.locator('.help-card')).toBeVisible();
        found.push(...(await smallText(page, 'shortcut sheet')));
        await escapeFrom(page, '.help-card');

        await menuCommand(page, 'help.whatMoved');
        await expect(page.locator('#shellNote')).toBeVisible();
        found.push(...(await smallText(page, 'what moved note')));
        expect(found).toEqual([]);
      });

      test(`the menus, each open, and present mode (${where})`, async ({
        page,
      }) => {
        await bootSignedIn(page, theme);
        const found: string[] = [];
        const labels = ['File', 'Edit', 'View', 'Arrange', 'Help'];
        for (const [i, id] of [
          'file',
          'edit',
          'view',
          'arrange',
          'help',
        ].entries()) {
          if (phone(page)) {
            // Folded: each menu is a submenu of the Menu button's menu.
            await page.locator('#menuMore').click();
            await page
              .locator('.menu-layer [aria-haspopup="menu"]')
              .filter({ hasText: labels[i] })
              .first()
              .click();
            await expect(page.locator('.menu-layer .menu')).toHaveCount(2);
          } else {
            await page.locator(`#menubar [data-menu="${id}"]`).click();
            await expect(page.locator('.menu-layer .menu')).toHaveCount(1);
          }
          found.push(...(await smallText(page, `${labels[i]} menu`)));
          await page.keyboard.press('Escape');
          await page.keyboard.press('Escape');
          await expect(page.locator('.menu-layer')).toHaveCount(0);
        }
        await page.locator('#userChip').click();
        await expect(page.locator('.menu-layer .menu')).toHaveCount(1);
        found.push(...(await smallText(page, 'account menu')));
        await page.keyboard.press('Escape');
        await expect(page.locator('.menu-layer')).toHaveCount(0);

        await menuCommand(page, 'view.present');
        await expect(page.locator('.present-root')).toBeVisible();
        found.push(...(await smallText(page, 'present mode')));
        expect(found).toEqual([]);
      });

      test(`the dialogs: Share, both wizards and the node designer (${where})`, async ({
        page,
      }) => {
        await bootSignedIn(page, theme);
        const found: string[] = [];
        await menuCommand(page, 'file.share');
        await expect(page.locator('.share-card')).toBeVisible();
        found.push(...(await smallText(page, 'Share')));
        await escapeFrom(page, '.share-card');

        await menuCommand(page, 'file.generateSdwan');
        await expect(page.locator('.sdw-card')).toBeVisible();
        found.push(...(await smallText(page, 'SD-WAN wizard')));
        await escapeFrom(page, '.sdw-card');

        await newFromTemplate(page, 'spine-leaf');
        await expect(page.locator('.tpw-card')).toBeVisible();
        found.push(...(await smallText(page, 'template wizard')));
        await escapeFrom(page, '.tpw-card');

        if (phone(page)) await page.locator('#palette-toggle').click();
        await page.locator('#pDesign').click();
        await expect(page.locator('.nd-modal')).toBeVisible();
        found.push(...(await smallText(page, 'node designer')));
        expect(found).toEqual([]);
      });

      test(`the workspace, preferences and admin panels (${where})`, async ({
        page,
      }) => {
        await bootSignedIn(page, theme);
        const found: string[] = [];
        await page.locator('#workspaceChip').click();
        await expect(page.locator('.workspace-panel')).toBeVisible();
        found.push(...(await smallText(page, 'workspace panel')));
        await page.locator('#workspaceChip').click();
        await expect(page.locator('.workspace-panel')).toBeHidden();

        await accountCommand(page, 'account.preferences');
        await expect(page.locator('.profile-panel')).toBeVisible();
        found.push(...(await smallText(page, 'preferences panel')));
        await accountCommand(page, 'account.preferences');
        await expect(page.locator('.profile-panel')).toBeHidden();

        await accountCommand(page, 'account.admin');
        await expect(page.locator('.admin-panel')).toBeVisible();
        found.push(...(await smallText(page, 'admin panel')));
        expect(found).toEqual([]);
      });
    });
  }

/* ── Horizontal overflow ───────────────────────────────────────────────── */

// The document never scrolls sideways, at any width from 360 to 1,920px,
// sampled every 40px, and on the narrowest phones (320 and 340px): signed
// out, and signed in under a 30-character login. The document title keeps
// at least 120px, and on a phone (640px or less) at least 64px.
// The body clips what overflows, so the document's own scroll width cannot
// show a bar that runs past the window: each bar is measured too, and every
// visible control outside the canvas must end inside the window.
// Plus the widths where the shell's own rules change, each side of them.
const WIDTHS = [
  320,
  340,
  ...Array.from({ length: 40 }, (_, i) => 360 + i * 40),
  ...[640, 641, 700, 701, 760, 761, 1023, 1024, 1100, 1101, 1279, 1280],
  ...[1359, 1360, 1366, 1520],
].sort((a, b) => a - b);
const LONG_LOGIN = 'octocat-network-engineering-01';
const BARS = ['.topbar', '#statusbar', '#pagesBar', '.stage'];

async function overflowing(
  page: Page,
  widths: number[] = WIDTHS,
): Promise<string[]> {
  const out: string[] = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    // Let the shell's resize observers lay the bars out at the new width.
    const found = await page.evaluate(
      (bars) =>
        new Promise<string[]>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const over: string[] = [];
              const doc = document.documentElement;
              if (doc.scrollWidth > doc.clientWidth)
                over.push(
                  `the document is ${doc.scrollWidth - doc.clientWidth}px too wide`,
                );
              for (const selector of bars) {
                const bar = document.querySelector(selector);
                if (bar && bar.scrollWidth > bar.clientWidth + 1)
                  over.push(
                    `${selector} is ${bar.scrollWidth - bar.clientWidth}px too wide`,
                  );
              }
              const title = document.getElementById('docTitle')!;
              const least = window.innerWidth <= 640 ? 64 : 120;
              const titleWidth = title.getBoundingClientRect().width;
              if (titleWidth < least - 0.5)
                over.push(
                  `the title is ${Math.round(titleWidth)}px, under ${least}px`,
                );
              const controls = document.querySelectorAll<HTMLElement>(
                'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
              );
              for (const el of controls) {
                if (el.closest('svg')) continue;
                if (getComputedStyle(el).visibility === 'hidden') continue;
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                if (r.right > window.innerWidth + 1 || r.left < -1)
                  over.push(
                    `${el.id ? `#${el.id}` : el.className || el.tagName} spans ` +
                      `${Math.round(r.left)}..${Math.round(r.right)}`,
                  );
              }
              // No two visible controls of a bar are drawn over each other
              // (the save state beside the title counts as one), and no item
              // of the status bar ends past its edge.
              const label = (el: Element) =>
                el.id ? `#${el.id}` : el.className || el.tagName;
              for (const selector of [
                '.topbar',
                '#pagesBar',
                '#rail',
                '#statusbar',
              ]) {
                const bar = document.querySelector(selector);
                if (!bar) continue;
                const barBox = bar.getBoundingClientRect();
                const shown = [
                  ...bar.querySelectorAll<HTMLElement>(
                    'button, input, select, [tabindex="0"], .saved, .sb-k',
                  ),
                ]
                  .filter((el) => {
                    if (!el.checkVisibility({ visibilityProperty: true }))
                      return false;
                    const r = el.getBoundingClientRect();
                    return r.width > 0.5 && r.height > 0.5;
                  })
                  .map((el) => {
                    // Cut to the scrolling strip it sits in, if any.
                    let r = el.getBoundingClientRect();
                    const strip = el.closest('.filmstrip, #rail');
                    if (strip && strip !== el) {
                      const c = strip.getBoundingClientRect();
                      r = new DOMRect(
                        Math.max(r.left, c.left),
                        Math.max(r.top, c.top),
                        Math.min(r.right, c.right) - Math.max(r.left, c.left),
                        Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top),
                      );
                    }
                    return { el, r };
                  })
                  .filter(({ r }) => r.width > 0.5 && r.height > 0.5);
                for (let i = 0; i < shown.length; i++)
                  for (let j = i + 1; j < shown.length; j++) {
                    const a = shown[i]!;
                    const b = shown[j]!;
                    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
                    const x =
                      Math.min(a.r.right, b.r.right) -
                      Math.max(a.r.left, b.r.left);
                    const y =
                      Math.min(a.r.bottom, b.r.bottom) -
                      Math.max(a.r.top, b.r.top);
                    if (x > 0.5 && y > 0.5)
                      over.push(
                        `${label(a.el)} and ${label(b.el)} overlap by ${Math.round(x)}px`,
                      );
                  }
                if (selector === '#statusbar')
                  for (const item of bar.children) {
                    const r = item.getBoundingClientRect();
                    if (r.width > 0 && r.right > barBox.right + 0.5)
                      over.push(
                        `${label(item)} ends ${Math.round(r.right - barBox.right)}px past the status bar`,
                      );
                  }
              }
              resolve(over);
            }),
          ),
        ),
      BARS,
    );
    out.push(...found.map((f) => `${width}px: ${f}`));
  }
  return out;
}

/** Commit a short title, so the save state beside it says "✓ saved". */
async function saveTitle(page: Page): Promise<void> {
  await page.locator('#docTitle').fill('Branch A');
  await page.locator('#docTitle').press('Enter');
  await expect(page.locator('#saved')).toHaveText('✓ saved');
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}

/** Make browser storage refuse the document, then make an edit: the save
 * state turns into the warning that offers the download. */
async function failSave(page: Page): Promise<void> {
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('topology-dojo:doc'))
        throw new DOMException('full', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  await page.locator('#docTitle').fill('Branch B');
  await page.locator('#docTitle').press('Enter');
  await expect(page.locator('#saved')).toHaveText(
    '⚠ not saved — download JSON',
  );
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}

// Each walk runs in three parts, so none takes long.
for (const range of [
  { name: '320 to 999px', widths: WIDTHS.filter((w) => w < 1000) },
  {
    name: '1,000 to 1,399px',
    widths: WIDTHS.filter((w) => w >= 1000 && w < 1400),
  },
  { name: '1,400 to 1,920px', widths: WIDTHS.filter((w) => w >= 1400) },
]) {
  test(`the document never scrolls sideways from ${range.name}, signed out`, async ({
    page,
  }) => {
    await bootEditor(page);
    await saveTitle(page);
    expect(await overflowing(page, range.widths)).toEqual([]);
  });

  test(`the document never scrolls sideways from ${range.name}, signed in under a long login`, async ({
    page,
  }) => {
    expect(LONG_LOGIN).toHaveLength(30);
    await signIn(page, LONG_LOGIN);
    await bootEditor(page);
    await expect(page.locator('#userName')).toHaveText(LONG_LOGIN);
    await saveTitle(page);
    expect(await overflowing(page, range.widths)).toEqual([]);
  });

  test(`the document never scrolls sideways from ${range.name}, signed out, with a save warning`, async ({
    page,
  }) => {
    await bootEditor(page);
    await failSave(page);
    expect(await overflowing(page, range.widths)).toEqual([]);
  });

  test(`the document never scrolls sideways from ${range.name}, signed in under a long login, with a save warning`, async ({
    page,
  }) => {
    await signIn(page, LONG_LOGIN);
    await bootEditor(page);
    await expect(page.locator('#userName')).toHaveText(LONG_LOGIN);
    await failSave(page);
    expect(await overflowing(page, range.widths)).toEqual([]);
    // The warning keeps its whole sentence as its name, whatever it shows.
    await expect(page.locator('#saved')).toHaveAccessibleName(
      '⚠ not saved — download JSON',
    );
  });
}
