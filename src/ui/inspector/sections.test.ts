import { describe, expect, it } from 'vitest';
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
    new SectionMemory(storage).remember('Wiring', true);
    new SectionMemory(storage).remember('Text', false);
    const reloaded = new SectionMemory(storage);
    expect(reloaded.isOpen('Wiring', false)).toBe(true);
    expect(reloaded.isOpen('Text', true)).toBe(false);
    expect(JSON.parse(storage.data.get(INSPECTOR_SECTIONS_KEY)!)).toEqual({
      Wiring: true,
      Text: false,
    });
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
      memory.remember('Text', false); // never throws
      expect(memory.isOpen('Text', true)).toBe(false);
    }
  });
});

describe('a section', () => {
  const memory = new SectionMemory(null);

  it('is a details element keyed by its title, with its count and hint', () => {
    const html = sectionHtml(memory, 'Annotations', '<p>rows</p>', {
      open: false,
      count: 3,
      hint: 'What it is for.',
    });
    expect(html).toBe(
      '<details class="insp-group" data-group="Annotations">' +
        '<summary class="insp-h">Annotations <span class="insp-count">3</span></summary>' +
        '<div class="insp-hint">What it is for.</div><p>rows</p></details>',
    );
  });

  it('opens as the user left it', () => {
    const left = new SectionMemory(null);
    left.remember('Wiring', true);
    expect(sectionHtml(left, 'Wiring', 'x', { open: false })).toContain(
      'data-group="Wiring" open>',
    );
  });

  it('is left out when it has nothing in it', () => {
    expect(sectionHtml(memory, 'Data', '', { open: true })).toBe('');
  });

  it('escapes a title that comes from a document (a custom type name)', () => {
    expect(
      sectionHtml(memory, '<b>"x"</b> options', 'x', { open: true }),
    ).toContain(
      'data-group="&lt;b&gt;&quot;x&quot;&lt;/b&gt; options" open><summary class="insp-h">&lt;b&gt;&quot;x&quot;&lt;/b&gt; options</summary>',
    );
  });
});
