/**
 * Arguments a tool does not list are never dropped silently: they are moved
 * to where they belong, or refused with a message that says what to change.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { admitArgs } from './args.js';
import { registerTopologyTools } from './register.js';
import { createTools, type ToolDef } from './tools.js';
import { TopologyStore } from './store.js';
import { renderDocumentToSVG } from '../server/render.js';

describe('admitArgs', () => {
  let tools: ToolDef[];
  const tool = (name: string): ToolDef => tools.find((t) => t.name === name)!;
  beforeEach(() => {
    tools = createTools(new TopologyStore(), {
      renderDocument: renderDocumentToSVG,
    });
  });

  it('returns the same object when every argument is one the tool takes', () => {
    const args = { topologyId: 't', type: 'router', x: 1, y: 2 };
    expect(admitArgs(tool('add_node'), args)).toBe(args);
  });

  it('moves node fields written beside add_node arguments into extra', () => {
    const out = admitArgs(tool('add_node'), {
      topologyId: 't',
      type: 'router',
      x: 1,
      y: 2,
      status: 'down',
      labelPlacement: 'n',
      href: 'https://example.com',
    });
    expect(out).toEqual({
      topologyId: 't',
      type: 'router',
      x: 1,
      y: 2,
      extra: {
        status: 'down',
        labelPlacement: 'n',
        href: 'https://example.com',
      },
    });
  });

  it('keeps an explicit extra entry over the same field beside it', () => {
    const out = admitArgs(tool('add_link'), {
      topologyId: 't',
      type: 'line',
      from: 'a',
      to: 'b',
      vlan: '100',
      extra: { vlan: '200', bandwidth: '10G' },
    });
    expect(out.extra).toEqual({ vlan: '200', bandwidth: '10G' });
  });

  it('refuses an argument that is nothing the tool knows, with the nearest real one', () => {
    expect(() =>
      admitArgs(tool('add_node'), {
        topologyId: 't',
        type: 'router',
        x: 1,
        y: 2,
        nodeid: 'core',
      }),
    ).toThrow(
      'invalid arguments for add_node — unknown argument "nodeid" (did you mean "nodeId"?). Accepted: topologyId, pageIndex, type,',
    );
  });

  it('says what to do with a field the add tool cannot take', () => {
    expect(() =>
      admitArgs(tool('add_zone'), {
        topologyId: 't',
        nodes: ['a'],
        backdrop: 'europe',
      }),
    ).toThrow(
      '"backdrop" is a zone field that add_zone does not take: add the element, then set it with update_element',
    );
  });

  it('refuses an argument on a tool with no such argument at all', () => {
    expect(() =>
      admitArgs(tool('render_svg'), { topologyId: 't', page: 1 }),
    ).toThrow(/unknown argument "page" \(did you mean "pageIndex"\?\)/);
  });
});

describe('through the server', () => {
  async function connect(): Promise<{ client: Client; store: TopologyStore }> {
    const server = new McpServer({ name: 'args', version: '0' });
    const store = registerTopologyTools(server, {
      renderDocument: renderDocumentToSVG,
    });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'args', version: '0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    return { client, store };
  }
  const text = (result: unknown): string =>
    (result as { content: { text: string }[] }).content[0]!.text;

  it('a field beside the arguments reaches the element instead of vanishing', async () => {
    const { client, store } = await connect();
    const created = await client.callTool({
      name: 'create_topology',
      arguments: { title: 'T' },
    });
    const id = (JSON.parse(text(created)) as { id: string }).id;
    const added = await client.callTool({
      name: 'add_node',
      arguments: {
        topologyId: id,
        type: 'router',
        x: 100,
        y: 100,
        nodeId: 'core',
        status: 'down',
      },
    });
    expect(added.isError).toBeFalsy();
    expect(store.get(id).pages[0]!.nodes[0]).toMatchObject({
      id: 'core',
      status: 'down',
    });
  });

  it('an unknown argument is an error the agent can act on, and nothing is written', async () => {
    const { client, store } = await connect();
    const created = await client.callTool({
      name: 'create_topology',
      arguments: { title: 'T' },
    });
    const id = (JSON.parse(text(created)) as { id: string }).id;
    const result = await client.callTool({
      name: 'add_node',
      arguments: { topologyId: id, type: 'router', x: 1, y: 2, lable: 'Core' },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      'unknown argument "lable" (did you mean "label"?)',
    );
    expect(store.get(id).pages[0]!.nodes).toHaveLength(0);
  });

  it('a batch names the operation, and applies nothing', async () => {
    const { client, store } = await connect();
    const created = await client.callTool({
      name: 'create_topology',
      arguments: { title: 'T' },
    });
    const id = (JSON.parse(text(created)) as { id: string }).id;
    const result = await client.callTool({
      name: 'edit_topology',
      arguments: {
        topologyId: id,
        operations: [
          {
            op: 'add_node',
            type: 'router',
            x: 1,
            y: 2,
            nodeId: 'a',
            status: 'ok',
          },
          {
            op: 'add_node',
            type: 'router',
            x: 9,
            y: 2,
            nodeId: 'b',
            colour: 'red',
          },
        ],
      },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain(
      'operations[1] (add_node): unknown argument "colour" (did you mean "color"?)',
    );
    expect(store.get(id).pages[0]!.nodes).toHaveLength(0);
  });

  it('a batch page index is not forced on operations that have no page', async () => {
    const { client, store } = await connect();
    const created = await client.callTool({
      name: 'create_topology',
      arguments: { title: 'T' },
    });
    const id = (JSON.parse(text(created)) as { id: string }).id;
    const result = await client.callTool({
      name: 'edit_topology',
      arguments: {
        topologyId: id,
        pageIndex: 0,
        operations: [
          { op: 'define_layer', layerId: 'overlay', kind: 'overlay' },
          { op: 'add_node', type: 'router', x: 1, y: 2, nodeId: 'a' },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(store.get(id).layers?.map((l) => l.id)).toEqual(['overlay']);
  });
});
