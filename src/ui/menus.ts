/**
 * The shell's menus, as data: what the menu bar (File, Edit, View, Arrange,
 * Help), the folded menu bar of a narrow window, the Export and Tidy buttons,
 * the account chip and the canvas's right-click menu each offer, in order.
 *
 * Each function returns the entries `openMenu` (./menu.ts) renders. An item
 * that runs a command is built from the registry: it carries the command's
 * id (rendered as `data-command`), its shortcut as the hint, its icon, and
 * whether it is enabled and checked at the moment the menu is built, and it
 * runs the command through `registry.run`. Nothing here does the work of a
 * command.
 *
 * Labels are the registry's titles, except where a menu words a command more
 * shortly than the palette or a tooltip does: a toggle under a check mark is
 * named for what it shows ("Grid", not "Toggle grid"), an item inside a
 * submenu leaves out what the submenu already says ("Auto-arrange ▸ Grid"),
 * and an item that opens a dialog ends in an ellipsis ("Open…"). Those
 * wordings are written out below, next to the item.
 *
 * Pure: no DOM and nothing of the editor; it runs under node. The parts that
 * change while the editor runs (the starter templates, whether sharing is
 * offered, who is signed in) come in a `MenuContext`.
 */
import type { CommandId, CommandRegistry, TemplateEntry } from './commands.js';
import type { IconName } from './icons.js';
import type { MenuEntry, MenuItem } from './menu.js';

/** What the menus need from the shell, read each time a menu is built. */
export interface MenuContext {
  /** The editor's command registry, with its commands bound. */
  readonly commands: Pick<
    CommandRegistry<CommandId>,
    'get' | 'run' | 'isEnabled' | 'isChecked' | 'shortcutLabel'
  >;
  /** The starter templates, in the order the template picker lists them. */
  readonly templates: readonly TemplateEntry[];
  /** The hosted Worker reported a session, so a document can be shared. */
  readonly shareAvailable: boolean;
  /** The signed-in user, or null for nobody (or no Worker). */
  readonly account: { readonly login: string; readonly admin: boolean } | null;
  /** The markup of an icon (src/ui/icons.ts `icon`). Left out: no icons. */
  readonly icon?: (name: IconName) => string;
}

/* ── Definitions ────────────────────────────────────────────────────── */

/** One entry of a menu before the registry fills it in. */
type Def =
  | {
      command: CommandId;
      /** The menu's own wording, when it is not the command's title. */
      label?: string;
      /** Show whether it is on: a check mark, or one of a set of choices. */
      check?: 'checkbox' | 'radio';
      /** A longer description, the item's tooltip. */
      title?: string;
      /** What the command is run with, for one that takes a caller's
       * argument (Paste here: the point that was right-clicked). */
      args?: unknown;
    }
  | { label: string; submenu: Def[] }
  | { separator: true }
  | { heading: string };

const SEP = { separator: true } as const;
const cmd = (
  command: CommandId,
  label?: string,
  check?: 'checkbox' | 'radio',
): Def => ({
  command,
  ...(label === undefined ? {} : { label }),
  ...(check === undefined ? {} : { check }),
});
const toggle = (command: CommandId, label: string): Def =>
  cmd(command, label, 'checkbox');
const submenu = (label: string, entries: Def[]): Def => ({
  label,
  submenu: entries,
});

/** The Generate SD-WAN wizard: the last entry of the old template picker,
 * with the tooltip it had there. */
const SDWAN: Def = {
  ...cmd('file.generateSdwan', 'Generate SD-WAN…'),
  title:
    'Generate an SD-WAN fabric: vendor, regions, hubs, branches, WAN transports, HA, LAN',
};

/** One item per template, each with the template's description as its
 * tooltip, as the old picker's options had. */
function templateDefs(ctx: MenuContext): Def[] {
  return [
    ...ctx.templates.map(
      (t): Def => ({
        ...cmd(`file.template.${t.id}` as CommandId, t.name),
        ...(t.description ? { title: t.description } : {}),
      }),
    ),
    SDWAN,
  ];
}

function exportDefs(): Def[] {
  return [
    { heading: 'Image' },
    cmd('file.export.svg', 'SVG'),
    cmd('file.export.png', 'PNG'),
    cmd('file.export.copyPng', 'Copy PNG to clipboard'),
    { heading: 'Document' },
    cmd('file.export.pdfPage', 'PDF (this page)'),
    cmd('file.export.pdfAll', 'PDF (all pages)'),
    cmd('file.export.pptx', 'PowerPoint (slide per page)'),
    cmd('file.export.pptxLayers', 'PowerPoint (slide per layer)'),
    cmd('file.export.flipbook', 'Flipbook HTML'),
    { heading: 'Editable, lossy' },
    cmd('file.export.drawio', 'draw.io'),
    cmd('file.export.vsdx', 'Visio .vsdx'),
    cmd('file.export.mermaid', 'Mermaid'),
    { heading: 'Selection only' },
    cmd('file.export.svgSelection', 'SVG'),
    cmd('file.export.pngSelection', 'PNG'),
  ];
}

const LAYOUTS: Def[] = [
  cmd('arrange.layout.hierarchical', 'Hierarchical'),
  cmd('arrange.layout.grid', 'Grid'),
  cmd('arrange.layout.circular', 'Circular'),
  cmd('arrange.layout.force', 'Force-directed'),
];

const THEMES: Def[] = [
  cmd('view.theme.dark', 'Dark', 'radio'),
  cmd('view.theme.light', 'Light', 'radio'),
];

function fileDefs(ctx: MenuContext): Def[] {
  return [
    cmd('file.new', 'New'),
    submenu('New from template', templateDefs(ctx)),
    cmd('file.open', 'Open…'),
    cmd('file.download', 'Download JSON'),
    SEP,
    submenu('Export', exportDefs()),
    ...(ctx.shareAvailable ? [cmd('file.share', 'Share…')] : []),
    SEP,
    cmd('view.present'),
  ];
}

function editDefs(): Def[] {
  return [
    cmd('edit.undo'),
    cmd('edit.redo'),
    SEP,
    cmd('edit.cut'),
    cmd('edit.copy'),
    cmd('edit.paste'),
    cmd('edit.pasteInPlace'),
    cmd('edit.duplicate'),
    cmd('edit.delete'),
    SEP,
    cmd('selection.all'),
    submenu('Select', [
      cmd('selection.sameType', 'Same type'),
      cmd('selection.sameColor', 'Same color'),
      cmd('selection.growConnected', 'Connected nodes'),
      cmd('selection.invert', 'Invert'),
    ]),
    SEP,
    cmd('edit.copyFormat'),
    cmd('edit.pasteFormat'),
    SEP,
    cmd('edit.rename'),
    // Worded for what it would do now, as the context menu words it.
    cmd('edit.toggleLock'),
    SEP,
    cmd('edit.find', 'Find…'),
    SEP,
    // The rail's tools, one of them current. Named for the tool, as the
    // rail's tooltips name it.
    submenu('Tools', [
      cmd('tool.select', 'Select', 'radio'),
      cmd('tool.hand', 'Hand', 'radio'),
      cmd('tool.link', 'Draw link', 'radio'),
      cmd('tool.anchor', 'Drop anchor', 'radio'),
    ]),
  ];
}

function viewDefs(): Def[] {
  return [
    toggle('view.toggleGrid', 'Grid'),
    toggle('view.toggleSnap', 'Snap'),
    toggle('view.toggleCalm', 'Calm canvas'),
    toggle('view.toggleBadges', 'Problem badges'),
    SEP,
    toggle('view.toggleLibrary', 'Node library'),
    toggle('view.toggleProperties', 'Properties'),
    toggle('view.toggleFrames', 'Pages'),
    toggle('view.toggleMinimap', 'Minimap'),
    SEP,
    cmd('view.zoomIn'),
    cmd('view.zoomOut'),
    cmd('view.zoom100'),
    cmd('view.fit', 'Fit to content'),
    cmd('view.zoomToSelection'),
    SEP,
    submenu('Theme', THEMES),
    cmd('view.displaySettings', 'Display…'),
  ];
}

function arrangeDefs(): Def[] {
  return [
    cmd('arrange.tidy', 'Tidy'),
    cmd('arrange.balance', 'Balance'),
    submenu('Auto-arrange', LAYOUTS),
    cmd('arrange.autoPlaceLabels'),
    SEP,
    submenu('Align', [
      cmd('arrange.alignLeft'),
      cmd('arrange.alignCenterH'),
      cmd('arrange.alignRight'),
      cmd('arrange.alignTop'),
      cmd('arrange.alignMiddleV'),
      cmd('arrange.alignBottom'),
    ]),
    submenu('Distribute', [
      cmd('arrange.distributeH'),
      cmd('arrange.distributeV'),
    ]),
    SEP,
    cmd('arrange.bringToFront'),
    cmd('arrange.bringForward'),
    cmd('arrange.sendBackward'),
    cmd('arrange.sendToBack'),
    SEP,
    cmd('selection.groupIntoZone'),
    cmd('page.fitToContent'),
  ];
}

function helpDefs(): Def[] {
  return [
    cmd('help.shortcuts'),
    cmd('help.commandPalette'),
    cmd('help.whatMoved'),
  ];
}

function tidyDefs(): Def[] {
  return [
    cmd('arrange.tidy', 'Tidy'),
    cmd('arrange.balance', 'Balance'),
    SEP,
    // Out of the Auto-arrange submenu, each says what it is.
    cmd('arrange.layout.hierarchical'),
    cmd('arrange.layout.grid'),
    cmd('arrange.layout.circular'),
    cmd('arrange.layout.force'),
    SEP,
    cmd('arrange.autoPlaceLabels'),
    cmd('page.fitToContent'),
  ];
}

function accountDefs(ctx: MenuContext): Def[] {
  const signedIn = ctx.account
    ? [
        { heading: `Signed in as ${ctx.account.login}` },
        cmd('account.apiKeys'),
        cmd('account.preferences'),
        ...(ctx.account.admin ? [cmd('account.admin', 'Admin')] : []),
        SEP,
      ]
    : [];
  return [
    ...signedIn,
    submenu('Theme', THEMES),
    ...(ctx.account ? [SEP, cmd('account.signOut')] : []),
  ];
}

/** What was right-clicked, as the context menu needs to know it. */
export interface ContextTarget {
  /** A node (or several), a link, or the empty canvas. */
  readonly kind: 'node' | 'link' | 'empty';
  /** The page point that was right-clicked: where Paste here pastes. */
  readonly at: { readonly x: number; readonly y: number };
  /** Exactly one node is selected: it has a label to rename. */
  readonly singleNode: boolean;
  /** Two nodes are selected: the routes between them can be traced. */
  readonly canAnalyzePath: boolean;
}

/* The context menu's items are worded as the registry titles them, not
 * shortened as the menu bar's are: it names what it acts on, out of any
 * menu that would say it. */
function contextDefs(target: ContextTarget): Def[] {
  if (target.kind === 'node')
    return [
      // Rename is for one node; a multi-selection has no single label.
      ...(target.singleNode ? [cmd('edit.rename')] : []),
      cmd('edit.duplicate'),
      cmd('edit.cut'),
      cmd('edit.copy'),
      cmd('edit.copyAsImage'),
      cmd('edit.copyFormat'),
      cmd('edit.pasteFormat'),
      SEP,
      cmd('selection.emphasize'),
      // Two nodes: the routes between them (the "visual traceroute").
      ...(target.canAnalyzePath ? [cmd('selection.analyzePath')] : []),
      cmd('selection.groupIntoZone'),
      cmd('selection.saveAsStencil'),
      cmd('selection.addPolicyMarker'),
      SEP,
      cmd('arrange.bringToFront'),
      cmd('arrange.sendToBack'),
      SEP,
      cmd('edit.toggleLock'),
      cmd('edit.delete'),
    ];
  if (target.kind === 'link')
    return [
      cmd('link.swapEndpoints'),
      cmd('link.straighten'),
      cmd('edit.copyFormat'),
      cmd('edit.pasteFormat'),
      cmd('selection.emphasize'),
      SEP,
      cmd('arrange.bringToFront'),
      cmd('arrange.sendToBack'),
      SEP,
      cmd('edit.toggleLock'),
      cmd('edit.delete'),
    ];
  return [
    // At the point that was right-clicked, as a block centred on it.
    { command: 'edit.pasteHere', args: { x: target.at.x, y: target.at.y } },
    // At the coordinates it was copied from: the same place on another page.
    cmd('edit.pasteInPlace'),
    cmd('selection.all'),
    cmd('edit.copyFrameAsImage'),
    SEP,
    cmd('arrange.tidy'),
    cmd('arrange.balance'),
    cmd('arrange.autoPlaceLabels'),
    cmd('page.fitToContent'),
  ];
}

/* ── From definitions to menu entries ───────────────────────────────── */

function commandItem(
  ctx: MenuContext,
  def: Extract<Def, { command: CommandId }>,
): MenuItem {
  const { commands } = ctx;
  const id = def.command;
  const spec = commands.get(id);
  if (!spec) throw new Error(`the menus name "${id}", which is not a command`);
  let label = def.label ?? spec.title;
  // Lock and unlock are one command; the item says which a press does.
  if (id === 'edit.toggleLock')
    label = commands.isChecked(id) ? 'Unlock' : 'Lock';
  const hint = commands.shortcutLabel(id);
  const { args } = def;
  const item: MenuItem = {
    id,
    label,
    run: () =>
      void (args === undefined ? commands.run(id) : commands.run(id, args)),
  };
  if (hint !== undefined) item.hint = hint;
  if (def.title) item.title = def.title;
  if (spec.icon !== undefined && ctx.icon) item.iconHtml = ctx.icon(spec.icon);
  if (def.check) item.checked = commands.isChecked(id);
  if (def.check === 'radio') item.radio = true;
  if (!commands.isEnabled(id)) item.disabled = true;
  return item;
}

function resolve(ctx: MenuContext, defs: readonly Def[]): MenuEntry[] {
  return defs.map((def): MenuEntry => {
    if ('separator' in def) return { kind: 'separator' };
    if ('heading' in def) return { kind: 'heading', label: def.heading };
    if ('submenu' in def)
      return { label: def.label, submenu: resolve(ctx, def.submenu) };
    return commandItem(ctx, def);
  });
}

/* ── The menus ──────────────────────────────────────────────────────── */

export const fileMenu = (ctx: MenuContext): MenuEntry[] =>
  resolve(ctx, fileDefs(ctx));
export const editMenu = (ctx: MenuContext): MenuEntry[] =>
  resolve(ctx, editDefs());
export const viewMenu = (ctx: MenuContext): MenuEntry[] =>
  resolve(ctx, viewDefs());
export const arrangeMenu = (ctx: MenuContext): MenuEntry[] =>
  resolve(ctx, arrangeDefs());
export const helpMenu = (ctx: MenuContext): MenuEntry[] =>
  resolve(ctx, helpDefs());
/** The Export button's menu (and File ▸ Export). */
export const exportMenu = (ctx: MenuContext): MenuEntry[] =>
  resolve(ctx, exportDefs());
/** The menu beside the Tidy button. */
export const tidyMenu = (ctx: MenuContext): MenuEntry[] =>
  resolve(ctx, tidyDefs());
/** The account chip's menu. */
export const accountMenu = (ctx: MenuContext): MenuEntry[] =>
  resolve(ctx, accountDefs(ctx));

/** The right-click menu of the canvas, for what is under the pointer. */
export const contextMenu = (
  ctx: MenuContext,
  target: ContextTarget,
): MenuEntry[] => resolve(ctx, contextDefs(target));

/** The menu bar's menus, in order: `data-menu`, the button's text, its
 * entries. */
export const MENUBAR: readonly {
  readonly id: 'file' | 'edit' | 'view' | 'arrange' | 'help';
  readonly label: string;
  readonly entries: (ctx: MenuContext) => MenuEntry[];
}[] = [
  { id: 'file', label: 'File', entries: fileMenu },
  { id: 'edit', label: 'Edit', entries: editMenu },
  { id: 'view', label: 'View', entries: viewMenu },
  { id: 'arrange', label: 'Arrange', entries: arrangeMenu },
  { id: 'help', label: 'Help', entries: helpMenu },
];

/** The one menu that stands in for the menu bar in a narrow window: each of
 * the five menus as a submenu. */
export const moreMenu = (ctx: MenuContext): MenuEntry[] =>
  MENUBAR.map((m) => ({ label: m.label, submenu: m.entries(ctx) }));

/** Where the menu bar offers a command. */
export interface MenuBarPath {
  /** The menu that holds it (`data-menu`). */
  readonly menu: (typeof MENUBAR)[number]['id'];
  /** That menu's text on the bar. */
  readonly menuLabel: string;
  /** The submenus to open on the way to it, outermost first, by their text. */
  readonly submenus: readonly string[];
}

/**
 * Where the menu bar offers a command: the menu, and the submenus to open
 * on the way. A command the bar offers twice is found where someone reading
 * the bar from the left, each menu from the top, meets it first. Null when no
 * menu of the bar offers it.
 */
export function menuBarPath(
  ctx: MenuContext,
  command: string,
): MenuBarPath | null {
  const within = (
    entries: readonly MenuEntry[],
    trail: readonly string[],
  ): readonly string[] | null => {
    for (const entry of entries) {
      // Separators and headings hold nothing.
      if (entry.kind !== undefined && entry.kind !== 'item') continue;
      if (entry.id === command) return trail;
      if (!entry.submenu) continue;
      const inner =
        typeof entry.submenu === 'function' ? entry.submenu() : entry.submenu;
      const found = within(inner, [...trail, entry.label]);
      if (found) return found;
    }
    return null;
  };
  for (const menu of MENUBAR) {
    const submenus = within(menu.entries(ctx), []);
    if (submenus) return { menu: menu.id, menuLabel: menu.label, submenus };
  }
  return null;
}
