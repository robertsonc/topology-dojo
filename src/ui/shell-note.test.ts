import { describe, expect, it } from 'vitest';
import { SHELL_NOTE_KEY, shellNoteStart, storageKeys } from './shell-note.js';

describe('shellNoteStart', () => {
  it('is a first visit when nothing of the editor is in storage', () => {
    expect(shellNoteStart([], null)).toBe('first-visit');
    // Another site's or library's keys are not the editor's.
    expect(shellNoteStart(['theme', 'tdsx', 'topology'], null)).toBe(
      'first-visit',
    );
  });

  it('shows the note to a browser that used the editor before', () => {
    expect(shellNoteStart(['tds-palette-collapsed'], null)).toBe('show');
    expect(shellNoteStart(['topology-dojo:doc'], null)).toBe('show');
    expect(shellNoteStart(['other', 'topology-dojo:theme'], null)).toBe('show');
  });

  it('never shows it once dismissed', () => {
    expect(shellNoteStart(['tds-palette-collapsed', SHELL_NOTE_KEY], '1')).toBe(
      'none',
    );
    expect(shellNoteStart([SHELL_NOTE_KEY], '1')).toBe('none');
  });

  it('does not count its own key as the editor having been used', () => {
    // Only '1' dismisses; with nothing else stored it is still a first visit.
    expect(shellNoteStart([SHELL_NOTE_KEY], '0')).toBe('first-visit');
    expect(shellNoteStart([SHELL_NOTE_KEY, 'tds-wheel-mode'], '0')).toBe(
      'show',
    );
  });
});

describe('storageKeys', () => {
  it('lists every key, and none when storage cannot be read', () => {
    const entries = new Map([
      ['a', '1'],
      ['tds-b', '2'],
    ]);
    const storage = {
      get length() {
        return entries.size;
      },
      key: (i: number) => [...entries.keys()][i] ?? null,
    } as Storage;
    expect(storageKeys(storage)).toEqual(['a', 'tds-b']);
    expect(storageKeys(null)).toEqual([]);
    const broken = {
      get length(): number {
        throw new Error('blocked');
      },
    } as Storage;
    expect(storageKeys(broken)).toEqual([]);
  });
});
