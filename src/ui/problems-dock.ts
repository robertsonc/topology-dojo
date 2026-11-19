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
import type { IconName } from './icons.js';

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
  /** The status-bar indicator's mark: problems are shown, or none are. */
  statusIcon: Extract<IconName, 'warning' | 'check'>;
  /** The status-bar indicator's text after the mark; empty when clean. */
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

  let statusIcon: ProblemsDockView['statusIcon'];
  let statusLabel: string;
  let statusTitle: string;
  if (p.visible > 0) {
    statusIcon = 'warning';
    statusLabel = String(p.visible);
    statusTitle =
      `${counted(p.errors, 'error')}, ${counted(warnings, 'warning')}` +
      (hiddenNote ? `, ${hiddenNote}` : '') +
      ' — open Problems';
  } else if (p.hidden > 0) {
    statusIcon = 'check';
    statusLabel = hiddenNote;
    statusTitle = `No problems shown, ${hiddenNote} — open Problems to show or restore them`;
  } else {
    statusIcon = 'check';
    statusLabel = '';
    statusTitle = 'No problems';
  }
  return {
    collapsed,
    count: String(p.visible),
    hiddenNote,
    severity: p.errors > 0 ? 'error' : warnings > 0 ? 'warn' : 'none',
    statusIcon,
    statusLabel,
    statusTitle,
  };
}

/** Where in the properties panel a problem is fixed: the tab that shows it
 * and, when the problem is about one field, that field's selector. */
export interface ProblemField {
  tab: 'selection' | 'page' | 'document';
  /** A selector inside the panel, or null when no one field is at fault. */
  field: string | null;
}

/** Page fields of the Page tab, by the document key a problem names. */
const PAGE_FIELDS: Readonly<Record<string, string>> = {
  duration: '#p-dur',
  transition: '#p-tr',
  lineJumps: '#p-jumps',
  portLabels: '#p-portlabels',
  viewBox: '#p-w',
  linkAttach: '#p-attach',
};

/**
 * Where a problem is fixed. A problem about an element (its `where` names a
 * node, link or zone) is fixed on the Selection tab; one about a page on the
 * Page tab; one about the document's layers, tiers, bundles, link styles or
 * custom types on the Document tab. The field is the one the message starts
 * with when it is a key followed by what is wrong with it ("href must …",
 * "opacity 2 should …", "labelScale 9 should …"); the type for an unknown
 * type, the link field for a page link that points nowhere.
 */
export function problemField(p: {
  where: string;
  message: string;
}): ProblemField | null {
  const lead = /^([a-z][A-Za-z]*) (?:must|should|is|out|not|"|'|-?\d)/.exec(
    p.message,
  )?.[1];
  if (/^page\[\d+\](?: "[^"]*")?$/.test(p.where))
    return { tab: 'page', field: (lead && PAGE_FIELDS[lead]) ?? null };
  if (/ (?:node|link|zone) "/.test(p.where)) {
    if (/^unknown (?:node|link) type /.test(p.message))
      return { tab: 'selection', field: '#i-type' };
    if (/^page link /.test(p.message))
      return { tab: 'selection', field: '[data-key="href"]' };
    return {
      tab: 'selection',
      field: lead ? `[data-key="${lead}"]` : null,
    };
  }
  if (
    p.where === 'document' ||
    /^(?:layers|tiers|bundles|linkStyles|customNodes)\[/.test(p.where)
  )
    return { tab: 'document', field: null };
  return null;
}
