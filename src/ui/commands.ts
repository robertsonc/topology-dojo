/**
 * The editor's commands: what each one is called, which keys run it, and the
 * registry the shell binds them to.
 *
 * Until this module every command was wired by hand on each surface that
 * offers it: a toolbar listener, a branch of the window's key handler, a
 * closure in the context menu, a row of the shortcut sheet and the
 * "(Ctrl/Cmd+Z)" at the end of a tooltip. Here each command is written down
 * once, as data (`COMMAND_SPECS`), and those surfaces read it:
 *
 * - `matchKey` is the one place that decides which command a key press
 *   means;
 * - `createCommandRegistry` gives the shell `run`, `isEnabled`, `isChecked`
 *   and the shortcut text of a command, once the shell has bound the command
 *   to the function that does the work;
 * - the shortcut sheet is `helpSections()` plus `HELP_GESTURES`.
 *
 * This module is pure: no DOM, nothing of the editor. It runs under node.
 *
 * ## Reading the key table
 *
 * "What does key X do": search this file for `key: 'x'` (letters are written
 * lower-case; a named key as the browser names it, e.g. `'ArrowLeft'`) or
 * `code: 'KeyX'`. "What is the shortcut of command Y": the `bindings` of its
 * spec; the first one is the one tooltips show.
 *
 * A binding states every modifier. Left out, a modifier must NOT be held;
 * `'any'` means it is not read at all. Most bindings are older than this
 * table and were written against a handler that read Shift and Alt for a
 * handful of keys only, so most of them say `LENIENT` (Shift and Alt not
 * read): Ctrl+Shift+A still selects all, Shift+G and Alt+G still toggle
 * snap, Shift+Delete still deletes. A new binding should leave `LENIENT` out.
 *
 * Ctrl and Cmd are one modifier (`mod`) on every platform, and a press with
 * Ctrl/Cmd held never runs a binding without `mod`: Ctrl+A selects all and
 * does not also pick the anchor tool, and a Ctrl/Cmd combination that is not
 * bound here is left to the browser, untouched.
 *
 * Zoom uses plain keys (+ and -) and Shift + a digit, not Ctrl/Cmd + plus,
 * minus and zero: those belong to the browser's own page zoom, which people
 * who need larger text rely on, and a canvas shortcut that reaches the canvas
 * from every control would take it away from them. The Shift + digit
 * shortcuts name the physical key (`code`), because the character a shifted
 * digit types depends on the keyboard layout: Shift+0 is ")" on a US
 * keyboard and "=" on a German one.
 *
 * ## Which binding wins
 *
 * Two bindings can both fit one press only when one of them names a physical
 * key: what that key types depends on the layout, so it can be the character
 * of another binding (Shift+0 types "=", the zoom-in key, on a German
 * keyboard; the physical C key types "x" on a Bépo one). `matchKey` tries
 * the bindings in this order, which is the order of the handler it replaced:
 *
 * 1. the one binding that is read whatever else is held (`mod: 'any'`): `?`;
 * 2. the bindings that name a physical key (`code`), in the order
 *    `COMMAND_SPECS` lists them;
 * 3. all the others. No two of these fit the same press, so their order
 *    does not matter (commands.test.ts proves it, and proves the whole table
 *    against a transcription of the old handler).
 *
 * ## What is not here
 *
 * Gestures (hold Space to pan, the wheel, Shift+click, a double-click) are
 * not commands; the sheet lists them from `HELP_GESTURES`. Keys that belong
 * to one surface while it is open (the presentation, the Find box, a context
 * menu, a text field) are handled by that surface and listed there too.
 * Actions that need a row or a value to act on (delete THIS annotation, set
 * the link type to X, go to page N, pick a brand colour) stay with the
 * control that has the row or the value.
 */
import type { IconName } from './icons.js';

/** The menu a command belongs to. */
export type CommandGroup =
  | 'file'
  | 'edit'
  | 'selection'
  | 'arrange'
  | 'tools'
  | 'view'
  | 'pages'
  | 'help';

/** The groups in menu order, with the name each is shown under. */
export const COMMAND_GROUPS: readonly { id: CommandGroup; title: string }[] = [
  { id: 'file', title: 'File' },
  { id: 'edit', title: 'Edit' },
  { id: 'selection', title: 'Selection' },
  { id: 'arrange', title: 'Arrange' },
  { id: 'tools', title: 'Tools' },
  { id: 'view', title: 'View' },
  { id: 'pages', title: 'Pages' },
  { id: 'help', title: 'Help' },
];

/** How a binding reads one modifier: held, not held, or not looked at. */
export type ModifierRule = boolean | 'any';

/** One shortcut of a command. */
export interface KeyBinding {
  /**
   * The character or key name, as `KeyboardEvent.key` reports it. A
   * one-character key is matched in either case (write it lower-case) unless
   * `caseSensitive`.
   */
  key?: string;
  /**
   * The physical key, as `KeyboardEvent.code` reports it: for a shortcut
   * that must not depend on what the key types. With `key` as well, the
   * press fits when either does.
   */
  code?: string;
  /** Ctrl or Cmd. Default: not held. */
  mod?: ModifierRule;
  /** Default: not held. */
  shift?: ModifierRule;
  /** Default: not held. */
  alt?: ModifierRule;
  /** Match `key` exactly: "t" and "T" are different commands. */
  caseSensitive?: boolean;
  /**
   * When the binding applies. `canvasFocus`: nothing interactive has focus
   * (Enter on a focused button presses the button). `hasSelection` /
   * `noSelection`: something, or nothing, is selected on the canvas.
   */
  when?: 'always' | 'canvasFocus' | 'hasSelection' | 'noSelection';
  /**
   * Whether the press is taken from the browser. It is taken whether or not
   * the command can do anything right now.
   */
  preventDefault: boolean;
  /** How the shortcut sheet and tooltips print it, e.g. "Ctrl/Cmd+Z". */
  display: string;
  /** What the command is run with from this binding, instead of its own
   * `args` (Shift+arrow nudges by 10). */
  args?: unknown;
}

/** One command, as data. */
export interface CommandSpec<Id extends string = string> {
  /** Dotted and stable, e.g. `edit.undo`. */
  id: Id;
  /** What a menu or the command palette calls it. */
  title: string;
  group: CommandGroup;
  /** Its shortcuts. The first is the one a tooltip shows. */
  bindings?: readonly KeyBinding[];
  icon?: IconName;
  /** Other words that should find it in a search. */
  keywords?: readonly string[];
  /** What a parameterised variant is run with (`arrange.layout.grid` is the
   * layout command with `'grid'`). */
  args?: unknown;
  /** What the shortcut sheet says, where the title alone is too short. */
  help?: string;
}

/** Shift and Alt are not read (see "Reading the key table"). */
const LENIENT = { shift: 'any', alt: 'any' } as const;

// The arrow keys as the sheet prints them.
const LEFT = '←';
const RIGHT = '→';
const UP = '↑';
const DOWN = '↓';

/**
 * The presentation's keys as its bar's tooltips print them ("Previous frame
 * (←)"); the sheet's Presentation rows start with the same text. The keys
 * themselves are the presentation's own handler's (src/main.ts).
 */
export const PRESENT_KEYS = {
  prev: LEFT,
  next: RIGHT,
  playPause: 'Space',
  exit: 'Esc',
} as const;

/** The two bindings of a nudge: one unit, and ten with Shift. */
function nudgeKeys<K extends string, D extends string>(key: K, display: D) {
  return [
    {
      key,
      alt: 'any',
      when: 'hasSelection',
      preventDefault: true,
      display,
    },
    {
      key,
      shift: true,
      alt: 'any',
      when: 'hasSelection',
      preventDefault: true,
      display: `Shift+${display}`,
      args: 10,
    },
  ] as const;
}

const FILE = [
  {
    id: 'file.new',
    title: 'New document',
    group: 'file',
    keywords: ['blank', 'clear', 'start over'],
  },
  {
    id: 'file.open',
    title: 'Open a file',
    group: 'file',
    keywords: ['import', 'load', 'json', 'draw.io', 'mermaid', 'csv'],
    bindings: [
      { key: 'o', mod: true, preventDefault: true, display: 'Ctrl/Cmd+O' },
    ],
  },
  {
    id: 'file.download',
    title: 'Download as JSON',
    group: 'file',
    keywords: ['save', 'export'],
    bindings: [
      { key: 's', mod: true, preventDefault: true, display: 'Ctrl/Cmd+S' },
    ],
  },
  {
    id: 'file.loadOtherTab',
    title: 'Load the version saved in another tab',
    group: 'file',
  },
  {
    id: 'file.share',
    title: 'Share',
    group: 'file',
    keywords: ['publish', 'public link'],
  },
  { id: 'file.export.svg', title: 'Export page as SVG', group: 'file' },
  { id: 'file.export.png', title: 'Export page as PNG', group: 'file' },
  // The export menu's formats: each is the menu's export run with `args`.
  {
    id: 'file.export.pdfPage',
    title: 'Export page as PDF',
    group: 'file',
    args: 'pdf-page',
  },
  {
    id: 'file.export.pdfAll',
    title: 'Export all pages as PDF',
    group: 'file',
    args: 'pdf-all',
  },
  {
    id: 'file.export.flipbook',
    title: 'Export all pages as a flipbook (HTML)',
    group: 'file',
    args: 'flipbook',
  },
  {
    id: 'file.export.drawio',
    title: 'Export all pages as draw.io',
    group: 'file',
    keywords: ['diagrams.net'],
    args: 'drawio',
  },
  {
    id: 'file.export.vsdx',
    title: 'Export all pages as Visio (.vsdx)',
    group: 'file',
    args: 'vsdx',
  },
  {
    id: 'file.export.pptx',
    title: 'Export as PowerPoint, a slide per page',
    group: 'file',
    args: 'pptx',
  },
  {
    id: 'file.export.pptxLayers',
    title: 'Export as PowerPoint, a slide per layer',
    group: 'file',
    args: 'pptx-layers',
  },
  {
    id: 'file.export.mermaid',
    title: 'Export page as Mermaid',
    group: 'file',
    args: 'mermaid',
  },
  {
    id: 'file.export.copyPng',
    title: 'Copy page PNG to the clipboard',
    group: 'file',
    args: 'copy-png',
  },
  {
    id: 'file.export.svgSelection',
    title: 'Export selection as SVG',
    group: 'file',
    args: 'svg-selection',
  },
  {
    id: 'file.export.pngSelection',
    title: 'Export selection as PNG',
    group: 'file',
    args: 'png-selection',
  },
  {
    id: 'file.generateSdwan',
    title: 'Generate an SD-WAN fabric',
    group: 'file',
    keywords: ['template', 'wizard'],
  },
  // The account menu's, once the hosted Worker reports a signed-in user.
  {
    id: 'account.preferences',
    title: 'Authoring preferences',
    group: 'file',
    keywords: ['learned patterns', 'profile'],
  },
  {
    id: 'account.admin',
    title: 'Admin dashboard',
    group: 'file',
    keywords: ['owner', 'usage'],
  },
  { id: 'account.apiKeys', title: 'API keys', group: 'file' },
  {
    id: 'account.signOut',
    title: 'Sign out',
    group: 'file',
    keywords: ['log out'],
  },
  // While a shared copy is on the canvas (the banner's three buttons).
  { id: 'shared.keepCopy', title: 'Keep this shared copy', group: 'file' },
  { id: 'shared.backToMine', title: 'Back to my document', group: 'file' },
  {
    id: 'shared.unpublish',
    title: 'Unpublish this shared link',
    group: 'file',
  },
] as const satisfies readonly CommandSpec[];

/** A starter template's command: the template picker's entry for it. */
export type TemplateCommandId = `file.template.${string}`;

/** A starter template as the template picker lists it. */
export interface TemplateEntry {
  readonly id: string;
  readonly name: string;
  /** What the template holds: the menu item's tooltip. */
  readonly description?: string;
}

/**
 * The commands of the starter templates: one per template, run with its id.
 * The shell passes the list (`listTemplates()` of src/api/templates.ts), so
 * that this module stays data and does not load the template builder.
 */
export function templateCommandSpecs(
  templates: readonly TemplateEntry[],
): CommandSpec<TemplateCommandId>[] {
  return templates.map((t) => ({
    id: `file.template.${t.id}`,
    title: `New from template: ${t.name}`,
    group: 'file',
    args: t.id,
  }));
}

const EDIT = [
  {
    id: 'edit.undo',
    title: 'Undo',
    group: 'edit',
    icon: 'undo',
    bindings: [
      {
        key: 'z',
        mod: true,
        alt: 'any',
        preventDefault: true,
        display: 'Ctrl/Cmd+Z',
      },
    ],
  },
  {
    id: 'edit.redo',
    title: 'Redo',
    group: 'edit',
    icon: 'redo',
    bindings: [
      {
        key: 'z',
        mod: true,
        shift: true,
        alt: 'any',
        preventDefault: true,
        display: 'Ctrl/Cmd+Shift+Z',
      },
      {
        key: 'y',
        mod: true,
        ...LENIENT,
        preventDefault: true,
        display: 'Ctrl/Cmd+Y',
      },
    ],
  },
  {
    id: 'edit.cut',
    title: 'Cut',
    group: 'edit',
    bindings: [
      {
        key: 'x',
        mod: true,
        ...LENIENT,
        preventDefault: true,
        display: 'Ctrl/Cmd+X',
      },
    ],
  },
  {
    id: 'edit.copy',
    title: 'Copy',
    group: 'edit',
    // With Alt it is the format painter's key.
    bindings: [
      {
        key: 'c',
        mod: true,
        shift: 'any',
        preventDefault: true,
        display: 'Ctrl/Cmd+C',
      },
    ],
  },
  {
    id: 'edit.paste',
    title: 'Paste',
    group: 'edit',
    // With Shift it pastes in place; with Alt it pastes the format.
    bindings: [
      { key: 'v', mod: true, preventDefault: true, display: 'Ctrl/Cmd+V' },
    ],
  },
  // The context menu's: at the point that was right-clicked.
  { id: 'edit.pasteHere', title: 'Paste here', group: 'edit' },
  {
    id: 'edit.pasteInPlace',
    title: 'Paste in place',
    group: 'edit',
    help: 'Paste in place (same position, any page)',
    bindings: [
      {
        key: 'v',
        mod: true,
        shift: true,
        preventDefault: true,
        display: 'Ctrl/Cmd+Shift+V',
      },
    ],
  },
  {
    id: 'edit.duplicate',
    title: 'Duplicate',
    group: 'edit',
    icon: 'duplicate',
    bindings: [
      {
        key: 'd',
        mod: true,
        ...LENIENT,
        preventDefault: true,
        display: 'Ctrl/Cmd+D',
      },
    ],
  },
  {
    id: 'edit.delete',
    title: 'Delete',
    group: 'edit',
    icon: 'delete',
    help: 'Delete the selection',
    bindings: [
      { key: 'Delete', ...LENIENT, preventDefault: true, display: 'Del' },
      {
        key: 'Backspace',
        ...LENIENT,
        preventDefault: true,
        display: 'Backspace',
      },
    ],
  },
  {
    id: 'edit.rename',
    title: 'Rename',
    group: 'edit',
    icon: 'pencil',
    help: 'Rename the selected node, link or zone',
    bindings: [
      // F2 presses nothing, so it renames from a focused button too.
      { key: 'F2', preventDefault: true, display: 'F2' },
      {
        key: 'Enter',
        when: 'canvasFocus',
        preventDefault: true,
        display: 'Enter',
      },
    ],
  },
  // The format painter. Matched on the physical key as well: Alt + a letter
  // types a composed character on some layouts.
  {
    id: 'edit.copyFormat',
    title: 'Copy format',
    group: 'edit',
    icon: 'copy-format',
    help: 'Copy format (format painter)',
    bindings: [
      {
        key: 'c',
        code: 'KeyC',
        mod: true,
        alt: true,
        shift: 'any',
        preventDefault: true,
        display: 'Ctrl/Cmd+Alt+C',
      },
    ],
  },
  {
    id: 'edit.pasteFormat',
    title: 'Paste format',
    group: 'edit',
    icon: 'paste-format',
    help: 'Paste format onto the selection',
    bindings: [
      {
        key: 'v',
        code: 'KeyV',
        mod: true,
        alt: true,
        shift: 'any',
        preventDefault: true,
        display: 'Ctrl/Cmd+Alt+V',
      },
    ],
  },
  {
    id: 'edit.toggleLock',
    title: 'Lock / unlock',
    group: 'edit',
    icon: 'lock',
    bindings: [
      {
        key: 'l',
        mod: true,
        ...LENIENT,
        preventDefault: true,
        display: 'Ctrl/Cmd+L',
      },
    ],
  },
  {
    id: 'edit.find',
    title: 'Find',
    group: 'edit',
    keywords: ['search', 'jump to'],
    help: 'Find a node, link or zone on any page',
    bindings: [
      {
        key: 'f',
        mod: true,
        ...LENIENT,
        preventDefault: true,
        display: 'Ctrl/Cmd+F',
      },
    ],
  },
  {
    id: 'edit.copyAsImage',
    title: 'Copy as image',
    group: 'edit',
    keywords: ['png', 'clipboard', 'selection'],
  },
  {
    id: 'edit.copyFrameAsImage',
    title: 'Copy page as image',
    group: 'edit',
    keywords: ['png', 'clipboard'],
  },
] as const satisfies readonly CommandSpec[];

const SELECTION = [
  {
    id: 'selection.all',
    title: 'Select all',
    group: 'selection',
    bindings: [
      {
        key: 'a',
        mod: true,
        ...LENIENT,
        preventDefault: true,
        display: 'Ctrl/Cmd+A',
      },
    ],
  },
  { id: 'selection.sameType', title: 'Select same type', group: 'selection' },
  {
    id: 'selection.sameColor',
    title: 'Select same color',
    group: 'selection',
  },
  {
    id: 'selection.growConnected',
    title: 'Grow selection to connected nodes',
    group: 'selection',
  },
  { id: 'selection.invert', title: 'Invert selection', group: 'selection' },
  {
    // What Escape does on the canvas: more than its name.
    id: 'selection.clear',
    title: 'Clear selection',
    group: 'selection',
    help: 'Clear the selection, stop playback, close path analysis, back to the Select tool',
    bindings: [
      { key: 'Escape', ...LENIENT, preventDefault: false, display: 'Esc' },
    ],
  },
  // The arrows nudge while something is selected (a selected link counts,
  // though it has nothing to move); with nothing selected they flip pages.
  {
    id: 'selection.nudgeLeft',
    title: 'Nudge left',
    group: 'selection',
    help: 'Nudge left (Shift = ×10)',
    bindings: nudgeKeys('ArrowLeft', LEFT),
  },
  {
    id: 'selection.nudgeRight',
    title: 'Nudge right',
    group: 'selection',
    help: 'Nudge right (Shift = ×10)',
    bindings: nudgeKeys('ArrowRight', RIGHT),
  },
  {
    id: 'selection.nudgeUp',
    title: 'Nudge up',
    group: 'selection',
    help: 'Nudge up (Shift = ×10)',
    bindings: nudgeKeys('ArrowUp', UP),
  },
  {
    id: 'selection.nudgeDown',
    title: 'Nudge down',
    group: 'selection',
    help: 'Nudge down (Shift = ×10)',
    bindings: nudgeKeys('ArrowDown', DOWN),
  },
  {
    id: 'selection.emphasize',
    title: 'Emphasize on this page',
    group: 'selection',
    icon: 'star',
    keywords: ['spotlight', 'highlight'],
  },
  {
    id: 'selection.analyzePath',
    title: 'Analyze path',
    group: 'selection',
    icon: 'route',
    keywords: ['traceroute', 'route between two nodes'],
  },
  {
    id: 'selection.groupIntoZone',
    title: 'Group into zone',
    group: 'selection',
  },
  {
    id: 'selection.addFlow',
    title: 'Add flow path',
    group: 'selection',
    icon: 'flow',
  },
  {
    id: 'selection.addPolicyMarker',
    title: 'Add policy marker',
    group: 'selection',
    keywords: ['badge'],
  },
  {
    id: 'selection.saveAsStencil',
    title: 'Save as stencil…',
    group: 'selection',
    keywords: ['reusable group'],
  },
  {
    id: 'link.swapEndpoints',
    title: 'Swap endpoints',
    group: 'selection',
    icon: 'reverse',
  },
  {
    id: 'link.straighten',
    title: 'Straighten (clear bends)',
    group: 'selection',
    icon: 'slash',
  },
  // The path analysis bar's actions, while a path is on show.
  { id: 'path.prev', title: 'Previous route', group: 'selection' },
  { id: 'path.next', title: 'Next route', group: 'selection' },
  {
    id: 'path.swap',
    title: 'Trace the path the other way',
    group: 'selection',
  },
  {
    id: 'path.keepEmphasis',
    title: 'Keep the path spotlit on the page',
    group: 'selection',
  },
  {
    id: 'path.addFlow',
    title: 'Add a flow along the path',
    group: 'selection',
  },
  {
    id: 'path.newFrame',
    title: 'Copy the page with the path spotlit',
    group: 'selection',
  },
  { id: 'path.close', title: 'Close path analysis', group: 'selection' },
] as const satisfies readonly CommandSpec[];

const ARRANGE = [
  {
    id: 'arrange.bringToFront',
    title: 'Bring to front',
    group: 'arrange',
    icon: 'bring-to-front',
    bindings: [
      {
        key: ']',
        mod: true,
        ...LENIENT,
        preventDefault: true,
        display: 'Ctrl/Cmd+]',
      },
    ],
  },
  {
    id: 'arrange.bringForward',
    title: 'Bring forward',
    group: 'arrange',
    icon: 'arrow-up',
    bindings: [{ key: ']', ...LENIENT, preventDefault: false, display: ']' }],
  },
  {
    id: 'arrange.sendBackward',
    title: 'Send backward',
    group: 'arrange',
    icon: 'arrow-down',
    bindings: [{ key: '[', ...LENIENT, preventDefault: false, display: '[' }],
  },
  {
    id: 'arrange.sendToBack',
    title: 'Send to back',
    group: 'arrange',
    icon: 'send-to-back',
    bindings: [
      {
        key: '[',
        mod: true,
        ...LENIENT,
        preventDefault: true,
        display: 'Ctrl/Cmd+[',
      },
    ],
  },
  {
    id: 'arrange.alignLeft',
    title: 'Align left',
    group: 'arrange',
    icon: 'align-left',
    args: 'left',
  },
  {
    id: 'arrange.alignCenterH',
    title: 'Align horizontal centers',
    group: 'arrange',
    icon: 'align-center',
    args: 'centerH',
  },
  {
    id: 'arrange.alignRight',
    title: 'Align right',
    group: 'arrange',
    icon: 'align-right',
    args: 'right',
  },
  {
    id: 'arrange.alignTop',
    title: 'Align top',
    group: 'arrange',
    icon: 'align-top',
    args: 'top',
  },
  {
    id: 'arrange.alignMiddleV',
    title: 'Align vertical middles',
    group: 'arrange',
    icon: 'align-middle',
    args: 'middleV',
  },
  {
    id: 'arrange.alignBottom',
    title: 'Align bottom',
    group: 'arrange',
    icon: 'align-bottom',
    args: 'bottom',
  },
  {
    id: 'arrange.distributeH',
    title: 'Distribute horizontally',
    group: 'arrange',
    icon: 'distribute-h',
    args: 'h',
  },
  {
    id: 'arrange.distributeV',
    title: 'Distribute vertically',
    group: 'arrange',
    icon: 'distribute-v',
    args: 'v',
  },
  // "t" and "T" are told apart by the character alone, as they always were:
  // with Caps Lock on, the unshifted key balances.
  {
    id: 'arrange.tidy',
    title: 'Tidy layout',
    group: 'arrange',
    icon: 'tidy',
    keywords: ['grid-snap', 'de-overlap'],
    bindings: [
      {
        key: 't',
        caseSensitive: true,
        ...LENIENT,
        preventDefault: false,
        display: 'T',
      },
    ],
  },
  {
    id: 'arrange.balance',
    title: 'Balance layout',
    group: 'arrange',
    icon: 'balance',
    keywords: ['align rows and columns', 'centre'],
    bindings: [
      {
        key: 'T',
        caseSensitive: true,
        ...LENIENT,
        preventDefault: false,
        display: 'Shift+T',
      },
    ],
  },
  {
    id: 'arrange.layout.hierarchical',
    title: 'Auto-arrange: hierarchical',
    group: 'arrange',
    args: 'hierarchical',
  },
  {
    id: 'arrange.layout.grid',
    title: 'Auto-arrange: grid',
    group: 'arrange',
    args: 'grid',
  },
  {
    id: 'arrange.layout.circular',
    title: 'Auto-arrange: circular',
    group: 'arrange',
    args: 'circular',
  },
  {
    id: 'arrange.layout.force',
    title: 'Auto-arrange: force-directed',
    group: 'arrange',
    args: 'force',
  },
  {
    id: 'arrange.autoPlaceLabels',
    title: 'Auto-place labels',
    group: 'arrange',
  },
  {
    id: 'page.fitToContent',
    title: 'Fit page to content',
    group: 'arrange',
    icon: 'fit-page',
    keywords: ['resize the page'],
  },
] as const satisfies readonly CommandSpec[];

const TOOLS = [
  {
    id: 'tool.select',
    title: 'Select/move tool',
    group: 'tools',
    icon: 'tool-select',
    bindings: [{ key: 'v', ...LENIENT, preventDefault: false, display: 'V' }],
  },
  {
    id: 'tool.link',
    title: 'Draw link tool',
    group: 'tools',
    icon: 'tool-link',
    bindings: [{ key: 'l', ...LENIENT, preventDefault: false, display: 'L' }],
  },
  {
    id: 'tool.anchor',
    title: 'Drop anchor tool',
    group: 'tools',
    icon: 'anchor',
    bindings: [{ key: 'a', ...LENIENT, preventDefault: false, display: 'A' }],
  },
  {
    id: 'tool.hand',
    title: 'Hand / pan tool',
    group: 'tools',
    icon: 'hand',
    help: 'Hand: drag to pan',
    bindings: [{ key: 'h', ...LENIENT, preventDefault: false, display: 'H' }],
  },
] as const satisfies readonly CommandSpec[];

const VIEW = [
  {
    id: 'view.zoomIn',
    title: 'Zoom in',
    group: 'view',
    icon: 'zoom-in',
    // "+" is Shift+"=" on a US keyboard and its own key on many others; the
    // numpad's keys report the same characters.
    bindings: [
      { key: '+', shift: 'any', preventDefault: true, display: '+' },
      { key: '=', shift: 'any', preventDefault: true, display: '=' },
    ],
  },
  {
    id: 'view.zoomOut',
    title: 'Zoom out',
    group: 'view',
    icon: 'zoom-out',
    bindings: [
      { key: '-', shift: 'any', preventDefault: true, display: '-' },
      { key: '_', shift: 'any', preventDefault: true, display: '_' },
    ],
  },
  {
    id: 'view.zoom100',
    title: 'Zoom to 100%',
    group: 'view',
    bindings: [
      { code: 'Digit0', shift: true, preventDefault: true, display: 'Shift+0' },
    ],
  },
  {
    id: 'view.fit',
    title: 'Fit view',
    group: 'view',
    icon: 'fit-view',
    help: 'Fit to content',
    bindings: [
      { key: '0', ...LENIENT, preventDefault: false, display: '0' },
      { code: 'Digit1', shift: true, preventDefault: true, display: 'Shift+1' },
    ],
  },
  {
    id: 'view.zoomToSelection',
    title: 'Zoom to selection',
    group: 'view',
    bindings: [
      { code: 'Digit2', shift: true, preventDefault: true, display: 'Shift+2' },
    ],
  },
  {
    id: 'view.toggleGrid',
    title: 'Toggle grid',
    group: 'view',
    icon: 'grid',
    bindings: [{ key: 'r', ...LENIENT, preventDefault: false, display: 'R' }],
  },
  {
    id: 'view.toggleSnap',
    title: 'Toggle snap',
    group: 'view',
    icon: 'snap',
    bindings: [{ key: 'g', ...LENIENT, preventDefault: false, display: 'G' }],
  },
  {
    id: 'view.toggleCalm',
    title: 'Calm canvas',
    group: 'view',
    icon: 'calm',
    keywords: ['pause animations', 'reduced motion'],
    help: 'Calm canvas (pause animation)',
    bindings: [{ key: 'c', ...LENIENT, preventDefault: false, display: 'C' }],
  },
  {
    id: 'view.toggleBadges',
    title: 'Toggle on-canvas problem badges',
    group: 'view',
    icon: 'badges',
  },
  {
    id: 'view.displaySettings',
    title: 'Display settings',
    group: 'view',
    icon: 'settings',
    keywords: ['ambient', 'wheel', 'brand palette'],
  },
  {
    id: 'view.ambient.animated',
    title: 'Ambient backdrop: animated',
    group: 'view',
    args: 'animated',
  },
  {
    id: 'view.ambient.static',
    title: 'Ambient backdrop: static',
    group: 'view',
    args: 'static',
  },
  {
    id: 'view.ambient.off',
    title: 'Ambient backdrop: off',
    group: 'view',
    args: 'off',
  },
  {
    id: 'view.wheel.auto',
    title: 'Wheel: auto (a mouse zooms, a trackpad pans)',
    group: 'view',
    args: 'auto',
  },
  {
    id: 'view.wheel.zoom',
    title: 'Wheel: always zoom',
    group: 'view',
    args: 'zoom',
  },
  {
    id: 'view.wheel.pan',
    title: 'Wheel: always pan',
    group: 'view',
    args: 'pan',
  },
  {
    id: 'view.toggleTheme',
    title: 'Toggle light / dark theme',
    group: 'view',
    icon: 'sun',
  },
  // The theme as a choice of two, beside the toggle: a menu shows the one
  // that is on.
  {
    id: 'view.theme.dark',
    title: 'Dark theme',
    group: 'view',
    icon: 'moon',
    args: 'dark',
  },
  {
    id: 'view.theme.light',
    title: 'Light theme',
    group: 'view',
    icon: 'sun',
    args: 'light',
  },
  {
    id: 'view.present',
    title: 'Present',
    group: 'view',
    icon: 'present',
    keywords: ['full screen', 'slideshow', 'playback'],
  },
  {
    id: 'view.toggleLibrary',
    title: 'Toggle node library',
    group: 'view',
    bindings: [{ key: 'b', ...LENIENT, preventDefault: false, display: 'B' }],
  },
  {
    id: 'view.toggleMinimap',
    title: 'Toggle minimap',
    group: 'view',
    bindings: [{ key: 'm', ...LENIENT, preventDefault: false, display: 'M' }],
  },
  {
    id: 'view.toggleProperties',
    title: 'Toggle properties',
    group: 'view',
    bindings: [{ key: 'p', ...LENIENT, preventDefault: false, display: 'P' }],
  },
  {
    id: 'view.toggleFrames',
    title: 'Toggle pages',
    group: 'view',
    bindings: [{ key: 'f', ...LENIENT, preventDefault: false, display: 'F' }],
  },
  { id: 'view.toggleProblems', title: 'Toggle problems', group: 'view' },
  {
    id: 'view.showProblems',
    title: 'Show problems',
    group: 'view',
    keywords: ['validation', 'layout problems'],
  },
  // The footer of the problems panel, while any problem is hidden.
  {
    id: 'problems.showHidden',
    title: 'Show hidden problems',
    group: 'view',
  },
  {
    id: 'problems.restoreAll',
    title: 'Restore all hidden problems',
    group: 'view',
  },
] as const satisfies readonly CommandSpec[];

const PAGES = [
  { id: 'page.add', title: 'Add blank page', group: 'pages', icon: 'plus' },
  {
    id: 'page.duplicate',
    title: 'Duplicate current page',
    group: 'pages',
    icon: 'duplicate',
  },
  // Run with a page's index it deletes that page; without, the current one.
  { id: 'page.delete', title: 'Delete page', group: 'pages' },
  {
    id: 'page.undoDelete',
    title: 'Undo page delete',
    group: 'pages',
    icon: 'restore',
  },
  {
    id: 'page.next',
    title: 'Next page',
    group: 'pages',
    icon: 'frame-next',
    help: 'Next page (with nothing selected)',
    bindings: [
      {
        key: 'ArrowRight',
        ...LENIENT,
        when: 'noSelection',
        preventDefault: false,
        display: RIGHT,
      },
    ],
  },
  {
    id: 'page.prev',
    title: 'Previous page',
    group: 'pages',
    icon: 'frame-prev',
    help: 'Previous page (with nothing selected)',
    bindings: [
      {
        key: 'ArrowLeft',
        ...LENIENT,
        when: 'noSelection',
        preventDefault: false,
        display: LEFT,
      },
    ],
  },
  {
    id: 'page.playPause',
    title: 'Play / pause the flipbook',
    group: 'pages',
    icon: 'play',
  },
  { id: 'page.emphasis.clear', title: 'Clear emphasis', group: 'pages' },
] as const satisfies readonly CommandSpec[];

const HELP = [
  {
    id: 'help.shortcuts',
    title: 'Keyboard shortcuts',
    group: 'help',
    icon: 'shortcuts',
    help: 'This shortcut reference',
    // Read whatever else is held, and before every other binding.
    bindings: [
      {
        key: '?',
        mod: 'any',
        ...LENIENT,
        preventDefault: true,
        display: '?',
      },
    ],
  },
  {
    id: 'help.commandPalette',
    title: 'Command palette',
    group: 'help',
    icon: 'search',
    keywords: ['search', 'run a command', 'go to'],
    help: 'Search the commands, the node types, the elements and the pages',
    bindings: [
      {
        key: 'k',
        mod: true,
        shift: false,
        alt: false,
        preventDefault: true,
        display: 'Ctrl/Cmd+K',
      },
    ],
  },
] as const satisfies readonly CommandSpec[];

type IdOf<T extends readonly CommandSpec[]> = T[number]['id'];

/** The id of a command in `COMMAND_SPECS`. */
export type CommandId =
  | IdOf<typeof FILE>
  | TemplateCommandId
  | IdOf<typeof EDIT>
  | IdOf<typeof SELECTION>
  | IdOf<typeof ARRANGE>
  | IdOf<typeof TOOLS>
  | IdOf<typeof VIEW>
  | IdOf<typeof PAGES>
  | IdOf<typeof HELP>;

/**
 * Every command of the editor, group by group in menu order, but the starter
 * templates: those come from `templateCommandSpecs`, with the list the shell
 * passes. They have no keys.
 */
export const COMMAND_SPECS: readonly CommandSpec<CommandId>[] = [
  ...FILE,
  ...EDIT,
  ...SELECTION,
  ...ARRANGE,
  ...TOOLS,
  ...VIEW,
  ...PAGES,
  ...HELP,
];

/**
 * The variant of a parameterised command that `args` asks for: the spec
 * under `prefix` (`'file.export.'`, `'arrange.layout.'`…) whose `args` are
 * `args`. How a menu's option value finds its command.
 */
export function commandVariant(
  prefix: string,
  args: unknown,
  specs: readonly CommandSpec<CommandId>[] = COMMAND_SPECS,
): CommandSpec<CommandId> | undefined {
  return specs.find(
    (spec) =>
      spec.id.startsWith(prefix) &&
      spec.args !== undefined &&
      spec.args === args,
  );
}

/**
 * The arguments of the variants under `prefix`, in table order: the values a
 * menu of them offers (the export menu's options are the `file.export.`
 * variants that take one). Each is a string; anything else throws.
 */
export function variantArgs(
  prefix: string,
  specs: readonly CommandSpec<CommandId>[] = COMMAND_SPECS,
): string[] {
  return specs
    .filter((spec) => spec.id.startsWith(prefix) && spec.args !== undefined)
    .map((spec) => {
      if (typeof spec.args !== 'string')
        throw new Error(`${spec.id}: its argument is not a string`);
      return spec.args;
    });
}

/**
 * The argument a bound command was run with, checked: `ok` says what it
 * takes, and anything else (a wrong value, or none) is a mistake of the
 * caller and throws instead of running the command with it.
 */
export function commandArg<T>(
  id: string,
  args: unknown,
  ok: (value: unknown) => value is T,
): T {
  if (!ok(args))
    throw new Error(`${id}: unexpected argument ${describeArg(args)}`);
  return args;
}
const describeArg = (value: unknown): string => {
  if (value === undefined) return '(none)';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** A check for `commandArg`: one of `values`. */
export function oneOf<const T extends string>(
  values: readonly T[],
): (value: unknown) => value is T {
  return (value): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);
}

/** A check for `commandArg`: a page point (where "Paste here" pastes). */
export function isPoint(value: unknown): value is { x: number; y: number } {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return (
    typeof x === 'number' &&
    Number.isFinite(x) &&
    typeof y === 'number' &&
    Number.isFinite(y)
  );
}

/* ── Keys ──────────────────────────────────────────────────────────────── */

/** The part of a `KeyboardEvent` a binding reads. */
export interface KeyPress {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** What the shell knows that a key press does not say. */
export interface KeyContext {
  /** Nothing interactive has focus: the page body or the canvas. */
  focusOnCanvas: boolean;
  /** How many elements are selected on the canvas (nodes, anchors, links). */
  selectionCount: number;
}

/** The command a key press means. */
export interface KeyMatch {
  id: CommandId;
  /** Take the key from the browser, whether or not the command can run. */
  preventDefault: boolean;
  /** What to run the command with, when the binding or the spec says. */
  args?: unknown;
}

function modifierFits(rule: ModifierRule | undefined, held: boolean): boolean {
  return rule === 'any' || (rule ?? false) === held;
}

/** Whether one binding fits a key press in a context. */
export function bindingMatches(
  binding: KeyBinding,
  e: KeyPress,
  ctx: KeyContext,
): boolean {
  if (!modifierFits(binding.mod, !!(e.ctrlKey || e.metaKey))) return false;
  if (!modifierFits(binding.shift, !!e.shiftKey)) return false;
  if (!modifierFits(binding.alt, !!e.altKey)) return false;
  if (binding.when === 'canvasFocus' && !ctx.focusOnCanvas) return false;
  if (binding.when === 'hasSelection' && !(ctx.selectionCount > 0))
    return false;
  if (binding.when === 'noSelection' && ctx.selectionCount > 0) return false;
  if (binding.code !== undefined && e.code === binding.code) return true;
  if (binding.key === undefined) return false;
  const key =
    binding.caseSensitive || e.key.length !== 1 ? e.key : e.key.toLowerCase();
  return key === binding.key;
}

interface BoundKey {
  spec: CommandSpec<CommandId>;
  binding: KeyBinding;
}

/** Every binding, in the order `matchKey` tries them (see the module doc). */
const MATCH_ORDER: readonly BoundKey[] = (() => {
  const all: BoundKey[] = COMMAND_SPECS.flatMap((spec) =>
    (spec.bindings ?? []).map((binding) => ({ spec, binding })),
  );
  const tier = ({ binding }: BoundKey): number =>
    binding.mod === 'any' ? 0 : binding.code !== undefined ? 1 : 2;
  // A stable sort: within a tier, the order COMMAND_SPECS lists them.
  return all.sort((a, b) => tier(a) - tier(b));
})();

/**
 * The command a key press means, or null when it is not a shortcut (a
 * Ctrl/Cmd combination that is not bound is null too: it stays the
 * browser's). The single place that decides it.
 *
 * It does not ask whether the command can run: a bound key is consumed
 * (`preventDefault`) either way, and the command ignores a press it has
 * nothing to act on.
 */
export function matchKey(e: KeyPress, ctx: KeyContext): KeyMatch | null {
  for (const { spec, binding } of MATCH_ORDER) {
    if (!bindingMatches(binding, e, ctx)) continue;
    const args = binding.args ?? spec.args;
    return {
      id: spec.id,
      preventDefault: binding.preventDefault,
      ...(args === undefined ? {} : { args }),
    };
  }
  return null;
}

/* ── Registry ──────────────────────────────────────────────────────────── */

/** What the shell binds a command to. */
export interface CommandHandlers {
  /** Do it. `args` is what the caller passed, or else the spec's. */
  run(args?: unknown): void;
  /** Whether it can run now. Left out: always. */
  enabled?(): boolean;
  /** For a toggle or a choice: whether it is on now. */
  checked?(): boolean;
}

export interface RunOptions {
  /**
   * Run without asking `enabled` first. For key presses: the keyboard never
   * asked whether a command was available (the command ignores a press it
   * has nothing to act on), and a dispatcher that started asking would change
   * what a press does beside the command, such as redrawing the inspector.
   */
  ignoreEnabled?: boolean;
}

/** One group of the shortcut sheet. */
export interface HelpSection {
  title: string;
  rows: readonly (readonly [keys: string, description: string])[];
}

export interface CommandRegistry<Id extends string = string> {
  /**
   * Give a command its behaviour. Throws for an id that is not a command
   * and for a second binding of the same one: both are mistakes in the
   * shell, and a silent one would leave a control that does nothing.
   */
  bind(id: Id, handlers: CommandHandlers): void;
  /**
   * Run a command. False, with nothing run, when the id is not a command,
   * when nothing is bound to it yet or when it is not enabled.
   */
  run(id: Id, args?: unknown, options?: RunOptions): boolean;
  get(id: string): CommandSpec<Id> | undefined;
  /** Every command, or one group's, in the order they were given. */
  list(group?: CommandGroup): readonly CommandSpec<Id>[];
  /** Bound, and available now. */
  isEnabled(id: Id): boolean;
  /** Bound, and on now. */
  isChecked(id: Id): boolean;
  /** The first binding as text, e.g. "Ctrl/Cmd+Z". */
  shortcutLabel(id: Id): string | undefined;
  /**
   * A tooltip: the title, or `label` in its place, then the shortcut in
   * brackets when there is one — "Undo (Ctrl/Cmd+Z)". Throws for an id that
   * is not a command.
   */
  titleWithShortcut(id: Id, label?: string): string;
  /** The shortcut sheet: every command that has a binding, by group. */
  helpSections(): HelpSection[];
  /** The commands nothing is bound to yet. */
  unbound(): Id[];
}

/** The separator between two shortcuts of one command in a sheet row's keys:
 * the sheet splits on it to draw each shortcut as its own key cap. */
export const KEYS_SEPARATOR = ' · ';

export function createCommandRegistry<Id extends string>(
  specs: readonly CommandSpec<Id>[],
): CommandRegistry<Id> {
  const byId = new Map<string, CommandSpec<Id>>();
  for (const spec of specs) {
    if (byId.has(spec.id)) throw new Error(`duplicate command "${spec.id}"`);
    byId.set(spec.id, spec);
  }
  const bound = new Map<string, CommandHandlers>();

  const known = (id: string): CommandSpec<Id> => {
    const spec = byId.get(id);
    if (!spec) throw new Error(`unknown command "${id}"`);
    return spec;
  };
  const enabled = (id: string): boolean => {
    const handlers = bound.get(id);
    return !!handlers && (handlers.enabled?.() ?? true);
  };

  return {
    bind(id, handlers) {
      known(id);
      if (bound.has(id)) throw new Error(`command "${id}" is already bound`);
      bound.set(id, handlers);
    },
    run(id, args, options) {
      const spec = byId.get(id);
      const handlers = bound.get(id);
      if (!spec || !handlers) return false;
      if (!options?.ignoreEnabled && !enabled(id)) return false;
      handlers.run(args === undefined ? spec.args : args);
      return true;
    },
    get: (id) => byId.get(id),
    list: (group) =>
      group === undefined ? specs : specs.filter((s) => s.group === group),
    isEnabled: (id) => enabled(id),
    isChecked: (id) => bound.get(id)?.checked?.() ?? false,
    shortcutLabel: (id) => byId.get(id)?.bindings?.[0]?.display,
    titleWithShortcut(id, label) {
      const spec = known(id);
      const shortcut = spec.bindings?.[0]?.display;
      const title = label ?? spec.title;
      return shortcut === undefined ? title : `${title} (${shortcut})`;
    },
    helpSections() {
      const sections: HelpSection[] = [];
      for (const group of COMMAND_GROUPS) {
        const rows = specs
          .filter((s) => s.group === group.id && s.bindings?.length)
          .map((s) => {
            const keys = [...new Set(s.bindings!.map((b) => b.display))];
            return [keys.join(KEYS_SEPARATOR), s.help ?? s.title] as const;
          });
        if (rows.length) sections.push({ title: group.title, rows });
      }
      return sections;
    },
    unbound: () => specs.filter((s) => !bound.has(s.id)).map((s) => s.id),
  };
}

/* ── Gestures and surface keys ─────────────────────────────────────────── */

/**
 * What the shortcut sheet lists besides the commands: gestures (they are not
 * commands: nothing runs them but the pointer or a held key) and the keys of
 * surfaces that take the keyboard while they are open. Kept here so the
 * sheet has one source; the handlers are the editor's pointer code and each
 * surface's own key handler.
 */
export const HELP_GESTURES: readonly HelpSection[] = [
  {
    title: 'Mouse and touch',
    rows: [
      ['Wheel', 'Zoom to cursor (mouse) / pan (trackpad)'],
      ['Pinch · Ctrl/Cmd+wheel', 'Zoom to cursor'],
      ['Shift+wheel', 'Pan sideways'],
      ['Space / Middle-drag', 'Pan (hold Space and drag)'],
      ['Shift+click · Ctrl/Cmd+click', 'Add to or take from the selection'],
      ['Ctrl/Cmd+click', 'Follow the hyperlink of a node or link'],
      ['Double-click', 'Rename; on empty canvas, add a node'],
    ],
  },
  {
    title: 'Dialogs and menus',
    rows: [
      ['Esc', 'Close the open dialog / menu'],
      ['Tab / Shift+Tab', 'Cycle focus inside the dialog'],
      [`${UP}${DOWN} · Enter`, 'Navigate / run context-menu items'],
      ['Home / End', 'First / last context-menu item'],
      ['Enter / Space', 'Use the save chip when it offers a way out'],
    ],
  },
  {
    title: 'Presentation',
    rows: [
      [`${PRESENT_KEYS.prev} / PageUp`, 'Previous frame'],
      [`${PRESENT_KEYS.next} / PageDown`, 'Next frame'],
      [PRESENT_KEYS.playPause, 'Play / pause'],
      [PRESENT_KEYS.exit, 'Exit'],
    ],
  },
  {
    title: 'Find and the node library',
    rows: [
      [`${UP}${DOWN} · Enter`, 'In Find: choose a match and go to it'],
      ['Esc', 'Close Find; clear the library search; cancel a library drag'],
    ],
  },
];
