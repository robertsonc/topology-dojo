import { describe, expect, it } from 'vitest';
import { icon } from '../icons.js';
import {
  INSPECTOR_SECTIONS_KEY,
  SectionMemory,
  sectionHtml,
} from './sections.js';

/** A Storage stand-in that keeps what is written. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('which sections are open', () => {
  it('is the default until the user opens or closes one', () => {
    const memory = new SectionMemory(memoryStorage());
    expect(memory.isOpen('Wiring', false)).toBe(false);
    expect(memory.isOpen('Text', true)).toBe(true);
  });

  it('is remembered per title, across a reload', () => {
    const storage = memoryStorage();
    new SectionMemory(storage).remember('Wiring', true, false);
    new SectionMemory(storage).remember('Text', false, true);
    const reloaded = new SectionMemory(storage);
    expect(reloaded.isOpen('Wiring', false)).toBe(true);
    expect(reloaded.isOpen('Text', true)).toBe(false);
    expect(JSON.parse(storage.data.get(INSPECTOR_SECTIONS_KEY)!)).toEqual({
      Wiring: true,
      Text: false,
    });
  });

  it('keeps only what differs from a section’s default', () => {
    const storage = memoryStorage();
    const memory = new SectionMemory(storage);
    // A section drawn as it starts reports that state: nothing is stored.
    memory.remember('Page', true, true);
    memory.remember('Sheet', false, false);
    expect(storage.data.has(INSPECTOR_SECTIONS_KEY)).toBe(false);
    memory.remember('Sheet', true, false);
    memory.remember('Page', false, true);
    expect(JSON.parse(storage.data.get(INSPECTOR_SECTIONS_KEY)!)).toEqual({
      Sheet: true,
      Page: false,
    });
    // Back to its default, a section's entry goes, so a later change of the
    // default reaches it.
    memory.remember('Page', true, true);
    expect(JSON.parse(storage.data.get(INSPECTOR_SECTIONS_KEY)!)).toEqual({
      Sheet: true,
    });
    expect(new SectionMemory(storage).isOpen('Page', false)).toBe(false);
  });

  it('falls back to the defaults when storage is missing, broken or throws', () => {
    for (const storage of [
      null,
      memoryStorage({ [INSPECTOR_SECTIONS_KEY]: 'not json' }),
      memoryStorage({ [INSPECTOR_SECTIONS_KEY]: '["Text"]' }),
      memoryStorage({ [INSPECTOR_SECTIONS_KEY]: '{"Text":"yes"}' }),
      {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
    ]) {
      const memory = new SectionMemory(storage);
      expect(memory.isOpen('Text', true)).toBe(true);
      memory.remember('Text', false, true); // never throws
      expect(memory.isOpen('Text', true)).toBe(false);
    }
  });
});

describe('a section', () => {
  const memory = new SectionMemory(null);
  const CARET = `<span class="insp-caret">${icon('chevron-right', { size: 12 })}</span>`;

  it('is a details element keyed by its title, with its count and hint', () => {
    const html = sectionHtml(memory, 'Annotations', '<p>rows</p>', {
      open: false,
      count: 3,
      hint: 'What it is for.',
    });
    expect(html).toBe(
      '<details class="insp-group" data-group="Annotations" data-open-default="false">' +
        `<summary class="insp-h">${CARET}Annotations <span class="badge insp-count">3</span></summary>` +
        '<div class="insp-rows"><div class="insp-hint">What it is for.</div><p>rows</p></div></details>',
    );
  });

  it('opens as the user left it', () => {
    const left = new SectionMemory(null);
    left.remember('Wiring', true, false);
    expect(sectionHtml(left, 'Wiring', 'x', { open: false })).toContain(
      'data-group="Wiring" data-open-default="false" open>',
    );
  });

  it('is left out when it has nothing in it', () => {
    expect(sectionHtml(memory, 'Data', '', { open: true })).toBe('');
  });

  it('escapes a title that comes from a document (a custom type name)', () => {
    expect(
      sectionHtml(memory, '<b>"x"</b> options', 'x', { open: true }),
    ).toContain(
      `data-group="&lt;b&gt;&quot;x&quot;&lt;/b&gt; options" data-open-default="true" open><summary class="insp-h">${CARET}&lt;b&gt;&quot;x&quot;&lt;/b&gt; options</summary>`,
    );
  });
});
