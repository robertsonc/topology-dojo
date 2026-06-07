/**
 * Topology Dojo MCP server (stdio transport).
 *
 * Exposes the headless authoring + render API as MCP tools so an agent can build,
 * validate, and render topologies the same way the GUI does. Run with:
 *   npm run mcp        (tsx src/mcp/server.ts)
 *
 * A thin adapter over `createTools`: it registers each tool's zod input shape
 * with the SDK and wraps the handler's return value as MCP text content.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TopologyStore } from './store.js';
import { createTools } from './tools.js';

const server = new McpServer({
  name: 'topology-dojo',
  version: '0.1.0',
});

const store = new TopologyStore();

for (const tool of createTools(store)) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputShape },
    (args: Record<string, unknown>) => {
      try {
        const result = tool.handler(args);
        const text =
          typeof result === 'string' ? result : JSON.stringify(result, null, 2);
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

const transport = new StdioServerTransport();
await server.connect(transport);
// Note to stderr (stdout is the JSON-RPC channel — never log there).
console.error('topology-dojo MCP server ready on stdio');
