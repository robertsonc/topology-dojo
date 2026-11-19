import { describe, expect, it } from 'vitest';
import { listTemplates } from '../api/templates.js';
import { rankEntries } from './command-palette.js';
import {
  COMMAND_SPECS,
  createCommandRegistry,
  templateCommandSpecs,
  type CommandId,
} from './commands.js';
import {
  pageName,
  paletteEntries,
  type PalettePage,
  type PaletteSources,
} from './palette-sources.js';

const SPECS = [...COMMAND_SPECS, ...templateCommandSpecs(listTemplates())];

const PAGES: PalettePage[] = [
  {
    name: 'Overview',
    nodes: [
      { id: 'fw', label: 'SRX', type: 'firewall' },
      { id: 'sw', label: '', type: 'switch' },
    ],
    links: [
      { id: 'l1', label: '', type: 'ethernet', from: 'fw', to: 'sw' },
      { id: 'l2', label: 'Uplink', type: 'fiber', from: 'sw', to: 'fw' },
    ],
    zones: [{ id: 'z1', label: 'DMZ' }],
  },
  {
    nodes: [{ id: 'app', label: 'App\nserver', type: 'server' }],
    links: [],
  },
];

function sources(over: Partial<PaletteSources> = {}) {
  const commands = createCommandRegistry(SPECS);
  const log: string[] = [];
  const off = new Set<string>(['edit.undo', 'file.share']);
  for (const spec of SPECS)
    commands.bind(spec.id, {
      run: () => log.push(`run ${spec.id}`),
      enabled: () => !off.has(spec.id),
    });
  const src: PaletteSources = {
    commands,
    open: { pathAnalysis: false, sharedCopy: false, otherTabVersion: false },
    nodeTypes: [
      { type: 'firewall', label: 'Firewall', category: 'Security' },
      {
        type: 'server',
        label: 'Server',
        category: 'Compute',
        keywords: ['host'],
      },
    ],
    pages: PAGES,
    current: 1,
    addNode: (type) => log.push(`add ${type}`),
    goToElement: (i, kind, id) => log.push(`go ${i} ${kind} ${id}`),
    goToPage: (i) => log.push(`page ${i}`),
    ...over,
  };
  return { src, log };
}

const titles = (src: PaletteSources): string[] =>
  paletteEntries(src).map((e) => e.title);

describe('the command palette lists', () => {
  it('every command that can run now, by title, group and shortcut', () => {
    const { src, log } = sources();
    const entries = paletteEntries(src);
    const byId = (id: CommandId) =>
      entries.find((e) => e.id === `command:${id}`);
    expect(byId('edit.copy')).toMatchObject({
      title: 'Copy',
      group: 'Edit',
      hint: 'Ctrl/Cmd+C',
    });
    expect(byId('view.toggleGrid')?.group).toBe('View');
    // Not enabled now: not listed. Nor the palette itself.
    expect(byId('edit.undo')).toBeUndefined();
    expect(byId('file.share')).toBeUndefined();
    expect(byId('help.commandPalette')).toBeUndefined();
    byId('edit.copy')!.run();
    expect(log).toEqual(['run edit.copy']);
    // The commands come first, in the registry's order.
    const commandIds = entries
      .filter((e) => e.id.startsWith('command:'))
      .map((e) => e.id.slice('command:'.length));
    const order = SPECS.map((s) => s.id as string).filter((id) =>
      commandIds.includes(id),
    );
    expect(commandIds).toEqual(order);
    expect(entries[0]!.id.startsWith('command:')).toBe(true);
  });

  it('the commands of a surface only while it is open', () => {
    const ids = (src: PaletteSources): string[] =>
      paletteEntries(src).map((e) => e.id);
    const closed = ids(sources().src);
    for (const id of [
      'path.next',
      'path.close',
      'shared.keepCopy',
      'shared.backToMine',
      'file.loadOtherTab',
    ])
      expect(closed, id).not.toContain(`command:${id}`);
    const open = ids(
      sources({
        open: { pathAnalysis: true, sharedCopy: true, otherTabVersion: true },
      }).src,
    );
    for (const id of ['path.next', 'shared.keepCopy', 'file.loadOtherTab'])
      expect(open, id).toContain(`command:${id}`);
  });

  it('"Add <node type>" for each type of the library', () => {
    const { src, log } = sources();
    const adds = paletteEntries(src).filter((e) => e.id.startsWith('add:'));
    expect(adds.map((e) => [e.title, e.group])).toEqual([
      ['Add Firewall', 'Add node'],
      ['Add Server', 'Add node'],
    ]);
    expect(adds[1]!.keywords).toEqual(['server', 'Compute', 'host']);
    adds[0]!.run();
    expect(log).toEqual(['add firewall']);
  });

  it('"Go to <label>" for the elements of every page, the current one first', () => {
    const { src, log } = sources();
    const gos = paletteEntries(src).filter((e) =>
      /^(node|link|zone):/.test(e.id),
    );
    // The group says what the element is and where.
    expect(gos.map((e) => [e.title, e.group])).toEqual([
      ['Go to App server', 'server · Page 2'],
      ['Go to SRX', 'firewall · Page 1 · Overview'],
      // No label: the id.
      ['Go to sw', 'switch · Page 1 · Overview'],
      // A link with no label is named by its ends.
      ['Go to SRX — sw', 'ethernet link · Page 1 · Overview'],
      ['Go to Uplink', 'fiber link · Page 1 · Overview'],
      ['Go to DMZ', 'zone · Page 1 · Overview'],
    ]);
    expect(gos.every((e) => e.hint === undefined)).toBe(true);
    gos[1]!.run();
    gos[3]!.run();
    gos[5]!.run();
    expect(log).toEqual(['go 0 node fw', 'go 0 link l1', 'go 0 zone z1']);
  });

  it('"Go to page N · name" for each page', () => {
    const { src, log } = sources();
    const pages = paletteEntries(src).filter((e) => e.id.startsWith('page:'));
    expect(pages.map((e) => e.title)).toEqual([
      'Go to page 1 · Overview',
      'Go to page 2',
    ]);
    pages[1]!.run();
    expect(log).toEqual(['page 1']);
    expect(pageName({ name: '  ', nodes: [], links: [] }, 4)).toBe('Page 5');
  });

  it('entries a query finds in the expected order', () => {
    const { src } = sources();
    const top = (q: string): string[] =>
      rankEntries(q, paletteEntries(src))
        .slice(0, 3)
        .map((r) => r.entry.title);
    expect(top('srx')[0]).toBe('Go to SRX');
    expect(top('add fire')[0]).toBe('Add Firewall');
    expect(top('page 2')).toContain('Go to page 2');
    expect(titles(src)).toContain('Toggle grid');
  });

  it('gives every entry an id of its own', () => {
    const ids = paletteEntries(sources().src).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
