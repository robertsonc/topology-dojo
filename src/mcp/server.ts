/**
 * Topology Dojo MCP server (stdio transport).
 *
 * Exposes the headless authoring + render API as MCP tools so an agent can build,
 * validate, and render topologies the same way the GUI does. Run with:
 *   npm run mcp        (tsx src/mcp/server.ts)
 *
 * Tool registration is shared with the Cloudflare Worker (`registerTopologyTools`);
 * this entry just wires the Node renderer and a stdio transport.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { renderDocumentToSVG } from '../server/render.js';
import { registerTopologyTools } from './register.js';

const server = new McpServer({ name: 'topology-dojo', version: '0.1.0' });
registerTopologyTools(server, { renderDocument: renderDocumentToSVG });

const transport = new StdioServerTransport();
await server.connect(transport);
// Note to stderr (stdout is the JSON-RPC channel — never log there).
console.error('topology-dojo MCP server ready on stdio');
