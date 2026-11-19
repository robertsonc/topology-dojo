/**
 * The menu component (src/ui/menu.ts) in a real browser: focus, keys,
 * pointer, ARIA, and how it shares the keyboard with the editor shell.
 *
 * The component is not wired into the shell yet, so each test mounts a small
 * bench (a trigger button, a menu button and a menu bar) into document.body
 * and drives that. The page loads the module with a dynamic import of
 * `/src/ui/menu.ts`: the e2e suite runs against the Vite dev server, which
 * serves source files at their repository path, so the import resolves to the
 * same module graph the editor itself loaded (one `overlay.ts`, shared with
 * `main.ts`, which is what makes the shortcut tests meaningful).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { MenuEntry } from '../src/ui/menu.js';
import {
  bootEditor,
  clickNode,
  nodeBox,
  statusCount,
  statusText,
  tabTo,
} from './helpers.js';

type MenuModule = typeof import('../src/ui/menu.js');

interface Bench {
  menu: MenuModule;
  /** What happened, in order: `close:<reason>`, `run:<id> …`, `after:click`. */
  log: string[];
  /** The state the "Grid" checkbox item reads when its menu opens. */
  grid: boolean;
  bar: { destroy(): void };
  button: { destroy(): void };
}

declare global {
  interface Window {
    menuBench?: Bench;
  }
}

const MODULE = '/src/ui/menu.ts';

/**
 * Mount the bench. In tab order: Before, Actions (a plain trigger using
 * `toggleMenu`), More (`attachMenuButton`), the menu bar File / Edit / View
 * (`attachMenubar`, one tab stop), After.
 *
 * The Actions menu, by entry index: 0 heading "Clipboard", 1 Cut, 2 Copy,
 * 3 Paste (disabled), 4 separator, 5 Grid (checked), 6 Snap (unchecked),
 * 7 Share (submenu: Link, Embed, More > Deep), 8 Plain (no command),
 * 9 separator, 10 Delete (danger).
 */
async function mountBench(page: Page): Promise<void> {
  await page.evaluate(async (url) => {
    const menu = (await import(/* @vite-ignore */ url)) as MenuModule;
    const host = document.createElement('div');
    host.id = 'menu-bench';
    host.style.cssText =
      'position:fixed;left:340px;top:64px;z-index:900;display:flex;gap:8px;padding:6px';
    host.innerHTML =
      '<button type="button" id="mb-before">Before</button>' +
      '<button type="button" id="mb-trigger" aria-haspopup="menu" aria-expanded="false">Actions</button>' +
      '<button type="button" id="mb-button">More</button>' +
      '<div id="mb-bar" role="menubar" aria-label="Bench" style="display:flex;gap:4px">' +
      '<button type="button" role="menuitem" data-menu="file">File</button>' +
      '<button type="button" role="menuitem" data-menu="edit">Edit</button>' +
      '<button type="button" role="menuitem" data-menu="view">View</button>' +
      '</div>' +
      '<button type="button" id="mb-after">After</button>';
    document.body.append(host);
    const el = (id: string): HTMLElement => document.getElementById(id)!;

    const log: string[] = [];
    const closed = (reason: string): void => void log.push(`close:${reason}`);
    /** A command that records what the page looked like when it ran. */
    const ran = (id: string) => (): void => {
      const menus = document.querySelectorAll('.menu').length;
      const active = document.activeElement as HTMLElement | null;
      const focus = active?.id || active?.dataset.menu || '';
      log.push(`run:${id} menus=${menus} focus=${focus}`);
    };

    const actions = (): MenuEntry[] => [
      { kind: 'heading', label: 'Clipboard' },
      { id: 'edit.cut', label: 'Cut', hint: 'Ctrl+X', run: ran('edit.cut') },
      { id: 'edit.copy', label: 'Copy', hint: 'Ctrl+C', run: ran('edit.copy') },
      {
        id: 'edit.paste',
        label: 'Paste',
        disabled: true,
        run: ran('edit.paste'),
      },
      { kind: 'separator' },
      {
        id: 'view.grid',
        label: 'Grid',
        checked: window.menuBench!.grid,
        run: ran('view.grid'),
      },
      { id: 'view.snap', label: 'Snap', checked: false, run: ran('view.snap') },
      {
        label: 'Share',
        iconHtml:
          '<svg class="bench-icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/></svg>',
        submenu: () => [
          { id: 'share.link', label: 'Link', run: ran('share.link') },
          { id: 'share.embed', label: 'Embed', run: ran('share.embed') },
          {
            label: 'More',
            submenu: [
              { id: 'share.deep', label: 'Deep', run: ran('share.deep') },
            ],
          },
        ],
      },
      { label: 'Plain' },
      { kind: 'separator' },
      {
        id: 'edit.delete',
        label: 'Delete',
        danger: true,
        run: ran('edit.delete'),
      },
    ];

    const trigger = el('mb-trigger');
    trigger.addEventListener('click', (e) => {
      menu.toggleMenu(actions, {
        anchor: trigger,
        // A click the keyboard made has detail 0.
        focus: e.detail === 0 ? 'first' : 'menu',
        onClose: closed,
      });
    });
    el('mb-after').addEventListener('click', () => log.push('after:click'));

    const button = menu.attachMenuButton(
      el('mb-button'),
      () => [
        { id: 'more.refresh', label: 'Refresh', run: ran('more.refresh') },
        {
          id: 'more.hostile',
          label: '<img src=x onerror="window.pwned = 1"> & co',
          hint: '<i>hint</i>',
          run: ran('more.hostile'),
        },
        { id: 'more.off', label: 'Unavailable', disabled: true },
      ],
      { placement: 'below-end', onClose: closed },
    );

    const barMenus: Record<string, MenuEntry[]> = {
      file: [
        { id: 'file.new', label: 'New', run: ran('file.new') },
        { id: 'file.open', label: 'Open', run: ran('file.open') },
        {
          label: 'Export',
          submenu: [
            { id: 'export.png', label: 'PNG', run: ran('export.png') },
            { id: 'export.svg', label: 'SVG', run: ran('export.svg') },
          ],
        },
        { id: 'file.close', label: 'Close', run: ran('file.close') },
      ],
      edit: [
        { id: 'edit.undo', label: 'Undo', disabled: true },
        { id: 'edit.redo', label: 'Redo', run: ran('edit.redo') },
        { id: 'edit.find', label: 'Find', run: ran('edit.find') },
      ],
      view: [
        { id: 'view.in', label: 'Zoom in', run: ran('view.in') },
        { id: 'view.out', label: 'Zoom out', run: ran('view.out') },
      ],
    };
    const bar = menu.attachMenubar(el('mb-bar'), (key) => barMenus[key] ?? []);

    window.menuBench = { menu, log, grid: true, bar, button };
  }, MODULE);
}

test.beforeEach(async ({ page }) => {
  await bootEditor(page);
  await mountBench(page);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    const bench = window.menuBench;
    if (!bench) return;
    bench.menu.closeAllMenus();
    bench.bar.destroy();
    bench.button.destroy();
    document.getElementById('menu-bench')?.remove();
    delete window.menuBench;
  });
});

/* ── Helpers ────────────────────────────────────────────────────────── */

const trigger = (page: Page): Locator => page.locator('#mb-trigger');
const barButton = (page: Page, key: string): Locator =>
  page.locator(`#mb-bar [data-menu="${key}"]`);
/** Open menus, root first. */
const menus = (page: Page): Locator => page.locator('.menu');
/** A menu item by its label. */
const item = (page: Page, label: string): Locator =>
  page.locator(`.menu-item:has(.menu-label:text-is("${label}"))`);

const log = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.menuBench!.log.slice());

/** Everything the component puts in the DOM. */
const leftovers = (page: Page): Promise<number> =>
  page.evaluate(
    () => document.querySelectorAll('.menu-layer, .menu, .menu-edge').length,
  );

/** Open the Actions menu the way a keyboard user does (first item focused). */
async function openByKeyboard(page: Page): Promise<void> {
  await trigger(page).focus();
  await page.keyboard.press('Enter');
  await expect(item(page, 'Cut')).toBeFocused();
}

/** Open the Actions menu with the pointer (the menu itself focused). */
async function openByPointer(page: Page): Promise<void> {
  await trigger(page).click();
  await expect(menus(page).first()).toBeFocused();
}

async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** The centre of an element, for raw mouse moves that must not wait. */
async function centre(target: Locator): Promise<{ x: number; y: number }> {
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/* ── Opening, roles and names ───────────────────────────────────────── */

test('a keyboard open focuses the first enabled item, and the menu is fully described', async ({
  page,
}) => {
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  await openByKeyboard(page);

  const root = menus(page).first();
  await expect(menus(page)).toHaveCount(1);
  await expect(root).toHaveAttribute('role', 'menu');
  // Named after its trigger unless the caller gives a label.
  await expect(root).toHaveAttribute('aria-label', 'Actions');
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');

  // Hosted on the body, fixed to the viewport, on the menu layer.
  const hosting = await root.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      layer: el.parentElement?.className,
      onBody: el.parentElement?.parentElement === document.body,
      position: style.position,
      zIndex: style.zIndex,
    };
  });
  expect(hosting).toEqual({
    layer: 'menu-layer',
    onBody: true,
    position: 'fixed',
    zIndex: '1000',
  });

  // What assistive technology is told (the focus sentinels are not in it).
  await expect(page.locator('.menu-layer')).toMatchAriaSnapshot(`
    - menu "Actions":
      - group "Clipboard":
        - menuitem "Cut Ctrl+X"
        - menuitem "Copy Ctrl+C"
        - menuitem "Paste" [disabled]
      - separator
      - menuitemcheckbox "Grid" [checked]
      - menuitemcheckbox "Snap"
      - menuitem "Share"
      - menuitem "Plain"
      - separator
      - menuitem "Delete"
  `);

  // Roving tabindex: the focused item is the menu's one tab stop.
  await expect(item(page, 'Cut')).toHaveAttribute('tabindex', '0');
  await expect(root.locator('.menu-item[tabindex="-1"]')).toHaveCount(7);
  await expect(root).toHaveAttribute('tabindex', '-1');

  // Items, checkboxes, a disabled item, a submenu parent.
  const cut = item(page, 'Cut');
  await expect(cut).toHaveAttribute('role', 'menuitem');
  await expect(cut).toHaveAttribute('data-command', 'edit.cut');
  await expect(cut).toHaveAttribute('type', 'button');
  await expect(cut.locator('.menu-hint')).toHaveText('Ctrl+X');
  await expect(item(page, 'Grid')).toHaveAttribute('role', 'menuitemcheckbox');
  await expect(item(page, 'Grid')).toHaveAttribute('aria-checked', 'true');
  await expect(item(page, 'Grid').locator('.menu-check svg')).toHaveCount(1);
  await expect(item(page, 'Snap')).toHaveAttribute('aria-checked', 'false');
  await expect(item(page, 'Snap').locator('.menu-check svg')).toHaveCount(0);
  await expect(item(page, 'Cut')).not.toHaveAttribute('aria-checked');
  await expect(item(page, 'Paste')).toHaveAttribute('aria-disabled', 'true');
  await expect(item(page, 'Paste')).not.toHaveAttribute('disabled');
  await expect(item(page, 'Share')).toHaveAttribute('aria-haspopup', 'menu');
  await expect(item(page, 'Share')).toHaveAttribute('aria-expanded', 'false');
  await expect(item(page, 'Share').locator('.menu-caret svg')).toHaveCount(1);
  await expect(item(page, 'Delete')).toHaveClass(/\bdanger\b/);

  // Separators, and the group a heading names.
  await expect(root.locator('.menu-sep[role="separator"]')).toHaveCount(2);
  const group = root.locator('[role="group"]');
  await expect(group).toHaveAttribute('aria-label', 'Clipboard');
  await expect(group.locator('.menu-heading')).toHaveText('Clipboard');
  await expect(group.locator('.menu-item .menu-label')).toHaveText([
    'Cut',
    'Copy',
    'Paste',
  ]);

  // The caller's icon markup is rendered; decoration is hidden from
  // assistive technology.
  await expect(
    item(page, 'Share').locator('.menu-icon svg.bench-icon'),
  ).toHaveCount(1);
  await expect(item(page, 'Share').locator('.menu-icon')).toHaveAttribute(
    'aria-hidden',
    'true',
  );

  // The keyboard user's focus ring is the shared one, on the focused item.
  const ring = await cut.evaluate((el) => {
    const style = getComputedStyle(el);
    return `${style.outlineStyle} ${style.outlineWidth}`;
  });
  expect(ring).toBe('solid 2px');
});

test('a pointer open focuses the menu itself: no item is active, and the arrows work at once', async ({
  page,
}) => {
  // A key press first, so the browser would draw focus rings on anything a
  // script focuses from here on.
  await trigger(page).focus();
  await press(page, 'ArrowLeft');
  await openByPointer(page);
  const root = menus(page).first();
  await expect(root).toHaveAttribute('tabindex', '0');
  await expect(root.locator('.menu-item[tabindex="0"]')).toHaveCount(0);
  // The pointer opened it: no ring frames the popup, though the browser
  // counts this focus as the keyboard's.
  const ring = (target: Locator): Promise<string> =>
    target.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(await root.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  expect(await ring(root)).toBe('none');

  // The first key press makes it the keyboard's: an item, with the ring.
  await press(page, 'ArrowDown');
  await expect(item(page, 'Cut')).toBeFocused();
  await expect(root).toHaveAttribute('tabindex', '-1');
  expect(await ring(item(page, 'Cut'))).toBe('solid');

  // From the menu itself, ArrowUp goes to the last item.
  await press(page, 'Escape');
  await openByPointer(page);
  await press(page, 'ArrowUp');
  await expect(item(page, 'Delete')).toBeFocused();
});

test('labels and hints are text, never markup', async ({ page }) => {
  await page.locator('#mb-button').click();
  const hostile = page.locator('.menu-item[data-command="more.hostile"]');
  await expect(hostile.locator('.menu-label')).toHaveText(
    '<img src=x onerror="window.pwned = 1"> & co',
  );
  await expect(hostile.locator('.menu-hint')).toHaveText('<i>hint</i>');
  await expect(menus(page).locator('img, i')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as { pwned?: number }).pwned),
  ).toBeUndefined();
});

test('entries given as a function are built each time the menu opens', async ({
  page,
}) => {
  await openByKeyboard(page);
  await expect(item(page, 'Grid')).toHaveAttribute('aria-checked', 'true');
  await press(page, 'Escape');

  await page.evaluate(() => {
    window.menuBench!.grid = false;
  });
  await openByKeyboard(page);
  await expect(item(page, 'Grid')).toHaveAttribute('aria-checked', 'false');
  await expect(item(page, 'Grid').locator('.menu-check svg')).toHaveCount(0);
});

/* ── Keys inside a menu ─────────────────────────────────────────────── */

test('the arrows wrap, skip separators and headings, and stop on disabled items; Home and End', async ({
  page,
}) => {
  await openByKeyboard(page);
  const order = [
    'Copy',
    'Paste', // disabled, and still a stop
    'Grid', // over the separator
    'Snap',
    'Share',
    'Plain',
    'Delete',
    'Cut', // wrapped, over the heading
  ];
  for (const label of order) {
    await press(page, 'ArrowDown');
    await expect(item(page, label)).toBeFocused();
  }
  await press(page, 'ArrowUp');
  await expect(item(page, 'Delete')).toBeFocused();
  await press(page, 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp');
  await expect(item(page, 'Paste')).toBeFocused();

  await press(page, 'End');
  await expect(item(page, 'Delete')).toBeFocused();
  await press(page, 'Home');
  await expect(item(page, 'Cut')).toBeFocused();
  // One tab stop throughout.
  await expect(menus(page).locator('.menu-item[tabindex="0"]')).toHaveCount(1);
});

test('typing jumps to the next item with that prefix, and the buffer resets after a pause', async ({
  page,
}) => {
  await openByKeyboard(page);
  // "s": Snap, then (the same letter again) the next "s", Share, then back.
  await press(page, 's');
  await expect(item(page, 'Snap')).toBeFocused();
  await press(page, 's');
  await expect(item(page, 'Share')).toBeFocused();
  await press(page, 's');
  await expect(item(page, 'Snap')).toBeFocused();

  // A fresh buffer after the pause. "p" is the next "p" after Snap, which is
  // Plain; "a" makes the prefix "pa", which only Paste has (a disabled item
  // can be reached this way too). Typed in one go, so no pause falls between.
  await page.waitForTimeout(650);
  await page.keyboard.type('pa');
  await expect(item(page, 'Paste')).toBeFocused();

  // After another pause the buffer starts over ("pad" would match nothing),
  // and case does not matter.
  await page.waitForTimeout(650);
  await press(page, 'D');
  await expect(item(page, 'Delete')).toBeFocused();

  // A letter that leaves the prefix matching nothing keeps focus where the
  // prefix had put it: "p" Paste, "pl" Plain, "plx" still Plain.
  await page.waitForTimeout(650);
  await page.keyboard.type('plx');
  await expect(item(page, 'Plain')).toBeFocused();
  await expect(menus(page)).toHaveCount(1);
});

test('a disabled item takes focus but does nothing, and so does an item without a command', async ({
  page,
}) => {
  await openByKeyboard(page);
  await press(page, 'ArrowDown', 'ArrowDown');
  await expect(item(page, 'Paste')).toBeFocused();
  await press(page, 'Enter', 'Space');
  // (Playwright refuses to click an aria-disabled element unless forced.)
  await item(page, 'Paste').click({ force: true });
  await expect(menus(page)).toHaveCount(1);
  await expect(item(page, 'Paste')).toBeFocused();

  await press(page, 'End', 'ArrowUp');
  await expect(item(page, 'Plain')).toBeFocused();
  await press(page, 'Enter', 'Space');
  await item(page, 'Plain').click();
  await expect(menus(page)).toHaveCount(1);
  expect(await log(page)).toEqual([]);
});

test('Enter and Space run the command once the menu is gone and focus is back on the trigger', async ({
  page,
}) => {
  await openByKeyboard(page);
  await press(page, 'ArrowDown', 'Enter');
  await expect(menus(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  // Closed first (reason "select"), then run: no menu left, focus restored.
  expect(await log(page)).toEqual([
    'close:select',
    'run:edit.copy menus=0 focus=mb-trigger',
  ]);
  expect(await leftovers(page)).toBe(0);

  // Space on the trigger opens it again (the browser's click), Space on an
  // item activates it.
  await press(page, 'Space');
  await expect(item(page, 'Cut')).toBeFocused();
  await press(page, 'Space');
  await expect(menus(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  expect((await log(page)).slice(2)).toEqual([
    'close:select',
    'run:edit.cut menus=0 focus=mb-trigger',
  ]);
});

test('a click runs the command the same way, from a submenu too', async ({
  page,
}) => {
  await openByPointer(page);
  await item(page, 'Delete').click();
  await expect(menus(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();

  await openByPointer(page);
  await item(page, 'Share').click();
  await expect(menus(page)).toHaveCount(2);
  await item(page, 'Embed').click();
  await expect(menus(page)).toHaveCount(0);
  expect(await log(page)).toEqual([
    'close:select',
    'run:edit.delete menus=0 focus=mb-trigger',
    'close:select',
    'run:share.embed menus=0 focus=mb-trigger',
  ]);
  expect(await leftovers(page)).toBe(0);
});

/* ── Submenus ───────────────────────────────────────────────────────── */

test('ArrowRight opens a submenu on its first item and ArrowLeft closes it', async ({
  page,
}) => {
  await openByKeyboard(page);
  await press(page, 's', 's');
  await expect(item(page, 'Share')).toBeFocused();
  await press(page, 'ArrowRight');

  await expect(menus(page)).toHaveCount(2);
  const sub = menus(page).nth(1);
  await expect(item(page, 'Link')).toBeFocused();
  await expect(item(page, 'Share')).toHaveAttribute('aria-expanded', 'true');
  await expect(sub).toHaveAttribute('role', 'menu');
  await expect(sub).toHaveAttribute('aria-label', 'Share');

  // Beside its parent menu, level with the parent item.
  const rootBox = (await menus(page).first().boundingBox())!;
  const subBox = (await sub.boundingBox())!;
  const shareBox = (await item(page, 'Share').boundingBox())!;
  const linkBox = (await item(page, 'Link').boundingBox())!;
  expect(subBox.x).toBeGreaterThan(rootBox.x + rootBox.width - 8);
  expect(Math.abs(linkBox.y - shareBox.y)).toBeLessThanOrEqual(1);
  await expect(sub).toHaveAttribute('data-placement', 'right-start');

  await expect(page.locator('.menu-layer')).toMatchAriaSnapshot(`
    - menu "Actions":
      - menuitem "Share" [expanded]
    - menu "Share":
      - menuitem "Link"
      - menuitem "Embed"
      - menuitem "More"
  `);

  // The arrows move inside the submenu, and wrap there.
  await press(page, 'ArrowDown', 'ArrowDown', 'ArrowDown');
  await expect(item(page, 'Link')).toBeFocused();

  // A second level.
  await press(page, 'End', 'ArrowRight');
  await expect(menus(page)).toHaveCount(3);
  await expect(item(page, 'Deep')).toBeFocused();
  await expect(item(page, 'More')).toHaveAttribute('aria-expanded', 'true');

  await press(page, 'ArrowLeft');
  await expect(menus(page)).toHaveCount(2);
  await expect(item(page, 'More')).toBeFocused();
  await expect(item(page, 'More')).toHaveAttribute('aria-expanded', 'false');
  await press(page, 'ArrowLeft');
  await expect(menus(page)).toHaveCount(1);
  await expect(item(page, 'Share')).toBeFocused();
  await expect(item(page, 'Share')).toHaveAttribute('aria-expanded', 'false');

  // At the root with no menu bar, ArrowLeft has nowhere to go: the menu stays.
  await press(page, 'ArrowLeft');
  await expect(menus(page)).toHaveCount(1);
  await expect(item(page, 'Share')).toBeFocused();

  // Enter on a submenu parent opens it on its first item, like ArrowRight.
  await press(page, 'Enter');
  await expect(item(page, 'Link')).toBeFocused();
  expect(await log(page)).toEqual([]);
});

test('Escape closes one level at a time, returning focus to the parent item and then the trigger', async ({
  page,
}) => {
  await openByKeyboard(page);
  await press(page, 's', 's', 'ArrowRight', 'End', 'ArrowRight');
  await expect(menus(page)).toHaveCount(3);
  await expect(item(page, 'Deep')).toBeFocused();

  await press(page, 'Escape');
  await expect(menus(page)).toHaveCount(2);
  await expect(item(page, 'More')).toBeFocused();
  await press(page, 'Escape');
  await expect(menus(page)).toHaveCount(1);
  await expect(item(page, 'Share')).toBeFocused();
  expect(await log(page)).toEqual([]);

  await press(page, 'Escape');
  await expect(menus(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  expect(await log(page)).toEqual(['close:escape']);
  expect(await leftovers(page)).toBe(0);
});

test('hovering a submenu parent opens it after a moment; a sibling closes it', async ({
  page,
}) => {
  await openByPointer(page);

  // Not at once: a pointer passing over the parent opens nothing.
  const immediately = await item(page, 'Share').evaluate((el) => {
    el.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }),
    );
    return document.querySelectorAll('.menu').length;
  });
  expect(immediately).toBe(1);
  await item(page, 'Snap').hover();
  await page.waitForTimeout(400);
  await expect(menus(page)).toHaveCount(1);

  // Resting on it does. Focus stays on the parent item: the pointer has not
  // entered the submenu.
  await item(page, 'Share').hover();
  await expect(menus(page)).toHaveCount(2);
  await expect(item(page, 'Share')).toBeFocused();
  await expect(item(page, 'Share')).toHaveAttribute('aria-expanded', 'true');

  // Into the submenu: it stays, and the item under the pointer is active.
  await item(page, 'Embed').hover();
  await expect(item(page, 'Embed')).toBeFocused();
  await page.waitForTimeout(450);
  await expect(menus(page)).toHaveCount(2);

  // Back out to a sibling of the parent: after the grace period it closes.
  await item(page, 'Plain').hover();
  await expect(menus(page)).toHaveCount(1);
  await expect(item(page, 'Plain')).toBeFocused();
  await expect(item(page, 'Share')).toHaveAttribute('aria-expanded', 'false');

  // A touch has no hover: its pointer events open nothing.
  const afterTouch = await item(page, 'Share').evaluate(async (el) => {
    el.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    return document.querySelectorAll('.menu').length;
  });
  expect(afterTouch).toBe(1);
});

test('a diagonal move across a sibling into an open submenu does not close it', async ({
  page,
}) => {
  await openByPointer(page);
  await item(page, 'Share').hover();
  await expect(menus(page)).toHaveCount(2);

  // Share -> Plain (the sibling below) -> Embed (in the submenu), with no
  // pause: raw moves, so nothing waits between them.
  const plain = await centre(item(page, 'Plain'));
  const embed = await centre(item(page, 'Embed'));
  await page.mouse.move(plain.x, plain.y);
  await page.mouse.move(embed.x, embed.y);

  await expect(item(page, 'Embed')).toBeFocused();
  await page.waitForTimeout(500); // well past the grace period
  await expect(menus(page)).toHaveCount(2);
  await expect(item(page, 'Share')).toHaveAttribute('aria-expanded', 'true');

  // The keyboard takes over from where the pointer is.
  await press(page, 'ArrowLeft');
  await expect(menus(page)).toHaveCount(1);
  await expect(item(page, 'Share')).toBeFocused();
});

test('the item under the pointer is the one active item, with the neutral hover fill', async ({
  page,
}) => {
  await openByKeyboard(page);
  const fill = (target: Locator): Promise<string> =>
    target.evaluate((el) => getComputedStyle(el).backgroundColor);
  const idle = 'rgba(0, 0, 0, 0)';
  expect(await fill(item(page, 'Cut'))).not.toBe(idle);

  await item(page, 'Snap').hover();
  await expect(item(page, 'Snap')).toBeFocused();
  // One highlight: the keyboard's item gave it up.
  expect(await fill(item(page, 'Snap'))).not.toBe(idle);
  expect(await fill(item(page, 'Cut'))).toBe(idle);
  // The hover fill is the neutral surface tint, not the accent.
  const tokens = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText =
      'background: var(--surface-hover); color: var(--fg-strong)';
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const out = { hover: style.backgroundColor, strong: style.color };
    probe.remove();
    return out;
  });
  expect(await fill(item(page, 'Snap'))).toBe(tokens.hover);
  expect(
    await item(page, 'Snap').evaluate((el) => getComputedStyle(el).color),
  ).toBe(tokens.strong);

  // The focus ring is the keyboard's: it does not trail the pointer, though
  // the browser counts this focus as the keyboard's (the menu was opened
  // with Enter).
  const ring = (target: Locator): Promise<string> =>
    target.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(
    await item(page, 'Snap').evaluate((el) => el.matches(':focus-visible')),
  ).toBe(true);
  expect(await ring(item(page, 'Snap'))).toBe('none');

  // The arrows continue from the pointer's item, and take the highlight and
  // the ring with them.
  await press(page, 'ArrowDown');
  await expect(item(page, 'Share')).toBeFocused();
  expect(await fill(item(page, 'Snap'))).toBe(idle);
  expect(await ring(item(page, 'Share'))).toBe('solid');

  // A disabled item can hold focus but never looks active.
  await item(page, 'Paste').hover();
  await expect(item(page, 'Paste')).toBeFocused();
  expect(await fill(item(page, 'Paste'))).toBe(idle);

  // Forced colours have no fills: there the pointer's item is outlined.
  await item(page, 'Snap').hover();
  expect(await ring(item(page, 'Snap'))).toBe('none');
  await page.emulateMedia({ forcedColors: 'active' });
  expect(await ring(item(page, 'Snap'))).toBe('solid');
  await page.emulateMedia({ forcedColors: 'none' });
});

/* ── Closing ────────────────────────────────────────────────────────── */

test('a press outside closes the menu and still does what it would have done', async ({
  page,
}) => {
  // On another control: the menu closes and the control is clicked.
  await openByPointer(page);
  await page.locator('#mb-after').click();
  await expect(menus(page)).toHaveCount(0);
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#mb-after')).toBeFocused();
  expect(await log(page)).toEqual(['close:outside', 'after:click']);

  // On the canvas: the menu closes and the node under the press is selected.
  await openByPointer(page);
  await press(page, 'ArrowDown');
  expect(await statusCount(page, 'selected')).toBe(0);
  await clickNode(page, 'fw');
  await expect(menus(page)).toHaveCount(0);
  await expect.poll(() => statusCount(page, 'selected')).toBe(1);
  expect((await log(page)).slice(2)).toEqual(['close:outside']);
  expect(await leftovers(page)).toBe(0);

  // Nothing is still listening: further presses close nothing more.
  await page.locator('#mb-before').click();
  await page.locator('#mb-after').click();
  expect((await log(page)).slice(3)).toEqual(['after:click']);
});

test('a press on the trigger of an open menu closes it instead of reopening it', async ({
  page,
}) => {
  await openByPointer(page);
  await trigger(page).click();
  await expect(menus(page)).toHaveCount(0);
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  expect(await log(page)).toEqual(['close:programmatic']);

  // And the next click opens it again.
  await trigger(page).click();
  await expect(menus(page)).toHaveCount(1);
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
});

test('Tab closes everything and focus moves on from the trigger', async ({
  page,
}) => {
  // The overlay primitive would trap Tab at the first and last focusable of
  // its root. The layer's inert sentinels keep every real focus target away
  // from those ends: pin what that relies on.
  await openByKeyboard(page);
  const sentinels = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-layer > .menu-edge')].map((el) => ({
      inert: el.hasAttribute('inert'),
      tabindex: el.getAttribute('tabindex'),
      hasBox: el.getClientRects().length > 0,
      atEnd:
        el === el.parentElement?.firstElementChild ||
        el === el.parentElement?.lastElementChild,
    })),
  );
  expect(sentinels).toEqual([
    { inert: true, tabindex: '0', hasBox: true, atEnd: true },
    { inert: true, tabindex: '0', hasBox: true, atEnd: true },
  ]);

  // From the first item.
  await press(page, 'Tab');
  await expect(menus(page)).toHaveCount(0);
  await expect(page.locator('#mb-button')).toBeFocused();
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  expect(await log(page)).toEqual(['close:tab']);

  // From the last item (where a focus trap would wrap).
  await openByKeyboard(page);
  await press(page, 'End');
  await expect(item(page, 'Delete')).toBeFocused();
  await press(page, 'Tab');
  await expect(menus(page)).toHaveCount(0);
  await expect(page.locator('#mb-button')).toBeFocused();

  // Shift+Tab from the first item goes the other way.
  await openByKeyboard(page);
  await press(page, 'Shift+Tab');
  await expect(menus(page)).toHaveCount(0);
  await expect(page.locator('#mb-before')).toBeFocused();

  // From inside a submenu: the whole chain closes.
  await openByKeyboard(page);
  await press(page, 's', 's', 'ArrowRight', 'End', 'ArrowRight');
  await expect(item(page, 'Deep')).toBeFocused();
  await press(page, 'Tab');
  await expect(menus(page)).toHaveCount(0);
  await expect(page.locator('#mb-button')).toBeFocused();

  // From the menu itself (a pointer open, no item focused).
  await openByPointer(page);
  await press(page, 'Tab');
  await expect(menus(page)).toHaveCount(0);
  await expect(page.locator('#mb-button')).toBeFocused();
  await openByPointer(page);
  await press(page, 'Shift+Tab');
  await expect(menus(page)).toHaveCount(0);
  await expect(page.locator('#mb-before')).toBeFocused();

  expect(await log(page)).toEqual(Array<string>(6).fill('close:tab'));
  expect(await leftovers(page)).toBe(0);
});

test('the menu closes when the window loses focus, is resized, or focus is taken elsewhere', async ({
  page,
}) => {
  await openByKeyboard(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(menus(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();

  await openByKeyboard(page);
  await page.setViewportSize({ width: 1180, height: 700 });
  await expect(menus(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();

  // Focus moved by something else: the menu goes, and does not pull it back.
  await openByKeyboard(page);
  await page.evaluate(() => document.getElementById('mb-after')!.focus());
  await expect(menus(page)).toHaveCount(0);
  await expect(page.locator('#mb-after')).toBeFocused();

  expect(await log(page)).toEqual(['close:blur', 'close:resize', 'close:blur']);
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  expect(await leftovers(page)).toBe(0);
});

test('opening a menu closes the one already open; close() and closeAllMenus() report themselves', async ({
  page,
}) => {
  await openByKeyboard(page);
  // A context menu at a point, while the Actions menu is open.
  const state = await page.evaluate(() => {
    const bench = window.menuBench!;
    const handle = bench.menu.openMenu(
      [{ id: 'ctx.one', label: 'One', run: () => bench.log.push('run:one') }],
      {
        anchor: { x: 600, y: 300 },
        label: 'Canvas',
        onClose: (reason) => bench.log.push(`ctx:${reason}`),
      },
    );
    return {
      open: handle.isOpen(),
      isRoot: handle.element === document.querySelector('.menu'),
      layers: document.querySelectorAll('.menu-layer').length,
      label: handle.element.getAttribute('aria-label'),
    };
  });
  expect(state).toEqual({
    open: true,
    isRoot: true,
    layers: 1,
    label: 'Canvas',
  });
  expect(await log(page)).toEqual(['close:programmatic']);
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  // Its corner is on the point.
  const box = (await menus(page).first().boundingBox())!;
  expect({ x: box.x, y: box.y }).toEqual({ x: 600, y: 300 });

  await page.evaluate(() => window.menuBench!.menu.closeAllMenus());
  await expect(menus(page)).toHaveCount(0);
  // A menu opened at a point returns focus to whatever had it before.
  await expect(trigger(page)).toBeFocused();
  expect((await log(page)).slice(1)).toEqual(['ctx:programmatic']);

  // A handle keeps answering after its menu has gone, and closing twice is
  // harmless.
  const after = await page.evaluate(() => {
    const bench = window.menuBench!;
    const handle = bench.menu.openMenu([{ label: 'One' }], {
      anchor: { x: 600, y: 300 },
      onClose: (reason) => bench.log.push(`again:${reason}`),
    });
    handle.close('escape');
    handle.close();
    bench.menu.closeAllMenus();
    return handle.isOpen();
  });
  expect(after).toBe(false);
  expect((await log(page)).slice(2)).toEqual(['again:escape']);
  expect(await leftovers(page)).toBe(0);
});

test('closing leaves nothing behind: no elements, and no timer that still opens a submenu', async ({
  page,
}) => {
  await openByPointer(page);
  // Start the hover timer for the Share submenu, then close before it fires.
  await item(page, 'Share').hover();
  await press(page, 'Escape');
  expect(await leftovers(page)).toBe(0);
  await page.waitForTimeout(400);
  expect(await leftovers(page)).toBe(0);

  // The same with a submenu open and a typeahead buffer pending.
  await openByKeyboard(page);
  await press(page, 's', 's', 'ArrowRight', 'e');
  await expect(item(page, 'Embed')).toBeFocused();
  await press(page, 'Tab');
  expect(await leftovers(page)).toBe(0);
  await page.waitForTimeout(700);
  expect(await leftovers(page)).toBe(0);
});

/* ── The editor shell behind it ─────────────────────────────────────── */

test("the editor's shortcuts stand down while a menu is open, and work again after it closes", async ({
  page,
}) => {
  await clickNode(page, 'fw');
  await expect.poll(() => statusCount(page, 'selected')).toBe(1);
  const nodes = await statusCount(page, 'nodes');
  const before = await nodeBox(page, 'fw');
  expect(await statusText(page, 'tool')).toBe('select');

  await openByPointer(page);
  // "l" is the link tool, Delete removes the selection, the arrows nudge it,
  // "?" opens the shortcut sheet, Space pans: none of them reach the editor.
  // (Space while the menu itself has focus; on an item it would activate it.)
  await press(page, 'l', 'Delete', 'Backspace', 'ArrowRight', '?', 'v');
  await press(page, 'Space', 'ArrowDown', 'ArrowDown');
  await expect(item(page, 'Copy')).toBeFocused();
  expect(await statusText(page, 'tool')).toBe('select');
  expect(await statusCount(page, 'nodes')).toBe(nodes);
  expect(await nodeBox(page, 'fw')).toEqual(before);
  await expect(page.locator('.help-card')).toHaveCount(0);
  await expect(menus(page)).toHaveCount(1);

  // Escape closes the menu and nothing else: the selection is still there.
  await press(page, 'Escape');
  await expect(menus(page)).toHaveCount(0);
  expect(await statusCount(page, 'selected')).toBe(1);

  // The shortcuts are the editor's again.
  await press(page, 'l');
  expect(await statusText(page, 'tool')).toBe('link');
  await press(page, 'v');
  expect(await statusText(page, 'tool')).toBe('select');
  await press(page, 'ArrowRight');
  await expect
    .poll(async () => (await nodeBox(page, 'fw')).x)
    .toBeGreaterThan(before.x);
});

test('both themes come from the tokens', async ({ page }) => {
  await openByKeyboard(page);
  const paint = (): Promise<{ background: string; text: string }> =>
    menus(page)
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, text: style.color };
      });
  const token = (name: string): Promise<string> =>
    page.evaluate((n) => {
      const probe = document.createElement('div');
      probe.style.background = `var(${n})`;
      document.body.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    }, name);

  await page.evaluate(() => document.documentElement.classList.remove('light'));
  const dark = await paint();
  expect(dark.background).toBe(await token('--surface-float'));
  expect(dark.text).toBe(await token('--fg'));

  await page.evaluate(() => document.documentElement.classList.add('light'));
  const light = await paint();
  expect(light.background).toBe(await token('--surface-float'));
  expect(light.text).toBe(await token('--fg'));

  expect(light.background).not.toBe(dark.background);
  expect(light.text).not.toBe(dark.text);
  // The shortcut hint is in the data face, the label in the UI face.
  const faces = await item(page, 'Cut').evaluate((el) => ({
    label: getComputedStyle(el.querySelector('.menu-label')!).fontFamily,
    hint: getComputedStyle(el.querySelector('.menu-hint')!).fontFamily,
  }));
  expect(faces.label).toContain('Inter');
  expect(faces.hint).toContain('JetBrains Mono');
});

/* ── Placement ──────────────────────────────────────────────────────── */

test('a menu opens under its trigger and stays inside the viewport near the edges', async ({
  page,
}) => {
  await openByKeyboard(page);
  const anchor = (await trigger(page).boundingBox())!;
  const below = (await menus(page).first().boundingBox())!;
  expect(below.x).toBe(Math.round(anchor.x));
  expect(below.y).toBe(Math.round(anchor.y + anchor.height + 4));
  await expect(menus(page).first()).toHaveAttribute(
    'data-placement',
    'below-start',
  );
  await press(page, 'Escape');

  // At the bottom-right corner: flipped above, hanging from its right edge,
  // and its submenu opens to the left.
  const viewport = page.viewportSize()!;
  await page.evaluate(
    ({ x, y }) => {
      const share: MenuEntry = {
        label: 'Share',
        submenu: [{ label: 'Link' }, { label: 'Embed' }],
      };
      window.menuBench!.menu.openMenu([{ label: 'One' }, share], {
        anchor: { x, y },
        focus: 'last',
      });
    },
    { x: viewport.width - 12, y: viewport.height - 12 },
  );
  await expect(item(page, 'Share')).toBeFocused();
  await expect(menus(page).first()).toHaveAttribute(
    'data-placement',
    'above-end',
  );
  await press(page, 'ArrowRight');
  await expect(item(page, 'Link')).toBeFocused();
  await expect(menus(page).nth(1)).toHaveAttribute(
    'data-placement',
    'left-start',
  );
  for (const box of [
    (await menus(page).first().boundingBox())!,
    (await menus(page).nth(1).boundingBox())!,
  ]) {
    expect(box.x).toBeGreaterThanOrEqual(4);
    expect(box.y).toBeGreaterThanOrEqual(4);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 4);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 4);
  }
  const rootBox = (await menus(page).first().boundingBox())!;
  const subBox = (await menus(page).nth(1).boundingBox())!;
  expect(subBox.x + subBox.width).toBeLessThanOrEqual(rootBox.x + 8);
});

test('a menu taller than the viewport scrolls inside itself', async ({
  page,
}) => {
  await page.evaluate(() => {
    const many: MenuEntry[] = Array.from({ length: 60 }, (_, i) => ({
      label: `Item ${i + 1}`,
    }));
    window.menuBench!.menu.openMenu(many, {
      anchor: document.getElementById('mb-trigger')!,
      focus: 'first',
    });
  });
  const root = menus(page).first();
  await expect(item(page, 'Item 1')).toBeFocused();
  await expect(root).toHaveClass(/\bscroll-slim\b/);
  const viewport = page.viewportSize()!;
  const box = (await root.boundingBox())!;
  expect(box.y).toBe(4);
  expect(box.height).toBe(viewport.height - 8);
  const scrolls = await root.evaluate(
    (el) => el.scrollHeight > el.clientHeight,
  );
  expect(scrolls).toBe(true);

  // Keyboard focus brings the far end into view.
  await press(page, 'End');
  await expect(item(page, 'Item 60')).toBeFocused();
  await expect(item(page, 'Item 60')).toBeInViewport();
  const last = (await item(page, 'Item 60').boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(box.y + box.height);
});

/* ── Menu button ────────────────────────────────────────────────────── */

test('a menu button announces its popup, opens from the keyboard and toggles on click', async ({
  page,
}) => {
  const more = page.locator('#mb-button');
  await expect(more).toHaveAttribute('aria-haspopup', 'menu');
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  // ArrowDown: first item. The menu hangs from the button's right corner.
  await more.focus();
  await press(page, 'ArrowDown');
  await expect(item(page, 'Refresh')).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(menus(page).first()).toHaveAttribute('aria-label', 'More');
  const anchor = (await more.boundingBox())!;
  const box = (await menus(page).first().boundingBox())!;
  expect(Math.abs(box.x + box.width - (anchor.x + anchor.width))).toBeLessThan(
    1,
  );
  await press(page, 'Escape');
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  // ArrowUp: last item (disabled ones are skipped for the initial focus).
  await press(page, 'ArrowUp');
  await expect(
    page.locator('.menu-item[data-command="more.hostile"]'),
  ).toBeFocused();
  await press(page, 'Escape');

  // Enter and Space are the button's click: first item.
  await press(page, 'Enter');
  await expect(item(page, 'Refresh')).toBeFocused();
  await press(page, 'Escape');
  await press(page, 'Space');
  await expect(item(page, 'Refresh')).toBeFocused();
  await press(page, 'Enter');
  await expect(menus(page)).toHaveCount(0);
  await expect(more).toBeFocused();

  // A pointer click toggles, with focus on the menu itself.
  await more.click();
  await expect(menus(page).first()).toBeFocused();
  await more.click();
  await expect(menus(page)).toHaveCount(0);
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  expect(await log(page)).toEqual([
    'close:escape',
    'close:escape',
    'close:escape',
    'close:select',
    'run:more.refresh menus=0 focus=mb-button',
    'close:programmatic',
  ]);

  // destroy() takes the listeners with it.
  await page.evaluate(() => window.menuBench!.button.destroy());
  await more.click();
  await press(page, 'ArrowDown');
  await expect(menus(page)).toHaveCount(0);
});

/* ── Menu bar ───────────────────────────────────────────────────────── */

test('menu bar: one tab stop, arrows move between the buttons and wrap, and open the menus', async ({
  page,
}) => {
  const file = barButton(page, 'file');
  const edit = barButton(page, 'edit');
  const view = barButton(page, 'view');
  for (const button of [file, edit, view]) {
    await expect(button).toHaveAttribute('aria-haspopup', 'menu');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(file).toHaveAttribute('tabindex', '0');
  await expect(edit).toHaveAttribute('tabindex', '-1');
  await expect(view).toHaveAttribute('tabindex', '-1');

  // The bar is one stop in the page's tab order.
  await page.locator('#mb-button').focus();
  await press(page, 'Tab');
  await expect(file).toBeFocused();
  await press(page, 'Tab');
  await expect(page.locator('#mb-after')).toBeFocused();
  await press(page, 'Shift+Tab');
  await expect(file).toBeFocused();

  await press(page, 'ArrowRight');
  await expect(edit).toBeFocused();
  await expect(edit).toHaveAttribute('tabindex', '0');
  await expect(file).toHaveAttribute('tabindex', '-1');
  await press(page, 'ArrowRight', 'ArrowRight');
  await expect(file).toBeFocused();
  await press(page, 'ArrowLeft');
  await expect(view).toBeFocused();
  await press(page, 'Home');
  await expect(file).toBeFocused();
  await press(page, 'End');
  await expect(view).toBeFocused();
  await expect(menus(page)).toHaveCount(0);
  // The tab stop followed: leaving and coming back lands on View.
  await press(page, 'Tab', 'Shift+Tab');
  await expect(view).toBeFocused();

  // ArrowDown opens on the first item; Escape returns to the button.
  await press(page, 'Home', 'ArrowDown');
  await expect(item(page, 'New')).toBeFocused();
  await expect(file).toHaveAttribute('aria-expanded', 'true');
  await expect(menus(page).first()).toHaveAttribute('aria-label', 'File');
  const anchor = (await file.boundingBox())!;
  const box = (await menus(page).first().boundingBox())!;
  expect(box.x).toBe(Math.round(anchor.x));
  expect(box.y).toBe(Math.round(anchor.y + anchor.height + 4));
  await press(page, 'Escape');
  await expect(menus(page)).toHaveCount(0);
  await expect(file).toBeFocused();
  await expect(file).toHaveAttribute('aria-expanded', 'false');

  // ArrowUp opens on the last item; Enter and Space on the first.
  await press(page, 'ArrowUp');
  await expect(item(page, 'Close')).toBeFocused();
  await press(page, 'Escape', 'Enter');
  await expect(item(page, 'New')).toBeFocused();
  await press(page, 'Escape', 'Space');
  await expect(item(page, 'New')).toBeFocused();

  // An item runs after the menu has closed, focus back on its button.
  await press(page, 'ArrowDown', 'Enter');
  await expect(menus(page)).toHaveCount(0);
  await expect(file).toBeFocused();
  expect(await log(page)).toEqual(['run:file.open menus=0 focus=file']);
  expect(await leftovers(page)).toBe(0);
});

test('menu bar: with a menu open, Left and Right switch menus; submenus take the arrows first', async ({
  page,
}) => {
  const file = barButton(page, 'file');
  const edit = barButton(page, 'edit');
  const view = barButton(page, 'view');
  await file.focus();
  await press(page, 'ArrowDown');
  await expect(item(page, 'New')).toBeFocused();

  // Right on an item without a submenu: the next menu, first enabled item.
  await press(page, 'ArrowRight');
  await expect(menus(page)).toHaveCount(1);
  await expect(menus(page).first()).toHaveAttribute('aria-label', 'Edit');
  await expect(item(page, 'Redo')).toBeFocused(); // Undo is disabled
  await expect(file).toHaveAttribute('aria-expanded', 'false');
  await expect(edit).toHaveAttribute('aria-expanded', 'true');
  await expect(edit).toHaveAttribute('tabindex', '0');

  await press(page, 'ArrowRight');
  await expect(item(page, 'Zoom in')).toBeFocused();
  await expect(view).toHaveAttribute('aria-expanded', 'true');
  // Wraps from the last menu to the first, and back.
  await press(page, 'ArrowRight');
  await expect(item(page, 'New')).toBeFocused();
  await press(page, 'ArrowLeft');
  await expect(item(page, 'Zoom in')).toBeFocused();
  await press(page, 'ArrowLeft');
  await expect(item(page, 'Redo')).toBeFocused();
  await press(page, 'ArrowLeft');
  await expect(item(page, 'New')).toBeFocused();

  // On a submenu parent, Right opens the submenu instead.
  await press(page, 'ArrowDown', 'ArrowDown');
  await expect(item(page, 'Export')).toBeFocused();
  await press(page, 'ArrowRight');
  await expect(menus(page)).toHaveCount(2);
  await expect(item(page, 'PNG')).toBeFocused();
  await expect(file).toHaveAttribute('aria-expanded', 'true');
  // Inside it, Left closes the submenu rather than changing menus…
  await press(page, 'ArrowLeft');
  await expect(menus(page)).toHaveCount(1);
  await expect(item(page, 'Export')).toBeFocused();
  // …and Right on a plain item there moves to the next menu.
  await press(page, 'ArrowRight', 'ArrowRight');
  await expect(menus(page)).toHaveCount(1);
  await expect(item(page, 'Redo')).toBeFocused();

  // Escape closes the menu and returns to its own top-level button.
  await press(page, 'Escape');
  await expect(menus(page)).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expect(edit).toHaveAttribute('aria-expanded', 'false');
  // The bar still has the keyboard: the arrows move on from Edit.
  await press(page, 'ArrowRight');
  await expect(view).toBeFocused();
  expect(await leftovers(page)).toBe(0);
});

test('menu bar: a click toggles, hovering switches while a menu is open, and destroy() unhooks it', async ({
  page,
}) => {
  const file = barButton(page, 'file');
  const edit = barButton(page, 'edit');
  const view = barButton(page, 'view');

  // Hovering with no menu open does nothing.
  await edit.hover();
  await expect(menus(page)).toHaveCount(0);

  await file.click();
  await expect(menus(page).first()).toHaveAttribute('aria-label', 'File');
  await expect(menus(page).first()).toBeFocused();
  await expect(file).toHaveAttribute('aria-expanded', 'true');

  await edit.hover();
  await expect(menus(page).first()).toHaveAttribute('aria-label', 'Edit');
  await expect(menus(page)).toHaveCount(1);
  await expect(file).toHaveAttribute('aria-expanded', 'false');
  await expect(edit).toHaveAttribute('aria-expanded', 'true');
  await view.hover();
  await expect(menus(page).first()).toHaveAttribute('aria-label', 'View');

  // A click on the open menu's button closes it.
  await view.click();
  await expect(menus(page)).toHaveCount(0);
  await expect(view).toHaveAttribute('aria-expanded', 'false');
  // And hovering no longer opens anything.
  await file.hover();
  await expect(menus(page)).toHaveCount(0);

  // A click on another button while one is open moves to it.
  await file.click();
  await expect(menus(page).first()).toHaveAttribute('aria-label', 'File');
  await item(page, 'New').click();
  await expect(menus(page)).toHaveCount(0);
  expect(await log(page)).toEqual(['run:file.new menus=0 focus=file']);

  await page.evaluate(() => window.menuBench!.bar.destroy());
  await file.click();
  await file.focus();
  await press(page, 'ArrowDown', 'ArrowRight');
  await expect(menus(page)).toHaveCount(0);
  expect(await leftovers(page)).toBe(0);
});

test('a trigger that was only clicked does not keep the arrow keys from the canvas', async ({
  page,
}) => {
  const file = barButton(page, 'file');
  const edit = barButton(page, 'edit');
  await clickNode(page, 'fw');
  await expect.poll(() => statusCount(page, 'selected')).toBe(1);
  const before = await nodeBox(page, 'fw');

  // Opened and closed with the pointer: focus is on File, but the keyboard
  // is still the canvas's (src/ui/key-routing.ts), so the arrow nudges.
  await file.click();
  await file.click();
  await expect(menus(page)).toHaveCount(0);
  await expect(file).toBeFocused();
  await press(page, 'ArrowRight');
  await expect(file).toBeFocused();
  await expect
    .poll(async () => (await nodeBox(page, 'fw')).x)
    .toBeGreaterThan(before.x);
  await press(page, 'ArrowDown');
  await expect(menus(page)).toHaveCount(0);

  // The same after choosing an item with the pointer.
  await file.click();
  await item(page, 'New').click();
  await expect(file).toBeFocused();
  const nudged = await nodeBox(page, 'fw');
  await press(page, 'ArrowRight');
  await expect(file).toBeFocused();
  await expect
    .poll(async () => (await nodeBox(page, 'fw')).x)
    .toBeGreaterThan(nudged.x);

  // Reached with Tab, the bar has the keyboard and the node stays put.
  await tabTo(page, '#mb-bar [data-menu="file"]');
  const settled = await nodeBox(page, 'fw');
  await press(page, 'ArrowRight');
  await expect(edit).toBeFocused();
  await press(page, 'ArrowDown');
  await expect(item(page, 'Redo')).toBeFocused();
  expect(await nodeBox(page, 'fw')).toEqual(settled);

  // And so it has after the keyboard closed a menu the pointer opened.
  await press(page, 'Escape');
  await file.click();
  await press(page, 'ArrowDown', 'Escape');
  await expect(file).toBeFocused();
  await press(page, 'ArrowRight');
  await expect(edit).toBeFocused();
  expect(await nodeBox(page, 'fw')).toEqual(settled);
});
