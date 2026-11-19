/**
 * The shell's one menu component: menu bar menus, button menus (Export, Tidy,
 * the account menu) and the right-click context menu all open through
 * `openMenu`. It follows the WAI-ARIA Authoring Practices "Menu and Menubar"
 * pattern (and "Menu Button" for `attachMenuButton`).
 *
 *     const handle = openMenu(
 *       () => [
 *         { id: 'edit.copy', label: 'Copy', hint: 'Ctrl+C', run: copy },
 *         { kind: 'separator' },
 *         { label: 'Grid', checked: gridOn(), run: toggleGrid },
 *         { label: 'Align', submenu: () => alignEntries() },
 *       ],
 *       { anchor: button, placement: 'below-start', focus: 'first' },
 *     );
 *
 * What it renders. A host `<div class="menu-layer">` is appended to
 * `document.body`; the popup, `<div class="menu" role="menu">`, and every open
 * submenu are its children, `position: fixed`. Items are
 * `<button role="menuitem">` (`menuitemcheckbox` + `aria-checked` when
 * `checked` is defined), carry `data-command="<id>"`, and use a roving
 * tabindex. A heading starts a `role="group"` named after it, which runs to
 * the next separator or heading. `label` and `hint` are text; `iconHtml` is
 * the one field inserted as markup, so it must come from the caller's own
 * code (an icon sprite), never from a document or the network.
 *
 * Keys, inside a menu: ArrowDown / ArrowUp move with wrap-around and stop on
 * disabled items (they are focusable, announced as unavailable, and inert);
 * Home / End; a typed letter jumps to the next item starting with it;
 * ArrowRight opens a submenu, ArrowLeft closes it; Escape closes one level;
 * Tab closes everything and lets focus move on from the trigger. Enter and
 * Space are left to the browser: it turns them into a click on the focused
 * button, at the moment each engine activates a button (Space on key-up), so
 * focus never changes hands between a key going down and coming up.
 *
 * Pointer: the item under the pointer takes focus, so there is one highlight
 * and the arrow keys continue from where the pointer is. Focus the pointer
 * moved shows the highlight without the focus ring, which stays the
 * keyboard's (`data-pointer` on the layer, until the next key press). A
 * submenu opens after a short hover and survives a diagonal move toward it.
 * A press outside closes the menu and still lands; a press on the trigger is
 * left to the trigger's click, which closes the menu it finds open.
 *
 * Triggers (`attachMenubar`, `attachMenuButton`) follow the shell's key
 * routing (`./key-routing.ts`): a trigger that a pointer focused leaves the
 * arrows, Space and Enter to the canvas; one the keyboard reached keeps them.
 *
 * The overlay primitive (`./overlay.ts`). The layer is registered as one
 * overlay for the whole chain, which gives the menu three things: the shell's
 * global shortcuts stand down while it is open, Escape is routed to it, and
 * the invoker is remembered for menus opened at a point. The primitive also
 * traps Tab inside the overlay root, which a menu must not do. The trap only
 * interferes when focus is on the first or last focusable of the root, or
 * outside it, so the layer starts and ends with an inert, zero-size
 * `span[tabindex="0"]`: the primitive counts them (it matches by attribute),
 * the browser and assistive technology do not, and the focused element is
 * therefore never at an edge. The menu container is the tab stop while no
 * item is (`tabindex="0"`), so it is inside that list too. Tab then reaches
 * this module un-prevented: it closes the chain, puts focus back on the
 * trigger, and the browser's own Tab carries on from there.
 * `e2e/menu-component.spec.ts` pins this from every focus position.
 *
 * Beyond the packet's API (all additive):
 * - `MenuOptions.focus` also takes `'last'` (ArrowUp on a menu bar button).
 * - `MenuOptions.onNavigate` reports ArrowLeft / ArrowRight that the menu
 *   itself has no use for; the menu bar moves to the neighbouring menu.
 * - `MenuCloseReason` has `'resize'`.
 * - `placeMenu` may return `'left-start'`, the flipped `'right-start'`.
 * - `nextEnabledIndex` / `firstEnabledIndex` / `lastEnabledIndex` take
 *   `includeDisabled`: arrow keys stop on disabled items, initial focus
 *   prefers an enabled one.
 * - `toggleMenu` and `attachMenuButton` for button menus.
 * - An anchor that declares `aria-haspopup` gets its `aria-expanded` kept in
 *   step, however the menu closes.
 */

import { isImeKey } from './ime.js';
import { registerOverlay } from './overlay.js';

/* ── Entries and options ────────────────────────────────────────────── */

/** One activatable row of a menu. */
export interface MenuItem {
  kind?: 'item';
  /** Command id, rendered as `data-command`. */
  id?: string;
  /** The row's text. Set as text, never parsed as markup. */
  label: string;
  /** Right-aligned secondary text, usually the shortcut. Text, never markup. */
  hint?: string;
  /**
   * Markup for a 16px icon, inserted as-is. TRUSTED: pass only markup the
   * application itself produced.
   */
  iconHtml?: string;
  /** Defined: the row is a checkbox item showing this state. */
  checked?: boolean;
  /** Focusable and announced as unavailable, but does nothing. */
  disabled?: boolean;
  /** Destructive action: drawn in the error colour. */
  danger?: boolean;
  /** Runs after the whole menu has closed and focus is back on the trigger. */
  run?: () => void;
  /** Entries of a submenu; a function is called each time it opens. */
  submenu?: MenuEntry[] | (() => MenuEntry[]);
}

export type MenuEntry =
  | MenuItem
  | { kind: 'separator' }
  | { kind: 'heading'; label: string };

/** A menu's entries, or a function that builds them when the menu opens. */
export type MenuEntries = MenuEntry[] | (() => MenuEntry[]);

export type MenuPlacement =
  | 'below-start'
  | 'below-end'
  | 'above-start'
  | 'above-end'
  | 'right-start'
  /** Only ever a result: `'right-start'` flipped at the viewport edge. */
  | 'left-start';

/**
 * Where focus goes when the menu opens: the first or last enabled item (a
 * keyboard open), or the menu itself, so that no item looks chosen yet the
 * arrow keys work at once (a pointer open). Pass `'first'` whenever a key
 * opened the menu: `'menu'` shows no focus ring until a key is pressed.
 */
export type MenuFocus = 'first' | 'last' | 'menu';

export type MenuCloseReason =
  /** An item was activated. */
  | 'select'
  | 'escape'
  /** A pointer was pressed outside the menu and its trigger. */
  | 'outside'
  | 'tab'
  /** The window lost focus, or focus moved to something outside the menu. */
  | 'blur'
  /** The window was resized. */
  | 'resize'
  /** `close()`, `closeAllMenus()`, or another menu opening. */
  | 'programmatic';

export interface MenuOptions {
  /** The trigger element, or a viewport point (a context menu). */
  anchor: HTMLElement | { x: number; y: number };
  /** Preferred side and alignment; default `'below-start'`. */
  placement?: Exclude<MenuPlacement, 'left-start'>;
  /** The popup's accessible name; defaults to the anchor element's own. */
  label?: string;
  /** Default `'menu'`. */
  focus?: MenuFocus;
  /** Called once, after the menu is gone and focus has been restored. */
  onClose?: (reason: MenuCloseReason) => void;
  /**
   * ArrowLeft at the root level (`'previous'`), or ArrowRight on an item
   * without a submenu (`'next'`). The menu stays open; a menu bar answers by
   * opening the neighbouring menu.
   */
  onNavigate?: (direction: 'previous' | 'next') => void;
}

export interface MenuHandle {
  /** The root `role="menu"` element. */
  readonly element: HTMLElement;
  isOpen(): boolean;
  /** Close the whole chain. Default reason `'programmatic'`. */
  close(reason?: MenuCloseReason): void;
}

/* ── Pure helpers ───────────────────────────────────────────────────── */

/** Whether an entry is an item (not a separator or a heading). */
export function isMenuItem(entry: MenuEntry | undefined): entry is MenuItem {
  return (
    entry !== undefined && (entry.kind === undefined || entry.kind === 'item')
  );
}

/**
 * The index of the next item from `from` in direction `dir`, wrapping around.
 * Separators and headings are never returned. Disabled items are skipped
 * unless `includeDisabled` (the arrow keys pass it: a disabled item is still a
 * stop). `from` outside the list starts before the first entry (`dir` 1) or
 * after the last (`dir` -1). Returns `from` itself when it is the only
 * candidate, and -1 when there is none.
 */
export function nextEnabledIndex(
  entries: readonly MenuEntry[],
  from: number,
  dir: 1 | -1,
  includeDisabled = false,
): number {
  const n = entries.length;
  let i = from >= 0 && from < n ? from : dir === 1 ? -1 : n;
  for (let step = 0; step < n; step++) {
    i = (i + dir + n) % n;
    const entry = entries[i];
    if (isMenuItem(entry) && (includeDisabled || !entry.disabled)) return i;
  }
  return -1;
}

/** The first item that is not disabled (or any item, with `includeDisabled`); -1 if none. */
export function firstEnabledIndex(
  entries: readonly MenuEntry[],
  includeDisabled = false,
): number {
  return nextEnabledIndex(entries, -1, 1, includeDisabled);
}

/** The last item that is not disabled (or any item, with `includeDisabled`); -1 if none. */
export function lastEnabledIndex(
  entries: readonly MenuEntry[],
  includeDisabled = false,
): number {
  return nextEnabledIndex(entries, -1, -1, includeDisabled);
}

/**
 * The item a type-ahead `buffer` selects, or -1 when no label starts with it
 * (the caller then leaves focus where it is). Matching ignores case and
 * leading spaces; disabled items match, since they can hold focus.
 *
 * - One letter, or the same letter repeated ("s", "sss"), cycles: the search
 *   starts after `from`, so each press moves to the next label with that
 *   initial, and returns `from` only when it is the sole match.
 * - A longer buffer refines: the search starts at `from`, so focus stays put
 *   while the current label still matches.
 *
 * `from` outside the list (no item focused) searches from the top.
 */
export function typeaheadIndex(
  entries: readonly MenuEntry[],
  from: number,
  buffer: string,
): number {
  const typed = [...buffer.toLowerCase()];
  const first = typed[0];
  if (first === undefined) return -1;
  const needle = typed.every((ch) => ch === first) ? first : typed.join('');
  const n = entries.length;
  const cycles = needle === first;
  const start = from >= 0 && from < n ? from + (cycles ? 1 : 0) : 0;
  for (let step = 0; step < n; step++) {
    const i = (start + step) % n;
    const entry = entries[i];
    if (
      isMenuItem(entry) &&
      entry.label.trimStart().toLowerCase().startsWith(needle)
    )
      return i;
  }
  return -1;
}

/** A box in viewport coordinates. */
export interface MenuRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

/** The margin a menu keeps from every edge of the viewport, in px. */
export const MENU_EDGE = 4;

/**
 * Where to put a popup of `size` beside `anchor` so that it is fully inside
 * `viewport`, as the top-left corner in viewport coordinates.
 *
 * `placement` is the wish: the side (`below` / `above` / `right`) and the
 * alignment (`start`: left edges together, or tops for `right`; `end`: right
 * edges together). `gap` is the distance kept from the anchor on the side
 * axis; a negative gap overlaps it.
 *
 * 1. Side: if the popup does not fit on the wished side and the opposite side
 *    has more room, it flips (`below` ↔ `above`, `right` ↔ `left`).
 * 2. Alignment: if `start` overflows and `end` fits (or the reverse), it
 *    switches, so a menu near the right edge hangs from its trigger's right
 *    corner instead of being shifted arbitrarily.
 * 3. Clamp: whatever is left is pushed inside the `MENU_EDGE` margin. A popup
 *    larger than the viewport is pinned to the top / left margin, so its start
 *    is always reachable; the caller limits its height and lets it scroll.
 *
 * The returned `placement` says what was actually used.
 */
export function placeMenu(
  anchor: MenuRect,
  size: MenuSize,
  viewport: MenuSize,
  placement: MenuPlacement = 'below-start',
  gap = 4,
): { left: number; top: number; placement: MenuPlacement } {
  const clamp = (at: number, length: number, extent: number): number =>
    Math.max(MENU_EDGE, Math.min(at, extent - MENU_EDGE - length));

  if (placement === 'right-start' || placement === 'left-start') {
    const right = anchor.right + gap;
    const left = anchor.left - gap - size.width;
    const roomRight = viewport.width - MENU_EDGE - right;
    const roomLeft = anchor.left - gap - MENU_EDGE;
    const wishRight = placement === 'right-start';
    const room = wishRight ? roomRight : roomLeft;
    const other = wishRight ? roomLeft : roomRight;
    const useRight = size.width > room && other > room ? !wishRight : wishRight;
    return {
      left: clamp(useRight ? right : left, size.width, viewport.width),
      top: clamp(anchor.top, size.height, viewport.height),
      placement: useRight ? 'right-start' : 'left-start',
    };
  }

  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const roomBelow = viewport.height - MENU_EDGE - below;
  const roomAbove = anchor.top - gap - MENU_EDGE;
  const wishBelow = placement === 'below-start' || placement === 'below-end';
  const room = wishBelow ? roomBelow : roomAbove;
  const other = wishBelow ? roomAbove : roomBelow;
  const useBelow = size.height > room && other > room ? !wishBelow : wishBelow;

  const start = anchor.left;
  const end = anchor.right - size.width;
  const inside = (at: number): boolean =>
    at >= MENU_EDGE && at + size.width <= viewport.width - MENU_EDGE;
  const wishStart = placement === 'below-start' || placement === 'above-start';
  const useStart = wishStart
    ? inside(start) || !inside(end)
    : !inside(end) && inside(start);

  return {
    left: clamp(useStart ? start : end, size.width, viewport.width),
    top: clamp(useBelow ? below : above, size.height, viewport.height),
    placement: `${useBelow ? 'below' : 'above'}-${useStart ? 'start' : 'end'}`,
  };
}

/* ── The component ──────────────────────────────────────────────────── */

/** Hovering a submenu parent opens it after this long. */
const OPEN_DELAY_MS = 150;
/** An open submenu survives this long while the pointer crosses its parent's
 * siblings on the way to it. */
const GRACE_MS = 300;
const TYPEAHEAD_RESET_MS = 500;
/** Distance between a trigger element and its menu. */
const ANCHOR_GAP = 4;
/** How far a submenu overlaps its parent menu. */
const SUBMENU_OVERLAP = 4;
/** A menu's border + padding (menu.css): lifts a submenu by this much so its
 * first item lines up with the parent item. */
const MENU_INSET = 5;

const SVG_ATTRS =
  'viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
  'aria-hidden="true" focusable="false"';
const CHECK_SVG = `<svg ${SVG_ATTRS}><path d="M3.5 8.5l3 3 6-7"/></svg>`;
const CARET_SVG = `<svg ${SVG_ATTRS}><path d="M6 3.5 10.5 8 6 12.5"/></svg>`;

/** One open menu: the root, or a submenu. */
interface Level {
  el: HTMLDivElement;
  entries: readonly MenuEntry[];
  /** The button of each entry; null for separators and headings. */
  buttons: (HTMLButtonElement | null)[];
  parent: Level | null;
  /** The open submenu, and the index of the entry it belongs to. */
  child: Level | null;
  childIndex: number;
  /** The item the pointer was last seen on; -1 when it is not on one. */
  hoverIndex: number;
  /** Timer ids; 0 when not running. */
  openTimer: number;
  graceTimer: number;
  typed: string;
  typeTimer: number;
}

/** An open root menu with its submenus. */
interface Chain {
  layer: HTMLDivElement;
  /** The closing focus sentinel: submenus are inserted before it. */
  tail: HTMLElement;
  root: Level;
  anchor: HTMLElement | null;
  options: MenuOptions;
  open: boolean;
  /** Aborting it removes every listener the chain added. */
  listeners: AbortController;
  /** Unregisters the overlay. */
  release: () => void;
}

/** The open menu. There is never more than one. */
let current: Chain | null = null;

function isElement(anchor: MenuOptions['anchor']): anchor is HTMLElement {
  return 'nodeType' in anchor;
}

function resolve(entries: MenuEntries): MenuEntry[] {
  return typeof entries === 'function' ? entries() : entries;
}

/** An element's accessible name, as far as it can be read cheaply. */
function nameOf(el: HTMLElement): string {
  return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
}

function span(className: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  return el;
}

/** A focus sentinel for the overlay's Tab trap (see the file comment). */
function edge(): HTMLSpanElement {
  const el = span('menu-edge');
  el.tabIndex = 0;
  el.setAttribute('inert', '');
  return el;
}

function hasSubmenu(entry: MenuEntry | undefined): entry is MenuItem {
  return isMenuItem(entry) && !!entry.submenu && !entry.disabled;
}

function itemButton(entry: MenuItem, columns: 0 | 1 | 2): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = entry.danger ? 'menu-item danger' : 'menu-item';
  btn.tabIndex = -1;
  const checkable = entry.checked !== undefined;
  btn.setAttribute('role', checkable ? 'menuitemcheckbox' : 'menuitem');
  if (checkable) btn.setAttribute('aria-checked', String(entry.checked));
  if (entry.id !== undefined) btn.dataset.command = entry.id;
  if (entry.disabled) btn.setAttribute('aria-disabled', 'true');
  if (entry.submenu) {
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
  }
  // Leading slots: a tick for a checkbox item, the icon for any other. Every
  // row of a menu gets the slot once one row needs it, so the labels line up;
  // rows get both only in a menu where some item has a tick and an icon.
  if (columns === 2 || (columns === 1 && checkable)) {
    const check = span('menu-check');
    check.setAttribute('aria-hidden', 'true');
    if (entry.checked) check.innerHTML = CHECK_SVG;
    btn.append(check);
  }
  if (columns === 2 || (columns === 1 && !checkable)) {
    const icon = span('menu-icon');
    icon.setAttribute('aria-hidden', 'true');
    if (entry.iconHtml) icon.innerHTML = entry.iconHtml; // trusted, see MenuItem
    btn.append(icon);
  }
  const label = span('menu-label');
  label.textContent = entry.label;
  btn.append(label);
  if (entry.hint) {
    const hint = span('menu-hint');
    hint.textContent = entry.hint;
    btn.append(hint);
  }
  if (entry.submenu) {
    const caret = span('menu-caret');
    caret.innerHTML = CARET_SVG;
    btn.append(caret);
  }
  return btn;
}

function buildLevel(
  entries: readonly MenuEntry[],
  label: string,
  parent: Level | null,
): Level {
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  if (label) el.setAttribute('aria-label', label);
  // The menu is its own tab stop until an item takes focus (roving tabindex).
  el.tabIndex = 0;

  const items = entries.filter(isMenuItem);
  const ticked = (e: MenuItem): boolean => e.checked !== undefined;
  const columns = items.some((e) => ticked(e) && !!e.iconHtml)
    ? 2
    : items.some((e) => ticked(e) || !!e.iconHtml)
      ? 1
      : 0;
  const buttons: (HTMLButtonElement | null)[] = [];
  let group: HTMLElement = el;
  for (const entry of entries) {
    if (isMenuItem(entry)) {
      const btn = itemButton(entry, columns);
      group.append(btn);
      buttons.push(btn);
      continue;
    }
    buttons.push(null);
    if (entry.kind === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'menu-sep';
      sep.setAttribute('role', 'separator');
      el.append(sep);
      group = el;
    } else {
      // A heading names the group that runs to the next separator or heading.
      // The name is on the group; the visible text is not announced twice.
      group = document.createElement('div');
      group.className = 'menu-group';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', entry.label);
      const heading = document.createElement('div');
      heading.className = 'menu-heading';
      heading.setAttribute('aria-hidden', 'true');
      heading.textContent = entry.label;
      group.append(heading);
      el.append(group);
    }
  }

  const level: Level = {
    el,
    entries,
    buttons,
    parent,
    child: null,
    childIndex: -1,
    hoverIndex: -1,
    openTimer: 0,
    graceTimer: 0,
    typed: '',
    typeTimer: 0,
  };
  // The pointer left this menu, for its submenu or for somewhere else: either
  // way nothing pending here should still open or close a submenu.
  el.addEventListener('pointerleave', () => clearHover(level));
  return level;
}

/** Size the popup to the viewport and put it beside its anchor. */
function place(
  el: HTMLElement,
  anchor: MenuRect,
  placement: MenuPlacement,
  gap: number,
): void {
  const root = document.documentElement;
  const viewport = {
    width: root.clientWidth || window.innerWidth,
    height: root.clientHeight || window.innerHeight,
  };
  // A menu taller than the viewport scrolls inside itself.
  const room = viewport.height - 2 * MENU_EDGE;
  let box = el.getBoundingClientRect();
  if (box.height > room) {
    el.style.maxHeight = `${room}px`;
    el.classList.add('scroll-slim');
    box = el.getBoundingClientRect();
  }
  const at = placeMenu(anchor, box, viewport, placement, gap);
  el.style.left = `${Math.round(at.left)}px`;
  el.style.top = `${Math.round(at.top)}px`;
  el.dataset.placement = at.placement;
}

function levelOf(chain: Chain, target: EventTarget | null): Level | null {
  if (!(target instanceof Node)) return null;
  for (let level: Level | null = chain.root; level; level = level.child)
    if (level.el.contains(target)) return level;
  return null;
}

/** The index of the item an event landed on in `level`; -1 if none. */
function indexAt(level: Level, target: EventTarget | null): number {
  const btn =
    target instanceof Element
      ? target.closest<HTMLButtonElement>('.menu-item')
      : null;
  return btn ? level.buttons.indexOf(btn) : -1;
}

function clearHover(level: Level): void {
  window.clearTimeout(level.openTimer);
  window.clearTimeout(level.graceTimer);
  level.openTimer = 0;
  level.graceTimer = 0;
  level.hoverIndex = -1;
}

function clearTimers(level: Level): void {
  clearHover(level);
  window.clearTimeout(level.typeTimer);
  level.typeTimer = 0;
  level.typed = '';
}

function focusTarget(level: Level, focus: MenuFocus): HTMLElement {
  if (focus === 'menu') return level.el;
  const pick = focus === 'first' ? firstEnabledIndex : lastEnabledIndex;
  // Prefer an item that can be activated; with none, any item can still be
  // read out. An empty menu keeps focus on itself.
  let index = pick(level.entries);
  if (index < 0) index = pick(level.entries, true);
  return level.buttons[index] ?? level.el;
}

/** Move focus to an item with the keyboard. */
function moveTo(level: Level, index: number): void {
  if (index < 0) return;
  clearHover(level);
  if (level.child && level.childIndex !== index) closeChild(level);
  level.buttons[index]?.focus();
}

/**
 * Close `parent`'s submenu (and anything open below it). Focus goes back to
 * the parent item if it was inside what closed.
 */
function closeChild(parent: Level): void {
  const child = parent.child;
  if (!child) return;
  closeChild(child);
  clearTimers(child);
  const item = parent.buttons[parent.childIndex];
  item?.setAttribute('aria-expanded', 'false');
  parent.child = null;
  parent.childIndex = -1;
  // Before the element goes, so focus never falls back to the page.
  if (child.el.contains(document.activeElement)) item?.focus();
  child.el.remove();
}

/**
 * Open the submenu of `parent`'s entry at `index`. `enter` moves focus to its
 * first item (keyboard); otherwise focus stays on the parent item (pointer).
 */
function openChild(
  chain: Chain,
  parent: Level,
  index: number,
  enter: boolean,
): void {
  const entry = parent.entries[index];
  const item = parent.buttons[index];
  if (!hasSubmenu(entry) || !entry.submenu || !item) return;
  if (parent.childIndex !== index) {
    closeChild(parent);
    const child = buildLevel(resolve(entry.submenu), entry.label, parent);
    chain.layer.insertBefore(child.el, chain.tail);
    const row = item.getBoundingClientRect();
    const menu = parent.el.getBoundingClientRect();
    place(
      child.el,
      {
        left: menu.left,
        right: menu.right,
        top: row.top - MENU_INSET,
        bottom: row.bottom + MENU_INSET,
      },
      'right-start',
      -SUBMENU_OVERLAP,
    );
    parent.child = child;
    parent.childIndex = index;
    item.setAttribute('aria-expanded', 'true');
  }
  clearHover(parent);
  if (enter && parent.child) focusTarget(parent.child, 'first').focus();
}

function closeChain(chain: Chain, reason: MenuCloseReason): void {
  if (!chain.open) return;
  chain.open = false;
  if (current === chain) current = null;
  chain.listeners.abort();
  for (let level: Level | null = chain.root; level; level = level.child)
    clearTimers(level);

  // Focus goes back to the trigger, unless the user has already put it
  // somewhere else. Doing it before the overlay is released leaves the
  // primitive's own restore with nothing to do; for a menu opened at a point
  // (or from an anchor that cannot take focus) that restore is the fallback,
  // back to whatever had focus when the menu opened.
  const active = document.activeElement;
  const held =
    !active || active === document.body || chain.layer.contains(active);
  if (held && chain.anchor?.isConnected) chain.anchor.focus();
  chain.release();
  chain.layer.remove();
  if (chain.anchor?.hasAttribute('aria-haspopup'))
    chain.anchor.setAttribute('aria-expanded', 'false');
  chain.options.onClose?.(reason);
}

/** Escape: one level at a time, deepest first. */
function closeDeepest(chain: Chain): void {
  chain.layer.removeAttribute('data-pointer');
  let level = chain.root;
  while (level.child) level = level.child;
  if (level.parent) closeChild(level.parent);
  else closeChain(chain, 'escape');
}

function onKeydown(chain: Chain, e: KeyboardEvent): void {
  if (isImeKey(e)) return;
  const level = levelOf(chain, e.target);
  if (!level) return;
  // The keyboard is driving again: the focus ring is back (see onPointerMove).
  chain.layer.removeAttribute('data-pointer');
  if (e.key === 'Tab') {
    // Not prevented: with focus back on the trigger, the browser's own Tab
    // moves on from there.
    closeChain(chain, 'tab');
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // -1 while the menu itself has focus and no item does.
  const index = indexAt(level, e.target);
  switch (e.key) {
    case 'ArrowDown':
      moveTo(level, nextEnabledIndex(level.entries, index, 1, true));
      break;
    case 'ArrowUp':
      moveTo(level, nextEnabledIndex(level.entries, index, -1, true));
      break;
    case 'Home':
      moveTo(level, firstEnabledIndex(level.entries, true));
      break;
    case 'End':
      moveTo(level, lastEnabledIndex(level.entries, true));
      break;
    case 'ArrowRight':
      if (hasSubmenu(level.entries[index]))
        openChild(chain, level, index, true);
      else chain.options.onNavigate?.('next');
      break;
    case 'ArrowLeft':
      if (level.parent) closeChild(level.parent);
      else chain.options.onNavigate?.('previous');
      break;
    case 'Enter':
    case ' ':
      // Activation is the browser's click on the focused button. Swallow
      // only what would misfire: auto-repeat (holding Enter on a menu bar
      // button must not run the first item), and Space on the menu itself,
      // which would scroll.
      if (e.repeat || index < 0) e.preventDefault();
      return;
    default: {
      if ([...e.key].length !== 1) return; // not a printable character
      window.clearTimeout(level.typeTimer);
      level.typed += e.key;
      level.typeTimer = window.setTimeout(() => {
        level.typed = '';
        level.typeTimer = 0;
      }, TYPEAHEAD_RESET_MS);
      moveTo(level, typeaheadIndex(level.entries, index, level.typed));
    }
  }
  // The key was the menu's: nothing behind it gets to act on it as well.
  e.preventDefault();
  e.stopPropagation();
}

function onClick(chain: Chain, e: MouseEvent): void {
  const level = levelOf(chain, e.target);
  if (!level) return;
  const index = indexAt(level, e.target);
  const entry = level.entries[index];
  if (!isMenuItem(entry) || entry.disabled) return;
  if (entry.submenu) {
    // A click the keyboard made (detail 0) moves into the submenu.
    openChild(chain, level, index, e.detail === 0);
    return;
  }
  const run = entry.run;
  if (!run) return;
  // Close first, so a command that opens a dialog starts from a clean focus
  // state: no menu in the DOM, focus on the trigger.
  closeChain(chain, 'select');
  run();
}

function onPointerMove(chain: Chain, e: PointerEvent): void {
  if (e.pointerType === 'touch') return; // touch has no hover: a tap clicks
  const level = levelOf(chain, e.target);
  if (!level) return;
  // The pointer is inside this menu, so every menu above it keeps it open.
  for (let up = level.parent; up; up = up.parent) clearHover(up);
  const index = indexAt(level, e.target);
  const btn = level.buttons[index];
  if (!btn) {
    // On a separator, a heading or the padding.
    window.clearTimeout(level.openTimer);
    level.openTimer = 0;
    level.hoverIndex = -1;
    return;
  }
  // The item under the pointer is the active one: a single highlight, and the
  // arrow keys continue from here. Focus moved by the pointer shows the
  // highlight only; the stylesheet keeps the focus ring for the keyboard
  // (browsers decide :focus-visible for scripted focus by the last key
  // press, which would otherwise draw a ring that trails the pointer).
  chain.layer.setAttribute('data-pointer', '');
  if (document.activeElement !== btn) btn.focus({ preventScroll: true });
  if (index === level.hoverIndex) return;
  level.hoverIndex = index;
  window.clearTimeout(level.openTimer);
  level.openTimer = 0;
  if (level.child) {
    if (level.childIndex === index) {
      // Back on the open submenu's own parent: it stays.
      window.clearTimeout(level.graceTimer);
      level.graceTimer = 0;
    } else if (!level.graceTimer) {
      // On a sibling of the open submenu's parent. That is also what a
      // diagonal move toward the submenu looks like, so wait before acting;
      // reaching the submenu (pointerleave here) cancels this.
      level.graceTimer = window.setTimeout(() => {
        level.graceTimer = 0;
        closeChild(level);
        if (hasSubmenu(level.entries[level.hoverIndex]))
          openChild(chain, level, level.hoverIndex, false);
      }, GRACE_MS);
    }
    return;
  }
  if (hasSubmenu(level.entries[index]))
    level.openTimer = window.setTimeout(() => {
      level.openTimer = 0;
      openChild(chain, level, index, false);
    }, OPEN_DELAY_MS);
}

/** Roving tabindex: whatever has focus in a menu is that menu's tab stop. */
function onFocusIn(chain: Chain, e: FocusEvent): void {
  const level = levelOf(chain, e.target);
  if (!level) return;
  for (const btn of level.buttons)
    if (btn) btn.tabIndex = btn === e.target ? 0 : -1;
  level.el.tabIndex = level.el === e.target ? 0 : -1;
}

function listen(chain: Chain): void {
  const { layer, anchor } = chain;
  const { signal } = chain.listeners;
  const outside = (target: EventTarget | null): boolean =>
    target instanceof Node &&
    !layer.contains(target) &&
    !anchor?.contains(target);

  layer.addEventListener('keydown', (e) => onKeydown(chain, e), { signal });
  layer.addEventListener('click', (e) => onClick(chain, e), { signal });
  layer.addEventListener('pointermove', (e) => onPointerMove(chain, e), {
    signal,
  });
  layer.addEventListener('focusin', (e) => onFocusIn(chain, e), { signal });
  // A menu is not a place for the browser's own context menu.
  layer.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

  // A press anywhere else closes the menu and still does what it would have
  // done. A press on the trigger is left alone: the trigger's click decides
  // (it sees `isOpen()` and closes), so the menu is not closed here only to
  // be reopened by that click.
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (outside(e.target)) closeChain(chain, 'outside');
    },
    { capture: true, signal },
  );
  // Focus taken elsewhere (by the application, or by assistive technology)
  // leaves nothing to drive the menu with, so it closes without pulling
  // focus back.
  document.addEventListener(
    'focusin',
    (e) => {
      if (outside(e.target)) closeChain(chain, 'blur');
    },
    { signal },
  );
  window.addEventListener('blur', () => closeChain(chain, 'blur'), { signal });
  window.addEventListener('resize', () => closeChain(chain, 'resize'), {
    signal,
  });
}

/**
 * Open a menu. Any menu already open closes first (reason `'programmatic'`).
 * `entries` given as a function is called now, so checked and disabled states
 * are current.
 */
export function openMenu(
  entries: MenuEntries,
  options: MenuOptions,
): MenuHandle {
  closeAllMenus();
  const anchor = isElement(options.anchor) ? options.anchor : null;
  const label = options.label ?? (anchor ? nameOf(anchor) : '');
  const root = buildLevel(resolve(entries), label, null);
  const layer = document.createElement('div');
  layer.className = 'menu-layer';
  const tail = edge();
  layer.append(edge(), root.el, tail);
  document.body.append(layer);

  const chain: Chain = {
    layer,
    tail,
    root,
    anchor,
    options,
    open: true,
    listeners: new AbortController(),
    release: () => {},
  };
  current = chain;

  const at = isElement(options.anchor)
    ? options.anchor.getBoundingClientRect()
    : {
        left: options.anchor.x,
        right: options.anchor.x,
        top: options.anchor.y,
        bottom: options.anchor.y,
      };
  place(
    root.el,
    at,
    options.placement ?? 'below-start',
    anchor ? ANCHOR_GAP : 0,
  );
  if (anchor?.hasAttribute('aria-haspopup'))
    anchor.setAttribute('aria-expanded', 'true');
  listen(chain);
  // Focus on the menu itself is the pointer's kind of open: no ring around
  // the popup (see onPointerMove).
  const focus = options.focus ?? 'menu';
  if (focus === 'menu') layer.setAttribute('data-pointer', '');
  // The overlay primitive makes the shell's shortcuts stand down, routes
  // Escape here, and moves focus to the target named (so it has no default
  // of its own to apply).
  chain.release = registerOverlay(layer, {
    close: () => closeDeepest(chain),
    initialFocus: focusTarget(root, focus),
  });
  // If something answered that focus move by closing the menu, the overlay
  // was registered after the close ran: it must not stay behind and keep the
  // shell's shortcuts off.
  if (!chain.open) chain.release();

  return {
    element: root.el,
    isOpen: () => chain.open,
    close: (reason = 'programmatic') => closeChain(chain, reason),
  };
}

/** Close the open menu, if there is one. */
export function closeAllMenus(reason: MenuCloseReason = 'programmatic'): void {
  if (current) closeChain(current, reason);
}

/**
 * `openMenu`, unless the menu anchored to the same element is open: then it
 * closes and null is returned. For a trigger's click handler:
 *
 *     button.addEventListener('click', () =>
 *       toggleMenu(entries, { anchor: button }),
 *     );
 */
export function toggleMenu(
  entries: MenuEntries,
  options: MenuOptions,
): MenuHandle | null {
  if (current?.anchor && current.anchor === options.anchor) {
    closeChain(current, 'programmatic');
    return null;
  }
  return openMenu(entries, options);
}

/* ── Triggers: a menu button, and the menu bar ──────────────────────── */

/**
 * Whether the focus inside `root` (a trigger, or the menu bar) belongs to the
 * keyboard. The shell's rule (`./key-routing.ts`) is that a button which was
 * only clicked does not hold the keyboard: the arrows, Space and Enter stay
 * canvas shortcuts. A trigger follows it. Its keys act when focus came by
 * Tab, by an arrow key, or back from a menu that the keyboard closed; they
 * stand down when a pointer put focus there (a click on the trigger, or on a
 * menu item, after which focus returns to it).
 *
 * So: the kind of the last input, sampled when focus arrives, and a press on
 * the trigger itself always hands the keyboard back. (`:focus-visible` looks
 * like the same question but is not: Chromium keeps it on after a key press
 * until a pointer moves focus, so a click on an already focused button, or on
 * a menu item the pointer had focused by hovering, still reports it.)
 */
function keyboardFocus(root: HTMLElement, signal: AbortSignal): () => boolean {
  // Before any input, focus counts as the keyboard's, as it does in the shell.
  let keyboardLast = true;
  let byKeyboard = true;
  const capture = { capture: true, signal };
  window.addEventListener('pointerdown', () => (keyboardLast = false), capture);
  window.addEventListener('keydown', () => (keyboardLast = true), capture);
  root.addEventListener('pointerdown', () => (byKeyboard = false), { signal });
  root.addEventListener('focusin', () => (byKeyboard = keyboardLast), {
    signal,
  });
  return () => byKeyboard;
}

/** A key press that is a plain key, not an input-method or modified one. */
function plainKey(e: KeyboardEvent): boolean {
  return !isImeKey(e) && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/**
 * Make `button` a menu button (WAI-ARIA "Menu Button"): `aria-haspopup` and
 * `aria-expanded` are kept on it, a click toggles the menu, ArrowDown opens
 * it on the first item and ArrowUp on the last. Enter and Space are the
 * button's own click; a click made by the keyboard opens on the first item,
 * one made by a pointer leaves focus on the menu.
 */
export function attachMenuButton(
  button: HTMLElement,
  entries: MenuEntries,
  options: Omit<MenuOptions, 'anchor' | 'focus'> = {},
): { destroy(): void } {
  const listeners = new AbortController();
  const { signal } = listeners;
  const keyboard = keyboardFocus(button, signal);
  let handle: MenuHandle | null = null;
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');

  const show = (focus: MenuFocus): void => {
    handle = openMenu(entries, { ...options, anchor: button, focus });
  };
  button.addEventListener(
    'click',
    (e) => {
      if (handle?.isOpen()) handle.close();
      else show(e.detail === 0 ? 'first' : 'menu');
    },
    { signal },
  );
  button.addEventListener(
    'keydown',
    (e) => {
      if (!plainKey(e) || !keyboard()) return;
      if (e.key === 'Enter' || e.key === ' ') {
        // The browser's click opens the menu; the shell must not also take
        // the key as a canvas shortcut.
        e.stopPropagation();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      show(e.key === 'ArrowDown' ? 'first' : 'last');
      e.preventDefault();
      e.stopPropagation();
    },
    { signal },
  );

  return {
    destroy(): void {
      listeners.abort();
      if (handle?.isOpen()) handle.close();
    },
  };
}

/**
 * Drive a menu bar (WAI-ARIA "Menubar"). `bar` is the `role="menubar"`
 * element; its top-level items are the `button[data-menu][role="menuitem"]`
 * inside it, and `menuFor(key)` builds the menu of the one whose `data-menu`
 * is `key`, each time it opens.
 *
 * The bar gets a roving tabindex (one tab stop), and each button
 * `aria-haspopup="menu"` and `aria-expanded`. A click toggles a button's
 * menu. ArrowLeft / ArrowRight move between the buttons, wrapping, and Home /
 * End go to the ends; with a menu open they open the neighbour's menu on its
 * first item instead. ArrowDown, Enter and Space open on the first item,
 * ArrowUp on the last. While a menu is open, moving the pointer onto another
 * button switches to its menu. Buttons that are not displayed are skipped.
 */
export function attachMenubar(
  bar: HTMLElement,
  menuFor: (key: string) => MenuEntry[],
): { destroy(): void } {
  const listeners = new AbortController();
  const { signal } = listeners;
  const keyboard = keyboardFocus(bar, signal);
  let open: { button: HTMLElement; handle: MenuHandle } | null = null;

  const all = (): HTMLElement[] => [
    ...bar.querySelectorAll<HTMLElement>('[data-menu]'),
  ];
  const shown = (): HTMLElement[] =>
    all().filter((b) => b.getClientRects().length > 0);
  const buttonAt = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element
      ? target.closest<HTMLElement>('[data-menu]')
      : null;
  const isOpen = (): boolean => !!open?.handle.isOpen();
  const setTabStop = (stop: HTMLElement | undefined): void => {
    for (const b of all()) b.tabIndex = b === stop ? 0 : -1;
  };
  const neighbour = (of: HTMLElement, dir: 1 | -1): HTMLElement | undefined => {
    const list = shown();
    return list[(list.indexOf(of) + dir + list.length) % list.length];
  };

  const show = (button: HTMLElement, focus: MenuFocus): void => {
    const handle = openMenu(() => menuFor(button.dataset.menu ?? ''), {
      anchor: button,
      placement: 'below-start',
      focus,
      // ArrowLeft / ArrowRight that the menu had no use for.
      onNavigate: (direction) => {
        const next = neighbour(button, direction === 'next' ? 1 : -1);
        if (next && next !== button) show(next, 'first');
      },
    });
    open = { button, handle };
    // Focus goes from one menu to the next without touching the button, so
    // the bar's tab stop has to follow by hand.
    setTabStop(button);
  };
  /** Go to another top-level button: open its menu if one is open. */
  const go = (to: HTMLElement | undefined): void => {
    if (!to) return;
    if (isOpen()) show(to, 'first');
    else to.focus();
  };

  for (const b of all()) {
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
  }
  setTabStop(
    all().find((b) => b === document.activeElement) ?? shown()[0] ?? all()[0],
  );

  bar.addEventListener(
    'click',
    (e) => {
      const button = buttonAt(e.target);
      if (!button) return;
      if (open?.button === button && isOpen()) open.handle.close();
      else show(button, e.detail === 0 ? 'first' : 'menu');
    },
    { signal },
  );
  bar.addEventListener(
    'keydown',
    (e) => {
      const button = buttonAt(e.target);
      if (!button || !plainKey(e) || !keyboard()) return;
      switch (e.key) {
        case 'ArrowRight':
          go(neighbour(button, 1));
          break;
        case 'ArrowLeft':
          go(neighbour(button, -1));
          break;
        case 'Home':
          go(shown()[0]);
          break;
        case 'End':
          go(shown().at(-1));
          break;
        case 'ArrowDown':
          show(button, 'first');
          break;
        case 'ArrowUp':
          show(button, 'last');
          break;
        case 'Enter':
        case ' ':
          // The browser's click opens the menu; the shell must not also
          // take the key as a canvas shortcut.
          e.stopPropagation();
          return;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
    },
    { signal },
  );
  bar.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch' || !open || !isOpen()) return;
      const button = buttonAt(e.target);
      if (button && button !== open.button) show(button, 'menu');
    },
    { signal },
  );
  bar.addEventListener(
    'focusin',
    (e) => {
      const button = buttonAt(e.target);
      if (button) setTabStop(button);
    },
    { signal },
  );

  return {
    destroy(): void {
      listeners.abort();
      if (open && isOpen()) open.handle.close();
      open = null;
    },
  };
}
