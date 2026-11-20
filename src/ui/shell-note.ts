/**
 * The one-time "what moved" note: someone who used the editor before the
 * menu bar and the left rail replaced the toolbar is shown, once, where the
 * controls went.
 *
 * It is a small card over the canvas's bottom-left corner. It is not modal:
 * it never takes the focus and never holds a key, and the canvas around it
 * works as before. "Got it" dismisses it for good; Help ▸ What moved shows
 * it again at any time.
 *
 * Whether it shows is decided from the browser's storage as the editor
 * found it, before this visit wrote anything: `shellNoteStart` (pure).
 */
import { esc } from './inspector/html.js';

/** Set to '1' once the note is dismissed (or on a first visit, see below). */
export const SHELL_NOTE_KEY = 'topology-dojo:shell-note';

/** The prefixes of the keys the editor has always kept in storage. */
const EDITOR_KEY_PREFIXES = ['topology-dojo:', 'tds-'] as const;

/**
 * What the note does when the editor starts:
 * - `show`: the browser has used the editor before (one of its keys is in
 *   storage) and the note has not been dismissed;
 * - `first-visit`: nothing of the editor's is in storage, so there is
 *   nothing old to point at. The caller records the note as seen, so that
 *   the keys this visit writes do not make the next visit look like an old
 *   user's;
 * - `none`: the note was dismissed.
 *
 * `keys` are the storage keys present before this visit wrote any;
 * `noteValue` is the value under `SHELL_NOTE_KEY`, or null.
 */
export function shellNoteStart(
  keys: Iterable<string>,
  noteValue: string | null,
): 'show' | 'first-visit' | 'none' {
  if (noteValue === '1') return 'none';
  for (const key of keys)
    if (
      key !== SHELL_NOTE_KEY &&
      EDITOR_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
    )
      return 'show';
  return 'first-visit';
}

/** Every key in `storage`, or none when storage cannot be read. */
export function storageKeys(storage: Storage | null): string[] {
  try {
    if (!storage) return [];
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

export interface ShellNoteOptions {
  /** Where the card goes: the canvas area, which it floats over. */
  host: HTMLElement;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** The command palette's shortcut as the shortcut sheet writes it. */
  paletteKey: string;
  /** Run when "Show shortcuts" is pressed: opens the shortcut sheet. */
  showShortcuts: () => void;
}

export interface ShellNote {
  /** Show the note (Help ▸ What moved), whether or not it was dismissed. */
  show(): void;
  /** Dismiss it for good, as "Got it" does. */
  dismiss(): void;
  /** Keep it out of sight while `on` (present mode), without dismissing. */
  hold(on: boolean): void;
  isShown(): boolean;
}

/** The card's lines: where each part of the old toolbar went. */
function linesHtml(paletteKey: string): string {
  return [
    'The menus hold the File, Edit, View and Arrange commands.',
    'The tools are on the left rail.',
    'Pages, grid, snap and the minimap are on the bar under the canvas.',
    'Properties has Selection, Page and Document tabs.',
  ]
    .map((line) => `<li>${esc(line)}</li>`)
    .concat(
      `<li><kbd class="kbd">${esc(paletteKey)}</kbd> finds any command.</li>`,
    )
    .join('');
}

/**
 * Build the card in `host` and decide whether it shows now. `start` is
 * `shellNoteStart`'s answer for this visit; on a first visit the note is
 * recorded as seen.
 */
export function mountShellNote(
  opts: ShellNoteOptions,
  start: ReturnType<typeof shellNoteStart>,
): ShellNote {
  const card = document.createElement('section');
  card.className = 'shell-note';
  card.id = 'shellNote';
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', 'What moved');
  card.innerHTML =
    `<h2 class="shell-note-title">The editor has a new layout</h2>` +
    `<ul class="shell-note-lines">${linesHtml(opts.paletteKey)}</ul>` +
    `<div class="shell-note-foot">` +
    `<button type="button" class="btn btn-primary btn-sm" id="shellNoteOk">Got it</button>` +
    `<button type="button" class="btn btn-ghost btn-sm" id="shellNoteKeys">Show shortcuts</button>` +
    `</div>`;
  card.hidden = true;
  opts.host.append(card);

  let shown = false;
  let held = false;
  const paint = (): void => {
    card.hidden = !shown || held;
  };
  const remember = (): void => {
    try {
      opts.storage?.setItem(SHELL_NOTE_KEY, '1');
    } catch {
      /* storage unavailable: dismissed until reload */
    }
  };

  const note: ShellNote = {
    show() {
      shown = true;
      paint();
    },
    dismiss() {
      // Pressed from inside the card, the focus goes back to the page, where
      // the canvas's keys are read, instead of staying on a hidden button.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && card.contains(focused))
        focused.blur();
      shown = false;
      paint();
      remember();
    },
    hold(on) {
      held = on;
      paint();
    },
    isShown: () => shown && !held,
  };

  card
    .querySelector('#shellNoteOk')!
    .addEventListener('click', () => note.dismiss());
  card
    .querySelector('#shellNoteKeys')!
    .addEventListener('click', () => opts.showShortcuts());

  if (start === 'first-visit') remember();
  else if (start === 'show') note.show();
  return note;
}
