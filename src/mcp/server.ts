/**
 * Topology Dojo MCP server (stdio transport).
 *
 * Exposes the headless authoring + render API as MCP tools so an agent can build,
 * validate, and render topologies the same way the GUI does. Run with:
 *   npm run mcp        (tsx src/mcp/server.ts)
 *
 * Live fabric data (optional): set LIVE_DATA_ENABLED=true plus ORCH_BASE_URL +
 * ORCH_API_KEY to connect the EdgeConnect Orchestrator provider, or
 * TOPOLOGY_PROVIDER=mock for the fixture fabric — either registers the
 * read-only live-data tools (list_appliances, list_flows, …). Credentials come
 * from the environment only, never from tools. Secret presence alone does not
 * enable the real provider.
 *
 * Tool registration is shared with the Cloudflare Worker (`registerTopologyTools`);
 * this entry just wires the Node renderer, the provider, and a stdio transport.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { renderDocumentToSVG } from '../server/render.js';
import { EdgeConnectProvider } from '../connect/edgeconnect.js';
import { MockProvider } from '../connect/mock.js';
import type { TopologyProvider } from '../connect/types.js';
import { registerTopologyTools } from './register.js';

function providerFromEnv(): TopologyProvider | undefined {
  if (process.env.TOPOLOGY_PROVIDER === 'mock') return new MockProvider();
  // Same opt-in semantics as worker/env.ts `liveDataEnabled()` — only the
  // literal "true" enables the real Orchestrator client. The mock fixture
  // has no fabric credentials, so it stays available without the flag.
  if (process.env.LIVE_DATA_ENABLED !== 'true') return undefined;
  const baseUrl = process.env.ORCH_BASE_URL;
  const apiKey = process.env.ORCH_API_KEY;
  if (baseUrl && apiKey) return new EdgeConnectProvider({ baseUrl, apiKey });
  return undefined;
}

const provider = providerFromEnv();
const server = new McpServer({ name: 'topology-dojo', version: '0.1.0' });
registerTopologyTools(server, {
  renderDocument: renderDocumentToSVG,
  ...(provider ? { provider } : {}),
});

const transport = new StdioServerTransport();
await server.connect(transport);
// Note to stderr (stdout is the JSON-RPC channel — never log there).
console.error(
  `topology-dojo MCP server ready on stdio${
    provider ? ` (live data: ${provider.describe().system})` : ''
  }`,
);
