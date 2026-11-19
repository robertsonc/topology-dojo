import { describe, expect, it } from 'vitest';
import {
  initialTabState,
  nextTabState,
  parseRestingTab,
  selectionTabLabel,
  tabAfterKey,
  tabEnabled,
  type InspectorTabEvent,
  type InspectorTabState,
} from './inspector-tabs.js';

const run = (
  state: InspectorTabState,
  ...events: InspectorTabEvent[]
): InspectorTabState => events.reduce(nextTabState, state);
const select = (selection: string | null): InspectorTabEvent => ({
  type: 'selection',
  selection,
});

describe('the properties panel tabs', () => {
  it('starts on the stored resting tab, Page by default', () => {
    expect(initialTabState(null)).toEqual({
      active: 'page',
      resting: 'page',
      selection: null,
    });
    expect(initialTabState('document').active).toBe('document');
    for (const junk of [undefined, '', 'selection', 'Page', '{}'])
      expect(parseRestingTab(junk)).toBe('page');
  });

  it('shows the Selection tab when something is selected, or something else', () => {
    const one = run(initialTabState(null), select('n1'));
    expect(one.active).toBe('selection');
    const onPage = run(one, { type: 'pick', tab: 'page' });
    expect(run(onPage, select('n2')).active).toBe('selection');
    expect(run(onPage, select('n1,n2')).active).toBe('selection');
  });

  it('goes back to the last resting tab when the selection clears', () => {
    const start = initialTabState(null);
    expect(run(start, select('n1'), select(null)).active).toBe('page');
    const viaDocument = run(
      start,
      { type: 'pick', tab: 'document' },
      select('n1'),
      select(null),
    );
    expect(viaDocument.active).toBe('document');
    // Picked while something was selected: still the one to return to.
    const picked = run(
      start,
      select('n1'),
      { type: 'pick', tab: 'document' },
      { type: 'pick', tab: 'selection' },
      select(null),
    );
    expect(picked.active).toBe('document');
  });

  it('keeps a tab picked by hand while the selection is the same', () => {
    const state = run(initialTabState(null), select('n1'), {
      type: 'pick',
      tab: 'page',
    });
    expect(state.active).toBe('page');
    // The panel re-renders after every edit and reports the selection again.
    const again = run(state, select('n1'), select('n1'));
    expect(again).toBe(state);
  });

  it('cannot pick the Selection tab with nothing selected', () => {
    const start = initialTabState(null);
    expect(tabEnabled(start, 'selection')).toBe(false);
    expect(run(start, { type: 'pick', tab: 'selection' })).toBe(start);
    const selected = run(start, select('n1'), { type: 'pick', tab: 'page' });
    expect(tabEnabled(selected, 'selection')).toBe(true);
    expect(run(selected, { type: 'pick', tab: 'selection' }).active).toBe(
      'selection',
    );
  });

  it('reveals a page or document setting on request', () => {
    const selected = run(initialTabState(null), select('n1'));
    const revealed = run(selected, { type: 'reveal', tab: 'document' });
    expect(revealed).toMatchObject({
      active: 'document',
      resting: 'document',
      selection: 'n1',
    });
    expect(run(revealed, { type: 'reveal', tab: 'document' })).toBe(revealed);
  });

  it('returns the same object when nothing changes', () => {
    const state = run(initialTabState(null), { type: 'pick', tab: 'page' });
    expect(state).toEqual(initialTabState(null));
    expect(run(state, select(null))).toBe(state);
    expect(run(state, { type: 'pick', tab: 'page' })).toBe(state);
  });

  it('labels the Selection tab with what is selected', () => {
    expect(selectionTabLabel({})).toBe('Selection');
    expect(selectionTabLabel({ nodes: 0, links: 0 })).toBe('Selection');
    expect(selectionTabLabel({ nodes: 1 })).toBe('Node');
    expect(selectionTabLabel({ links: 1 })).toBe('Link');
    expect(selectionTabLabel({ anchors: 1 })).toBe('Anchor');
    expect(selectionTabLabel({ zones: 1 })).toBe('Zone');
    expect(selectionTabLabel({ nodes: 3 })).toBe('3 nodes');
    expect(selectionTabLabel({ links: 2 })).toBe('2 links');
    expect(selectionTabLabel({ nodes: 3, links: 2 })).toBe('5 items');
    expect(selectionTabLabel({ nodes: 1, anchors: 1 })).toBe('2 items');
  });

  it('moves between enabled tabs with the arrow keys, Home and End', () => {
    const empty = initialTabState(null);
    expect(tabAfterKey(empty, 'page', 'ArrowRight')).toBe('document');
    expect(tabAfterKey(empty, 'document', 'ArrowRight')).toBe('page');
    expect(tabAfterKey(empty, 'page', 'ArrowLeft')).toBe('document');
    expect(tabAfterKey(empty, 'page', 'Home')).toBe('page');
    expect(tabAfterKey(empty, 'page', 'End')).toBe('document');
    expect(tabAfterKey(empty, 'page', 'Enter')).toBeNull();
    // From the disabled tab the arrows still land on an enabled one.
    expect(tabAfterKey(empty, 'selection', 'ArrowRight')).toBe('page');
    expect(tabAfterKey(empty, 'selection', 'ArrowLeft')).toBe('document');

    const selected = run(empty, select('n1'));
    expect(tabAfterKey(selected, 'selection', 'ArrowRight')).toBe('page');
    expect(tabAfterKey(selected, 'selection', 'ArrowLeft')).toBe('document');
    expect(tabAfterKey(selected, 'document', 'ArrowRight')).toBe('selection');
    expect(tabAfterKey(selected, 'document', 'Home')).toBe('selection');
  });
});
