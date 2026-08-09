/**
 * Shared overlay/focus primitive (issue #209).
 *
 * Every floating surface that owns interaction while open — modals (node
 * designer, help), side panels (workspace / preferences / admin), popovers
 * (display settings, account menu) and the context menu — registers here on
 * open. The primitive supplies the behavior they all need identically:
 *
 * - initial focus (a designated element, else the first focusable, else the
 *   root itself, made focusable);
 * - a Tab/Shift+Tab focus trap inside the topmost overlay;
 * - Escape closes the topmost overlay (its own `close` callback runs, so each
 *   surface keeps its existing teardown path);
 * - focus restored to the invoking element on release.
 *
 * The app shell's global shortcut handler checks `overlayActive()` and bails
 * while any overlay is open, so canvas shortcuts (Delete/T/L/V/…) can never
 * mutate the hidden document behind a dialog. The primitive's own listener is
 * capture-phase and touches ONLY Escape and Tab — every other key still
 * reaches the overlay's own controls (inputs, menus, arrows).
 */

interface OverlayEntry {
  root: HTMLElement;
  close: () => void;
  /** The element focused when the overlay opened — focus returns here. */
  invoker: HTMLElement | null;
}

const stack: OverlayEntry[] = [];

/** Tabbables the trap cycles through; hidden/disabled controls are skipped. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0,
  );
}

/** Whether any overlay currently owns interaction (shortcut handlers bail). */
export function overlayActive(): boolean {
  return stack.length > 0;
}

/**
 * Register an open overlay. Call the returned release function from the
 * overlay's OWN close path (it only unregisters + restores focus — it never
 * closes the overlay itself). `close` is what Escape invokes on the topmost
 * overlay; `initialFocus` overrides the first-focusable default.
 */
export function registerOverlay(
  root: HTMLElement,
  options: { close: () => void; initialFocus?: HTMLElement | null },
): () => void {
  const entry: OverlayEntry = {
    root,
    close: options.close,
    invoker:
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
  };
  stack.push(entry);
  const target = options.initialFocus ?? focusables(root)[0] ?? root;
  if (target === root && !root.hasAttribute('tabindex')) root.tabIndex = -1;
  target.focus();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    // Restore focus to the invoker — but never steal it from an element the
    // user (or a newer overlay) has meanwhile focused outside this overlay.
    const active = document.activeElement;
    if (
      entry.invoker &&
      document.contains(entry.invoker) &&
      (active === null || active === document.body || root.contains(active))
    )
      entry.invoker.focus();
  };
}

function onKeydown(e: KeyboardEvent): void {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    top.close();
    return;
  }
  if (e.key !== 'Tab') return;
  const items = focusables(top.root);
  if (items.length === 0) {
    e.preventDefault();
    top.root.focus();
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const i = active ? items.indexOf(active) : -1;
  if (i === -1) {
    // Focus escaped the overlay (e.g. a poll re-rendered its body) — re-enter.
    e.preventDefault();
    (e.shiftKey ? items[items.length - 1] : items[0])!.focus();
  } else if (!e.shiftKey && i === items.length - 1) {
    e.preventDefault();
    items[0]!.focus();
  } else if (e.shiftKey && i === 0) {
    e.preventDefault();
    items[items.length - 1]!.focus();
  }
}

// Capture-phase so Escape/Tab are settled before any bubble-phase app handler
// (window guard: this module is also imported under the Node test runner).
if (
  typeof window !== 'undefined' &&
  typeof window.addEventListener === 'function'
) {
  window.addEventListener('keydown', onKeydown, true);
}
