import { describe, expect, it } from 'vitest';
import { problemField, problemsDockView } from './problems-dock.js';

const base = { visible: 0, errors: 0, hidden: 0, collapsedPref: null };

describe('problemsDockView', () => {
  it('stays closed when problems appear, until the user opens it', () => {
    const view = problemsDockView({ ...base, visible: 1 });
    expect(view.collapsed).toBe(true);
    // The header and the status bar still say there is something to see.
    expect(view.count).toBe('1');
    expect(view.severity).toBe('warn');
    expect(view.statusIcon).toBe('warning');
    expect(view.statusLabel).toBe('1');
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
    expect(none.statusIcon).toBe('check');
    expect(none.statusLabel).toBe('2 hidden');
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
    expect(some.statusIcon).toBe('warning');
    expect(some.statusLabel).toBe('3');
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
      // Clean: the check mark alone; the title is its accessible name.
      statusIcon: 'check',
      statusLabel: '',
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

describe('problemField', () => {
  const node = 'page[0] "Frame 1" node "fw"';
  const link = 'page[1] "Frame 2" link "l3"';
  it('finds the field a problem about an element names', () => {
    expect(
      problemField({
        where: node,
        message:
          'href "ftp://x" is not an http(s) URL — it will not render as a link',
      }),
    ).toEqual({ tab: 'selection', field: '[data-key="href"]' });
    expect(
      problemField({
        where: node,
        message: 'opacity 2 should be between 0 and 1',
      }),
    ).toEqual({ tab: 'selection', field: '[data-key="opacity"]' });
    expect(
      problemField({
        where: link,
        message: 'labelScale 9 should be between 0.25 and 4',
      }),
    ).toEqual({ tab: 'selection', field: '[data-key="labelScale"]' });
    expect(
      problemField({ where: node, message: 'tooltip must be a string' }),
    ).toEqual({ tab: 'selection', field: '[data-key="tooltip"]' });
  });
  it('sends an unknown type to the type and a dead page link to the link field', () => {
    expect(
      problemField({ where: node, message: 'unknown node type "quantum"' }),
    ).toEqual({ tab: 'selection', field: '#i-type' });
    expect(
      problemField({
        where: node,
        message: 'page link "#page=x" points at no page in this document',
      }),
    ).toEqual({ tab: 'selection', field: '[data-key="href"]' });
  });
  it('shows the element alone when no one field is at fault', () => {
    expect(
      problemField({
        where: node,
        message:
          'unconnected node — no link, flow, zone, or marker references it',
      }),
    ).toEqual({ tab: 'selection', field: null });
  });
  it('sends a page problem to the Page tab, at its field when it has one', () => {
    expect(
      problemField({
        where: 'page[0] "Frame 1"',
        message: 'transition "wipe" not in [cut, fade]',
      }),
    ).toEqual({ tab: 'page', field: '#p-tr' });
    expect(
      problemField({
        where: 'page[2] "Core"',
        message: 'duration -1 should be a positive ms count',
      }),
    ).toEqual({ tab: 'page', field: '#p-dur' });
    expect(
      problemField({
        where: 'page[0] "Frame 1"',
        message: 'duplicate page id "p1"',
      }),
    ).toEqual({ tab: 'page', field: null });
  });
  it('sends a document problem to the Document tab', () => {
    expect(
      problemField({ where: 'layers[0]', message: 'layer has no id' }),
    ).toEqual({ tab: 'document', field: null });
    expect(
      problemField({ where: 'document', message: 'document has no pages' }),
    ).toEqual({ tab: 'document', field: null });
  });
});
