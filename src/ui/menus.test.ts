import { describe, expect, it } from 'vitest';
import { listTemplates } from '../api/templates.js';
import {
  COMMAND_SPECS,
  createCommandRegistry,
  templateCommandSpecs,
  variantArgs,
  type CommandId,
} from './commands.js';
import { isMenuItem, type MenuEntry, type MenuItem } from './menu.js';
import {
  accountMenu,
  arrangeMenu,
  contextMenu,
  editMenu,
  exportMenu,
  fileMenu,
  helpMenu,
  MENUBAR,
  moreMenu,
  tidyMenu,
  viewMenu,
  type ContextTarget,
  type MenuContext,
} from './menus.js';

const TEMPLATES = listTemplates();
const SPECS = [...COMMAND_SPECS, ...templateCommandSpecs(TEMPLATES)];

/** A registry with every command bound to a stub that records its runs;
 * `off` lists the disabled commands, `on` the checked ones. */
function registry(
  options: { off?: readonly CommandId[]; on?: readonly CommandId[] } = {},
) {
  const commands = createCommandRegistry(SPECS);
  const ran: CommandId[] = [];
  for (const spec of SPECS)
    commands.bind(spec.id, {
      run: () => ran.push(spec.id),
      enabled: () => !options.off?.includes(spec.id),
      checked: () => !!options.on?.includes(spec.id),
    });
  return { commands, ran };
}

function context(overrides: Partial<MenuContext> = {}): MenuContext {
  return {
    commands: registry().commands,
    templates: TEMPLATES,
    shareAvailable: true,
    account: { login: 'octocat', admin: true },
    icon: (name) => `<svg data-icon="${name}"></svg>`,
    ...overrides,
  };
}

const ALL_MENUS = {
  fileMenu,
  editMenu,
  viewMenu,
  arrangeMenu,
  helpMenu,
  exportMenu,
  tidyMenu,
  accountMenu,
  moreMenu,
} as const;

function submenuOf(item: MenuItem): MenuEntry[] {
  const { submenu } = item;
  if (submenu === undefined) return [];
  return typeof submenu === 'function' ? submenu() : submenu;
}

/** Every item of a menu, those of its submenus included. */
function items(entries: readonly MenuEntry[]): MenuItem[] {
  return entries
    .filter(isMenuItem)
    .flatMap((item) => [item, ...items(submenuOf(item))]);
}

/** The command ids a menu runs, submenus included. */
function commandIds(entries: readonly MenuEntry[]): string[] {
  return items(entries).flatMap((item) =>
    item.id === undefined ? [] : [item.id],
  );
}

/**
 * A menu written out: a command item is its id, a separator "—", a heading
 * "# text", and a submenu `{ "Its label": [its entries] }`.
 */
type Shape = string | { [label: string]: Shape[] };
function shape(entries: readonly MenuEntry[]): Shape[] {
  return entries.map((entry): Shape => {
    if (entry.kind === 'separator') return '—';
    if (entry.kind === 'heading') return `# ${entry.label}`;
    if (entry.submenu !== undefined)
      return { [entry.label]: shape(submenuOf(entry)) };
    return entry.id ?? `(no command) ${entry.label}`;
  });
}

const EXPORT_SHAPE: Shape[] = [
  '# Image',
  'file.export.svg',
  'file.export.png',
  'file.export.copyPng',
  '# Document',
  'file.export.pdfPage',
  'file.export.pdfAll',
  'file.export.pptx',
  'file.export.pptxLayers',
  'file.export.flipbook',
  '# Editable, lossy',
  'file.export.drawio',
  'file.export.vsdx',
  'file.export.mermaid',
  '# Selection only',
  'file.export.svgSelection',
  'file.export.pngSelection',
];
const LAYOUT_IDS = [
  'arrange.layout.hierarchical',
  'arrange.layout.grid',
  'arrange.layout.circular',
  'arrange.layout.force',
];
const THEME_SHAPE: Shape = { Theme: ['view.theme.dark', 'view.theme.light'] };

describe('the menus', () => {
  it('have the items and the order the shell specification gives', () => {
    const ctx = context();
    expect(shape(fileMenu(ctx))).toEqual([
      'file.new',
      {
        'New from template': [
          ...TEMPLATES.map((t) => `file.template.${t.id}`),
          'file.generateSdwan',
        ],
      },
      'file.open',
      'file.download',
      '—',
      { Export: EXPORT_SHAPE },
      'file.share',
      '—',
      'view.present',
    ]);
    expect(shape(editMenu(ctx))).toEqual([
      'edit.undo',
      'edit.redo',
      '—',
      'edit.cut',
      'edit.copy',
      'edit.paste',
      'edit.pasteInPlace',
      'edit.duplicate',
      'edit.delete',
      '—',
      'selection.all',
      {
        Select: [
          'selection.sameType',
          'selection.sameColor',
          'selection.growConnected',
          'selection.invert',
        ],
      },
      '—',
      'edit.copyFormat',
      'edit.pasteFormat',
      '—',
      'edit.rename',
      'edit.toggleLock',
      '—',
      'edit.find',
      '—',
      { Tools: ['tool.select', 'tool.hand', 'tool.link', 'tool.anchor'] },
    ]);
    expect(shape(viewMenu(ctx))).toEqual([
      'view.toggleGrid',
      'view.toggleSnap',
      'view.toggleCalm',
      'view.toggleBadges',
      '—',
      'view.toggleLibrary',
      'view.toggleProperties',
      'view.toggleFrames',
      'view.toggleMinimap',
      '—',
      'view.zoomIn',
      'view.zoomOut',
      'view.zoom100',
      'view.fit',
      'view.zoomToSelection',
      '—',
      THEME_SHAPE,
      'view.displaySettings',
    ]);
    expect(shape(arrangeMenu(ctx))).toEqual([
      'arrange.tidy',
      'arrange.balance',
      { 'Auto-arrange': LAYOUT_IDS },
      'arrange.autoPlaceLabels',
      '—',
      {
        Align: [
          'arrange.alignLeft',
          'arrange.alignCenterH',
          'arrange.alignRight',
          'arrange.alignTop',
          'arrange.alignMiddleV',
          'arrange.alignBottom',
        ],
      },
      { Distribute: ['arrange.distributeH', 'arrange.distributeV'] },
      '—',
      'arrange.bringToFront',
      'arrange.bringForward',
      'arrange.sendBackward',
      'arrange.sendToBack',
      '—',
      'selection.groupIntoZone',
      'page.fitToContent',
    ]);
    expect(shape(helpMenu(ctx))).toEqual([
      'help.shortcuts',
      'help.commandPalette',
    ]);
    expect(shape(exportMenu(ctx))).toEqual(EXPORT_SHAPE);
    expect(shape(tidyMenu(ctx))).toEqual([
      'arrange.tidy',
      'arrange.balance',
      '—',
      ...LAYOUT_IDS,
      '—',
      'arrange.autoPlaceLabels',
      'page.fitToContent',
    ]);
    expect(shape(accountMenu(ctx))).toEqual([
      '# Signed in as octocat',
      'account.apiKeys',
      'account.preferences',
      'account.admin',
      '—',
      THEME_SHAPE,
      '—',
      'account.signOut',
    ]);
  });

  it('fold into one menu with the five as submenus, in menu bar order', () => {
    const ctx = context();
    expect(MENUBAR.map((m) => [m.id, m.label])).toEqual([
      ['file', 'File'],
      ['edit', 'Edit'],
      ['view', 'View'],
      ['arrange', 'Arrange'],
      ['help', 'Help'],
    ]);
    expect(shape(moreMenu(ctx))).toEqual([
      { File: shape(fileMenu(ctx)) },
      { Edit: shape(editMenu(ctx)) },
      { View: shape(viewMenu(ctx)) },
      { Arrange: shape(arrangeMenu(ctx)) },
      { Help: shape(helpMenu(ctx)) },
    ]);
  });

  it('name only commands of the registry', () => {
    const ctx = context();
    const known = new Set<string>(SPECS.map((s) => s.id));
    for (const [name, menu] of Object.entries(ALL_MENUS))
      for (const id of commandIds(menu(ctx)))
        expect(known.has(id), `${name}: ${id}`).toBe(true);
    // An unknown id is a mistake in the definitions, not an empty row.
    const partial = createCommandRegistry(COMMAND_SPECS.slice(1));
    expect(() => fileMenu(context({ commands: partial }))).toThrow(
      /"file\.new", which is not a command/,
    );
  });

  it('list no command twice in one menu', () => {
    const ctx = context();
    for (const [name, menu] of Object.entries(ALL_MENUS)) {
      const ids = commandIds(menu(ctx));
      const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(twice, name).toEqual([]);
    }
  });

  it('give every item, submenu and heading a sentence-case label', () => {
    // Words that keep their capitals inside a label: product names. Words in
    // capitals throughout (SVG, PDF, SD-WAN) are acronyms and pass anyway.
    const PROPER = new Set(['PowerPoint', 'Visio', 'Mermaid', 'Flipbook']);
    // Brands written lower-case even at the start.
    const LOWER_FIRST = new Set(['draw.io']);
    const labels: string[] = [];
    const collect = (entries: readonly MenuEntry[]): void => {
      for (const entry of entries) {
        if (entry.kind === 'separator') continue;
        if (entry.kind === 'heading') {
          // The account heading ends in the user's login, which is theirs.
          labels.push(entry.label.replace(/ octocat$/, ''));
          continue;
        }
        labels.push(entry.label);
        if (entry.submenu !== undefined) collect(submenuOf(entry));
      }
    };
    const ctx = context();
    for (const menu of Object.values(ALL_MENUS)) collect(menu(ctx));
    for (const label of labels) {
      expect(label.trim(), label).toBe(label);
      expect(label, label).not.toBe('');
      const [first, ...rest] = label.split(/\s+/);
      if (!LOWER_FIRST.has(first!))
        expect(first![0], label).toBe(first![0]!.toUpperCase());
      for (const word of rest) {
        const bare = word.replace(/^[^A-Za-z]+|[^A-Za-z.-]+$/g, '');
        if (/^[A-Z][a-z]/.test(bare))
          expect(PROPER.has(bare), label).toBe(true);
      }
    }
    // The flipbook's unit is a page in the shell's words, never a frame.
    for (const label of labels) expect(label, label).not.toMatch(/frame/i);
  });
});

/**
 * Every control of the toolbar before the shell was rebuilt, with the
 * commands that it ran (src/main.ts, the header template: maps/shell-map.md
 * §1.2). A select's options are listed one by one. A menu must offer each of
 * these commands, so that nothing the toolbar did is lost with it.
 */
const FORMER_TOOLBAR: readonly (readonly [string, readonly CommandId[]])[] = [
  ['#fNew', ['file.new']],
  ['#fSave', ['file.download']],
  ['#fOpen', ['file.open']],
  ['#fShare', ['file.share']],
  ['#tUndo', ['edit.undo']],
  ['#tRedo', ['edit.redo']],
  ['#fSvg', ['file.export.svg']],
  ['#fPng', ['file.export.png']],
  [
    '#fExport',
    [
      'file.export.pdfPage',
      'file.export.pdfAll',
      'file.export.flipbook',
      'file.export.drawio',
      'file.export.vsdx',
      'file.export.pptx',
      'file.export.pptxLayers',
      'file.export.mermaid',
      'file.export.copyPng',
      'file.export.svgSelection',
      'file.export.pngSelection',
    ],
  ],
  [
    '#fTemplate',
    [
      ...TEMPLATES.map((t) => `file.template.${t.id}` as const),
      'file.generateSdwan',
    ],
  ],
  ['#tGrid', ['view.toggleGrid']],
  ['#tSnap', ['view.toggleSnap']],
  ['#tCalm', ['view.toggleCalm']],
  ['#tBadges', ['view.toggleBadges']],
  ['#tDisplay', ['view.displaySettings']],
  // The toggle becomes the choice of the two themes.
  ['#tTheme', ['view.theme.dark', 'view.theme.light']],
  ['#tFit', ['view.fit']],
  ['#tPresent', ['view.present']],
  ['#tHelp', ['help.shortcuts']],
  ['#tDelete', ['edit.delete']],
  ['#tTidy', ['arrange.tidy']],
  ['#tBalance', ['arrange.balance']],
  [
    '#tLayout',
    [
      'arrange.layout.hierarchical',
      'arrange.layout.grid',
      'arrange.layout.circular',
      'arrange.layout.force',
    ],
  ],
  [
    '#tSelectBy',
    [
      'selection.sameType',
      'selection.sameColor',
      'selection.growConnected',
      'selection.invert',
      'selection.all',
    ],
  ],
  [
    '#alignGroup',
    [
      'arrange.alignLeft',
      'arrange.alignCenterH',
      'arrange.alignRight',
      'arrange.alignTop',
      'arrange.alignMiddleV',
      'arrange.alignBottom',
      'arrange.distributeH',
      'arrange.distributeV',
    ],
  ],
  ['#tSelect', ['tool.select']],
  ['#tLink', ['tool.link']],
  ['#tAnchor', ['tool.anchor']],
  ['#profileChip', ['account.preferences']],
  ['#adminChip', ['account.admin']],
  ['#userChip', ['account.apiKeys', 'account.signOut']],
];
describe('the former toolbar', () => {
  it('lists each export format and each template of the old selects', () => {
    const exportIds = FORMER_TOOLBAR.find(([c]) => c === '#fExport')![1];
    expect(exportIds.map((id) => SPECS.find((s) => s.id === id)!.args)).toEqual(
      variantArgs('file.export.', SPECS),
    );
    const templateIds = FORMER_TOOLBAR.find(([c]) => c === '#fTemplate')![1];
    expect(templateIds.length).toBe(TEMPLATES.length + 1);
  });

  it('has every command it ran in at least one menu', () => {
    // Signed in as the owner with sharing on: every conditional item shows.
    const ctx = context();
    const offered = new Set(
      Object.values(ALL_MENUS).flatMap((menu) => commandIds(menu(ctx))),
    );
    const missing = FORMER_TOOLBAR.flatMap(([control, ids]) =>
      ids.filter((id) => !offered.has(id)).map((id) => `${control}: ${id}`),
    );
    expect(missing).toEqual([]);
  });
});

describe('a menu item of a command', () => {
  it('takes its hint, icon, state and run from the registry', () => {
    const { commands, ran } = registry({
      off: ['edit.undo'],
      on: ['view.toggleGrid', 'view.theme.light'],
    });
    const ctx = context({ commands });
    const all = [...items(editMenu(ctx)), ...items(viewMenu(ctx))];
    const byId = (id: string): MenuItem => all.find((i) => i.id === id)!;

    const undo = byId('edit.undo');
    expect(undo.label).toBe('Undo');
    expect(undo.hint).toBe('Ctrl/Cmd+Z');
    expect(undo.iconHtml).toBe('<svg data-icon="undo"></svg>');
    expect(undo.disabled).toBe(true);
    expect(undo.checked).toBeUndefined();

    const grid = byId('view.toggleGrid');
    expect(grid.label).toBe('Grid');
    expect(grid.hint).toBe('R');
    expect(grid.checked).toBe(true);
    expect(grid.disabled).toBeUndefined();
    expect(byId('view.toggleSnap').checked).toBe(false);

    expect(byId('view.theme.light')).toMatchObject({
      label: 'Light',
      radio: true,
      checked: true,
    });
    expect(byId('view.theme.dark')).toMatchObject({
      label: 'Dark',
      radio: true,
      checked: false,
    });

    // No shortcut, no hint; no icon function, no icons.
    expect(byId('selection.sameType').hint).toBeUndefined();
    const plain = items(editMenu(context({ commands, icon: undefined })));
    expect(plain.every((i) => i.iconHtml === undefined)).toBe(true);

    grid.run!();
    byId('edit.copy').run!();
    // A disabled command does not run: the registry refuses it.
    undo.run!();
    expect(ran).toEqual(['view.toggleGrid', 'edit.copy']);
  });

  it('says Lock or Unlock for what a press would do', () => {
    const lockOf = (ctx: MenuContext) =>
      items(editMenu(ctx)).find((i) => i.id === 'edit.toggleLock')!.label;
    expect(lockOf(context())).toBe('Lock');
    expect(
      lockOf(
        context({ commands: registry({ on: ['edit.toggleLock'] }).commands }),
      ),
    ).toBe('Unlock');
  });
});

describe('what the context decides', () => {
  it('offers Share only while sharing is available', () => {
    expect(commandIds(fileMenu(context()))).toContain('file.share');
    expect(
      commandIds(fileMenu(context({ shareAvailable: false }))),
    ).not.toContain('file.share');
  });

  it('lists the starter templates it is given, then the SD-WAN wizard', () => {
    const templates = [
      { id: 'a', name: 'First one' },
      { id: 'b', name: 'Second one' },
    ];
    const commands = createCommandRegistry([
      ...COMMAND_SPECS,
      ...templateCommandSpecs(templates),
    ]);
    const entry = fileMenu(context({ commands, templates }))[1] as MenuItem;
    expect(entry.label).toBe('New from template');
    expect(
      submenuOf(entry).map((e) => (isMenuItem(e) ? [e.id, e.label] : e.kind)),
    ).toEqual([
      ['file.template.a', 'First one'],
      ['file.template.b', 'Second one'],
      ['file.generateSdwan', 'Generate SD-WAN…'],
    ]);
  });

  it('offers Admin to the owner only, and only Theme to nobody signed in', () => {
    const member = commandIds(
      accountMenu(context({ account: { login: 'octocat', admin: false } })),
    );
    expect(member).toContain('account.preferences');
    expect(member).not.toContain('account.admin');
    expect(shape(accountMenu(context({ account: null })))).toEqual([
      THEME_SHAPE,
    ]);
  });
});

describe('the context menu', () => {
  const at = { x: 120, y: 80 };
  const target = (over: Partial<ContextTarget>): ContextTarget => ({
    kind: 'node',
    at,
    singleNode: true,
    canAnalyzePath: false,
    ...over,
  });

  it('lists what it listed before, in the same order, by registry title', () => {
    const ctx = context();
    const rows = (t: ContextTarget): string[] =>
      contextMenu(ctx, t).map((e) =>
        isMenuItem(e) ? e.label : e.kind === 'separator' ? '-' : e.label,
      );
    expect(rows(target({}))).toEqual([
      'Rename',
      'Duplicate',
      'Cut',
      'Copy',
      'Copy as image',
      'Copy format',
      'Paste format',
      '-',
      'Emphasize on this page',
      'Group into zone',
      'Save as stencil…',
      'Add policy marker',
      '-',
      'Bring to front',
      'Send to back',
      '-',
      'Lock',
      'Delete',
    ]);
    // Several nodes: no Rename. Two of them: the path between them.
    const two = rows(target({ singleNode: false, canAnalyzePath: true }));
    expect(two[0]).toBe('Duplicate');
    expect(two.slice(7, 10)).toEqual([
      'Emphasize on this page',
      'Analyze path',
      'Group into zone',
    ]);
    expect(rows(target({ kind: 'link' }))).toEqual([
      'Swap endpoints',
      'Straighten (clear bends)',
      'Copy format',
      'Paste format',
      'Emphasize on this page',
      '-',
      'Bring to front',
      'Send to back',
      '-',
      'Lock',
      'Delete',
    ]);
    expect(rows(target({ kind: 'empty' }))).toEqual([
      'Paste here',
      'Paste in place',
      'Select all',
      'Copy page as image',
      '-',
      'Tidy layout',
      'Balance layout',
      'Auto-place labels',
      'Fit page to content',
    ]);
  });

  it('greys out what cannot run, says Unlock when locked, and names no command twice', () => {
    const { commands } = registry({
      off: ['edit.pasteFormat', 'arrange.bringToFront'],
      on: ['edit.toggleLock'],
    });
    const menu = items(contextMenu(context({ commands }), target({})));
    const byId = (id: string): MenuItem => menu.find((i) => i.id === id)!;
    expect(byId('edit.pasteFormat').disabled).toBe(true);
    expect(byId('arrange.bringToFront').disabled).toBe(true);
    expect(byId('edit.copy').disabled).toBeUndefined();
    expect(byId('edit.toggleLock').label).toBe('Unlock');
    for (const kind of ['node', 'link', 'empty'] as const) {
      const ids = commandIds(contextMenu(context(), target({ kind })));
      expect(new Set(ids).size, kind).toBe(ids.length);
    }
  });

  it('pastes at the point that was right-clicked', () => {
    const commands = createCommandRegistry(SPECS);
    const calls: unknown[] = [];
    for (const spec of SPECS)
      commands.bind(spec.id, {
        run:
          spec.id === 'edit.pasteHere' ? (args) => calls.push(args) : () => {},
      });
    const paste = items(
      contextMenu(context({ commands }), target({ kind: 'empty' })),
    ).find((i) => i.id === 'edit.pasteHere')!;
    paste.run!();
    expect(calls).toEqual([at]);
  });
});
