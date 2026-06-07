/**
 * Register the Topology Dojo tool set onto an MCP server instance, mapping each
 * pure handler's return value to MCP text content (errors → isError). Shared by
 * the stdio server (`server.ts`) and the Cloudflare Worker agent so both expose
 * an identical tool surface.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTools, type ToolDeps } from './tools.js';
import { TopologyStore } from './store.js';

export function registerTopologyTools(
  server: McpServer,
  deps: ToolDeps,
  store: TopologyStore = new TopologyStore(),
): TopologyStore {
  for (const tool of createTools(store, deps)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputShape },
      (args: Record<string, unknown>) => {
        try {
          const result = tool.handler(args);
          const text =
            typeof result === 'string'
              ? result
              : JSON.stringify(result, null, 2);
          return { content: [{ type: 'text' as const, text }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
          };
        }
      },
    );
  }
  return store;
}
