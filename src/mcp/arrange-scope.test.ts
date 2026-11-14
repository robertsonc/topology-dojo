/**
 * The arrange tools take a page scope. Without one, an agent tidying one
 * messy page of a multi-page document also rearranged every other page,
 * hand-placed ones included.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { TopologyStore } from './store.js';
import { createTools, type ToolDef } from './tools.js';
import { renderDocumentToSVG } from '../server/render.js';

describe('arrange tools: page scope', () => {
  let store: TopologyStore;
  let tools: ToolDef[];
  let id: string;
  const call = (name: string, args: Record<string, unknown> = {}): unknown =>
    tools.find((t) => t.name === name)!.handler(args);
  /** `id@x,y` of every node, page by page. */
  const positions = (): string[] =>
    store
      .get(id)
      .pages.map((p) => p.nodes.map((n) => `${n.id}@${n.x},${n.y}`).join(' '));

  beforeEach(() => {
    store = new TopologyStore();
    tools = createTools(store, { renderDocument: renderDocumentToSVG });
    id = (call('create_topology', { title: 'Scope' }) as { id: string }).id;
    call('edit_topology', {
      topologyId: id,
      operations: [
        // Page 0: placed by hand, off the grid, nothing wrong with it.
        { op: 'add_node', type: 'router', x: 203, y: 197, nodeId: 'p0a' },
        { op: 'add_node', type: 'router', x: 707, y: 523, nodeId: 'p0b' },
        { op: 'add_link', type: 'line', from: 'p0a', to: 'p0b' },
        // Page 1: two nodes piled on each other.
        { op: 'add_page', name: 'messy' },
        { op: 'add_node', type: 'router', x: 300, y: 300, nodeId: 'p1a' },
        { op: 'add_node', type: 'router', x: 305, y: 305, nodeId: 'p1b' },
        { op: 'add_link', type: 'line', from: 'p1a', to: 'p1b' },
      ],
    });
  });

  const TOOLS: [string, Record<string, unknown>][] = [
    ['tidy_topology', {}],
    ['balance_topology', {}],
    ['layout_topology', { algorithm: 'grid' }],
  ];

  it.each(TOOLS)(
    '%s with pageIndex leaves the other page alone',
    (name, args) => {
      const [page0] = positions();
      call(name, { topologyId: id, pageIndex: 1, ...args });
      const after = positions();
      expect(after[0]).toBe(page0);
      expect(after[1]).not.toBe('p1a@300,300 p1b@305,305');
    },
  );

  it.each(TOOLS)(
    '%s without pageIndex still arranges every page',
    (name, args) => {
      const before = positions();
      call(name, { topologyId: id, ...args });
      const after = positions();
      expect(after[0]).not.toBe(before[0]);
      expect(after[1]).not.toBe(before[1]);
    },
  );

  it.each(TOOLS)('%s rejects a page that does not exist', (name, args) => {
    expect(() => call(name, { topologyId: id, pageIndex: 7, ...args })).toThrow(
      'no page at index 7 (the document has 2)',
    );
  });
});
