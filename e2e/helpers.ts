import { expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** The debounced (400ms) localStorage autosave, parsed. */
export async function readAutosave(
  page: Page,
  slot: 'local' | 'shared' = 'local',
): Promise<{ title: string; pages: { nodes: unknown[] }[] } | null> {
  return page.evaluate((s) => {
    const key =
      s === 'shared' ? 'topology-dojo:doc:shared' : 'topology-dojo:doc';
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, slot);
}
