/**
 * The element tools refuse what is wrong at the moment of the call, and say
 * what would be right, instead of succeeding and leaving it for
 * validate_topology to find later.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { TopologyStore } from './store.js';
import { createTools, type ToolDef } from './tools.js';
import { renderDocumentToSVG } from '../server/render.js';

describe('write-time checks', () => {
  let store: TopologyStore;
  let tools: ToolDef[];
  let id: string;
  const call = (name: string, args: Record<string, unknown> = {}): unknown =>
    tools.find((t) => t.name === name)!.handler({ topologyId: id, ...args });
  const page = () => store.get(id).pages[0]!;

  beforeEach(() => {
    store = new TopologyStore();
    tools = createTools(store, { renderDocument: renderDocumentToSVG });
    id = (
      tools
        .find((t) => t.name === 'create_topology')!
        .handler({
          title: 'T',
        }) as { id: string }
    ).id;
    call('add_node', { type: 'router', x: 200, y: 200, nodeId: 'a' });
    call('add_node', { type: 'router', x: 500, y: 200, nodeId: 'b' });
    call('add_link', { type: 'line', from: 'a', to: 'b', linkId: 'ab' });
  });

  it.each([
    [
      'a node type nobody defined',
      'add_node',
      { type: 'quantum-router', x: 1, y: 1 },
      'unknown node type "quantum-router" — use a type from describe_capabilities, or declare it first with define_node_type. Closest: router',
    ],
    [
      'a node id already in use',
      'add_node',
      { type: 'router', x: 1, y: 1, nodeId: 'a' },
      'id "a" is already used by a node on this page',
    ],
    [
      'an id used by an element of another kind',
      'add_node',
      { type: 'router', x: 1, y: 1, nodeId: 'ab' },
      'id "ab" is already used by a link on this page',
    ],
    [
      'a link type that does not exist',
      'add_link',
      { type: 'wormhole', from: 'a', to: 'b' },
      'unknown link type "wormhole" — one of line, tunnel,',
    ],
    [
      'a link to a node that is not there',
      'add_link',
      { type: 'line', from: 'a', to: 'ghost' },
      'link end "ghost" is not on this page — add the node (or anchor) first',
    ],
    [
      'a link from an element to itself',
      'add_link',
      { type: 'line', from: 'a', to: 'a' },
      'a link cannot start and end on the same element ("a")',
    ],
    [
      'a link ending on a link',
      'add_link',
      { type: 'line', from: 'a', to: 'ab' },
      'link end "ab" is a link, not a node or an anchor',
    ],
    [
      'a flow path with one waypoint',
      'add_flow_path',
      { waypoints: ['a'] },
      'a flow path needs at least two waypoints (got 1)',
    ],
    [
      'a flow path through a node that is not there',
      'add_flow_path',
      { waypoints: ['a', 'ghost'] },
      'waypoint "ghost" is not on this page',
    ],
    [
      'a zone around a node that is not there',
      'add_zone',
      { nodes: ['a', 'ghost'] },
      'zone member "ghost" is not a node on this page',
    ],
    [
      'a marker on a node that is not there',
      'add_policy_marker',
      { nodeId: 'ghost', type: 'inspect' },
      'nodeId "ghost" is not a node on this page',
    ],
    [
      'retyping a node to a type nobody defined',
      'update_element',
      { elementId: 'a', set: { type: 'nope' } },
      'unknown node type "nope"',
    ],
    [
      'moving a link end to a node that is not there',
      'update_element',
      { elementId: 'ab', set: { to: 'ghost' } },
      'link end "ghost" is not on this page',
    ],
  ])('refuses %s', (_what, tool, args, message) => {
    const before = JSON.stringify(page());
    expect(() => call(tool, args)).toThrow(message);
    expect(JSON.stringify(page())).toBe(before);
  });

  it('accepts what is right: anchors as ends, custom types, generated ids', () => {
    call('add_anchor', { x: 300, y: 400, anchorId: 'k' });
    call('add_link', { type: 'line', from: 'a', to: 'k' });
    call('add_flow_path', { waypoints: ['a', 'k', 'b'] });
    call('edit_topology', {
      operations: [
        { op: 'define_node_type', spec: { typeName: 'sensor' } },
        { op: 'add_node', type: 'sensor', x: 700, y: 400 },
      ],
    });
    expect(page().nodes.map((n) => n.type)).toContain('sensor');
    expect(page().links).toHaveLength(2);
  });

  it('a batch names the operation that failed, and applies nothing', () => {
    expect(() =>
      call('edit_topology', {
        operations: [
          { op: 'add_node', type: 'router', x: 700, y: 200, nodeId: 'c' },
          { op: 'add_link', type: 'line', from: 'c', to: 'ghost' },
        ],
      }),
    ).toThrow('operations[1] (add_link): link end "ghost" is not on this page');
    expect(page().nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('a later operation can use an id an earlier one created', () => {
    call('edit_topology', {
      operations: [
        { op: 'add_node', type: 'router', x: 700, y: 200, nodeId: 'c' },
        { op: 'add_link', type: 'line', from: 'b', to: 'c', linkId: 'bc' },
      ],
    });
    expect(page().links.map((l) => l.id)).toEqual(['ab', 'bc']);
  });
});

describe('an edit or removal without pageIndex goes to the page that has the element', () => {
  let store: TopologyStore;
  let tools: ToolDef[];
  let id: string;
  const call = (name: string, args: Record<string, unknown> = {}): unknown =>
    tools.find((t) => t.name === name)!.handler({ topologyId: id, ...args });

  beforeEach(() => {
    store = new TopologyStore();
    tools = createTools(store, { renderDocument: renderDocumentToSVG });
    id = (
      tools
        .find((t) => t.name === 'create_topology')!
        .handler({
          title: 'T',
        }) as { id: string }
    ).id;
    call('add_node', { type: 'router', x: 200, y: 200, nodeId: 'a' });
    call('add_node', { type: 'router', x: 500, y: 200, nodeId: 'b' });
    call('add_link', { type: 'line', from: 'a', to: 'b', linkId: 'ab' });
    // The newest page is now an empty one: the add tools' default.
    call('add_page', { name: 'Page two' });
  });

  it('update_element finds the element on the earlier page', () => {
    call('update_element', { elementId: 'a', set: { label: 'Renamed' } });
    expect(store.get(id).pages[0]!.nodes[0]!.label).toBe('Renamed');
  });

  it('remove_element finds it too', () => {
    call('remove_element', { elementId: 'ab' });
    expect(store.get(id).pages[0]!.links).toEqual([]);
  });

  it('asks which page when the id is on more than one', () => {
    call('add_node', { type: 'router', x: 200, y: 200, nodeId: 'a' });
    expect(() =>
      call('update_element', { elementId: 'a', set: { label: 'x' } }),
    ).toThrow('"a" is on pages 0, 1 — pass pageIndex to say which');
    call('update_element', {
      elementId: 'a',
      pageIndex: 1,
      set: { label: 'x' },
    });
    expect(store.get(id).pages.map((p) => p.nodes[0]!.label)).toEqual([
      undefined,
      'x',
    ]);
  });

  it('an id on no page is still reported as unknown', () => {
    expect(() =>
      call('update_element', { elementId: 'ghost', set: { label: 'x' } }),
    ).toThrow(/unknown element "ghost"/);
  });
});

describe('validate_topology on a document with very many findings', () => {
  it('lists errors first, stops at the cap and reports the true totals', () => {
    const store = new TopologyStore();
    const tools = createTools(store, { renderDocument: renderDocumentToSVG });
    const call = (name: string, args: Record<string, unknown>): unknown =>
      tools.find((t) => t.name === name)!.handler(args);
    // 40 nodes piled on one spot (hundreds of overlap warnings), and one
    // dangling link imported as a whole document (an error).
    const nodes = Array.from({ length: 40 }, (_, i) => ({
      id: `n${i}`,
      type: 'router',
      x: 300,
      y: 300,
    }));
    const { id } = call('import_topology', {
      json: {
        title: 'Pile',
        customNodes: [],
        pages: [
          {
            id: 'p1',
            name: 'F',
            viewBox: '0 0 1000 700',
            nodes,
            links: [{ id: 'l', type: 'line', from: 'n0', to: 'ghost' }],
            anchors: [],
            zones: [],
            flowPaths: [],
            policyMarkers: [],
          },
        ],
      },
    }) as { id: string };
    const v = call('validate_topology', { topologyId: id }) as {
      valid: boolean;
      problems: { level: string }[];
      omitted?: number;
      counts?: { errors: number; warnings: number };
    };
    expect(v.valid).toBe(false);
    expect(v.problems).toHaveLength(60);
    expect(v.problems[0]!.level).toBe('error');
    expect(v.omitted).toBe(v.counts!.errors + v.counts!.warnings - 60);
    expect(v.counts!.errors).toBeGreaterThanOrEqual(1);
    expect(v.counts!.warnings).toBeGreaterThan(60);
  });

  it('a short list is returned whole, with no extra fields', () => {
    const store = new TopologyStore();
    const tools = createTools(store, { renderDocument: renderDocumentToSVG });
    const { id } = tools
      .find((t) => t.name === 'create_topology')!
      .handler({
        title: 'T',
      }) as { id: string };
    const v = tools
      .find((t) => t.name === 'validate_topology')!
      .handler({ topologyId: id }) as Record<string, unknown>;
    expect(Object.keys(v).sort()).toEqual(['layoutClean', 'problems', 'valid']);
  });
});
