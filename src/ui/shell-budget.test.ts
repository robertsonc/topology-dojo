import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MENUBAR } from './menus.js';

/**
 * The shell's control budgets, read from its markup (the template in
 * src/main.ts) without a browser. e2e/shell-budget.spec.ts counts the same
 * controls in the running page, signed in with every chip showing.
 *
 * Every number here is a design decision: raising one is a change to the
 * design, to be agreed as one, not a fix to the test.
 */
const main = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'main.ts'),
  'utf8',
);

/** The markup from `start` to the first `end` after it. */
function slice(start: string, end: string): string {
  const from = main.indexOf(start);
  expect(from, `the shell's markup has ${start}`).toBeGreaterThan(-1);
  return main.slice(from, main.indexOf(end, from));
}

/** The ids of the controls written in `markup`, in order; a control built
 * from a list (the menu bar's menus) is "generated". */
function controlIds(markup: string): string[] {
  return [
    ...markup.matchAll(/<(?:button|input|select|textarea|a)\b([^>]*)>/g),
  ].map((m) => /\bid="([\w-]+)"/.exec(m[1]!)?.[1] ?? 'generated');
}

describe('shell budgets', () => {
  it('the menu bar has five menus', () => {
    // File, Edit, View, Arrange and Help: 5 menus.
    expect(MENUBAR.map((m) => m.label)).toEqual([
      'File',
      'Edit',
      'View',
      'Arrange',
      'Help',
    ]);
  });

  it('the top bar holds its menus and 12 other controls', () => {
    // Besides the menus: the folded Menu button, the title, Undo, Redo,
    // Tidy and its menu, Present, Export, Share, the workspace and account
    // chips, and the file input Open uses (never shown).
    expect(
      controlIds(slice('<header class="bar topbar"', '</header>')),
    ).toEqual([
      'generated',
      'menuMore',
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
      'fInput',
    ]);
  });

  it('the left rail holds 7 controls', () => {
    expect(
      controlIds(
        slice('<div class="rail scroll-slim" id="rail">', '<aside class="palette"'),
      ),
    ).toEqual([
      'tSelect',
      'ccHand',
      'tLink',
      'tAnchor',
      'palette-toggle',
      'tCommand',
      'tHelp',
    ]);
  });

  it("the pages bar's right end holds 5 controls", () => {
    expect(controlIds(slice('<div class="view-opts"', '</div>'))).toEqual([
      'tGrid',
      'tSnap',
      'tCalm',
      'tDisplay',
      'minimap-toggle',
    ]);
  });
});
