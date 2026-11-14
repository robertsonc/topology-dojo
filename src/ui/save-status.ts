/**
 * What the toolbar's save chip shows — and what is announced — for each state
 * of the autosave.
 *
 * Two of the states are not statuses but warnings with a way out: a failed
 * save (the chip downloads the document) and a newer version saved by
 * another tab (the chip loads it). Both must be readable at a glance — one
 * line, not a column of wrapped words — and must reach someone who cannot
 * see the chip turn red: each carries an announcement for an alert region.
 */

export type SaveState =
  /** The latest change is in browser storage. */
  | 'saved'
  /** Browser storage refused the write (full, or unavailable). */
  | 'failed'
  /** Another tab saved a different version of this document. */
  | 'stale';

export interface SaveChip {
  state: SaveState;
  /** The chip's visible text. */
  text: string;
  /** Its tooltip. */
  title: string;
  /** Whether the chip is a button (a click or Enter acts on the warning). */
  actionable: boolean;
  /**
   * What to say in the alert region when the chip enters this state; empty
   * when there is nothing to announce (and to withdraw an earlier alert).
   */
  announcement: string;
}

/**
 * The chip for a save state. `shared` is whether the canvas holds a shared
 * copy (saved apart from the user's own document); `okText` replaces the
 * default "saved" wording after a load or a sync.
 */
export function saveChip(
  state: SaveState,
  opts: { shared?: boolean; okText?: string } = {},
): SaveChip {
  if (state === 'failed')
    return {
      state,
      text: '⚠ not saved — download JSON',
      title:
        'Browser storage failed (full or unavailable). ' +
        'Click to download the document as JSON so no work is lost.',
      actionable: true,
      announcement:
        'Not saved: browser storage is full or unavailable. ' +
        'Use the “not saved — download JSON” button in the toolbar to keep your work.',
    };
  if (state === 'stale')
    return {
      state,
      text: '⚠ changed in another tab — load it',
      title:
        'Another tab saved a different version of this document. Click to load ' +
        'it here. If you keep editing in this tab, this tab’s version is saved.',
      actionable: true,
      announcement:
        'Another tab saved a different version of this document. ' +
        'Use the “changed in another tab — load it” button in the toolbar to load it.',
    };
  return {
    state,
    text: opts.okText ?? (opts.shared ? '✓ saved · shared copy' : '✓ saved'),
    title: opts.shared
      ? 'Autosaved separately — your own document is untouched'
      : 'Autosaved to this browser',
    actionable: false,
    announcement: '',
  };
}
