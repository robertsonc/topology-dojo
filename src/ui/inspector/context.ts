import type { Editor } from '../../editor/editor.js';
import type { TopologyDocument } from '../../pages/model.js';
import type { CommandId } from '../commands.js';
import type { SectionMemory } from './sections.js';

/** What the properties panel's modules are given by the shell. */
export interface InspectorContext {
  /** The panel element (`#inspector`) the tab content is drawn into. */
  root: HTMLElement;
  editor: Editor;
  doc: TopologyDocument;
  sections: SectionMemory;
  /** Run a command of the registry. */
  run(id: CommandId): void;
  /** Draw the panel again. */
  rerender(): void;
  /** The document changed outside the editor's own updates: autosave it. */
  markDirty(): void;
  /** The panel's Title field changed the document's title: the top bar's
   * title field, which edits the same value, shows it. */
  titleChanged(): void;
  /**
   * Whether this is the first edit of a typing run, which takes the undo
   * snapshot. A run lasts until focus next enters the panel.
   */
  firstEdit(): boolean;
  /** Show the current page again, after the sheet changed its size. */
  showCurrentPage(): void;
}
