import { expect, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTemplates } from '../src/api/templates.js';
import {
  COMMAND_SPECS,
  createCommandRegistry,
  templateCommandSpecs,
} from '../src/ui/commands.js';
import { menuBarPath, type MenuContext } from '../src/ui/menus.js';

export const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

/** Open the editor with clean browser storage and wait until it's interactive.
 * Storage is cleared with a one-off navigation (not addInitScript, which would
 * re-run on every reload and wipe the autosave under test). */
export async function bootEditor(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#page-canvas')).toBeVisible();
  // Phone-width layouts default the node library closed (#221); the toggle is
  // the reliable "editor chrome is up" signal. Desktop still waits for tiles
  // so callers can click a catalog item immediately.
  await expect(page.locator('#palette-toggle')).toBeVisible();
  const paletteOpen = await page
    .locator('#palette')
    .evaluate((el) => !el.classList.contains('collapsed'));
  if (paletteOpen) await expect(page.locator('.pitem').first()).toBeVisible();
}

/** Element count for one status-bar key (`nodes`, `links`, …). */
export async function statusCount(page: Page, key: string): Promise<number> {
  const row = page.locator('#statusbar span', {
    has: page.locator(`.sb-k:text-is("${key}")`),
  });
  const text = await row.first().innerText();
  return Number(text.replace(key, '').trim());
}

/** The text shown for one status-bar key (`tool` → "select"). */
export async function statusText(page: Page, key: string): Promise<string> {
  const row = page.locator('#statusbar span', {
    has: page.locator(`.sb-k:text-is("${key}")`),
  });
  return (await row.first().innerText()).replace(key, '').trim();
}

/** The on-screen box of a node drawn on the canvas, by its id. */
export async function nodeBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate((nodeId) => {
    const el = document.querySelector(
      `#page-canvas [data-tds-node="${CSS.escape(nodeId)}"]`,
    );
    if (!el) throw new Error(`no node "${nodeId}" on the canvas`);
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, id);
}

/** Click a node on the canvas (selects it), by its id. */
export async function clickNode(page: Page, id: string): Promise<void> {
  const box = await nodeBox(page, id);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** A point on the drawn route of a link, by its id (`at` of the way along). */
export async function linkPoint(
  page: Page,
  id: string,
  at = 0.4,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([linkId, t]) => {
      const g = document.querySelector(
        `#page-canvas g[data-tds-link="${CSS.escape(linkId)}"]`,
      );
      if (!g) throw new Error(`no link "${linkId}" on the canvas`);
      const el = [...g.querySelectorAll<SVGGeometryElement>('path, line')].sort(
        (a, b) => b.getTotalLength() - a.getTotalLength(),
      )[0]!;
      const q = el.getPointAtLength(el.getTotalLength() * t);
      const p = new DOMPoint(q.x, q.y).matrixTransform(el.getScreenCTM()!);
      return { x: p.x, y: p.y };
    },
    [id, at] as const,
  );
}

/** Click a link on the canvas (selects it), by its id. */
export async function clickLink(page: Page, id: string): Promise<void> {
  const p = await linkPoint(page, id);
  await page.mouse.click(p.x, p.y);
}

/** One saved element as loose JSON, for asserting on its stored fields. */
export type SavedElement = Record<string, unknown> & { id: string };

/** A saved page as loose JSON. */
export interface SavedPage {
  viewBox: string;
  nodes: SavedElement[];
  links: SavedElement[];
  zones: SavedElement[];
  flowPaths: SavedElement[];
  policyMarkers: SavedElement[];
  [key: string]: unknown;
}

/**
 * The document as autosaved once the editor reports the latest change saved.
 * Call it after an edit: a tab that has changed nothing has saved nothing.
 */
export async function savedDocument(
  page: Page,
): Promise<{ title: string; pages: SavedPage[]; [key: string]: unknown }> {
  await expect(page.locator('#saved')).toHaveText('✓ saved');
  const doc = await page.evaluate(() =>
    localStorage.getItem('topology-dojo:doc'),
  );
  if (!doc) throw new Error('nothing has been autosaved yet');
  return JSON.parse(doc) as {
    title: string;
    pages: SavedPage[];
    [key: string]: unknown;
  };
}

/**
 * The toolbar's export chip says that export `name` finished: in words, with
 * the check icon before them, and in the state it is styled by.
 */
export async function expectExported(page: Page, name: string): Promise<void> {
  const status = page.locator('#exportStatus');
  await expect(status).toHaveText(`exported ${name}`);
  await expect(status.locator('.icon use')).toHaveAttribute('href', '#i-check');
  await expect(status).toHaveClass(/export-ok/);
}

/** One element of the first saved page, by collection and id. */
export async function savedElement(
  page: Page,
  collection: 'nodes' | 'links' | 'zones' | 'flowPaths' | 'policyMarkers',
  id: string,
): Promise<SavedElement> {
  const doc = await savedDocument(page);
  const el = doc.pages[0]![collection].find((e) => e.id === id);
  if (!el) throw new Error(`no ${collection} element "${id}" in the autosave`);
  return el;
}

/**
 * Move keyboard focus to a control the way a keyboard user does: with Tab.
 * `locator.focus()` alone is a scripted focus, which the editor (rightly)
 * does not take as the user navigating by keyboard.
 */
export async function tabTo(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  await target.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
}

/**
 * Open a document JSON fixture through the toolbar's hidden file input, and
 * wait until it is on the canvas. The file is read asynchronously, so choosing
 * it is not the load; the save chip is the signal. It shows "…" the moment the
 * new document replaces the old one and "✓ saved" once that is autosaved.
 * Returning any earlier lets a caller read the previous document's counts.
 */
export async function openFixture(page: Page, name: string): Promise<void> {
  const loaded = page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const chip = document.querySelector('#saved')!;
        let replaced = false;
        const observer = new MutationObserver(() => {
          const text = chip.textContent ?? '';
          if (text === '…') replaced = true;
          else if (replaced && text.startsWith('✓')) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(chip, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }),
  );
  await page.locator('#fInput').setInputFiles(path.join(fixturesDir, name));
  await loaded;
}

/**
 * The debounced (400ms) localStorage autosave, parsed.
 *
 * A change is saved 400ms after it is made, and a tab that has changed nothing
 * has saved nothing. So this waits (up to two seconds) for the entry to exist
 * rather than hand null to a caller that reads straight after an edit; it
 * still returns null if nothing is ever saved.
 */
export async function readAutosave(
  page: Page,
  slot: 'local' | 'shared' = 'local',
): Promise<{ title: string; pages: { nodes: unknown[] }[] } | null> {
  const raw = await page.evaluate(async (s) => {
    const key =
      s === 'shared' ? 'topology-dojo:doc:shared' : 'topology-dojo:doc';
    const deadline = Date.now() + 2000;
    for (;;) {
      const value = localStorage.getItem(key);
      if (value !== null || Date.now() > deadline) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }, slot);
  return raw
    ? (JSON.parse(raw) as { title: string; pages: { nodes: unknown[] }[] })
    : null;
}

/** Show one tab of the properties panel: 'selection', 'page' or 'document'. */
export async function inspectorTab(
  page: Page,
  tab: 'selection' | 'page' | 'document',
): Promise<void> {
  const button = page.locator(`#insp-tab-${tab}`);
  await button.click();
  await expect(button).toHaveAttribute('aria-selected', 'true');
}

/** Open a section of the properties panel by its title, unless it is open. */
export async function inspectorSection(
  page: Page,
  title: string,
): Promise<void> {
  const section = page
    .locator(`#inspector details.insp-group[data-group="${title}"]`)
    .first();
  if (!(await section.evaluate((d) => (d as HTMLDetailsElement).open)))
    await section.locator('> summary').click();
  await expect(section).toHaveAttribute('open', '');
}

/**
 * Pick a swatch of a colour control in the properties panel: open the
 * popover the swatch is in (from the control's button), then click it.
 */
export async function chooseSwatch(swatch: Locator): Promise<void> {
  const control = swatch.locator(
    'xpath=ancestor::*[contains(concat(" ", @class, " "), " colour-ctl ")][1]',
  );
  await control.locator('[data-colour-open]').click();
  await swatch.click();
}

/**
 * The menu bar as the shell defines it (src/ui/menus.ts), with every command
 * offered: where each command is, so a test goes straight to it as a person
 * who knows the menus does. What the running page offers is still the
 * page's own: an item it does not show is an error here.
 */
const MENU_PATHS: MenuContext = (() => {
  const templates = listTemplates();
  const specs = [...COMMAND_SPECS, ...templateCommandSpecs(templates)];
  const commands = createCommandRegistry(specs);
  for (const spec of specs) commands.bind(spec.id, { run: () => undefined });
  return {
    commands,
    templates,
    shareAvailable: true,
    account: { login: 'e2e', admin: true },
  };
})();

/** A regular expression that matches exactly `text`. */
const exactly = (text: string): RegExp =>
  new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/**
 * Run a command from the menu bar the way a mouse user does: open the menu
 * that holds it (through the one Menu button, in a window narrow enough to
 * fold the menus), open the submenus on the way, and click the item
 * (`data-command` is the command id).
 */
export async function menuCommand(
  page: Page,
  commandId: string,
): Promise<void> {
  const path = menuBarPath(MENU_PATHS, commandId);
  if (!path) throw new Error(`no menu of the menu bar holds "${commandId}"`);
  const onBar = page.locator(`#menubar [data-menu="${path.menu}"]`);
  // Folded, the bar's menus are the submenus of the Menu button's menu.
  const folded = !(await onBar.isVisible());
  const submenus = folded ? [path.menuLabel, ...path.submenus] : path.submenus;
  await (folded ? page.locator('#menuMore') : onBar).click();
  const menus = page.locator('.menu-layer .menu');
  await expect(menus.first()).toBeVisible();
  for (const [level, label] of submenus.entries()) {
    await menus
      .nth(level)
      .locator('[aria-haspopup="menu"]')
      .filter({ has: page.locator('.menu-label', { hasText: exactly(label) }) })
      .click();
    await expect(menus.nth(level + 1)).toBeVisible();
  }
  const item = menus
    .nth(submenus.length)
    .locator(`[data-command="${commandId.replace(/"/g, '\\"')}"]`);
  if ((await item.count()) === 0)
    throw new Error(
      `the page's ${[path.menuLabel, ...path.submenus].join(' ▸ ')} menu does not offer "${commandId}"`,
    );
  await item.click();
}

/**
 * Export with the top bar's Export menu. `kind` is the export as the
 * command names it after `file.export.`, in the words of the old menu's
 * values: 'svg', 'png', 'pdf-page', 'svg-selection', ….
 */
export async function exportAs(page: Page, kind: string): Promise<void> {
  const id = kind.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
  await page.locator('#fExportBtn').click();
  await page.locator(`.menu-layer [data-command="file.export.${id}"]`).click();
}

/** Start a new document from the starter template `id` (File ▸ New from
 * template). */
export async function newFromTemplate(page: Page, id: string): Promise<void> {
  await menuCommand(page, `file.template.${id}`);
}

/** The canvas's right-click menu, opened with the shell's menu component. */
export const CONTEXT_MENU = '.menu[aria-label="Canvas context menu"]';
/** An item of the open context menu whose text has `text`. */
export const contextItem = (page: Page, text: string): Locator =>
  page.locator(`${CONTEXT_MENU} .menu-item`, { hasText: text });
