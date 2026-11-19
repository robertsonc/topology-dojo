/**
 * What the command palette (Ctrl / Cmd + K) lists: the registry's commands
 * that can run now, one "Add <node type>" per type of the node library,
 * one "Go to <label>" per node, link and zone on any page, and one
 * "Go to page N · name" per page.
 *
 * Pure: no DOM and nothing of the editor. The shell passes what the palette
 * draws from and the functions that do the work (add a node, jump to an
 * element or a page), and `openCommandPalette` (./command-palette.ts) ranks
 * and shows the entries.
 *
 * A command whose surface is not open is left out even when the registry
 * says it can run, because it would do nothing: the path bar's commands
 * (`path.*`) without path analysis, the shared copy's (`shared.*`) without
 * one, and loading another tab's version (`file.loadOtherTab`) while the
 * save chip does not offer it. The palette does not list itself.
 */
import type { PaletteEntry } from './command-palette.js';
import {
  COMMAND_GROUPS,
  type CommandId,
  type CommandRegistry,
} from './commands.js';
import type { IconName } from './icons.js';

/** One page, as far as the palette reads it. */
export interface PalettePage {
  readonly name?: string;
  readonly nodes: readonly {
    readonly id: string;
    readonly label?: string;
    readonly type: string;
  }[];
  readonly links: readonly {
    readonly id: string;
    readonly label?: string;
    readonly type: string;
    readonly from: string;
    readonly to: string;
  }[];
  readonly zones?: readonly { readonly id: string; readonly label?: string }[];
}

export interface PaletteSources {
  readonly commands: Pick<
    CommandRegistry<CommandId>,
    'list' | 'run' | 'isEnabled' | 'shortcutLabel'
  >;
  /** Which surfaces with commands of their own are open now. */
  readonly open: {
    readonly pathAnalysis: boolean;
    readonly sharedCopy: boolean;
    readonly otherTabVersion: boolean;
  };
  /** The node library's types, in library order. */
  readonly nodeTypes: readonly {
    readonly type: string;
    readonly label: string;
    readonly category: string;
    readonly keywords?: readonly string[];
  }[];
  readonly pages: readonly PalettePage[];
  /** The index of the page on screen: its elements are listed first. */
  readonly current: number;
  /** Place a node of `type` at the centre of the view. */
  readonly addNode: (type: string) => void;
  /** Go to the element's page and select it. */
  readonly goToElement: (
    pageIndex: number,
    kind: 'node' | 'link' | 'zone',
    id: string,
  ) => void;
  readonly goToPage: (pageIndex: number) => void;
  /** The markup of an icon (src/ui/icons.ts `icon`). Left out: no icons. */
  readonly icon?: (name: IconName) => string;
}

/** Text on one line, trimmed. */
const oneLine = (text: string | undefined): string =>
  (text ?? '').replace(/\s+/g, ' ').trim();

/** What a page is called in the palette: "Page 2 · Branch", or "Page 2". */
export function pageName(page: PalettePage, index: number): string {
  const name = oneLine(page.name);
  return name ? `Page ${index + 1} · ${name}` : `Page ${index + 1}`;
}

/** Whether a command belongs in the palette now (enabled aside). */
function offered(id: string, open: PaletteSources['open']): boolean {
  if (id === 'help.commandPalette') return false;
  if (id.startsWith('path.')) return open.pathAnalysis;
  if (id.startsWith('shared.')) return open.sharedCopy;
  if (id === 'file.loadOtherTab') return open.otherTabVersion;
  return true;
}

function commandEntries(src: PaletteSources): PaletteEntry[] {
  const { commands } = src;
  return commands
    .list()
    .filter((s) => offered(s.id, src.open) && commands.isEnabled(s.id))
    .map((s) => {
      const entry: PaletteEntry = {
        id: `command:${s.id}`,
        title: s.title,
        run: () => void commands.run(s.id),
      };
      const group = COMMAND_GROUPS.find((g) => g.id === s.group)?.title;
      if (group !== undefined) entry.group = group;
      const hint = commands.shortcutLabel(s.id);
      if (hint !== undefined) entry.hint = hint;
      if (s.keywords) entry.keywords = s.keywords;
      if (s.icon !== undefined && src.icon) entry.iconHtml = src.icon(s.icon);
      return entry;
    });
}

function addEntries(src: PaletteSources): PaletteEntry[] {
  return src.nodeTypes.map((t) => ({
    id: `add:${t.type}`,
    title: `Add ${t.label}`,
    group: 'Add node',
    keywords: [t.type, t.category, ...(t.keywords ?? [])],
    run: () => src.addNode(t.type),
  }));
}

/** The pages in the order their elements are listed: the current one first. */
function pageOrder(src: PaletteSources): number[] {
  const all = src.pages.map((_, i) => i);
  if (src.current < 0 || src.current >= src.pages.length) return all;
  return [src.current, ...all.filter((i) => i !== src.current)];
}

function elementEntries(src: PaletteSources): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (const pageIndex of pageOrder(src)) {
    const page = src.pages[pageIndex]!;
    const where = pageName(page, pageIndex);
    const nameOf = (id: string): string =>
      oneLine(page.nodes.find((n) => n.id === id)?.label) || id;
    const go =
      (kind: 'node' | 'link' | 'zone', id: string): (() => void) =>
      () =>
        src.goToElement(pageIndex, kind, id);
    for (const n of page.nodes)
      out.push({
        id: `node:${pageIndex}:${n.id}`,
        title: `Go to ${oneLine(n.label) || n.id}`,
        group: `${n.type} · ${where}`,
        keywords: [n.id, n.type],
        run: go('node', n.id),
      });
    for (const l of page.links)
      out.push({
        id: `link:${pageIndex}:${l.id}`,
        // A link with no label of its own is named by its two ends, as Find
        // names it.
        title: `Go to ${oneLine(l.label) || `${nameOf(l.from)} — ${nameOf(l.to)}`}`,
        group: `${l.type} link · ${where}`,
        keywords: [l.id, l.type],
        run: go('link', l.id),
      });
    for (const z of page.zones ?? [])
      out.push({
        id: `zone:${pageIndex}:${z.id}`,
        title: `Go to ${oneLine(z.label) || z.id}`,
        group: `zone · ${where}`,
        keywords: [z.id],
        run: go('zone', z.id),
      });
  }
  return out;
}

function pageEntries(src: PaletteSources): PaletteEntry[] {
  return src.pages.map((page, i) => ({
    id: `page:${i}`,
    title: `Go to ${pageName(page, i).replace(/^Page/, 'page')}`,
    group: 'Pages',
    run: () => src.goToPage(i),
  }));
}

/**
 * Everything the palette lists, in the order it shows them before anything
 * is typed (and within a rank once something is): the commands, the pages,
 * the node types, then the elements.
 */
export function paletteEntries(src: PaletteSources): PaletteEntry[] {
  return [
    ...commandEntries(src),
    ...pageEntries(src),
    ...addEntries(src),
    ...elementEntries(src),
  ];
}
