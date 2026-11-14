import { describe, expect, it } from 'vitest';
import { problemsDockView } from './problems-dock.js';

const base = { visible: 0, errors: 0, hidden: 0, collapsedPref: null };

describe('problemsDockView', () => {
  it('stays closed when problems appear, until the user opens it', () => {
    const view = problemsDockView({ ...base, visible: 1 });
    expect(view.collapsed).toBe(true);
    // The header and the status bar still say there is something to see.
    expect(view.count).toBe('1');
    expect(view.severity).toBe('warn');
    expect(view.statusLabel).toBe('⚠ 1');
  });

  it("honours the user's choice once they have made one", () => {
    expect(
      problemsDockView({ ...base, visible: 3, collapsedPref: false }).collapsed,
    ).toBe(false);
    expect(
      problemsDockView({ ...base, visible: 3, collapsedPref: true }).collapsed,
    ).toBe(true);
  });

  it('closes when there is nothing at all to list', () => {
    expect(problemsDockView({ ...base, collapsedPref: false }).collapsed).toBe(
      true,
    );
  });

  it('stays open when the last shown problem is hidden', () => {
    // The user had it open and hid the only problem: the footer that restores
    // it must stay where it is.
    const view = problemsDockView({
      ...base,
      hidden: 1,
      collapsedPref: false,
    });
    expect(view.collapsed).toBe(false);
    expect(view.count).toBe('0');
    expect(view.hiddenNote).toBe('1 hidden');
  });

  it('says how many problems are hidden, in the header and the status bar', () => {
    const none = problemsDockView({ ...base, hidden: 2 });
    expect(none.hiddenNote).toBe('2 hidden');
    expect(none.statusLabel).toBe('✓ 2 hidden');
    expect(none.statusTitle).toMatch(/2 hidden/);
    expect(none.severity).toBe('none');

    const some = problemsDockView({
      ...base,
      visible: 3,
      errors: 1,
      hidden: 2,
    });
    expect(some.count).toBe('3');
    expect(some.hiddenNote).toBe('2 hidden');
    expect(some.statusLabel).toBe('⚠ 3');
    expect(some.statusTitle).toBe(
      '1 error, 2 warnings, 2 hidden — open Problems',
    );
    expect(some.severity).toBe('error');
  });

  it('is plain when the document is clean', () => {
    expect(problemsDockView(base)).toEqual({
      collapsed: true,
      count: '0',
      hiddenNote: '',
      severity: 'none',
      statusLabel: '✓',
      statusTitle: 'No problems',
    });
  });

  it('uses singular and plural correctly', () => {
    expect(
      problemsDockView({ ...base, visible: 2, errors: 2 }).statusTitle,
    ).toBe('2 errors, 0 warnings — open Problems');
    expect(
      problemsDockView({ ...base, visible: 1, errors: 0 }).statusTitle,
    ).toBe('0 errors, 1 warning — open Problems');
  });
});
