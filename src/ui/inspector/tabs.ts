/**
 * The tab row above the properties panel: Selection, Page and Document.
 *
 * The rules for which tab shows are in `../inspector-tabs.ts` (a pure
 * reducer); this module is its DOM: the tab buttons and their ARIA
 * (APG "tabs with automatic activation": arrows, Home and End move between
 * the enabled tabs and show them, with a roving tabindex), the panel's
 * `role="tabpanel"`, and the Page / Document choice kept in local storage.
 */
import {
  INSPECTOR_TAB_KEY,
  initialTabState,
  nextTabState,
  selectionTabLabel,
  tabAfterKey,
  tabEnabled,
  type InspectorTab,
  type InspectorTabEvent,
  type InspectorTabState,
  type RestingTab,
  type SelectionCounts,
} from '../inspector-tabs.js';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const TABS: readonly InspectorTab[] = ['selection', 'page', 'document'];
const FIXED_LABELS: Readonly<Record<RestingTab, string>> = {
  page: 'Page',
  document: 'Document',
};

export interface InspectorTabs {
  /**
   * Tell the tabs what is selected (on every render of the panel) and get
   * the tab to draw. `selection` is null when nothing is.
   */
  sync(selection: string | null, counts: SelectionCounts): InspectorTab;
  /** Show the Page or Document tab, as a command or a problem asks. */
  reveal(tab: RestingTab): void;
  /**
   * Show the Selection tab, as a jump to an element asks (a Problems entry
   * or a badge): the element is shown even when it was already selected and
   * the Page or Document tab had been picked by hand. Nothing happens while
   * nothing is selected.
   */
  showSelection(): void;
  /** The tab on show. */
  active(): InspectorTab;
  /** The tab row's element (the `role="tablist"`). */
  readonly tabList: HTMLElement;
}

/**
 * Put the tab row in front of `at` (by default `panel` itself) and drive it.
 * `onChange` is called when the user (or `reveal`) changes the tab, to draw
 * the panel again.
 */
export function mountInspectorTabs(
  panel: HTMLElement,
  storage: StorageLike | null,
  onChange: () => void,
  at: Element = panel,
): InspectorTabs {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(INSPECTOR_TAB_KEY) ?? null;
  } catch {
    stored = null;
  }
  let state: InspectorTabState = initialTabState(stored);

  const list = document.createElement('div');
  list.className = 'tabs insp-tabs';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Properties');
  const buttons = new Map<InspectorTab, HTMLButtonElement>();
  for (const tab of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.id = `insp-tab-${tab}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', panel.id);
    b.dataset.tab = tab;
    b.textContent = tab === 'selection' ? 'Selection' : FIXED_LABELS[tab];
    buttons.set(tab, b);
    list.append(b);
  }
  at.before(list);
  panel.setAttribute('role', 'tabpanel');

  const paint = (): void => {
    for (const [tab, b] of buttons) {
      const on = state.active === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (tabEnabled(state, tab)) b.removeAttribute('aria-disabled');
      else b.setAttribute('aria-disabled', 'true');
    }
    panel.setAttribute('aria-labelledby', `insp-tab-${state.active}`);
  };

  const apply = (event: InspectorTabEvent): boolean => {
    const next = nextTabState(state, event);
    if (next === state) return false;
    if (next.resting !== state.resting)
      try {
        storage?.setItem(INSPECTOR_TAB_KEY, next.resting);
      } catch {
        /* storage unavailable: remembered until reload */
      }
    state = next;
    paint();
    return true;
  };

  const pick = (tab: InspectorTab): void => {
    if (apply({ type: 'pick', tab })) onChange();
  };

  list.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[role="tab"]');
    if (!b) return;
    pick(b.dataset.tab as InspectorTab);
  });
  list.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const from = (e.target as Element).closest<HTMLElement>('[role="tab"]')
      ?.dataset.tab as InspectorTab | undefined;
    if (!from) return;
    const to = tabAfterKey(state, from, e.key);
    if (!to) return;
    // The arrows are the tab row's own here: they do not reach the canvas.
    e.preventDefault();
    e.stopPropagation();
    pick(to);
    buttons.get(to)!.focus();
  });

  paint();
  return {
    sync(selection, counts) {
      buttons.get('selection')!.textContent = selectionTabLabel(counts);
      apply({ type: 'selection', selection });
      return state.active;
    },
    reveal(tab) {
      if (apply({ type: 'reveal', tab })) onChange();
    },
    showSelection() {
      pick('selection');
    },
    active: () => state.active,
    tabList: list,
  };
}
