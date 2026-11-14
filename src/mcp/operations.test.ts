/**
 * Operation-only tools: document setters that most diagrams never use are
 * not registered as tools (so they are not in every session's tool list) but
 * stay fully available as `edit_topology` operations, with their arguments
 * served on demand by `describe_operations`.
 */
import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTopologyTools } from './register.js';
import { OP_ONLY_TOOLS, createTools } from './tools.js';
import { TopologyStore } from './store.js';
import { renderDocumentToSVG } from '../server/render.js';
import type { TopologyDocument } from '../pages/model.js';

function setup() {
  const store = new TopologyStore();
  const tools = createTools(store, { renderDocument: renderDocumentToSVG });
  const call = (name: string, args: Record<string, unknown> = {}): unknown =>
    tools.find((t) => t.name === name)!.handler(args);
  return { store, tools, call };
}

interface Described {
  operations: {
    op: string;
    description: string;
    arguments: { properties: Record<string, unknown>; required?: string[] };
  }[];
}

describe('operation-only tools', () => {
  it('are not in the tool list a client receives', async () => {
    const server = new McpServer({ name: 't', version: '0' });
    registerTopologyTools(server, { renderDocument: renderDocumentToSVG });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const listed = (await client.listTools()).tools.map((t) => t.name);

    // Unlisted, but a call by name still works (existing scripts, and agents
    // following a hint that names the operation).
    const created = await client.callTool({
      name: 'create_topology',
      arguments: { title: 'Direct' },
    });
    const { id } = JSON.parse(
      (created.content as { text: string }[])[0]!.text,
    ) as { id: string };
    const direct = await client.callTool({
      name: 'define_tier',
      arguments: { topologyId: id, tierId: 'core', name: 'Core' },
    });
    expect(direct.isError).toBeFalsy();
    await client.close();

    expect(listed).toContain('edit_topology');
    expect(listed).toContain('describe_operations');
    for (const name of OP_ONLY_TOOLS) expect(listed).not.toContain(name);
    // edit_topology says where their arguments are.
    const edit = createTools(new TopologyStore(), {
      renderDocument: renderDocumentToSVG,
    }).find((t) => t.name === 'edit_topology')!;
    for (const name of OP_ONLY_TOOLS) expect(edit.description).toContain(name);
    expect(edit.description).toContain('describe_operations');
  });

  it('describe_operations lists every operation, cheaply', () => {
    const { call } = setup();
    const index = call('describe_operations') as {
      operations: { op: string; summary: string; tool?: true }[];
    };
    const ops = new Map(index.operations.map((o) => [o.op, o]));
    for (const name of OP_ONLY_TOOLS) {
      expect(ops.get(name)?.summary.length).toBeGreaterThan(10);
      expect(ops.get(name)?.tool).toBeUndefined();
    }
    expect(ops.get('add_node')?.tool).toBe(true);
    expect(JSON.stringify(index).length).toBeLessThan(3_500);
  });

  it('describe_operations returns the argument schema of each one', () => {
    const { call } = setup();
    const described = call('describe_operations', {
      operations: [...OP_ONLY_TOOLS],
    }) as Described;
    expect(described.operations.map((o) => o.op)).toEqual([...OP_ONLY_TOOLS]);
    for (const o of described.operations) {
      expect(o.description.length).toBeGreaterThan(20);
      expect(Object.keys(o.arguments.properties).length).toBeGreaterThan(0);
      // Inherited from the edit_topology call, so not an operation argument.
      expect(o.arguments.properties).not.toHaveProperty('topologyId');
      expect(o.arguments.required ?? []).not.toContain('topologyId');
    }
    const sheet = described.operations.find((o) => o.op === 'set_sheet')!;
    expect(sheet.arguments.properties).toHaveProperty('size');
    expect(() => call('describe_operations', { operations: ['nope'] })).toThrow(
      /unknown operation "nope"/,
    );
  });

  it('every one runs as an edit_topology operation', () => {
    const { call, store } = setup();
    const { id } = call('create_topology', { title: 'Ops' }) as { id: string };
    const result = call('edit_topology', {
      topologyId: id,
      operations: [
        { op: 'add_node', type: 'switch', x: 300, y: 300, nodeId: 'sw' },
        { op: 'set_legend', show: true, position: 'br' },
        { op: 'set_palette', accent: '#FF8800' },
        { op: 'set_sheet', size: 'a3' },
        { op: 'define_link_style', styleId: 'fibre', color: '#3366ff' },
        { op: 'define_tier', tierId: 'core', name: 'Core' },
        { op: 'define_bundle', bundleId: 'lag1' },
        { op: 'set_port_table', nodeIds: ['sw'] },
        {
          op: 'define_node_type',
          spec: { typeName: 'sensor', colorStroke: '#65aef9' },
        },
        { op: 'set_node_metadata', nodeId: 'sw', meta: { serial: 'SN1' } },
      ],
    }) as { applied: number };
    expect(result.applied).toBe(10);

    const doc: TopologyDocument = store.get(id);
    expect(doc.legend).toMatchObject({ show: true, position: 'br' });
    expect(doc.palette?.accent).toBe('#ff8800');
    expect(doc.sheet).toMatchObject({ size: 'a3' });
    expect(doc.linkStyles?.map((s) => s.id)).toContain('fibre');
    expect(doc.tiers?.map((t) => t.id)).toContain('core');
    expect(doc.bundles?.map((b) => b.id)).toContain('lag1');
    expect(doc.customNodes.map((n) => n.typeName)).toContain('sensor');
    const sw = doc.pages[0]!.nodes.find((n) => n.id === 'sw')!;
    expect(sw.portTable).toBeTruthy();
    expect(sw.meta).toMatchObject({ serial: 'SN1' });
  });

  it('a bad argument on one names the operation and leaves the document alone', () => {
    const { call, store } = setup();
    const { id } = call('create_topology', {}) as { id: string };
    expect(() =>
      call('edit_topology', {
        topologyId: id,
        operations: [
          { op: 'set_legend', show: true },
          { op: 'set_sheet', size: 'not-a-size' },
        ],
      }),
    ).toThrow(/operations\[1\] \(set_sheet\)/);
    expect(store.get(id).legend).toBeUndefined(); // atomic
  });
});
