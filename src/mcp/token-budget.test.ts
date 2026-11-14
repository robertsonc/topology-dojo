/**
 * Token budget for the MCP surface.
 *
 * Every connected agent pays for the whole `tools/list` payload — names,
 * descriptions and input schemas — in its context before it does anything,
 * and pays for `describe_capabilities` on its first call. Both grow a little
 * with each feature and nothing else pushes back: the full hosted tool list
 * went from 44 KB (55 tools) in August 2026 to 79 KB (72 tools) by November,
 * and was brought back to 67 KB (64 tools) by making rarely used document
 * setters `edit_topology` operations (see `OP_ONLY_TOOLS`).
 *
 * These are ratchets, not targets. When one fails, first try to make room
 * (shorten a description, fold a setter into `edit_topology`, move prose into
 * `describe_capabilities`, which is read on demand). Raise a limit only on
 * purpose, in the PR that needs it, and say why there.
 */
import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTopologyTools } from './register.js';
import { createTools, type ToolDeps } from './tools.js';
import { TopologyStore } from './store.js';
import { renderDocumentToSVG } from '../server/render.js';

/** A dependency that is present (so its tools register) and never called. */
const present = new Proxy(
  {},
  { get: () => () => ({ id: 'x', name: 'x', displayName: 'x' }) },
) as never;

const STDIO: ToolDeps = { renderDocument: renderDocumentToSVG };
/** Every optional tool group at once: the largest list any agent can see. */
const EVERYTHING: ToolDeps = {
  renderDocument: renderDocumentToSVG,
  rasterizer: present,
  catalog: present,
  publishTopology: present,
  unpublishTopology: present,
  listShares: present,
  provider: present,
  workspace: present,
  profile: present,
};

/** The `tools/list` result exactly as a client receives it. */
async function listedTools(deps: ToolDeps) {
  const server = new McpServer({ name: 'budget', version: '0' });
  registerTopologyTools(server, deps);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'budget', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

const bytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

describe('MCP token budget', () => {
  it('keeps the local (stdio) tool list within budget', async () => {
    const tools = await listedTools(STDIO);
    expect(tools.length).toBeLessThanOrEqual(35);
    expect(bytes(tools)).toBeLessThanOrEqual(44_200);
  });

  it('keeps the largest hosted tool list within budget', async () => {
    const tools = await listedTools(EVERYTHING);
    expect(tools.length).toBeLessThanOrEqual(64);
    expect(bytes(tools)).toBeLessThanOrEqual(67_800);
  });

  it('keeps any one tool definition small', async () => {
    const oversized = (await listedTools(EVERYTHING))
      .map((tool) => ({ name: tool.name, bytes: bytes(tool) }))
      .filter((tool) => tool.bytes > 3_400);
    expect(oversized).toEqual([]);
  });

  it('keeps the default describe_capabilities index small', async () => {
    const tool = createTools(new TopologyStore(), STDIO).find(
      (t) => t.name === 'describe_capabilities',
    )!;
    expect(bytes(await tool.handler({}))).toBeLessThanOrEqual(6_500);
  });

  it('keeps the full capability catalog to one modest reply', async () => {
    // Was 212 KB when every type repeated every field definition.
    const tool = createTools(new TopologyStore(), STDIO).find(
      (t) => t.name === 'describe_capabilities',
    )!;
    expect(bytes(await tool.handler({ detail: 'full' }))).toBeLessThanOrEqual(
      30_000,
    );
  });
});
