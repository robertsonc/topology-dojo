/**
 * Which tab of the properties panel is showing.
 *
 * The panel has three tabs: what is selected, the page, and the document.
 * The rules for moving between them are here, as a pure reducer, so they can
 * be tested without the panel:
 *
 * - selecting something (or something else) shows the Selection tab;
 * - clearing the selection goes back to whichever of Page and Document was
 *   showing last;
 * - a tab picked by hand stays while the selection is the same, so editing a
 *   page setting with a node still selected does not bounce back when the
 *   panel re-renders;
 * - a command or a Problems entry that targets a page or document setting
 *   can reveal that tab.
 *
 * Nothing here is saved in the document: the last Page/Document choice is a
 * view preference (`INSPECTOR_TAB_KEY` in local storage).
 */

export type InspectorTab = 'selection' | 'page' | 'document';
/** The two tabs that do not depend on a selection. */
export type RestingTab = Exclude<InspectorTab, 'selection'>;

export const INSPECTOR_TAB_KEY = 'topology-dojo:inspector-tab';

export interface InspectorTabState {
  /** The tab that is showing. */
  active: InspectorTab;
  /** The tab to show when nothing is selected. */
  resting: RestingTab;
  /**
   * What is selected, as one string that changes when the selection does
   * (the ids, joined), or null when nothing is. Only compared, never parsed.
   */
  selection: string | null;
}

export type InspectorTabEvent =
  /** The canvas selection is now this (called on every render: a repeat of
   * the same selection changes nothing). */
  | { type: 'selection'; selection: string | null }
  /** The user clicked a tab or moved to it with the keyboard. */
  | { type: 'pick'; tab: InspectorTab }
  /** Something asked for a page or document setting to be shown. */
  | { type: 'reveal'; tab: RestingTab };

/** The state the panel starts in, from the stored preference. */
export function initialTabState(
  stored: string | null | undefined,
): InspectorTabState {
  const resting = parseRestingTab(stored);
  return { active: resting, resting, selection: null };
}

/** The stored preference, or Page when there is none or it is unreadable. */
export function parseRestingTab(stored: string | null | undefined): RestingTab {
  return stored === 'document' ? 'document' : 'page';
}

export function nextTabState(
  state: InspectorTabState,
  event: InspectorTabEvent,
): InspectorTabState {
  switch (event.type) {
    case 'selection': {
      if (event.selection === state.selection) return state;
      return {
        ...state,
        selection: event.selection,
        active: event.selection === null ? state.resting : 'selection',
      };
    }
    case 'pick': {
      if (event.tab === 'selection')
        // The Selection tab is disabled while nothing is selected.
        return state.selection === null || state.active === 'selection'
          ? state
          : { ...state, active: 'selection' };
      if (state.active === event.tab && state.resting === event.tab)
        return state;
      return { ...state, active: event.tab, resting: event.tab };
    }
    case 'reveal': {
      if (state.active === event.tab && state.resting === event.tab)
        return state;
      return { ...state, active: event.tab, resting: event.tab };
    }
  }
}

/** Whether a tab can be activated in this state. */
export function tabEnabled(
  state: InspectorTabState,
  tab: InspectorTab,
): boolean {
  return tab !== 'selection' || state.selection !== null;
}

/** How many elements of each kind are selected. */
export interface SelectionCounts {
  nodes?: number;
  links?: number;
  anchors?: number;
  zones?: number;
}

const KINDS: readonly [keyof SelectionCounts, string, string][] = [
  ['nodes', 'Node', 'nodes'],
  ['links', 'Link', 'links'],
  ['anchors', 'Anchor', 'anchors'],
  ['zones', 'Zone', 'zones'],
];

/**
 * The Selection tab's label: what is selected. "Node", "Link", "3 nodes",
 * "5 items" for a mix, and "Selection" when nothing is.
 */
export function selectionTabLabel(counts: SelectionCounts): string {
  const present = KINDS.map(([key, one, many]) => ({
    n: Math.max(0, Math.floor(counts[key] ?? 0)),
    one,
    many,
  })).filter((k) => k.n > 0);
  const total = present.reduce((sum, k) => sum + k.n, 0);
  if (total === 0) return 'Selection';
  if (present.length > 1) return `${total} items`;
  const kind = present[0]!;
  return kind.n === 1 ? kind.one : `${kind.n} ${kind.many}`;
}

/** The tab an arrow, Home or End key moves to from `from` (enabled tabs only). */
export function tabAfterKey(
  state: InspectorTabState,
  from: InspectorTab,
  key: string,
): InspectorTab | null {
  const order: InspectorTab[] = ['selection', 'page', 'document'];
  const enabled = order.filter((tab) => tabEnabled(state, tab));
  const at = enabled.indexOf(from);
  switch (key) {
    case 'ArrowRight':
      return enabled[(at + 1) % enabled.length] ?? null;
    case 'ArrowLeft':
      // From a tab that is not enabled (at is -1) this is the last one.
      return (
        enabled[(Math.max(at, 0) - 1 + enabled.length) % enabled.length] ?? null
      );
    case 'Home':
      return enabled[0] ?? null;
    case 'End':
      return enabled[enabled.length - 1] ?? null;
    default:
      return null;
  }
}
