/**
 * The MCP agent — a Durable Object (via Cloudflare's `McpAgent`) that holds one
 * authoring session's in-memory `TopologyStore` and exposes the shared Topology
 * Dojo tool set over Streamable HTTP. Same tools as the stdio server; only the
 * transport and the (bundled) renderer differ.
 */
import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTopologyTools } from '../src/mcp/register.js';
import { TopologyStore } from '../src/mcp/store.js';
import { renderDocument } from './render.js';

export class TopologyMcp extends McpAgent {
  server = new McpServer({ name: 'topology-dojo', version: '0.1.0' });
  private store = new TopologyStore();

  async init(): Promise<void> {
    registerTopologyTools(this.server, { renderDocument }, this.store);
  }
}
