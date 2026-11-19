/**
 * The command palette component (src/ui/command-palette.ts), on its own.
 *
 * The palette is not wired into the shell yet, so each test loads the editor
 * and then imports the module in the page with a dynamic `import()` of its
 * `/src/ui/command-palette.ts` path. That path resolves because the e2e suite
 * runs against the Vite dev server, which serves (and compiles) the source
 * tree; it is the same module instance the shell would import, so the palette
 * registers with the same overlay stack the editor's shortcut handler reads.
 *
 * The fixture (the entries, a button to give focus back to and, where a test
 * needs them, a button and a key listener that open the palette) is mounted
 * into document.body from page.evaluate and removed after each test.
 */
import { expect, test, type Page } from '@playwright/test';
import type { PaletteHandle } from '../src/ui/command-palette.js';
import {
  bootEditor,
  clickNode,
  nodeBox,
  statusCount,
  statusText,
} from './helpers.js';

const MODULE_PATH = '/src/ui/command-palette.ts';
type PaletteModule = typeof import('../src/ui/command-palette.js');

/** An entry as the test describes it; `run` is made in the page. */
interface EntrySpec {
  id: string;
  title: string;
  group?: string;
  hint?: string;
  keywords?: string[];
  iconHtml?: string;
  disabled?: boolean;
  /** Make `run` throw an Error with this message. */
  throws?: string;
}

/** What the page records about the palette under test. */
interface Fixture {
  /** Every handle `openCommandPalette` returned, in order. */
  handles: PaletteHandle[];
  /** `close` for each onClose, `run:<id>` for each run, in order. */
  log: string[];
  /** The state of the page at the moment each `run` was called. */
  runs: {
    id: string;
    paletteInDom: boolean;
    handleOpen: boolean;
    focus: string;
  }[];
  /** Removes what `mountOpeners` added to window. */
  listeners?: AbortController;
}
type FixtureWindow = Window & {
  __paletteTest?: Fixture;
  __pwned?: number;
  /** How often the title of a counting entry has been read. */
  __titleReads?: number;
};

interface OpenOptions {
  /** Where focus is when the palette opens: on the fixture's button (the
   * default), on nothing (the page body), or wherever it already is. */
  focus?: 'invoker' | 'nothing' | 'keep';
  emptyText?: string;
}

const COMMANDS: EntrySpec[] = [
  { id: 'tidy', title: 'Tidy layout', group: 'Arrange', hint: 'T' },
  { id: 'balance', title: 'Balance layout', group: 'Arrange', hint: 'Shift+T' },
  { id: 'align-left', title: 'Align left', group: 'Arrange' },
  {
    id: 'grid',
    title: 'Toggle grid',
    group: 'View',
    hint: 'R',
    keywords: ['dots'],
  },
  { id: 'svg', title: 'Export: SVG', group: 'File' },
  {
    id: 'paste',
    title: 'Paste',
    group: 'Edit',
    hint: 'Ctrl+V',
    disabled: true,
  },
];

const manyEntries = (count: number): EntrySpec[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `entry-${i}`,
    title: `Entry ${i}`,
    group: 'Test',
  }));

/** Import the module in the page and open the palette on `entries`. */
async function openPalette(
  page: Page,
  entries: EntrySpec[],
  options: OpenOptions = {},
): Promise<void> {
  await page.evaluate(
    async ({ modulePath, entries, options }) => {
      const palette = (await import(modulePath)) as PaletteModule;
      const w = window as FixtureWindow;
      const fixture = (w.__paletteTest ??= { handles: [], log: [], runs: [] });
      let invoker = document.querySelector<HTMLElement>('#test-invoker');
      if (!invoker) {
        invoker = document.createElement('button');
        invoker.id = 'test-invoker';
        invoker.textContent = 'Open the palette';
        invoker.style.cssText = 'position:fixed;left:4px;bottom:4px';
        document.body.append(invoker);
      }
      const focus = options.focus ?? 'invoker';
      if (focus === 'invoker') invoker.focus();
      else if (
        focus === 'nothing' &&
        document.activeElement instanceof HTMLElement
      )
        document.activeElement.blur();

      const handle = palette.openCommandPalette({
        entries: () =>
          entries.map(({ throws, ...spec }) => ({
            ...spec,
            run: () => {
              fixture.log.push(`run:${spec.id}`);
              fixture.runs.push({
                id: spec.id,
                paletteInDom: document.querySelector('.cmdk-scrim') !== null,
                handleOpen: handle.isOpen(),
                focus:
                  document.activeElement?.id ||
                  document.activeElement?.tagName ||
                  '',
              });
              if (throws) throw new Error(throws);
            },
          })),
        onClose: () => fixture.log.push('close'),
        ...(options.emptyText ? { emptyText: options.emptyText } : {}),
      });
      fixture.handles.push(handle);
    },
    { modulePath: MODULE_PATH, entries, options },
  );
}

/**
 * Mount what the shell will open the palette from: a button (`#test-opener`)
 * and a Ctrl / Cmd + K listener on window, where the shell's shortcut handler
 * sits. Each logs `open` and opens the palette on `entries`.
 */
async function mountOpeners(page: Page, entries: EntrySpec[]): Promise<void> {
  await page.evaluate(
    async ({ modulePath, entries }) => {
      const palette = (await import(modulePath)) as PaletteModule;
      const w = window as FixtureWindow;
      const fixture = (w.__paletteTest ??= { handles: [], log: [], runs: [] });
      const open = (): void => {
        fixture.log.push('open');
        fixture.handles.push(
          palette.openCommandPalette({
            entries: () =>
              entries.map((spec) => ({
                ...spec,
                run: () => {
                  fixture.log.push(`run:${spec.id}`);
                },
              })),
            onClose: () => fixture.log.push('close'),
          }),
        );
      };
      const opener = document.createElement('button');
      opener.id = 'test-opener';
      opener.textContent = 'Command palette';
      opener.style.cssText = 'position:fixed;left:4px;bottom:4px';
      opener.addEventListener('click', open);
      document.body.append(opener);
      fixture.listeners = new AbortController();
      // The fixture's Ctrl+K stands in for the shell's own, which opens the
      // editor's palette: taken first, on the way down, so the shell's
      // handler never sees it. An open palette takes the key itself.
      window.addEventListener(
        'keydown',
        (e) => {
          if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return;
          if (document.querySelector('.cmdk-scrim')) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          open();
        },
        { signal: fixture.listeners.signal, capture: true },
      );
    },
    { modulePath: MODULE_PATH, entries },
  );
}

/** What the fixture has recorded so far. */
async function recorded(
  page: Page,
): Promise<{ log: string[]; runs: Fixture['runs']; open: boolean }> {
  return page.evaluate(() => {
    const fixture = (window as FixtureWindow).__paletteTest!;
    return {
      log: fixture.log,
      runs: fixture.runs,
      open: fixture.handles.some((h) => h.isOpen()),
    };
  });
}

/**
 * The `data-id` of the active option, as a screen reader finds it: through
 * the field's aria-activedescendant. Null when there is none. Throws when
 * the option it names is not the one and only option marked aria-selected,
 * so every caller also checks that the two always agree.
 */
async function activeId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const input = document.querySelector('.cmdk-input')!;
    const selected = [
      ...document.querySelectorAll<HTMLElement>(
        '.cmdk-item[aria-selected="true"]',
      ),
    ];
    const id = input.getAttribute('aria-activedescendant');
    if (id === null) {
      if (selected.length > 0)
        throw new Error('an option is selected but none is the active one');
      return null;
    }
    const option = document.getElementById(id);
    if (!option) throw new Error(`aria-activedescendant names no element`);
    if (selected.length !== 1 || selected[0] !== option)
      throw new Error('aria-selected and aria-activedescendant disagree');
    return option.dataset.id ?? null;
  });
}

/** Whether the active option is fully inside the list's viewport. */
async function activeInView(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const list = document.querySelector('.cmdk-list')!.getBoundingClientRect();
    const row = document
      .querySelector('.cmdk-item[aria-selected="true"]')!
      .getBoundingClientRect();
    return row.top >= list.top - 0.5 && row.bottom <= list.bottom + 0.5;
  });
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    const w = window as FixtureWindow;
    for (const handle of w.__paletteTest?.handles ?? []) handle.close();
    w.__paletteTest?.listeners?.abort();
    document.querySelector('#test-invoker')?.remove();
    document.querySelector('#test-opener')?.remove();
    delete w.__paletteTest;
  });
});

test('opens as a modal dialog with focus in the field and the first option active', async ({
  page,
}) => {
  await bootEditor(page);
  await openPalette(page, COMMANDS);

  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveClass('cmdk');
  await expect(page.locator('.cmdk-scrim > .cmdk')).toHaveCount(1);

  // The field is a combobox that owns the list, and focus is in it.
  const input = dialog.getByRole('combobox', { name: 'Search commands' });
  await expect(input).toBeFocused();
  await expect(input).toHaveClass('cmdk-input');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(input).toHaveAttribute('aria-autocomplete', 'list');
  await expect(input).toHaveAttribute('autocomplete', 'off');
  await expect(input).toHaveAttribute('spellcheck', 'false');
  const listbox = dialog.getByRole('listbox', { name: 'Results' });
  await expect(listbox).toHaveClass(/\bcmdk-list\b/);
  await expect(listbox).toHaveClass(/\bscroll-slim\b/);
  const listId = await listbox.getAttribute('id');
  expect(listId).toBeTruthy();
  await expect(input).toHaveAttribute('aria-controls', listId!);

  // Every entry is an option, in the order given, named for a screen reader
  // by title, group and shortcut.
  const options = dialog.getByRole('option');
  await expect(options).toHaveCount(COMMANDS.length);
  await expect(page.locator('.cmdk-list > .cmdk-item')).toHaveCount(
    COMMANDS.length,
  );
  await expect(page.locator('.cmdk-title')).toHaveText(
    COMMANDS.map((c) => c.title),
  );
  await expect(
    dialog.getByRole('option', {
      name: 'Tidy layout, Arrange, T',
      exact: true,
    }),
  ).toHaveAttribute('aria-selected', 'true');
  expect(await activeId(page)).toBe('tidy');
  await expect(page.locator('.cmdk-item[aria-selected="false"]')).toHaveCount(
    COMMANDS.length - 1,
  );
  const ids = await options.evaluateAll((els) => els.map((el) => el.id));
  expect(new Set(ids).size).toBe(COMMANDS.length);
  expect(ids.every((id) => id.length > 0)).toBe(true);

  // Group and shortcut are shown; only the disabled entry is marked so.
  const tidy = page.locator('.cmdk-item[data-id="tidy"]');
  await expect(tidy.locator('.cmdk-group')).toHaveText('Arrange');
  await expect(tidy.locator('.cmdk-hint')).toHaveText('T');
  await expect(page.locator('.cmdk-item[aria-disabled="true"]')).toHaveCount(1);
  await expect(page.locator('.cmdk-item[data-id="paste"]')).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  // Nothing has been announced: the count is for after typing.
  await expect(page.locator('.cmdk-status')).toHaveText('');
  await expect(page.locator('.cmdk-status')).toHaveAttribute(
    'aria-live',
    'polite',
  );
});

test('typing filters, highlights the match and announces the count', async ({
  page,
}) => {
  await bootEditor(page);
  await openPalette(page, COMMANDS);
  const input = page.locator('.cmdk-input');
  const titles = page.locator('.cmdk-title');
  const status = page.locator('.cmdk-status');

  await page.keyboard.type('lay');
  await expect(titles).toHaveText(['Tidy layout', 'Balance layout']);
  expect(await activeId(page)).toBe('tidy');
  // The highlighted text is the query, in each title.
  await expect(page.locator('.cmdk-title mark')).toHaveText(['lay', 'lay']);
  await expect(status).toHaveText('2 results');

  // A second token narrows it (every token must match) and is marked too.
  await page.keyboard.type(' tid');
  await expect(titles).toHaveText(['Tidy layout']);
  await expect(page.locator('.cmdk-title mark')).toHaveText(['Tid', 'lay']);
  await expect(status).toHaveText('1 result');

  // Case and accents do not matter; the mark is the title's own text.
  await input.fill('TÍDY');
  await expect(titles).toHaveText(['Tidy layout']);
  await expect(page.locator('.cmdk-title mark')).toHaveText(['Tidy']);

  // A keyword and a group find entries without marking the title.
  await input.fill('dots');
  await expect(titles).toHaveText(['Toggle grid']);
  await expect(page.locator('.cmdk-title mark')).toHaveCount(0);
  await input.fill('arrange');
  await expect(titles).toHaveText([
    'Align left',
    'Tidy layout',
    'Balance layout',
  ]);
  await expect(status).toHaveText('3 results');

  // Nothing matches: the list goes, the empty text shows, and the field no
  // longer points at an option.
  await input.fill('zzz');
  await expect(page.locator('.cmdk-item')).toHaveCount(0);
  await expect(page.locator('.cmdk-list')).toBeHidden();
  await expect(page.locator('.cmdk-empty')).toBeVisible();
  await expect(page.locator('.cmdk-empty')).toHaveText(
    'No results. Try a command, a node type or a name.',
  );
  await expect(status).toHaveText('No results');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  expect(await activeId(page)).toBeNull();

  // Clearing the field brings everything back, first option active.
  await input.fill('');
  await expect(page.locator('.cmdk-item')).toHaveCount(COMMANDS.length);
  await expect(page.locator('.cmdk-empty')).toBeHidden();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  expect(await activeId(page)).toBe('tidy');
  await expect(input).toBeFocused();
});

test('the empty text can be set by the caller', async ({ page }) => {
  await bootEditor(page);
  await openPalette(page, COMMANDS, { emptyText: 'Nothing by that name.' });
  await page.keyboard.type('zzz');
  await expect(page.locator('.cmdk-empty')).toHaveText('Nothing by that name.');
});

test('arrow keys move the active option and wrap; focus never leaves the field', async ({
  page,
}) => {
  await bootEditor(page);
  await openPalette(page, COMMANDS);
  const input = page.locator('.cmdk-input');

  await page.keyboard.press('ArrowDown');
  expect(await activeId(page)).toBe('balance');
  await page.keyboard.press('ArrowDown');
  expect(await activeId(page)).toBe('align-left');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  expect(await activeId(page)).toBe('tidy');
  // Up from the first wraps to the last (a disabled option can be active)…
  await page.keyboard.press('ArrowUp');
  expect(await activeId(page)).toBe('paste');
  // …and down from the last wraps to the first.
  await page.keyboard.press('ArrowDown');
  expect(await activeId(page)).toBe('tidy');

  // Ctrl+End and Ctrl+Home go to the last and the first option.
  await page.keyboard.press('Control+End');
  expect(await activeId(page)).toBe('paste');
  await page.keyboard.press('Control+Home');
  expect(await activeId(page)).toBe('tidy');

  // Plain Home and End are the text field's: they move the caret and leave
  // the active option alone.
  await page.keyboard.type('ti');
  await expect(page.locator('.cmdk-item')).toHaveCount(1);
  await page.keyboard.press('Home');
  expect(
    await input.evaluate((el: HTMLInputElement) => el.selectionStart),
  ).toBe(0);
  await page.keyboard.press('End');
  expect(
    await input.evaluate((el: HTMLInputElement) => el.selectionStart),
  ).toBe(2);
  expect(await activeId(page)).toBe('tidy');
  // An arrow does not move the caret either: it is the list's key.
  await page.keyboard.press('ArrowUp');
  expect(
    await input.evaluate((el: HTMLInputElement) => el.selectionStart),
  ).toBe(2);
  await expect(input).toBeFocused();
});

test('lists at most fifty; Page Down and Page Up move by a page and keep the active option in view', async ({
  page,
}) => {
  await bootEditor(page);
  await openPalette(page, manyEntries(120));
  const items = page.locator('.cmdk-item');
  await expect(items).toHaveCount(50);
  expect(await activeId(page)).toBe('entry-0');

  // The list scrolls inside the dialog; a page is the rows that fit.
  const pageRows = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.cmdk-list')!;
    const row = document.querySelector<HTMLElement>('.cmdk-item')!;
    if (list.scrollHeight <= list.clientHeight)
      throw new Error('the list does not scroll');
    return Math.floor(list.clientHeight / row.offsetHeight);
  });
  expect(pageRows).toBeGreaterThan(3);

  await page.keyboard.press('PageDown');
  expect(await activeId(page)).toBe(`entry-${pageRows}`);
  expect(await activeInView(page)).toBe(true);
  await page.keyboard.press('PageDown');
  expect(await activeId(page)).toBe(`entry-${pageRows * 2}`);
  expect(await activeInView(page)).toBe(true);
  await page.keyboard.press('PageUp');
  expect(await activeId(page)).toBe(`entry-${pageRows}`);
  expect(await activeInView(page)).toBe(true);

  // Page keys stop at the ends instead of wrapping.
  for (let i = 0; i < 10; i++) await page.keyboard.press('PageDown');
  expect(await activeId(page)).toBe('entry-49');
  expect(await activeInView(page)).toBe(true);
  for (let i = 0; i < 10; i++) await page.keyboard.press('PageUp');
  expect(await activeId(page)).toBe('entry-0');
  expect(await page.locator('.cmdk-list').evaluate((el) => el.scrollTop)).toBe(
    0,
  );

  // Arrows scroll the list along with the active option, across the wrap.
  await page.keyboard.press('ArrowUp');
  expect(await activeId(page)).toBe('entry-49');
  expect(await activeInView(page)).toBe(true);
  await page.keyboard.press('ArrowDown');
  expect(await activeId(page)).toBe('entry-0');
  expect(await activeInView(page)).toBe(true);
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
  expect(await activeId(page)).toBe('entry-20');
  expect(await activeInView(page)).toBe(true);

  // A query that matches more than is listed says so, and typing puts the
  // list back at the top.
  await page.keyboard.type('entry');
  await expect(items).toHaveCount(50);
  await expect(page.locator('.cmdk-status')).toHaveText(
    'First 50 results shown',
  );
  expect(await page.locator('.cmdk-list').evaluate((el) => el.scrollTop)).toBe(
    0,
  );
  await page.keyboard.type(' 11');
  await expect(page.locator('.cmdk-title')).toHaveText([
    'Entry 11',
    'Entry 110',
    'Entry 111',
    'Entry 112',
    'Entry 113',
    'Entry 114',
    'Entry 115',
    'Entry 116',
    'Entry 117',
    'Entry 118',
    'Entry 119',
  ]);
  await expect(page.locator('.cmdk-status')).toHaveText('11 results');
});

test('Enter runs the active entry once the palette is gone and focus is back', async ({
  page,
}) => {
  await bootEditor(page);
  await openPalette(page, COMMANDS);
  await expect(page.locator('.cmdk-input')).toBeFocused();

  await page.keyboard.press('ArrowDown');
  expect(await activeId(page)).toBe('balance');
  await page.keyboard.press('Enter');

  await expect(page.locator('.cmdk-scrim')).toHaveCount(0);
  const state = await recorded(page);
  // Closed (onClose included) first, then run: exactly once.
  expect(state.log).toEqual(['close', 'run:balance']);
  expect(state.runs).toEqual([
    {
      id: 'balance',
      paletteInDom: false,
      handleOpen: false,
      focus: 'test-invoker',
    },
  ]);
  expect(state.open).toBe(false);
  await expect(page.locator('#test-invoker')).toBeFocused();
});

test('clicking an option runs it, the same way', async ({ page }) => {
  await bootEditor(page);
  await openPalette(page, COMMANDS);

  await page.locator('.cmdk-item[data-id="svg"]').click();

  await expect(page.locator('.cmdk-scrim')).toHaveCount(0);
  const state = await recorded(page);
  expect(state.log).toEqual(['close', 'run:svg']);
  expect(state.runs).toEqual([
    {
      id: 'svg',
      paletteInDom: false,
      handleOpen: false,
      focus: 'test-invoker',
    },
  ]);
  await expect(page.locator('#test-invoker')).toBeFocused();
});

test('typing then Enter runs the best match', async ({ page }) => {
  await bootEditor(page);
  await openPalette(page, COMMANDS);
  await page.keyboard.type('grid');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cmdk-scrim')).toHaveCount(0);
  expect((await recorded(page)).log).toEqual(['close', 'run:grid']);
});

test('Escape closes without running anything and gives focus back', async ({
  page,
}) => {
  await bootEditor(page);
  await openPalette(page, COMMANDS);
  await page.keyboard.type('tidy');
  await page.keyboard.press('Escape');

  await expect(page.locator('.cmdk-scrim')).toHaveCount(0);
  const state = await recorded(page);
  expect(state.log).toEqual(['close']);
  expect(state.open).toBe(false);
  await expect(page.locator('#test-invoker')).toBeFocused();

  // Enter with nothing to run closes nothing and runs nothing.
  await openPalette(page, COMMANDS);
  await page.keyboard.type('zzz');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cmdk-scrim')).toHaveCount(1);
  expect((await recorded(page)).log).toEqual(['close']);

  // Ctrl+K, the key that opens the palette, closes it again.
  await page.keyboard.press('Control+k');
  await expect(page.locator('.cmdk-scrim')).toHaveCount(0);
  expect((await recorded(page)).log).toEqual(['close', 'close']);
  await expect(page.locator('#test-invoker')).toBeFocused();
});

test('a key held down does not run or toggle a second time', async ({
  page,
}) => {
  await bootEditor(page);
  await mountOpeners(page, COMMANDS);
  const scrim = page.locator('.cmdk-scrim');
  const input = page.locator('.cmdk-input');
  const log = async (): Promise<string[]> => (await recorded(page)).log;
  // Playwright sends a key that is already down again as its auto-repeat.
  const hold = async (key: string, repeats: number): Promise<void> => {
    for (let i = 0; i <= repeats; i++) await page.keyboard.down(key);
    await page.keyboard.up(key);
  };

  // The Enter that opens the palette from its button, held a moment too
  // long: its repeats arrive in the field and must not run the first entry.
  await page.locator('#test-opener').focus();
  await page.keyboard.down('Enter');
  await expect(input).toBeFocused();
  await hold('Enter', 3);
  await expect(scrim).toHaveCount(1);
  expect(await log()).toEqual(['open']);

  // Enter held on an option runs it once. Focus is back on the button by
  // then, which takes the next repeat as a press of its own and opens the
  // palette again, as a button does; the repeats after that do nothing.
  await hold('Enter', 6);
  await expect(input).toBeFocused();
  expect(await log()).toEqual(['open', 'close', 'run:tidy', 'open']);
  await page.keyboard.press('Escape');
  await expect(scrim).toHaveCount(0);

  // Ctrl+K held, with the shell listening for it on window: the palette
  // opens once and stays open, instead of flickering open and closed.
  await page.evaluate(() => {
    (window as FixtureWindow).__paletteTest!.log.length = 0;
    (document.activeElement as HTMLElement).blur();
  });
  await page.keyboard.down('Control');
  await hold('k', 5);
  await page.keyboard.up('Control');
  await expect(input).toBeFocused();
  expect(await log()).toEqual(['open']);

  // Pressed again, each key still does its work.
  await page.keyboard.press('Control+k');
  await expect(scrim).toHaveCount(0);
  expect(await log()).toEqual(['open', 'close']);
  // Held arrows do repeat: that is how a long list is travelled.
  await page.keyboard.press('Control+k');
  await expect(input).toBeFocused();
  await hold('ArrowDown', 2);
  expect(await activeId(page)).toBe('grid');
});

test('a press on the scrim closes; a press inside the dialog does not', async ({
  page,
}) => {
  await bootEditor(page);
  await openPalette(page, COMMANDS);
  const scrim = page.locator('.cmdk-scrim');
  const input = page.locator('.cmdk-input');

  // Inside the dialog, off the options: still open, focus still in the field.
  await page.locator('.cmdk-glass').click();
  await expect(scrim).toHaveCount(1);
  await expect(input).toBeFocused();
  const listBox = (await page.locator('.cmdk-list').boundingBox())!;
  await page.mouse.click(listBox.x + listBox.width / 2, listBox.y + 2);
  await expect(scrim).toHaveCount(1);
  await expect(input).toBeFocused();

  // A text selection dragged out of the field and released over the scrim
  // is not a press on the scrim.
  await page.keyboard.type('tidy');
  const field = (await input.boundingBox())!;
  await page.mouse.move(field.x + 40, field.y + field.height / 2);
  await page.mouse.down();
  await page.mouse.move(8, field.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect(scrim).toHaveCount(1);
  await expect(input).toBeFocused();

  // The scrim itself, beside the dialog.
  await page.mouse.click(8, 8);
  await expect(scrim).toHaveCount(0);
  const state = await recorded(page);
  expect(state.log).toEqual(['close']);
  await expect(page.locator('#test-invoker')).toBeFocused();
});

test('a disabled entry is listed and can be active, but does not run', async ({
  page,
}) => {
  await bootEditor(page);
  await openPalette(page, COMMANDS);
  const paste = page.locator('.cmdk-item[data-id="paste"]');

  // Reachable from the keyboard, and announced as unavailable.
  await page.keyboard.press('ArrowUp');
  expect(await activeId(page)).toBe('paste');
  await expect(
    page
      .getByRole('dialog')
      .getByRole('option', { name: 'Paste, Edit, Ctrl+V', disabled: true }),
  ).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Enter');
  await expect(page.locator('.cmdk-scrim')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  expect(await activeId(page)).toBe('tidy');
  // (Playwright's own click waits for an element to be enabled, so the
  // press is made with the mouse, as a user's is.)
  const box = (await paste.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.cmdk-scrim')).toHaveCount(1);
  // The click made it the active option, and focus stayed in the field.
  expect(await activeId(page)).toBe('paste');
  await expect(page.locator('.cmdk-input')).toBeFocused();
  expect((await recorded(page)).log).toEqual([]);

  // When a disabled entry is all that matches it is the active option, so
  // it can be read, and Enter still does nothing.
  await page.keyboard.type('paste');
  await expect(page.locator('.cmdk-item')).toHaveCount(1);
  expect(await activeId(page)).toBe('paste');
  await page.keyboard.press('Enter');
  expect((await recorded(page)).log).toEqual([]);
  await page.keyboard.press('Escape');

  // Typing makes the first ENABLED result active, not a disabled one above.
  await openPalette(page, [
    { id: 'cut', title: 'Cut', disabled: true },
    { id: 'copy', title: 'Copy', disabled: true },
    { id: 'select-all', title: 'Select all' },
  ]);
  expect(await activeId(page)).toBe('select-all');
  await page.keyboard.type('c');
  // "Cut" and "Copy" rank above "Select all" for "c", yet stay inactive.
  await expect(page.locator('.cmdk-title')).toHaveText([
    'Cut',
    'Copy',
    'Select all',
  ]);
  expect(await activeId(page)).toBe('select-all');
  await page.keyboard.press('Enter');
  expect((await recorded(page)).log).toEqual([
    'close',
    'close',
    'run:select-all',
  ]);
});

test('a title is rendered as text, never as markup', async ({ page }) => {
  await bootEditor(page);
  const hostile = '<img src=x onerror="window.__pwned=1">';
  await openPalette(page, [
    {
      id: 'hostile',
      title: hostile,
      group: '<b>group</b>',
      hint: '<i>hint</i>',
      // The icon is the one trusted slot: caller markup, rendered as such.
      iconHtml: '<svg data-test-icon width="16" height="16"></svg>',
    },
    { id: 'plain', title: 'Plain entry' },
  ]);
  const item = page.locator('.cmdk-item[data-id="hostile"]');
  await expect(item.locator('.cmdk-title')).toHaveText(hostile);
  await expect(item.locator('.cmdk-group')).toHaveText('<b>group</b>');
  await expect(item.locator('.cmdk-hint')).toHaveText('<i>hint</i>');
  await expect(page.locator('.cmdk img, .cmdk b, .cmdk i')).toHaveCount(0);
  await expect(item.locator('.cmdk-icon svg[data-test-icon]')).toHaveCount(1);
  // The entry without an icon keeps the column, so titles line up.
  await expect(
    page.locator('.cmdk-item[data-id="plain"] .cmdk-icon'),
  ).toHaveCount(1);

  // Highlighting cuts the title up: still text, and the pieces add up.
  await page.keyboard.type('<img onerror');
  await expect(item.locator('mark')).toHaveText(['<img', 'onerror']);
  await expect(item.locator('.cmdk-title')).toHaveText(hostile);
  await expect(page.locator('.cmdk img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as FixtureWindow).__pwned)).toBe(
    undefined,
  );
});

test('marks a letter with the marks on it, and tells apart letters that a mark tells apart', async ({
  page,
}) => {
  await bootEditor(page);
  // Spelled out by code point: the encoding is what is under test.
  const sharp = 'ß\u0301 line'; // ß with a combining acute accent
  const trademark = '\u2122\ufe0f mark'; // ™ with its emoji selector
  const guide = '\u30ac\u30a4\u30c9'; // "gaido" in katakana
  await openPalette(page, [
    { id: 'sharp', title: sharp },
    { id: 'trademark', title: trademark },
    { id: 'guide', title: guide },
    { id: 'hindi', title: 'हिंदी' },
  ]);
  const input = page.locator('.cmdk-input');
  /** The titles listed and the text marked in them, code unit for code unit. */
  const shown = async (
    query: string,
  ): Promise<{ titles: string[]; marks: string[] }> => {
    await input.fill(query);
    return page.evaluate(() => ({
      titles: [...document.querySelectorAll('.cmdk-title')].map(
        (el) => el.textContent ?? '',
      ),
      marks: [...document.querySelectorAll('.cmdk-title mark')].map(
        (el) => el.textContent ?? '',
      ),
    }));
  };

  // "s" is half of what ß becomes, "t" half of what ™ does: the mark takes
  // the whole character and the combining mark after it.
  expect(await shown('s')).toEqual({ titles: [sharp], marks: ['ß\u0301'] });
  expect(await shown('t')).toEqual({
    titles: [trademark],
    marks: ['\u2122\ufe0f'],
  });
  // "ka" is not "ga": the voicing mark of kana is spelling, not an accent.
  // Half-width "ga" is "ga".
  expect(await shown('\u30ab')).toEqual({ titles: [], marks: [] });
  expect(await shown('\uff76\uff9e')).toEqual({
    titles: [guide],
    marks: ['\u30ac'],
  });
  // A Devanagari consonant is marked with its vowel signs; without them it
  // is another word.
  expect(await shown('ह')).toEqual({ titles: ['हिंदी'], marks: ['हिं'] });
  expect(await shown('हद')).toEqual({ titles: [], marks: [] });
});

test('a keystroke re-ranks without reading every entry again', async ({
  page,
}) => {
  await bootEditor(page);
  // Entries that count how often their titles are read.
  await page.evaluate(async (modulePath) => {
    const palette = (await import(modulePath)) as PaletteModule;
    const w = window as FixtureWindow;
    const fixture = (w.__paletteTest ??= { handles: [], log: [], runs: [] });
    fixture.handles.push(
      palette.openCommandPalette({
        entries: () =>
          Array.from({ length: 300 }, (_, i) => ({
            id: `e${i}`,
            get title() {
              w.__titleReads = (w.__titleReads ?? 0) + 1;
              return `Entry ${i}`;
            },
            run: () => {},
          })),
      }),
    );
    // What opening read, to draw the first options, is not what is counted.
    w.__titleReads = 0;
  }, MODULE_PATH);
  const reads = (): Promise<number | undefined> =>
    page.evaluate(() => (window as FixtureWindow).__titleReads);
  const input = page.locator('.cmdk-input');

  // The first keystroke normalises every title. The ones after it rank what
  // was kept: nothing matches here, so no title is read to be drawn either.
  await page.keyboard.type('q');
  await expect(page.locator('.cmdk-empty')).toBeVisible();
  expect(await reads()).toBe(300);
  await page.keyboard.type('qq');
  await expect(input).toHaveValue('qqq');
  await expect(page.locator('.cmdk-empty')).toBeVisible();
  expect(await reads()).toBe(300);

  // What was kept ranks as before: only the options drawn are read again.
  await input.fill('entry 299');
  await expect(page.locator('.cmdk-title')).toHaveText(['Entry 299']);
  expect(await reads()).toBeLessThan(310);
});

test("the editor's shortcuts stand down while the palette is open", async ({
  page,
}) => {
  await bootEditor(page);
  await clickNode(page, 'fw');
  await expect.poll(() => statusCount(page, 'selected')).toBe(1);
  const nodes = await statusCount(page, 'nodes');
  const where = await nodeBox(page, 'fw');
  expect(await statusText(page, 'tool')).toBe('select');

  await openPalette(page, COMMANDS, { focus: 'nothing' });
  const input = page.locator('.cmdk-input');
  await expect(input).toBeFocused();

  // "l" is a letter here, not the link tool.
  await page.keyboard.type('l');
  await expect(input).toHaveValue('l');
  expect(await statusText(page, 'tool')).toBe('select');
  // Delete and Backspace edit the query, not the selected node; the arrows
  // do not nudge it; "?" does not open the shortcut sheet over the palette.
  await page.keyboard.press('Backspace');
  await expect(input).toHaveValue('');
  for (const key of ['Backspace', 'Delete', 'ArrowDown', 'ArrowRight'])
    await page.keyboard.press(key);
  await page.keyboard.type('?');
  await expect(input).toHaveValue('?');
  await expect(page.locator('.help-backdrop')).toHaveCount(0);
  expect(await statusCount(page, 'nodes')).toBe(nodes);
  expect(await statusCount(page, 'selected')).toBe(1);
  expect(await nodeBox(page, 'fw')).toEqual(where);
  expect(await statusText(page, 'tool')).toBe('select');

  // All of the above the shell grants any text field. What only an open
  // overlay gets: with focus out of the field (on the page body, where a key
  // is the canvas's), the shortcuts still stand down.
  await input.evaluate((el: HTMLElement) => el.blur());
  await expect(input).not.toBeFocused();
  for (const key of ['l', 'Delete', 'ArrowRight', '?'])
    await page.keyboard.press(key);
  await expect(input).toHaveValue('?');
  await expect(page.locator('.help-backdrop')).toHaveCount(0);
  expect(await statusCount(page, 'nodes')).toBe(nodes);
  expect(await statusCount(page, 'selected')).toBe(1);
  expect(await nodeBox(page, 'fw')).toEqual(where);
  expect(await statusText(page, 'tool')).toBe('select');

  // Closed, the same key is the shortcut again: nothing was left listening.
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmdk-scrim')).toHaveCount(0);
  await page.keyboard.press('l');
  await expect.poll(() => statusText(page, 'tool')).toBe('link');
});

test('keys the palette acts on do not travel on to window listeners', async ({
  page,
}) => {
  await bootEditor(page);
  await openPalette(page, COMMANDS);
  // A listener where the shell's shortcut handler sits: window, bubble phase.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as FixtureWindow & { __seenKeys?: string[] }).__seenKeys = seen;
    window.addEventListener('keydown', (e) => seen.push(e.key));
  });
  const seen = (): Promise<string[]> =>
    page.evaluate(
      () => (window as FixtureWindow & { __seenKeys?: string[] }).__seenKeys!,
    );

  // Typing is not the palette's to stop: it stays a normal key press.
  await page.keyboard.type('a');
  expect(await seen()).toEqual(['a']);
  // Moving, jumping and running are. Enter closes the palette first, so a
  // shortcut handler that saw it would act on the editor behind.
  for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'Control+End'])
    await page.keyboard.press(key);
  await page.keyboard.press('Enter');
  await expect(page.locator('.cmdk-scrim')).toHaveCount(0);
  expect((await recorded(page)).log).toHaveLength(2);
  expect((await seen()).filter((key) => key !== 'Control')).toEqual(['a']);

  // The same for the two keys that close it.
  await openPalette(page, COMMANDS);
  await page.keyboard.press('Control+k');
  await expect(page.locator('.cmdk-scrim')).toHaveCount(0);
  await openPalette(page, COMMANDS);
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmdk-scrim')).toHaveCount(0);
  expect((await seen()).filter((key) => key !== 'Control')).toEqual(['a']);
});

test('Tab stays inside the palette', async ({ page }) => {
  await bootEditor(page);
  await openPalette(page, COMMANDS);
  const input = page.locator('.cmdk-input');
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(input).toBeFocused();
  await expect(page.locator('.cmdk-scrim')).toHaveCount(1);
  // Still the palette's keyboard after the Tab.
  await page.keyboard.press('ArrowDown');
  expect(await activeId(page)).toBe('balance');
});

test('there is one palette at a time: opening again focuses the field', async ({
  page,
}) => {
  await bootEditor(page);
  await openPalette(page, COMMANDS);
  await page.keyboard.type('tid');
  // Focus is taken away, then the palette is asked for again.
  await page.locator('.cmdk-input').evaluate((el: HTMLElement) => el.blur());
  await openPalette(page, manyEntries(5), { focus: 'keep' });

  await expect(page.locator('.cmdk-scrim')).toHaveCount(1);
  await expect(page.locator('.cmdk-input')).toBeFocused();
  // The same palette: same handle, its query and entries untouched.
  expect(
    await page.evaluate(() => {
      const { handles } = (window as FixtureWindow).__paletteTest!;
      return handles.length === 2 && handles[0] === handles[1];
    }),
  ).toBe(true);
  await expect(page.locator('.cmdk-input')).toHaveValue('tid');
  await expect(page.locator('.cmdk-title')).toHaveText(['Tidy layout']);

  // One Escape closes it, and focus goes back to where it first came from.
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmdk-scrim')).toHaveCount(0);
  await expect(page.locator('#test-invoker')).toBeFocused();
  expect((await recorded(page)).log).toEqual(['close']);
});

test('leaves nothing in the page, and nothing listening, after it closes', async ({
  page,
}) => {
  await bootEditor(page);
  const census = (): Promise<{ body: number; palette: number }> =>
    page.evaluate(() => ({
      body: document.body.children.length,
      palette: document.querySelectorAll('[class^="cmdk"], [class*=" cmdk"]')
        .length,
    }));
  // Mount the fixture's button first, so the census is of the palette alone.
  await openPalette(page, COMMANDS);
  await page.keyboard.press('Escape');
  const before = await census();

  await openPalette(page, COMMANDS);
  const open = await census();
  expect(open.body).toBe(before.body + 1);
  expect(open.palette).toBeGreaterThan(0);
  expect(before.palette).toBe(0);
  await page.keyboard.type('lay');
  await expect(page.locator('.cmdk-item')).toHaveCount(2);
  // Closed while the count announcement is still pending.
  await page.keyboard.press('Escape');

  expect(await census()).toEqual(before);
  await expect(
    page.locator('.cmdk-scrim, .cmdk, .cmdk-list, .cmdk-item, .cmdk-status'),
  ).toHaveCount(0);
  await expect(page.locator('[id^="cmdk-"]')).toHaveCount(0);

  // The detached palette is inert: its options, field and scrim do nothing
  // when poked, and the pending announcement never lands.
  const after = await page.evaluate(async () => {
    const fixture = (window as FixtureWindow).__paletteTest!;
    const handle = fixture.handles[fixture.handles.length - 1]!;
    const root = handle.element;
    const input = root.querySelector<HTMLInputElement>('.cmdk-input')!;
    root.querySelector<HTMLElement>('.cmdk-item')!.click();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    input.value = 'grid';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    root.click();
    await new Promise((resolve) => setTimeout(resolve, 600));
    handle.close();
    return {
      open: handle.isOpen(),
      connected: root.isConnected,
      titles: [...root.querySelectorAll('.cmdk-title')].map(
        (el) => el.textContent,
      ),
      status: root.querySelector('.cmdk-status')!.textContent,
      log: fixture.log,
    };
  });
  expect(after).toEqual({
    open: false,
    connected: false,
    titles: ['Tidy layout', 'Balance layout'],
    status: '',
    log: ['close', 'close'],
  });
  expect(await census()).toEqual(before);
});

test('moving the pointer onto an option makes it active; a list scrolling under a resting pointer does not', async ({
  page,
}) => {
  await bootEditor(page);
  await openPalette(page, manyEntries(40));
  const underPointer = (x: number, y: number): Promise<string | null> =>
    page.evaluate(
      ([px, py]) =>
        document.elementFromPoint(px!, py!)?.closest<HTMLElement>('.cmdk-item')
          ?.dataset.id ?? null,
      [x, y],
    );

  const row = (await page.locator('.cmdk-item').nth(3).boundingBox())!;
  const x = row.x + row.width / 2;
  const y = row.y + row.height / 2;
  await page.mouse.move(x - 30, y - 60);
  await page.mouse.move(x, y, { steps: 3 });
  expect(await activeId(page)).toBe('entry-3');
  // There is one highlight, not a hover look and an active look.
  await expect(page.locator('.cmdk-item[aria-selected="true"]')).toHaveCount(1);

  // The keyboard carries on from there. The list scrolls under the pointer,
  // which now rests on other rows: the active option stays the keyboard's.
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
  expect(await activeId(page)).toBe('entry-15');
  const resting = await underPointer(x, y);
  expect(resting).not.toBeNull();
  expect(resting).not.toBe('entry-3');
  expect(resting).not.toBe('entry-15');
  // Give the browser time to report the row that slid under the pointer.
  await page.waitForTimeout(250);
  expect(await activeId(page)).toBe('entry-15');
  await page.keyboard.press('ArrowDown');
  expect(await activeId(page)).toBe('entry-16');

  // Scrolling with the wheel does not move the active option either.
  await page.mouse.wheel(0, 64);
  await page.waitForTimeout(250);
  expect(await activeId(page)).toBe('entry-16');

  // A real movement does: the option now under the pointer becomes active.
  await page.mouse.move(x + 6, y + 1);
  const now = await underPointer(x + 6, y + 1);
  expect(now).not.toBeNull();
  expect(await activeId(page)).toBe(now);
  expect(now).not.toBe('entry-16');

  // And Enter runs the one the pointer chose.
  await page.keyboard.press('Enter');
  expect((await recorded(page)).log).toEqual(['close', `run:${now}`]);
});

test('keys of an open IME composition are left to the input method; the list follows the composition', async ({
  page,
}) => {
  await bootEditor(page);
  await openPalette(page, COMMANDS);
  const input = page.locator('.cmdk-input');

  // While composing, Enter confirms a candidate, the arrows pick one and
  // Escape discards it: none of them is the palette's.
  await input.evaluate((el: HTMLInputElement) => {
    el.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    );
    const composing = (key: string, legacy = false): boolean =>
      el.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          bubbles: true,
          cancelable: true,
          ...(legacy ? { keyCode: 229 } : { isComposing: true }),
        }),
      );
    const taken = ['Enter', 'ArrowDown', 'Escape', 'PageDown']
      .flatMap((key) => [composing(key), composing(key, true)])
      .some((notPrevented) => !notPrevented);
    if (taken) throw new Error('the palette took a key of the composition');
    // The word so far: the list follows it before it is committed.
    el.value = 'grid';
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, isComposing: true }),
    );
  });
  await expect(page.locator('.cmdk-scrim')).toHaveCount(1);
  expect((await recorded(page)).log).toEqual([]);
  await expect(page.locator('.cmdk-title')).toHaveText(['Toggle grid']);
  expect(await activeId(page)).toBe('grid');

  // Committing a candidate re-ranks even without a final input event.
  await input.evaluate((el: HTMLInputElement) => {
    el.value = 'svg';
    el.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: 'svg' }),
    );
  });
  await expect(page.locator('.cmdk-title')).toHaveText(['Export: SVG']);

  // Composition over: Enter is the palette's again.
  await page.keyboard.press('Enter');
  await expect(page.locator('.cmdk-scrim')).toHaveCount(0);
  expect((await recorded(page)).log).toEqual(['close', 'run:svg']);
});

test('an entry that throws: the palette is already closed and the error is not swallowed', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await bootEditor(page);
  await openPalette(page, [
    { id: 'boom', title: 'Explode', throws: 'palette test: run failed' },
    { id: 'tidy', title: 'Tidy layout' },
  ]);

  await page.keyboard.press('Enter');

  await expect.poll(() => errors).toEqual(['palette test: run failed']);
  await expect(page.locator('.cmdk-scrim')).toHaveCount(0);
  const state = await recorded(page);
  expect(state.log).toEqual(['close', 'run:boom']);
  expect(state.runs[0]).toMatchObject({
    paletteInDom: false,
    handleOpen: false,
    focus: 'test-invoker',
  });
  await expect(page.locator('#test-invoker')).toBeFocused();

  // The palette is not left half-open: it opens and works again.
  await openPalette(page, COMMANDS);
  await expect(page.locator('.cmdk-input')).toBeFocused();
  await page.keyboard.press('Enter');
  expect((await recorded(page)).log).toEqual([
    'close',
    'run:boom',
    'close',
    'run:tidy',
  ]);
});

test('opens with the first enabled option active and in view, however far down it is', async ({
  page,
}) => {
  await bootEditor(page);
  await openPalette(page, [
    ...manyEntries(30).map((e) => ({ ...e, disabled: true })),
    { id: 'first-enabled', title: 'The first enabled entry' },
    { id: 'second-enabled', title: 'The second enabled entry' },
  ]);
  expect(await activeId(page)).toBe('first-enabled');
  expect(await activeInView(page)).toBe(true);
  await page.keyboard.press('Enter');
  expect((await recorded(page)).log).toEqual(['close', 'run:first-enabled']);
});

test('entries that cannot be listed: the error reaches the caller and nothing is left open', async ({
  page,
}) => {
  await bootEditor(page);
  const outcome = await page.evaluate(async (modulePath) => {
    const palette = (await import(modulePath)) as PaletteModule;
    const attempt = (entries: () => never[]): string => {
      try {
        palette.openCommandPalette({ entries });
        return 'opened';
      } catch (e) {
        return String((e as Error).message);
      }
    };
    return [
      attempt(() => {
        throw new Error('no entries today');
      }),
      // An entry without a title cannot be ranked.
      attempt(() => [{ id: 'broken', run() {} }] as unknown as never[]),
    ];
  }, MODULE_PATH);
  expect(outcome[0]).toBe('no entries today');
  expect(outcome[1]).not.toBe('opened');
  await expect(page.locator('.cmdk-scrim')).toHaveCount(0);

  // No overlay was left registered: the editor's shortcuts still work, and
  // the palette opens normally afterwards.
  await page.keyboard.press('l');
  await expect.poll(() => statusText(page, 'tool')).toBe('link');
  await openPalette(page, COMMANDS);
  await expect(page.locator('.cmdk-input')).toBeFocused();
  expect(await activeId(page)).toBe('tidy');
});

test('looks as designed, in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootEditor(page);
  await openPalette(page, COMMANDS);
  await page.keyboard.type('lay');
  await expect(page.locator('.cmdk-item')).toHaveCount(2);

  const look = (): Promise<Record<string, string | number>> =>
    page.evaluate(() => {
      const css = (selector: string): CSSStyleDeclaration =>
        getComputedStyle(document.querySelector(selector)!);
      const box = (selector: string): DOMRect =>
        document.querySelector(selector)!.getBoundingClientRect();
      const dialog = box('.cmdk');
      return {
        scrimZ: css('.cmdk-scrim').zIndex,
        scrimFill: css('.cmdk-scrim').backgroundColor,
        top: Math.round(dialog.top),
        width: Math.round(dialog.width),
        centred: Math.round(dialog.left + dialog.width / 2),
        surface: css('.cmdk').backgroundColor,
        radius: css('.cmdk').borderRadius,
        inputHeight: Math.round(box('.cmdk-input').height),
        inputSize: css('.cmdk-input').fontSize,
        inputBorder: css('.cmdk-input').borderTopWidth,
        listMax: css('.cmdk-list').maxHeight,
        rowHeight: Math.round(box('.cmdk-item').height),
        rowSize: css('.cmdk-item').fontSize,
        active: css('.cmdk-item[aria-selected="true"]').backgroundColor,
        idle: css('.cmdk-item[aria-selected="false"]').backgroundColor,
        activeText: css('.cmdk-item[aria-selected="true"]').color,
        idleText: css('.cmdk-item[aria-selected="false"]').color,
        markFill: css('.cmdk-title mark').backgroundColor,
        markWeight: css('.cmdk-title mark').fontWeight,
        markText: css('.cmdk-item[aria-selected="false"] mark').color,
        groupSize: css('.cmdk-group').fontSize,
        hintSize: css('.cmdk-hint').fontSize,
        hintFace: css('.cmdk-hint').fontFamily.split(',')[0]!.trim(),
        titleFace: css('.cmdk-title').fontFamily.split(',')[0]!.trim(),
        divider: css('.cmdk-field').borderBottomWidth,
        glass: css('.cmdk-glass').color,
      };
    });

  const dark = await look();
  expect(dark).toMatchObject({
    scrimZ: '100',
    top: 96,
    width: 560,
    centred: 640,
    radius: '12px',
    inputHeight: 44,
    inputSize: '14px',
    inputBorder: '0px',
    listMax: '320px',
    rowHeight: 32,
    rowSize: '13px',
    idle: 'rgba(0, 0, 0, 0)',
    markFill: 'rgba(0, 0, 0, 0)',
    markWeight: '600',
    groupSize: '12px',
    hintSize: '12px',
    divider: '1px',
  });
  expect(String(dark.hintFace)).toContain('JetBrains Mono');
  expect(String(dark.titleFace)).toContain('Inter');
  // The active row is filled and its text stronger; a mark is as strong as
  // the active text.
  expect(dark.active).not.toBe(dark.idle);
  expect(dark.activeText).not.toBe(dark.idleText);
  expect(dark.markText).toBe(dark.activeText);

  // The field has no focus ring to be clipped by the dialog; its magnifier
  // shows the focus instead, and goes quiet when focus is elsewhere.
  const input = page.locator('.cmdk-input');
  await expect(input).toBeFocused();
  expect(await input.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe(
    'none',
  );
  await input.evaluate((el: HTMLElement) => el.blur());
  const blurred = await look();
  await input.focus();
  expect(blurred.glass).not.toBe(dark.glass);
  expect(blurred.glass).toBe(
    await page
      .locator('.cmdk-group')
      .first()
      .evaluate((el) => getComputedStyle(el).color),
  );

  // The light theme changes the colours and nothing else.
  await page.evaluate(() => document.documentElement.classList.add('light'));
  const light = await look();
  await page.evaluate(() => document.documentElement.classList.remove('light'));
  for (const key of [
    'surface',
    'scrimFill',
    'active',
    'activeText',
    'idleText',
    'glass',
  ])
    expect(light[key], key).not.toBe(dark[key]);
  expect(light.surface).toBe('rgb(255, 255, 255)');
  expect(light.markText).toBe(light.activeText);
  for (const key of ['top', 'width', 'inputHeight', 'rowHeight', 'radius'])
    expect(light[key], key).toBe(dark[key]);
});

test('is usable at phone width, with no sideways overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootEditor(page);
  await openPalette(page, [
    {
      id: 'long',
      title:
        'Export: PowerPoint with one slide per layer and every page of the document',
      group: 'File and export options',
      hint: 'Ctrl+Shift+Alt+P',
    },
    ...COMMANDS,
    ...manyEntries(30),
  ]);

  const measure = (): Promise<{
    left: number;
    right: number;
    bottom: number;
    dialogOverflow: number;
    listOverflow: number;
    pageOverflow: number;
    rowsInside: boolean;
    hintInside: boolean;
  }> =>
    page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>('.cmdk')!;
      const list = document.querySelector<HTMLElement>('.cmdk-list')!;
      const box = dialog.getBoundingClientRect();
      const inside = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
      };
      return {
        left: box.left,
        right: box.right,
        bottom: box.bottom,
        dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
        listOverflow: list.scrollWidth - list.clientWidth,
        pageOverflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        rowsInside: [...document.querySelectorAll('.cmdk-item')].every(inside),
        hintInside: [...document.querySelectorAll('.cmdk-hint')].every(inside),
      };
    });

  const tall = await measure();
  // 16px of scrim on each side of the dialog.
  expect(tall.left).toBe(16);
  expect(tall.right).toBe(374);
  expect(tall.bottom).toBeLessThanOrEqual(844);
  expect(tall.dialogOverflow).toBe(0);
  expect(tall.listOverflow).toBe(0);
  expect(tall.pageOverflow).toBeLessThanOrEqual(0);
  expect(tall.rowsInside).toBe(true);
  expect(tall.hintInside).toBe(true);
  // The long title is cut with an ellipsis rather than pushing the row wide.
  expect(
    await page
      .locator('.cmdk-item[data-id="long"] .cmdk-title')
      .evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true);

  // With the on-screen keyboard up there is far less height: the dialog
  // still fits, and the list scrolls inside it.
  await page.setViewportSize({ width: 390, height: 320 });
  const short = await measure();
  expect(short.bottom).toBeLessThanOrEqual(320);
  expect(short.left).toBe(16);
  expect(short.right).toBe(374);
  expect(short.dialogOverflow).toBe(0);
  expect(short.pageOverflow).toBeLessThanOrEqual(0);
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
  expect(await activeId(page)).toBe('entry-5');
  expect(await activeInView(page)).toBe(true);

  // It works: type, pick with a tap on the option.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.type('grid');
  await expect(page.locator('.cmdk-title')).toHaveText(['Toggle grid']);
  await page.locator('.cmdk-item[data-id="grid"]').click();
  await expect(page.locator('.cmdk-scrim')).toHaveCount(0);
  expect((await recorded(page)).log).toEqual(['close', 'run:grid']);
});
