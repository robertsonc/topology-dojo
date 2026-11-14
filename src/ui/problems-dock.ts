/**
 * What the Problems dock and the status-bar indicator show for a given set of
 * problems — and whether the dock is open.
 *
 * The dock sits under the Properties panel and takes space from it, so it
 * opens when the user opens it, not when a problem appears: the count on its
 * header, the status-bar indicator and the badges on the canvas already say
 * that there is something to look at. Problems the user has hidden are still
 * accounted for: the header and the indicator say how many, so the way to
 * bring them back is never out of sight.
 */

export interface ProblemsSummary {
  /** Problems that are shown (not hidden). */
  visible: number;
  /** How many of the shown problems are errors; the rest are warnings. */
  errors: number;
  /** Problems the user has hidden. */
  hidden: number;
  /**
   * The user's own choice for the dock: true = closed, false = open, null if
   * they have never opened or closed it.
   */
  collapsedPref: boolean | null;
}

export interface ProblemsDockView {
  /** Whether the dock's list is closed. */
  collapsed: boolean;
  /** The count badge on the dock header: the problems that are shown. */
  count: string;
  /** Header note about hidden problems ("2 hidden"), empty when none. */
  hiddenNote: string;
  /** The worst level among the shown problems. */
  severity: 'error' | 'warn' | 'none';
  /** The status-bar indicator's text. */
  statusLabel: string;
  /** The status-bar indicator's tooltip and accessible name. */
  statusTitle: string;
}

function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export function problemsDockView(p: ProblemsSummary): ProblemsDockView {
  const warnings = Math.max(0, p.visible - p.errors);
  const hiddenNote = p.hidden > 0 ? `${p.hidden} hidden` : '';
  // With nothing to list at all the dock is closed. Otherwise it is where the
  // user left it, and closed until they first open it. Hidden problems count
  // as something to list: closing the dock whenever none are shown would
  // take the "show / restore" footer away from under the pointer.
  const collapsed =
    p.visible === 0 && p.hidden === 0 ? true : (p.collapsedPref ?? true);

  let statusLabel: string;
  let statusTitle: string;
  if (p.visible > 0) {
    statusLabel = `⚠ ${p.visible}`;
    statusTitle =
      `${counted(p.errors, 'error')}, ${counted(warnings, 'warning')}` +
      (hiddenNote ? `, ${hiddenNote}` : '') +
      ' — open Problems';
  } else if (p.hidden > 0) {
    statusLabel = `✓ ${hiddenNote}`;
    statusTitle = `No problems shown, ${hiddenNote} — open Problems to show or restore them`;
  } else {
    statusLabel = '✓';
    statusTitle = 'No problems';
  }
  return {
    collapsed,
    count: String(p.visible),
    hiddenNote,
    severity: p.errors > 0 ? 'error' : warnings > 0 ? 'warn' : 'none',
    statusLabel,
    statusTitle,
  };
}
