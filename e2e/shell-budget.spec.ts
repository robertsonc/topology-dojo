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
// sampled every 40px: signed out, and signed in under a 30-character login.
const WIDTHS = Array.from({ length: 40 }, (_, i) => 360 + i * 40);
const LONG_LOGIN = 'octocat-network-engineering-01';

async function overflowing(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    // Let the shell's resize observers lay the bars out at the new width.
    const over = await page.evaluate(
      () =>
        new Promise<number>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve(
                document.documentElement.scrollWidth -
                  document.documentElement.clientWidth,
              ),
            ),
          ),
        ),
    );
    if (over > 0) out.push(`${width}px: ${over}px too wide`);
  }
  return out;
}

test('the document never scrolls sideways from 360 to 1,920px, signed out', async ({
  page,
}) => {
  await bootEditor(page);
  expect(await overflowing(page)).toEqual([]);
});

test('the document never scrolls sideways from 360 to 1,920px, signed in under a long login', async ({
  page,
}) => {
  expect(LONG_LOGIN).toHaveLength(30);
  await signIn(page, LONG_LOGIN);
  await bootEditor(page);
  await expect(page.locator('#userName')).toHaveText(LONG_LOGIN);
  expect(await overflowing(page)).toEqual([]);
});
