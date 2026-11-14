/**
 * What this tab last read from, or wrote to, its autosave slot.
 *
 * Autosave is one localStorage entry shared by every tab on the origin, so a
 * tab must be able to tell "I hold changes" from "I am merely open":
 *
 * - On unload, a tab with nothing new must NOT write. It may have been idle
 *   for an hour while another tab saved newer work to the same slot; writing
 *   its copy back would silently destroy that work.
 * - On a `storage` event, a write from another tab that differs from what this
 *   tab holds means the canvas is showing an out-of-date document.
 */
export class AutosaveLedger {
  private persisted: string | null = null;

  /** This tab loaded `json` from storage, or just wrote it. */
  record(json: string): void {
    this.persisted = json;
  }

  /** Whether `current` (the tab's document, serialized) is not in storage. */
  hasUnsaved(current: string): boolean {
    return current !== this.persisted;
  }

  /**
   * Whether a value another tab wrote to this tab's slot is news: present, and
   * not what this tab already holds. (Removal is not news — it is the other
   * tab leaving shared-copy mode, not a newer document.)
   */
  isForeignChange(newValue: string | null): boolean {
    return newValue !== null && newValue !== this.persisted;
  }
}
