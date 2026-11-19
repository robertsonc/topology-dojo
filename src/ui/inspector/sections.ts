/**
 * The collapsible sections of the properties panel.
 *
 * Every section is a `<details class="insp-group" data-group="Title">`. Its
 * title is also its key: whether it is open is remembered per title in local
 * storage (`INSPECTOR_SECTIONS_KEY`), so a section the user closed stays
 * closed after the panel redraws and after a reload. That is a view
 * preference only; nothing about sections is written in the document.
 */
import { icon } from '../icons.js';
import { esc } from './html.js';

export const INSPECTOR_SECTIONS_KEY = 'topology-dojo:inspector-sections';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Which sections are open, by title, read from and written to storage. */
export class SectionMemory {
  private readonly open = new Map<string, boolean>();

  constructor(private readonly storage: StorageLike | null) {
    let raw: string | null = null;
    try {
      raw = storage?.getItem(INSPECTOR_SECTIONS_KEY) ?? null;
    } catch {
      raw = null; // storage unavailable: start from the defaults
    }
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        for (const [title, value] of Object.entries(parsed))
          if (typeof value === 'boolean') this.open.set(title, value);
    } catch {
      /* unreadable: start from the defaults */
    }
  }

  /** Whether the section is open: as last left, else `fallback`. */
  isOpen(title: string, fallback: boolean): boolean {
    return this.open.get(title) ?? fallback;
  }

  /**
   * Remember that the section was opened or closed. Only a state that
   * differs from the section's default (`fallback`) is kept: a section left
   * as it starts has no entry, so a later change to its default reaches it.
   */
  remember(title: string, open: boolean, fallback: boolean): void {
    if (open === fallback) {
      if (!this.open.has(title)) return;
      this.open.delete(title);
    } else {
      if (this.open.get(title) === open) return;
      this.open.set(title, open);
    }
    try {
      this.storage?.setItem(
        INSPECTOR_SECTIONS_KEY,
        JSON.stringify(Object.fromEntries(this.open)),
      );
    } catch {
      /* storage unavailable: remembered until reload */
    }
  }
}

/** The disclosure caret of a section's title; it turns while open. */
const CARET = `<span class="insp-caret">${icon('chevron-right', { size: 12 })}</span>`;

export interface SectionOptions {
  /** Open unless the user closed it before. */
  open: boolean;
  /** A count shown after the title (annotations, layers, set values). */
  count?: number;
  /** A line under the title saying what the section is for (plain text). */
  hint?: string;
}

/**
 * One section. `body` is the markup of its rows; a section with nothing in
 * it is left out altogether.
 */
export function sectionHtml(
  memory: SectionMemory,
  title: string,
  body: string,
  opts: SectionOptions,
): string {
  if (!body) return '';
  const open = memory.isOpen(title, opts.open);
  const count =
    opts.count === undefined
      ? ''
      : ` <span class="badge insp-count">${opts.count}</span>`;
  const hint = opts.hint
    ? `<div class="insp-hint">${esc(opts.hint)}</div>`
    : '';
  return (
    `<details class="insp-group" data-group="${esc(title)}" data-open-default="${opts.open}"${open ? ' open' : ''}>` +
    `<summary class="insp-h">${CARET}${esc(title)}${count}</summary>` +
    `<div class="insp-rows">${hint}${body}</div>` +
    `</details>`
  );
}

/** Remember each section's open / closed state as the user toggles it. */
export function wireSections(root: ParentNode, memory: SectionMemory): void {
  root
    .querySelectorAll<HTMLDetailsElement>('details.insp-group[data-group]')
    .forEach((d) => {
      d.addEventListener('toggle', () => {
        // A section drawn and then replaced by a redraw still reports its
        // first toggle; only the one on the page speaks for the user.
        // (A section drawn open also reports a toggle as it is inserted;
        // that is its default, or what was remembered, so nothing changes.)
        if (d.isConnected)
          memory.remember(
            d.dataset.group!,
            d.open,
            d.dataset.openDefault === 'true',
          );
      });
    });
}
