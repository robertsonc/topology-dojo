/**
 * The command table and its registry: the data is well formed, `matchKey`
 * decides every key press exactly as the handler it replaced did, no two
 * bindings compete for a press, and the registry binds, gates and describes
 * commands the way the shell relies on.
 */
import { describe, expect, it } from 'vitest';
import { listTemplates } from '../api/templates.js';
import {
  COMMAND_GROUPS,
  COMMAND_SPECS,
  HELP_GESTURES,
  bindingMatches,
  commandVariant,
  createCommandRegistry,
  matchKey,
  type CommandId,
  type CommandSpec,
  type KeyBinding,
  type KeyContext,
  type KeyMatch,
  type KeyPress,
} from './commands.js';
import { iconNames } from './icons.js';

const CANVAS: KeyContext = { focusOnCanvas: true, selectionCount: 0 };
const SELECTED: KeyContext = { focusOnCanvas: true, selectionCount: 2 };
const ON_BUTTON: KeyContext = { focusOnCanvas: false, selectionCount: 0 };

const spec = (id: CommandId): CommandSpec<CommandId> =>
  COMMAND_SPECS.find((s) => s.id === id)!;

describe('COMMAND_SPECS', () => {
  it('gives every command a unique dotted id, a title and a known group', () => {
    const ids = COMMAND_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(COMMAND_GROUPS.map((g) => g.id));
    for (const s of COMMAND_SPECS) {
      expect(s.id, s.id).toMatch(/^[a-z]+(\.[A-Za-z0-9-]+)+$/);
      expect(s.title.trim(), s.id).toBe(s.title);
      expect(s.title, s.id).not.toBe('');
      // Sentence case: a capital first, and no shortcut written into it.
      expect(s.title[0], s.id).toBe(s.title[0]!.toUpperCase());
      expect(s.title, s.id).not.toMatch(/\((Ctrl|Shift|Alt|Del|[A-Z0-9?])\b/);
      expect(groups.has(s.group), s.id).toBe(true);
      if (s.help !== undefined) expect(s.help.trim(), s.id).not.toBe('');
    }
  });

  it('draws its icons from the icon set', () => {
    const icons = new Set<string>(iconNames());
    for (const s of COMMAND_SPECS)
      if (s.icon !== undefined) expect(icons.has(s.icon), s.id).toBe(true);
  });

  it('writes every binding in full', () => {
    for (const s of COMMAND_SPECS)
      for (const b of s.bindings ?? []) {
        const where = `${s.id} ${b.display}`;
        expect(b.display.trim(), where).not.toBe('');
        expect(b.display.trim(), where).toBe(b.display);
        expect(b.key !== undefined || b.code !== undefined, where).toBe(true);
        if (b.key !== undefined) expect(b.key, where).not.toBe('');
        // A letter is matched in either case, so it is written lower-case.
        if (b.key?.length === 1 && !b.caseSensitive)
          expect(b.key, where).toBe(b.key.toLowerCase());
        if (b.code !== undefined)
          expect(b.code, where).toMatch(/^(Key[A-Z]|Digit[0-9])$/);
        expect(typeof b.preventDefault, where).toBe('boolean');
      }
  });

  it('has one command per starter template, run with the template id', () => {
    for (const t of listTemplates()) {
      const s = COMMAND_SPECS.find((c) => c.id === `file.template.${t.id}`);
      expect(s, t.id).toBeDefined();
      expect(s!.args).toBe(t.id);
      expect(s!.title).toContain(t.name);
      expect(commandVariant('file.template.', t.id)).toBe(s);
    }
  });

  it('finds the variant of a parameterised command by its argument', () => {
    expect(commandVariant('file.export.', 'pdf-page')?.id).toBe(
      'file.export.pdfPage',
    );
    expect(commandVariant('arrange.layout.', 'force')?.id).toBe(
      'arrange.layout.force',
    );
    expect(commandVariant('arrange.align', 'centerH')?.id).toBe(
      'arrange.alignCenterH',
    );
    expect(commandVariant('view.wheel.', 'pan')?.id).toBe('view.wheel.pan');
    // Not a variant: no such argument, or a command that takes none.
    expect(commandVariant('file.export.', 'gif')).toBeUndefined();
    expect(commandVariant('file.export.', undefined)).toBeUndefined();
    // Two variants of one command never share an argument.
    for (const prefix of [
      'file.export.',
      'file.template.',
      'arrange.align',
      'arrange.distribute',
      'arrange.layout.',
      'view.ambient.',
      'view.wheel.',
    ]) {
      const args = COMMAND_SPECS.filter(
        (s) => s.id.startsWith(prefix) && s.args !== undefined,
      ).map((s) => s.args);
      expect(args.length, prefix).toBeGreaterThan(1);
      expect(new Set(args).size, prefix).toBe(args.length);
    }
  });

  it('lists the commands the old surfaces offered', () => {
    const ids = new Set<string>(COMMAND_SPECS.map((s) => s.id));
    for (const id of [
      // toolbar and canvas controls
      ...['file.new', 'file.download', 'file.open', 'file.share'],
      ...['file.export.svg', 'file.export.png', 'file.generateSdwan'],
      ...['edit.undo', 'edit.redo', 'edit.delete'],
      ...['tool.select', 'tool.link', 'tool.anchor', 'tool.hand'],
      ...['view.toggleGrid', 'view.toggleSnap', 'view.toggleCalm'],
      ...['view.toggleBadges', 'view.displaySettings', 'view.toggleTheme'],
      ...['view.fit', 'view.present', 'view.zoomIn', 'view.zoomOut'],
      ...['arrange.tidy', 'arrange.balance', 'help.shortcuts'],
      // the export, arrange and select menus
      ...['pdfPage', 'pdfAll', 'flipbook', 'drawio', 'vsdx', 'pptx'].map(
        (k) => `file.export.${k}`,
      ),
      ...['pptxLayers', 'mermaid', 'copyPng', 'svgSelection'].map(
        (k) => `file.export.${k}`,
      ),
      'file.export.pngSelection',
      ...['hierarchical', 'grid', 'circular', 'force'].map(
        (k) => `arrange.layout.${k}`,
      ),
      ...['sameType', 'sameColor', 'growConnected', 'invert', 'all'].map(
        (k) => `selection.${k}`,
      ),
      // align and distribute
      ...['Left', 'CenterH', 'Right', 'Top', 'MiddleV', 'Bottom'].map(
        (k) => `arrange.align${k}`,
      ),
      ...['arrange.distributeH', 'arrange.distributeV'],
      // the context menus
      ...['edit.rename', 'edit.duplicate', 'edit.cut', 'edit.copy'],
      ...['edit.copyAsImage', 'edit.copyFormat', 'edit.pasteFormat'],
      ...['selection.emphasize', 'selection.analyzePath'],
      ...['selection.groupIntoZone', 'selection.saveAsStencil'],
      ...['selection.addPolicyMarker', 'arrange.bringToFront'],
      ...['arrange.sendToBack', 'edit.toggleLock', 'link.swapEndpoints'],
      ...['link.straighten', 'edit.pasteHere', 'edit.pasteInPlace'],
      ...['edit.copyFrameAsImage', 'arrange.autoPlaceLabels'],
      'page.fitToContent',
      // panels and frames
      ...['view.toggleLibrary', 'view.toggleMinimap', 'view.toggleProperties'],
      ...['view.toggleFrames', 'view.toggleProblems', 'view.showProblems'],
      ...['page.add', 'page.duplicate', 'page.delete', 'page.undoDelete'],
      ...['page.next', 'page.prev', 'page.playPause'],
    ])
      expect(ids.has(id), id).toBe(true);
  });
});

/* ── matchKey: the table, row by row ───────────────────────────────────── */

const hit = (
  id: CommandId,
  preventDefault: boolean,
  args?: unknown,
): KeyMatch => ({
  id,
  preventDefault,
  ...(args === undefined ? {} : { args }),
});

const ctrl = (key: string, more: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: true,
  ...more,
});
const cmd = (key: string, more: Partial<KeyPress> = {}): KeyPress => ({
  key,
  metaKey: true,
  ...more,
});

describe('matchKey', () => {
  /**
   * One row per branch of the handler this replaced (K1–K25 of the command
   * map, then the nine canvas-key commands in their own order): the press,
   * the context, and the command with whether the key is taken.
   */
  const ROWS: [
    name: string,
    press: KeyPress,
    ctx: KeyContext,
    expected: KeyMatch | null,
  ][] = [
    ['K1 ?', { key: '?', shiftKey: true }, CANVAS, hit('help.shortcuts', true)],
    // K2, Space, is a gesture (hold to pan): the shell reads it itself.
    ['K2 Space is not a command', { key: ' ', code: 'Space' }, CANVAS, null],
    // K3: the canvas keys.
    [
      'K3 Ctrl+Shift+V',
      ctrl('V', { shiftKey: true }),
      CANVAS,
      hit('edit.pasteInPlace', true),
    ],
    ['K3 Ctrl+S', ctrl('s'), CANVAS, hit('file.download', true)],
    ['K3 Cmd+O', cmd('o'), CANVAS, hit('file.open', true)],
    [
      'K3 Shift+0',
      { key: ')', code: 'Digit0', shiftKey: true },
      CANVAS,
      hit('view.zoom100', true),
    ],
    [
      'K3 Shift+1',
      { key: '!', code: 'Digit1', shiftKey: true },
      CANVAS,
      hit('view.fit', true),
    ],
    [
      'K3 Shift+2',
      { key: '@', code: 'Digit2', shiftKey: true },
      CANVAS,
      hit('view.zoomToSelection', true),
    ],
    ['K3 +', { key: '+', shiftKey: true }, CANVAS, hit('view.zoomIn', true)],
    ['K3 =', { key: '=' }, CANVAS, hit('view.zoomIn', true)],
    ['K3 -', { key: '-' }, CANVAS, hit('view.zoomOut', true)],
    ['K3 _', { key: '_', shiftKey: true }, CANVAS, hit('view.zoomOut', true)],
    ['K3 F2', { key: 'F2' }, CANVAS, hit('edit.rename', true)],
    ['K3 F2 from a button', { key: 'F2' }, ON_BUTTON, hit('edit.rename', true)],
    ['K3 Enter', { key: 'Enter' }, CANVAS, hit('edit.rename', true)],
    ['K3 Enter on a button', { key: 'Enter' }, ON_BUTTON, null],
    // K4: the Ctrl/Cmd block.
    [
      'K4a Ctrl+Alt+C',
      ctrl('c', { altKey: true, code: 'KeyC' }),
      CANVAS,
      hit('edit.copyFormat', true),
    ],
    [
      'K4a Cmd+Alt+C by physical key (Option+C types "ç")',
      cmd('ç', { altKey: true, code: 'KeyC' }),
      CANVAS,
      hit('edit.copyFormat', true),
    ],
    [
      'K4b Ctrl+Alt+V',
      ctrl('v', { altKey: true, code: 'KeyV' }),
      CANVAS,
      hit('edit.pasteFormat', true),
    ],
    [
      'K4b Cmd+Alt+V by physical key (Option+V types "√")',
      cmd('√', { altKey: true, code: 'KeyV' }),
      CANVAS,
      hit('edit.pasteFormat', true),
    ],
    ['K4c Ctrl+Z', ctrl('z'), CANVAS, hit('edit.undo', true)],
    [
      'K4c Ctrl+Shift+Z',
      ctrl('Z', { shiftKey: true }),
      CANVAS,
      hit('edit.redo', true),
    ],
    ['K4d Ctrl+Y', ctrl('y'), CANVAS, hit('edit.redo', true)],
    ['K4e Ctrl+A', ctrl('a'), CANVAS, hit('selection.all', true)],
    ['K4f Ctrl+F', ctrl('f'), CANVAS, hit('edit.find', true)],
    ['K4g Ctrl+C', ctrl('c'), CANVAS, hit('edit.copy', true)],
    ['K4h Ctrl+X', ctrl('x'), CANVAS, hit('edit.cut', true)],
    ['K4i Ctrl+V', ctrl('v'), CANVAS, hit('edit.paste', true)],
    ['K4j Ctrl+D', ctrl('d'), CANVAS, hit('edit.duplicate', true)],
    ['K4k Ctrl+L', ctrl('l'), CANVAS, hit('edit.toggleLock', true)],
    ['K4l Ctrl+]', ctrl(']'), CANVAS, hit('arrange.bringToFront', true)],
    ['K4m Ctrl+[', ctrl('['), CANVAS, hit('arrange.sendToBack', true)],
    // K4z: any other Ctrl/Cmd combination is the browser's, untouched.
    ['K4z Ctrl+K', ctrl('k'), CANVAS, null],
    // K5–K22: the plain keys.
    ['K5 Delete', { key: 'Delete' }, CANVAS, hit('edit.delete', true)],
    ['K5 Backspace', { key: 'Backspace' }, CANVAS, hit('edit.delete', true)],
    ['K6 ]', { key: ']' }, CANVAS, hit('arrange.bringForward', false)],
    ['K7 [', { key: '[' }, CANVAS, hit('arrange.sendBackward', false)],
    ['K8 g', { key: 'g' }, CANVAS, hit('view.toggleSnap', false)],
    ['K9 r', { key: 'r' }, CANVAS, hit('view.toggleGrid', false)],
    ['K10 m', { key: 'm' }, CANVAS, hit('view.toggleMinimap', false)],
    ['K11 b', { key: 'b' }, CANVAS, hit('view.toggleLibrary', false)],
    ['K12 p', { key: 'p' }, CANVAS, hit('view.toggleProperties', false)],
    ['K13 f', { key: 'f' }, CANVAS, hit('view.toggleFrames', false)],
    ['K14 c', { key: 'c' }, CANVAS, hit('view.toggleCalm', false)],
    ['K15 t', { key: 't' }, CANVAS, hit('arrange.tidy', false)],
    [
      'K16 T',
      { key: 'T', shiftKey: true },
      CANVAS,
      hit('arrange.balance', false),
    ],
    ['K17 0', { key: '0', code: 'Digit0' }, CANVAS, hit('view.fit', false)],
    ['K18 l', { key: 'l' }, CANVAS, hit('tool.link', false)],
    ['K19 v', { key: 'v' }, CANVAS, hit('tool.select', false)],
    ['K20 a', { key: 'a' }, CANVAS, hit('tool.anchor', false)],
    ['K21 h', { key: 'h' }, CANVAS, hit('tool.hand', false)],
    ['K22 Escape', { key: 'Escape' }, CANVAS, hit('selection.clear', false)],
    // K23: arrows with a selection nudge, by 10 with Shift.
    [
      'K23 ArrowLeft',
      { key: 'ArrowLeft' },
      SELECTED,
      hit('selection.nudgeLeft', true),
    ],
    [
      'K23 ArrowRight',
      { key: 'ArrowRight' },
      SELECTED,
      hit('selection.nudgeRight', true),
    ],
    [
      'K23 ArrowUp',
      { key: 'ArrowUp' },
      SELECTED,
      hit('selection.nudgeUp', true),
    ],
    [
      'K23 ArrowDown',
      { key: 'ArrowDown' },
      SELECTED,
      hit('selection.nudgeDown', true),
    ],
    [
      'K23 Shift+ArrowLeft',
      { key: 'ArrowLeft', shiftKey: true },
      SELECTED,
      hit('selection.nudgeLeft', true, 10),
    ],
    [
      'K23 Shift+ArrowDown',
      { key: 'ArrowDown', shiftKey: true },
      SELECTED,
      hit('selection.nudgeDown', true, 10),
    ],
    // K24, K25: with nothing selected, left and right flip frames.
    ['K24 ArrowRight', { key: 'ArrowRight' }, CANVAS, hit('page.next', false)],
    ['K25 ArrowLeft', { key: 'ArrowLeft' }, CANVAS, hit('page.prev', false)],
    ['ArrowUp, nothing selected', { key: 'ArrowUp' }, CANVAS, null],
    ['ArrowDown, nothing selected', { key: 'ArrowDown' }, CANVAS, null],
  ];

  it.each(ROWS)('%s', (_name, press, ctx, expected) => {
    expect(matchKey(press, ctx)).toEqual(expected);
  });

  it('reads Ctrl and Cmd as one modifier', () => {
    for (const key of ['z', 'y', 'a', 'f', 'c', 'x', 'v', 'd', 'l', ']', '['])
      expect(matchKey(cmd(key), CANVAS), key).toEqual(
        matchKey(ctrl(key), CANVAS),
      );
    expect(matchKey(cmd('z', { ctrlKey: true }), CANVAS)).toEqual(
      hit('edit.undo', true),
    );
  });

  it('does not read Shift in the Ctrl/Cmd block, except for Z and V', () => {
    for (const [key, id] of [
      ['A', 'selection.all'],
      ['C', 'edit.copy'],
      ['D', 'edit.duplicate'],
      ['F', 'edit.find'],
      ['L', 'edit.toggleLock'],
      ['X', 'edit.cut'],
      ['Y', 'edit.redo'],
    ] as const)
      expect(matchKey(ctrl(key, { shiftKey: true }), CANVAS), key).toEqual(
        hit(id, true),
      );
    // The brackets too, on a layout that still types them with Shift held.
    expect(matchKey(ctrl(']', { shiftKey: true }), CANVAS)).toEqual(
      hit('arrange.bringToFront', true),
    );
  });

  it('does not read Alt in the Ctrl/Cmd block, except for C and V', () => {
    for (const [key, id] of [
      ['z', 'edit.undo'],
      ['y', 'edit.redo'],
      ['a', 'selection.all'],
      ['d', 'edit.duplicate'],
      ['f', 'edit.find'],
      ['l', 'edit.toggleLock'],
      ['x', 'edit.cut'],
      ['[', 'arrange.sendToBack'],
    ] as const)
      expect(matchKey(ctrl(key, { altKey: true }), CANVAS), key).toEqual(
        hit(id, true),
      );
    expect(
      matchKey(ctrl('Z', { altKey: true, shiftKey: true }), CANVAS),
    ).toEqual(hit('edit.redo', true));
  });

  it('gives Ctrl/Cmd+Alt+C and +V to the format painter, never to copy or paste', () => {
    for (const mod of ['ctrlKey', 'metaKey'] as const) {
      const base = { [mod]: true, altKey: true };
      expect(matchKey({ key: 'c', ...base }, CANVAS)).toEqual(
        hit('edit.copyFormat', true),
      );
      expect(matchKey({ key: 'C', shiftKey: true, ...base }, CANVAS)).toEqual(
        hit('edit.copyFormat', true),
      );
      expect(matchKey({ key: 'v', ...base }, CANVAS)).toEqual(
        hit('edit.pasteFormat', true),
      );
      // Paste in place is Shift without Alt; with Alt it is the painter.
      expect(matchKey({ key: 'V', shiftKey: true, ...base }, CANVAS)).toEqual(
        hit('edit.pasteFormat', true),
      );
    }
    // The physical C key wins over what it types: on a Bépo keyboard it
    // types "x", and Ctrl+Alt+that was never Cut.
    expect(matchKey(ctrl('x', { altKey: true, code: 'KeyC' }), CANVAS)).toEqual(
      hit('edit.copyFormat', true),
    );
    // Copy format is asked first: a "c" typed by the physical V key copies.
    expect(matchKey(ctrl('c', { altKey: true, code: 'KeyV' }), CANVAS)).toEqual(
      hit('edit.copyFormat', true),
    );
    expect(matchKey(ctrl('v', { altKey: true, code: 'KeyC' }), CANVAS)).toEqual(
      hit('edit.copyFormat', true),
    );
  });

  it('never runs a plain-key shortcut with Ctrl or Cmd held', () => {
    // Bound or not, a Ctrl/Cmd combination stops at the Ctrl/Cmd bindings:
    // Ctrl+A is not the anchor tool, Ctrl+G is not snap.
    const plain = 'grmbpfctT0lvah'.split('');
    for (const key of plain)
      for (const press of [ctrl(key), cmd(key)]) {
        const found = matchKey(press, CANVAS);
        if (found) expect(found.preventDefault, key).toBe(true);
        else expect(found, key).toBeNull();
      }
    for (const key of ['g', 'r', 'm', 'b', 'p', 't', 'T', '0', 'h', 'k'])
      expect(matchKey(ctrl(key), CANVAS), key).toBeNull();
    for (const key of ['Delete', 'Backspace', 'Escape', 'F2', 'Enter'])
      expect(matchKey(ctrl(key), SELECTED), key).toBeNull();
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      expect(matchKey(ctrl(key), SELECTED), key).toBeNull();
      expect(matchKey(cmd(key), CANVAS), key).toBeNull();
    }
    // The browser keeps its own zoom keys.
    for (const key of ['+', '=', '-', '_', '0'])
      expect(matchKey(ctrl(key), CANVAS), key).toBeNull();
    // Shift or Alt on a file key leaves it to the browser as well.
    expect(matchKey(ctrl('S', { shiftKey: true }), CANVAS)).toBeNull();
    expect(matchKey(ctrl('s', { altKey: true }), CANVAS)).toBeNull();
    expect(matchKey(ctrl('O', { shiftKey: true }), CANVAS)).toBeNull();
  });

  it('accepts either case of a plain letter, and Shift or Alt with it', () => {
    for (const [key, id] of [
      ['g', 'view.toggleSnap'],
      ['r', 'view.toggleGrid'],
      ['m', 'view.toggleMinimap'],
      ['b', 'view.toggleLibrary'],
      ['p', 'view.toggleProperties'],
      ['f', 'view.toggleFrames'],
      ['c', 'view.toggleCalm'],
      ['l', 'tool.link'],
      ['v', 'tool.select'],
      ['a', 'tool.anchor'],
      ['h', 'tool.hand'],
    ] as const) {
      const expected = hit(id, false);
      const upper = key.toUpperCase();
      expect(matchKey({ key: upper }, CANVAS), upper).toEqual(expected);
      expect(matchKey({ key: upper, shiftKey: true }, CANVAS)).toEqual(
        expected,
      );
      expect(matchKey({ key, altKey: true }, CANVAS), key).toEqual(expected);
    }
    for (const key of ['Delete', 'Backspace'])
      expect(
        matchKey({ key, shiftKey: true, altKey: true }, CANVAS),
        key,
      ).toEqual(hit('edit.delete', true));
    expect(matchKey({ key: 'Escape', shiftKey: true }, CANVAS)).toEqual(
      hit('selection.clear', false),
    );
    expect(matchKey({ key: '0', altKey: true }, CANVAS)).toEqual(
      hit('view.fit', false),
    );
  });

  it('tells t from T by the character alone', () => {
    // Shift+T types "T": balance. Caps Lock without Shift types "T" too.
    expect(matchKey({ key: 'T', shiftKey: true }, CANVAS)).toEqual(
      hit('arrange.balance', false),
    );
    expect(matchKey({ key: 'T' }, CANVAS)).toEqual(
      hit('arrange.balance', false),
    );
    // Caps Lock with Shift types "t": tidy.
    expect(matchKey({ key: 't', shiftKey: true }, CANVAS)).toEqual(
      hit('arrange.tidy', false),
    );
    expect(matchKey({ key: 't', altKey: true }, CANVAS)).toEqual(
      hit('arrange.tidy', false),
    );
  });

  it('reads Shift + digit by the physical key, before what it types', () => {
    // German: Shift+0 types "=", which is not zoom in.
    expect(
      matchKey({ key: '=', code: 'Digit0', shiftKey: true }, CANVAS),
    ).toEqual(hit('view.zoom100', true));
    // French: Shift+0 types "0", which is not the plain 0.
    expect(
      matchKey({ key: '0', code: 'Digit0', shiftKey: true }, CANVAS),
    ).toEqual(hit('view.zoom100', true));
    expect(
      matchKey({ key: '"', code: 'Digit2', shiftKey: true }, CANVAS),
    ).toEqual(hit('view.zoomToSelection', true));
    expect(
      matchKey({ key: '+', code: 'Digit1', shiftKey: true }, CANVAS),
    ).toEqual(hit('view.fit', true));
    // The plain digits: 0 fits (and leaves the key alone), 1 and 2 nothing.
    expect(matchKey({ key: '1', code: 'Digit1' }, CANVAS)).toBeNull();
    expect(matchKey({ key: '2', code: 'Digit2' }, CANVAS)).toBeNull();
    // With Alt they are not zoom keys; a "0" still fits the view.
    expect(
      matchKey(
        { key: ')', code: 'Digit0', shiftKey: true, altKey: true },
        CANVAS,
      ),
    ).toBeNull();
    expect(
      matchKey(
        { key: '0', code: 'Digit0', shiftKey: true, altKey: true },
        CANVAS,
      ),
    ).toEqual(hit('view.fit', false));
  });

  it('keeps the zoom, rename and file keys off Alt and (for rename) off Shift', () => {
    for (const key of ['+', '=', '-', '_', 'F2', 'Enter'])
      expect(matchKey({ key, altKey: true }, CANVAS), key).toBeNull();
    expect(matchKey({ key: 'F2', shiftKey: true }, CANVAS)).toBeNull();
    expect(matchKey({ key: 'Enter', shiftKey: true }, CANVAS)).toBeNull();
  });

  it('opens the shortcut sheet on ? whatever else is held', () => {
    for (const more of [
      {},
      { shiftKey: true },
      { ctrlKey: true, shiftKey: true },
      { metaKey: true },
      { altKey: true },
      { code: 'Digit1', shiftKey: true },
      { code: 'KeyC', ctrlKey: true, altKey: true },
    ])
      for (const ctx of [CANVAS, SELECTED, ON_BUTTON])
        expect(matchKey({ key: '?', ...more }, ctx)).toEqual(
          hit('help.shortcuts', true),
        );
  });

  it('splits the arrows by whether anything is selected', () => {
    // A selected link counts: the arrow is taken, and never flips the frame.
    const one: KeyContext = { focusOnCanvas: true, selectionCount: 1 };
    expect(matchKey({ key: 'ArrowRight' }, one)).toEqual(
      hit('selection.nudgeRight', true),
    );
    expect(matchKey({ key: 'ArrowRight', shiftKey: true }, CANVAS)).toEqual(
      hit('page.next', false),
    );
    expect(matchKey({ key: 'ArrowLeft', altKey: true }, CANVAS)).toEqual(
      hit('page.prev', false),
    );
    expect(matchKey({ key: 'ArrowUp', altKey: true }, SELECTED)).toEqual(
      hit('selection.nudgeUp', true),
    );
    // Where focus is does not matter to them (the shell routes that).
    expect(
      matchKey(
        { key: 'ArrowLeft' },
        { focusOnCanvas: false, selectionCount: 3 },
      ),
    ).toEqual(hit('selection.nudgeLeft', true));
  });

  it('is nothing for keys that are not shortcuts', () => {
    for (const key of [
      ...['d', 'e', 'i', 'j', 'k', 'n', 'o', 'q', 's', 'u', 'w', 'x', 'y', 'z'],
      ...['1', '9', 'Tab', 'Home', 'End', 'PageUp', 'PageDown', 'F1', 'F3'],
      ...[
        ',',
        '.',
        '/',
        ';',
        "'",
        '\\',
        '`',
        'Shift',
        'Control',
        'Alt',
        'Meta',
      ],
      ...['Dead', 'Process', 'Unidentified', ''],
    ])
      for (const ctx of [CANVAS, SELECTED, ON_BUTTON])
        expect(matchKey({ key }, ctx), key).toBeNull();
  });
});

/* ── matchKey against the handler it replaced ──────────────────────────── */

/**
 * `canvasKeyCommand` as it was before the key table (src/ui/canvas-keys.ts
 * at f9b2bc6), character for character.
 */
function legacyCanvasKeyCommand(
  e: KeyPress,
  focusOnCanvas: boolean,
): string | null {
  if (e.altKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (e.ctrlKey || e.metaKey) {
    if (e.shiftKey) return key === 'v' ? 'paste-in-place' : null;
    if (key === 's') return 'save';
    if (key === 'o') return 'open';
    return null;
  }

  if (e.shiftKey) {
    if (e.code === 'Digit0') return 'zoom-100';
    if (e.code === 'Digit1') return 'zoom-fit';
    if (e.code === 'Digit2') return 'zoom-selection';
  }
  if (key === '+' || key === '=') return 'zoom-in';
  if (key === '-' || key === '_') return 'zoom-out';
  if (e.shiftKey) return null;
  if (key === 'F2') return 'rename';
  if (key === 'Enter' && focusOnCanvas) return 'rename';
  return null;
}

const LEGACY_CANVAS_COMMANDS: Record<string, CommandId> = {
  'zoom-in': 'view.zoomIn',
  'zoom-out': 'view.zoomOut',
  'zoom-100': 'view.zoom100',
  'zoom-fit': 'view.fit',
  'zoom-selection': 'view.zoomToSelection',
  rename: 'edit.rename',
  'paste-in-place': 'edit.pasteInPlace',
  save: 'file.download',
  open: 'file.open',
};

/**
 * The window key handler as it was (src/main.ts 5737-5880 at f9b2bc6), after
 * its guards, with each branch's body replaced by the command it ran. Every
 * `if`, `else` and `return` is where it was; "took" is `preventDefault`.
 * Space (hold to pan) stays explicit code in the shell, so it is "nothing"
 * here as it is for `matchKey`.
 */
function legacyHandler(e: KeyPress, ctx: KeyContext): KeyMatch[] {
  const ran: KeyMatch[] = [];
  let took = false;
  const preventDefault = (): void => {
    took = true;
  };
  const run = (id: CommandId, args?: unknown): void => {
    ran.push(hit(id, took, args));
  };

  ((): void => {
    if (e.key === '?') {
      preventDefault();
      run('help.shortcuts');
      return;
    }

    if (e.key === ' ') return; // editor.setSpacePan(true): the gesture

    const command = legacyCanvasKeyCommand(e, ctx.focusOnCanvas);
    if (command) {
      preventDefault();
      run(LEGACY_CANVAS_COMMANDS[command]!);
      return;
    }

    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      const k = e.key.toLowerCase();
      if (e.altKey && (e.code === 'KeyC' || k === 'c')) {
        preventDefault();
        run('edit.copyFormat');
        return;
      }
      if (e.altKey && (e.code === 'KeyV' || k === 'v')) {
        preventDefault();
        run('edit.pasteFormat');
        return;
      }
      if (k === 'z') {
        preventDefault();
        if (e.shiftKey) run('edit.redo');
        else run('edit.undo');
      } else if (k === 'y') {
        preventDefault();
        run('edit.redo');
      } else if (k === 'a') {
        preventDefault();
        run('selection.all');
      } else if (k === 'f') {
        preventDefault();
        run('edit.find');
      } else if (k === 'c') {
        preventDefault();
        run('edit.copy');
      } else if (k === 'x') {
        preventDefault();
        run('edit.cut');
      } else if (k === 'v') {
        preventDefault();
        run('edit.paste');
      } else if (k === 'd') {
        preventDefault();
        run('edit.duplicate');
      } else if (k === 'l') {
        preventDefault();
        run('edit.toggleLock');
      } else if (e.key === ']') {
        preventDefault();
        run('arrange.bringToFront');
      } else if (e.key === '[') {
        preventDefault();
        run('arrange.sendToBack');
      }
      return; // other mod combos: leave to the browser
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      preventDefault();
      run('edit.delete');
      return;
    }
    if (e.key === ']') {
      run('arrange.bringForward');
      return;
    }
    if (e.key === '[') {
      run('arrange.sendBackward');
      return;
    }
    if (e.key === 'g' || e.key === 'G') run('view.toggleSnap');
    if (e.key === 'r' || e.key === 'R') run('view.toggleGrid');
    if (e.key === 'm' || e.key === 'M') run('view.toggleMinimap');
    if (e.key === 'b' || e.key === 'B') run('view.toggleLibrary');
    if (e.key === 'p' || e.key === 'P') run('view.toggleProperties');
    if (e.key === 'f' || e.key === 'F') run('view.toggleFrames');
    if (e.key === 'c' || e.key === 'C') run('view.toggleCalm');
    if (e.key === 't') run('arrange.tidy');
    if (e.key === 'T') run('arrange.balance'); // Shift+T
    if (e.key === '0') run('view.fit');
    if (e.key === 'l' || e.key === 'L') run('tool.link');
    if (e.key === 'v' || e.key === 'V') run('tool.select');
    if (e.key === 'a' || e.key === 'A') run('tool.anchor');
    if (e.key === 'h' || e.key === 'H') run('tool.hand');
    if (e.key === 'Escape') run('selection.clear');

    // Arrows: nudge the selection (Shift = 10px); otherwise flip pages.
    if (e.key.startsWith('Arrow')) {
      if (ctx.selectionCount > 0) {
        preventDefault();
        const s = e.shiftKey ? 10 : 1;
        // One unit is the nudge commands' own step: no argument says so.
        const step = s === 1 ? undefined : s;
        if (e.key === 'ArrowLeft') run('selection.nudgeLeft', step);
        else if (e.key === 'ArrowRight') run('selection.nudgeRight', step);
        else if (e.key === 'ArrowUp') run('selection.nudgeUp', step);
        else if (e.key === 'ArrowDown') run('selection.nudgeDown', step);
      } else if (e.key === 'ArrowRight') run('page.next');
      else if (e.key === 'ArrowLeft') run('page.prev');
    }
  })();

  // A key the old handler took without running anything would be a
  // difference worth knowing. (It would have taken a key named "Arrow…" that
  // is none of the four, with a selection; there is no such key.)
  if (took && ran.length === 0) throw new Error(`took "${e.key}" for nothing`);
  return ran;
}

/** Every key a binding names, in both cases, and keys no binding names. */
const KEYS: string[] = (() => {
  const keys = new Set<string>([
    ...[' ', 'k', 'K', 's', 'S', 'o', 'O', '1', '2', ')', '!', '@', '"'],
    ...['ç', '√', 'Ω', 'Dead', 'Tab', 'F1', 'F3', 'Shift', 'Control', 'Alt'],
    ...['Meta', 'Home', 'PageDown', ''],
  ]);
  for (const s of COMMAND_SPECS)
    for (const b of s.bindings ?? [])
      if (b.key !== undefined) {
        keys.add(b.key);
        keys.add(b.key.toLowerCase());
        keys.add(b.key.toUpperCase());
      }
  return [...keys];
})();

/** Every physical key a binding names, one it does not, and none. */
const CODES: (string | undefined)[] = (() => {
  const codes = new Set<string | undefined>([undefined, 'KeyK', 'Equal']);
  for (const s of COMMAND_SPECS)
    for (const b of s.bindings ?? []) if (b.code) codes.add(b.code);
  return [...codes];
})();

const CONTEXTS: KeyContext[] = [true, false].flatMap((focusOnCanvas) =>
  [0, 1, 3].map((selectionCount) => ({ focusOnCanvas, selectionCount })),
);

/** Every combination of key, physical key and modifiers. */
function* presses(): Generator<KeyPress> {
  const flags = [false, true];
  for (const key of KEYS)
    for (const code of CODES)
      for (const ctrlKey of flags)
        for (const metaKey of flags)
          for (const shiftKey of flags)
            for (const altKey of flags)
              yield { key, code, ctrlKey, metaKey, shiftKey, altKey };
}

const describePress = (e: KeyPress, ctx: KeyContext): string =>
  [
    e.ctrlKey && 'Ctrl',
    e.metaKey && 'Cmd',
    e.altKey && 'Alt',
    e.shiftKey && 'Shift',
    JSON.stringify(e.key),
    e.code && `[${e.code}]`,
    ctx.focusOnCanvas ? '' : 'on a control',
    `${ctx.selectionCount} selected`,
  ]
    .filter(Boolean)
    .join(' ');

/**
 * What the shell does with a press now. Space is the pan gesture, which the
 * shell reads before it asks `matchKey` (where the old handler read it);
 * everything else is `matchKey`.
 */
const dispatch = (e: KeyPress, ctx: KeyContext): KeyMatch | null =>
  e.key === ' ' ? null : matchKey(e, ctx);

describe('matchKey and the handler it replaced', () => {
  it('covers every key and physical key the table names', () => {
    for (const key of ['?', 'Delete', 'ArrowUp', 'F2', 'T', 't', '[', '_'])
      expect(KEYS).toContain(key);
    expect(CODES).toEqual(
      expect.arrayContaining(['Digit0', 'Digit1', 'Digit2', 'KeyC', 'KeyV']),
    );
  });

  it('agree on every combination of key, physical key, modifiers and context', () => {
    let compared = 0;
    const differences: string[] = [];
    for (const press of presses())
      for (const ctx of CONTEXTS) {
        compared++;
        const before = legacyHandler(press, ctx);
        const now = dispatch(press, ctx);
        // The old handler never ran two commands for one press.
        if (before.length > 1)
          differences.push(`${describePress(press, ctx)}: old ran two`);
        const was = before[0] ?? null;
        if (JSON.stringify(was) !== JSON.stringify(now))
          differences.push(
            `${describePress(press, ctx)}: was ${JSON.stringify(was)}, is ${JSON.stringify(now)}`,
          );
      }
    expect(compared).toBeGreaterThan(50_000);
    expect(differences.slice(0, 20)).toEqual([]);
  });
});

/* ── No two bindings compete for a press ───────────────────────────────── */

describe('the bindings', () => {
  interface Fit {
    id: CommandId;
    binding: KeyBinding;
    /** The press fits by the character, not (only) by the physical key. */
    byKey: boolean;
    outcome: string;
  }

  /** Every binding that fits a press, with what it would run. */
  function fits(press: KeyPress, ctx: KeyContext): Fit[] {
    const found: Fit[] = [];
    for (const s of COMMAND_SPECS)
      for (const binding of s.bindings ?? []) {
        if (!bindingMatches(binding, press, ctx)) continue;
        const byKey =
          binding.key !== undefined &&
          bindingMatches({ ...binding, code: undefined }, press, ctx);
        const args = binding.args ?? s.args;
        const outcome = JSON.stringify([s.id, binding.preventDefault, args]);
        found.push({ id: s.id, binding, byKey, outcome });
      }
    return found;
  }

  /**
   * Every pair of bindings that fit one press and would do different
   * things, as "winner > loser". `collisions` are the pairs where both fit
   * by the character they name: those would be two commands on one key.
   */
  function overlaps(): { layout: Set<string>; collisions: Set<string> } {
    const layout = new Set<string>();
    const collisions = new Set<string>();
    for (const press of presses())
      for (const ctx of CONTEXTS) {
        const all = fits(press, ctx);
        if (new Set(all.map((f) => f.outcome)).size < 2) continue;
        const won = matchKey(press, ctx)!;
        const winner = all.find(
          (f) =>
            f.outcome ===
            JSON.stringify([won.id, won.preventDefault, won.args]),
        )!;
        for (const loser of all) {
          if (loser.outcome === winner.outcome) continue;
          const pair = `${winner.id} > ${loser.id}`;
          if (winner.byKey && loser.byKey) collisions.add(pair);
          else layout.add(pair);
        }
      }
    return { layout, collisions };
  }

  const found = overlaps();

  it('never put two commands on one key', () => {
    // Same character, same modifiers, same context: that is one shortcut
    // for two commands. Keys bound twice are split by a modifier (c: Calm,
    // Ctrl+C: copy, Ctrl+Alt+C: copy format) or by context (the arrows).
    expect([...found.collisions]).toEqual([]);
  });

  it('overlap only where one names a physical key, and then in a fixed order', () => {
    // What a physical key types depends on the layout, so a binding by
    // `code` can fit a press that also types another binding's character.
    // These are all of them, each decided the way the old handler did.
    const shiftDigit = ['view.zoom100', 'view.fit', 'view.zoomToSelection'];
    const painter = ['edit.copyFormat', 'edit.pasteFormat'];
    const expected = new Set<string>();
    // 1. `?` is read first, whatever key typed it.
    for (const id of [...shiftDigit, ...painter])
      expected.add(`help.shortcuts > ${id}`);
    // 2. Shift + a digit key is read before the character it types: every
    //    plain-key binding that does not mind Shift.
    for (const winner of shiftDigit)
      for (const s of COMMAND_SPECS)
        for (const b of s.bindings ?? [])
          if (
            b.code === undefined &&
            b.mod === undefined &&
            b.shift !== undefined &&
            b.shift !== false
          )
            expected.add(`${winner} > ${s.id}`);
    // 3. The format painter is read before the other Ctrl/Cmd bindings that
    //    do not mind Alt, and copy format before paste format.
    expected.add('edit.copyFormat > edit.pasteFormat');
    for (const winner of painter)
      for (const s of COMMAND_SPECS)
        for (const b of s.bindings ?? [])
          if (b.code === undefined && b.mod === true && b.alt === 'any')
            expected.add(`${winner} > ${s.id}`);

    expect([...found.layout].sort()).toEqual([...expected].sort());
    // The losers of rule 2 are what one would guess: the plain keys.
    expect(found.layout).toContain('view.zoom100 > view.zoomIn');
    expect(found.layout).toContain('view.zoom100 > view.fit');
    expect(found.layout).toContain('view.zoomToSelection > tool.select');
    expect(found.layout).not.toContain('view.zoom100 > edit.rename');
    // …and of rule 3, the Ctrl/Cmd letters, never plain copy or paste.
    expect(found.layout).toContain('edit.copyFormat > edit.cut');
    expect(found.layout).not.toContain('edit.copyFormat > edit.copy');
    expect(found.layout).not.toContain('edit.pasteFormat > edit.paste');
  });

  it('split the arrow keys by context, on purpose', () => {
    for (const [key, nudge, page] of [
      ['ArrowLeft', 'selection.nudgeLeft', 'page.prev'],
      ['ArrowRight', 'selection.nudgeRight', 'page.next'],
    ] as const) {
      const when = (id: CommandId): (string | undefined)[] =>
        spec(id)
          .bindings!.filter((b) => b.key === key)
          .map((b) => b.when);
      expect(when(nudge)).toEqual(['hasSelection', 'hasSelection']);
      expect(when(page)).toEqual(['noSelection']);
    }
  });
});

/* ── The registry ──────────────────────────────────────────────────────── */

describe('createCommandRegistry', () => {
  const SPECS: CommandSpec[] = [
    {
      id: 'edit.undo',
      title: 'Undo',
      group: 'edit',
      bindings: [
        { key: 'z', mod: true, preventDefault: true, display: 'Ctrl/Cmd+Z' },
      ],
    },
    {
      id: 'edit.redo',
      title: 'Redo',
      group: 'edit',
      bindings: [
        {
          key: 'z',
          mod: true,
          shift: true,
          preventDefault: true,
          display: 'Ctrl/Cmd+Shift+Z',
        },
        { key: 'y', mod: true, preventDefault: true, display: 'Ctrl/Cmd+Y' },
        // A second way to the same shortcut is listed once.
        {
          code: 'KeyY',
          mod: true,
          preventDefault: true,
          display: 'Ctrl/Cmd+Y',
        },
      ],
    },
    { id: 'view.present', title: 'Present', group: 'view' },
    {
      id: 'arrange.layout.grid',
      title: 'Auto-arrange: grid',
      group: 'arrange',
      args: 'grid',
    },
    {
      id: 'edit.find',
      title: 'Find',
      group: 'edit',
      help: 'Find a node on any frame',
      bindings: [
        { key: 'f', mod: true, preventDefault: true, display: 'Ctrl/Cmd+F' },
      ],
    },
  ];

  it('refuses two commands with one id', () => {
    expect(() => createCommandRegistry([SPECS[0]!, SPECS[0]!])).toThrow(
      /duplicate command "edit.undo"/,
    );
  });

  it('binds a command once, and only a command', () => {
    const registry = createCommandRegistry(SPECS);
    registry.bind('edit.undo', { run: () => {} });
    expect(() => registry.bind('edit.undo', { run: () => {} })).toThrow(
      /"edit.undo" is already bound/,
    );
    expect(() => registry.bind('edit.undoo', { run: () => {} })).toThrow(
      /unknown command "edit.undoo"/,
    );
    expect(registry.unbound()).toEqual([
      'edit.redo',
      'view.present',
      'arrange.layout.grid',
      'edit.find',
    ]);
  });

  it('runs what is bound, and reports what it could not run', () => {
    const registry = createCommandRegistry(SPECS);
    const ran: unknown[] = [];
    // Not a command; a command nothing is bound to yet.
    expect(registry.run('nope')).toBe(false);
    expect(registry.run('edit.undo')).toBe(false);
    expect(registry.isEnabled('edit.undo')).toBe(false);
    expect(registry.isEnabled('nope')).toBe(false);

    registry.bind('edit.undo', { run: (args) => ran.push(['undo', args]) });
    expect(registry.run('edit.undo')).toBe(true);
    expect(registry.isEnabled('edit.undo')).toBe(true);
    expect(ran).toEqual([['undo', undefined]]);
  });

  it('passes the spec’s args unless the caller gives its own', () => {
    const registry = createCommandRegistry(SPECS);
    const ran: unknown[] = [];
    registry.bind('arrange.layout.grid', { run: (args) => ran.push(args) });
    registry.run('arrange.layout.grid');
    registry.run('arrange.layout.grid', 'circular');
    registry.run('arrange.layout.grid', undefined, { ignoreEnabled: true });
    // A falsy argument is still the caller's argument.
    registry.run('arrange.layout.grid', 0);
    expect(ran).toEqual(['grid', 'circular', 'grid', 0]);
  });

  it('does not run a disabled command, unless told to ignore that', () => {
    const registry = createCommandRegistry(SPECS);
    let can = false;
    let runs = 0;
    registry.bind('edit.undo', { run: () => runs++, enabled: () => can });

    expect(registry.isEnabled('edit.undo')).toBe(false);
    expect(registry.run('edit.undo')).toBe(false);
    expect(runs).toBe(0);
    // A key press: the callee decides, as it always did.
    expect(registry.run('edit.undo', undefined, { ignoreEnabled: true })).toBe(
      true,
    );
    expect(runs).toBe(1);

    can = true; // asked again each time, never cached
    expect(registry.isEnabled('edit.undo')).toBe(true);
    expect(registry.run('edit.undo')).toBe(true);
    expect(runs).toBe(2);
    // Ignoring `enabled` does not conjure a binding.
    expect(registry.run('edit.redo', undefined, { ignoreEnabled: true })).toBe(
      false,
    );
  });

  it('reports a toggle’s state, live', () => {
    const registry = createCommandRegistry(SPECS);
    let on = false;
    registry.bind('view.present', {
      run: () => {
        on = !on;
      },
      checked: () => on,
    });
    registry.bind('edit.undo', { run: () => {} });
    expect(registry.isChecked('view.present')).toBe(false);
    registry.run('view.present');
    expect(registry.isChecked('view.present')).toBe(true);
    // No `checked`, not bound, not a command: not checked.
    expect(registry.isChecked('edit.undo')).toBe(false);
    expect(registry.isChecked('edit.redo')).toBe(false);
    expect(registry.isChecked('nope')).toBe(false);
  });

  it('lets a failing command fail loudly', () => {
    const registry = createCommandRegistry(SPECS);
    registry.bind('edit.undo', {
      run: () => {
        throw new Error('boom');
      },
    });
    expect(() => registry.run('edit.undo')).toThrow('boom');
  });

  it('looks commands up and lists them, all or by group', () => {
    const registry = createCommandRegistry(SPECS);
    expect(registry.get('edit.redo')).toBe(SPECS[1]);
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.list()).toEqual(SPECS);
    expect(registry.list('edit').map((s) => s.id)).toEqual([
      'edit.undo',
      'edit.redo',
      'edit.find',
    ]);
    expect(registry.list('pages')).toEqual([]);
  });

  it('prints the first binding as the shortcut', () => {
    const registry = createCommandRegistry(SPECS);
    expect(registry.shortcutLabel('edit.undo')).toBe('Ctrl/Cmd+Z');
    expect(registry.shortcutLabel('edit.redo')).toBe('Ctrl/Cmd+Shift+Z');
    expect(registry.shortcutLabel('view.present')).toBeUndefined();
    expect(registry.shortcutLabel('nope')).toBeUndefined();

    expect(registry.titleWithShortcut('edit.undo')).toBe('Undo (Ctrl/Cmd+Z)');
    expect(registry.titleWithShortcut('edit.redo')).toBe(
      'Redo (Ctrl/Cmd+Shift+Z)',
    );
    expect(registry.titleWithShortcut('view.present')).toBe('Present');
    // A surface's own wording keeps the shortcut text in one place.
    expect(registry.titleWithShortcut('edit.undo', 'Undo the last edit')).toBe(
      'Undo the last edit (Ctrl/Cmd+Z)',
    );
    expect(registry.titleWithShortcut('view.present', 'Present all')).toBe(
      'Present all',
    );
    expect(() => registry.titleWithShortcut('nope')).toThrow(
      /unknown command "nope"/,
    );
  });

  it('builds the shortcut sheet from the bindings', () => {
    const registry = createCommandRegistry(SPECS);
    expect(registry.helpSections()).toEqual([
      {
        title: 'Edit',
        rows: [
          ['Ctrl/Cmd+Z', 'Undo'],
          ['Ctrl/Cmd+Shift+Z · Ctrl/Cmd+Y', 'Redo'],
          ['Ctrl/Cmd+F', 'Find a node on any frame'],
        ],
      },
    ]);
  });
});

/* ── The editor's own registry ─────────────────────────────────────────── */

describe('the shortcut sheet', () => {
  const registry = createCommandRegistry(COMMAND_SPECS);
  const sections = [...registry.helpSections(), ...HELP_GESTURES];
  const rows = sections.flatMap((s) => s.rows);
  /** Every shortcut on the sheet, one by one. */
  const shortcuts = new Set(
    rows.flatMap(([keys]) => keys.split(/ · | \/ /).map((k) => k.trim())),
  );

  it('has a row for every command with a binding, under its group', () => {
    const commandSections = registry.helpSections();
    expect(commandSections.map((s) => s.title)).toEqual(
      COMMAND_GROUPS.map((g) => g.title),
    );
    for (const group of COMMAND_GROUPS) {
      const bound = COMMAND_SPECS.filter(
        (s) => s.group === group.id && s.bindings?.length,
      );
      const section = commandSections.find((s) => s.title === group.title)!;
      expect(section.rows.map(([, text]) => text)).toEqual(
        bound.map((s) => s.help ?? s.title),
      );
      for (const [i, s] of bound.entries())
        for (const b of s.bindings!)
          expect(section.rows[i]![0], s.id).toContain(b.display);
    }
  });

  it('shows the same shortcut text as the tooltips', () => {
    expect(registry.titleWithShortcut('edit.undo')).toBe('Undo (Ctrl/Cmd+Z)');
    expect(registry.titleWithShortcut('edit.redo')).toBe(
      'Redo (Ctrl/Cmd+Shift+Z)',
    );
    expect(registry.titleWithShortcut('tool.select')).toBe(
      'Select/move tool (V)',
    );
    expect(registry.titleWithShortcut('tool.link')).toBe('Draw link tool (L)');
    expect(registry.titleWithShortcut('tool.anchor')).toBe(
      'Drop anchor tool (A)',
    );
    expect(registry.titleWithShortcut('view.toggleGrid')).toBe(
      'Toggle grid (R)',
    );
    expect(registry.titleWithShortcut('view.toggleSnap')).toBe(
      'Toggle snap (G)',
    );
    expect(registry.titleWithShortcut('view.fit')).toBe('Fit view (0)');
    expect(registry.titleWithShortcut('help.shortcuts')).toBe(
      'Keyboard shortcuts (?)',
    );
    expect(registry.titleWithShortcut('edit.delete', 'Delete selection')).toBe(
      'Delete selection (Del)',
    );
    expect(registry.titleWithShortcut('arrange.balance')).toBe(
      'Balance layout (Shift+T)',
    );
    expect(registry.titleWithShortcut('edit.copyFormat')).toBe(
      'Copy format (Ctrl/Cmd+Alt+C)',
    );
    expect(registry.titleWithShortcut('edit.pasteFormat')).toBe(
      'Paste format (Ctrl/Cmd+Alt+V)',
    );
  });

  it('lists every shortcut the hand-written sheet listed', () => {
    // The 41 rows of the old SHORTCUTS table, shortcut by shortcut.
    for (const shortcut of [
      // Tools
      ...['V', 'L', 'A', 'Space', 'H'],
      // Edit
      ...['Ctrl/Cmd+Z', 'Ctrl/Cmd+Shift+Z', 'Ctrl/Cmd+Y', 'Ctrl/Cmd+C'],
      ...['Ctrl/Cmd+X', 'Ctrl/Cmd+V', 'Ctrl/Cmd+Shift+V', 'F2', 'Enter'],
      ...['Ctrl/Cmd+Alt+C', 'Ctrl/Cmd+Alt+V', 'Ctrl/Cmd+D', 'Ctrl/Cmd+L'],
      ...['Del', 'Backspace', '[', ']', 'Ctrl/Cmd+[', 'Ctrl/Cmd+]'],
      // Select
      ...['Ctrl/Cmd+A', 'Shift+click', '←', '↑', '→', '↓'],
      ...['Shift+←', 'Shift+↑', 'Shift+→', 'Shift+↓'],
      // Canvas
      ...['Wheel', 'Pinch', 'Ctrl/Cmd+wheel', 'Shift+wheel', 'Middle-drag'],
      ...['+', '-', '0', 'Shift+1', 'Shift+0', 'Shift+2', 'Ctrl/Cmd+S'],
      ...['Ctrl/Cmd+O', 'Ctrl/Cmd+F', 'R', 'G', 'M', 'P', 'B', 'F', 'C', 'T'],
      ...['Shift+T', '?'],
      // Dialogs & menus
      ...['Esc', 'Tab', 'Shift+Tab', '↑↓'],
    ])
      expect(shortcuts.has(shortcut), shortcut).toBe(true);
  });

  it('lists the shortcuts that worked but were never on the sheet', () => {
    // Frames by arrow key, Escape on the canvas, = and _ to zoom.
    expect(rows).toContainEqual(['→', 'Next frame (with nothing selected)']);
    expect(rows).toContainEqual([
      '←',
      'Previous frame (with nothing selected)',
    ]);
    expect(
      rows.find(([keys, text]) => keys === 'Esc' && /selection/.test(text)),
    ).toBeDefined();
    expect(rows).toContainEqual(['+ · =', 'Zoom in']);
    expect(rows).toContainEqual(['- · _', 'Zoom out']);
    // Gestures and the keys of other surfaces.
    for (const shortcut of [
      'Ctrl/Cmd+click',
      'Double-click',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ])
      expect(shortcuts.has(shortcut), shortcut).toBe(true);
    const text = rows.map(([, description]) => description).join('\n');
    expect(text).toMatch(/hyperlink/);
    expect(text).toMatch(/Find/);
    expect(text).toMatch(/library search/);
    expect(text).toMatch(/library drag/);
    expect(text).toMatch(/save chip/);
  });

  it('does not list Ctrl/Cmd+K: nothing is bound to it yet', () => {
    expect(matchKey({ key: 'k', ctrlKey: true }, CANVAS)).toBeNull();
    expect(matchKey({ key: 'k', metaKey: true }, CANVAS)).toBeNull();
    expect([...shortcuts].some((s) => /\+K$/.test(s))).toBe(false);
  });

  it('keeps gestures out of the commands', () => {
    for (const s of COMMAND_SPECS)
      for (const b of s.bindings ?? []) {
        expect(b.key, s.id).not.toBe(' ');
        expect(b.display, s.id).not.toMatch(/click|wheel|drag|\bSpace\b/i);
      }
    for (const section of HELP_GESTURES) {
      expect(section.title).not.toBe('');
      expect(section.rows.length).toBeGreaterThan(0);
      for (const [keys, description] of section.rows) {
        expect(keys).not.toBe('');
        expect(description).not.toBe('');
      }
    }
  });
});
