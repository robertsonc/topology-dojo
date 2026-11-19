/**
 * The head of the Selection tab: an icon for what kind of thing is selected,
 * its name, the type picker (`#i-type`, where the kind has types), and the
 * quick actions on the right: the lock toggle (nodes and links) and a "more"
 * menu of the commands that act on the selection.
 *
 * The actions are commands of the registry: the menu shows each command's
 * title and shortcut, is disabled where the command is, and runs it. Nothing
 * here writes the document itself.
 */
import type { CommandId, CommandRegistry } from '../commands.js';
import { icon, type IconName } from '../icons.js';
import { attachMenuButton, type MenuEntry } from '../menu.js';
import { esc } from './html.js';

export type SelectionKind = 'node' | 'link' | 'anchor' | 'zone' | 'nodes';

const KIND_ICONS: Readonly<Record<SelectionKind, IconName>> = {
  node: 'node',
  link: 'tool-link',
  anchor: 'anchor',
  zone: 'zone',
  nodes: 'nodes',
};

export interface SelectionHeader {
  kind: SelectionKind;
  /** What is selected, in a word ("Node", "Link", "Selection (2 nodes)"). */
  kindLabel: string;
  /** The element's label, or its id. */
  title: string;
  /** The element's id, when the title is its label. */
  id?: string;
  /** The type picker's markup (a `<select id="i-type">`), if it has one;
   * it is drawn under the title, after the kind. */
  typeSelect?: string;
  /** Whether the lock toggle is shown, and whether it is on. */
  locked?: boolean;
}

/** The commands of the "more" menu, in its order; null is a separator. */
export const MORE_COMMANDS: readonly (CommandId | null)[] = [
  'edit.copyFormat',
  'edit.pasteFormat',
  null,
  'arrange.bringToFront',
  'arrange.bringForward',
  'arrange.sendBackward',
  'arrange.sendToBack',
  null,
  'edit.duplicate',
  'edit.delete',
];

export function selectionHeaderHtml(
  h: SelectionHeader,
  commands: CommandRegistry<CommandId>,
): string {
  const lock =
    h.locked === undefined
      ? ''
      : `<button type="button" class="icon-btn" data-head="lock" aria-pressed="${h.locked}" ` +
        `aria-label="Lock" title="${esc(commands.titleWithShortcut('edit.toggleLock', h.locked ? 'Unlock' : 'Lock'))}">` +
        `${icon(h.locked ? 'lock' : 'unlock')}</button>`;
  // The type picker sits under the title; without one, the id does.
  const showId = h.id && h.id !== h.title;
  const sub =
    h.typeSelect ??
    (showId
      ? `<span class="insp-id data" title="Id">${esc(h.id!)}</span>`
      : '');
  const tip = showId ? `${h.title} (${h.id})` : h.title;
  return (
    `<div class="insp-head" data-kind="${h.kind}">` +
    `<span class="insp-glyph">${icon(KIND_ICONS[h.kind], { size: 20 })}</span>` +
    `<span class="insp-name">` +
    `<span class="insp-title" title="${esc(tip)}">${esc(h.title)}</span>` +
    `<span class="insp-sub"><span class="insp-h insp-kind">${esc(h.kindLabel)}</span>${sub}</span>` +
    `</span>` +
    `<span class="insp-actions">${lock}` +
    `<button type="button" class="icon-btn" data-head="more" aria-label="More actions" title="More actions">${icon('more')}</button>` +
    `</span></div>`
  );
}

/** The "more" menu's button of the last header drawn, to let go of on redraw. */
let moreMenu: { destroy(): void } | null = null;

/**
 * Wire the header's actions. `after` runs once a command has run, to draw
 * the panel again.
 */
export function wireSelectionHeader(
  root: ParentNode,
  commands: CommandRegistry<CommandId>,
  after: () => void,
): void {
  moreMenu?.destroy();
  moreMenu = null;
  root
    .querySelector<HTMLButtonElement>('[data-head="lock"]')
    ?.addEventListener('click', () => {
      commands.run('edit.toggleLock');
      after();
    });
  const more = root.querySelector<HTMLButtonElement>('[data-head="more"]');
  if (!more) return;
  moreMenu = attachMenuButton(more, () => moreEntries(commands, after), {
    placement: 'below-end',
    label: 'More actions',
  });
}

function moreEntries(
  commands: CommandRegistry<CommandId>,
  after: () => void,
): MenuEntry[] {
  return MORE_COMMANDS.map((id): MenuEntry => {
    if (id === null) return { kind: 'separator' };
    const spec = commands.get(id)!;
    return {
      id,
      label: spec.title,
      hint: commands.shortcutLabel(id),
      iconHtml: spec.icon ? icon(spec.icon) : undefined,
      disabled: !commands.isEnabled(id),
      danger: id === 'edit.delete',
      run: () => {
        commands.run(id);
        after();
      },
    };
  });
}
