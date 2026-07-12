/**
 * Register the Topology Dojo tool set onto an MCP server instance, mapping each
 * pure handler's return value to MCP text content (errors → isError). Shared by
 * the stdio server (`server.ts`) and the Cloudflare Worker agent so both expose
 * an identical tool surface.
 *
 * Arguments are runtime-validated against the tool's Zod shape before the
 * handler runs (unknown keys are stripped), so handlers never see malformed
 * input — type coercion like `Number("abc") → NaN` can't slip through.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTools, type ToolDef, type ToolDeps } from './tools.js';
import { TopologyStore } from './store.js';

/**
 * Validate raw arguments against a tool's input shape. Returns the parsed
 * (stripped) args; throws an Error with a readable message on mismatch.
 */
export function parseToolArgs(
  tool: ToolDef,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const result = z.object(tool.inputShape).safeParse(args);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '(args)'}: ${i.message}`)
      .join('; ');
    throw new Error(`invalid arguments for ${tool.name} — ${detail}`);
  }
  return result.data;
}

export function registerTopologyTools(
  server: McpServer,
  deps: ToolDeps,
  store: TopologyStore = new TopologyStore(),
  /**
   * Called after a tool handler succeeds, with the tool's name — the hook for a
   * durable backing store to persist the (possibly mutated) registry. Awaited
   * before the response is returned, so a write completes before the client
   * sees the result. No-op by default (the stdio server keeps state in memory).
   */
  afterToolCall?: (toolName: string) => void | Promise<void>,
  /** Guard invoked after runtime argument parsing but before the handler. */
  beforeToolCall?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => void | Promise<void>,
): TopologyStore {
  for (const tool of createTools(store, deps)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputShape },
      async (args: Record<string, unknown>) => {
        try {
          const parsed = parseToolArgs(tool, args);
          await beforeToolCall?.(tool.name, parsed);
          const result = await tool.handler(parsed);
          await afterToolCall?.(tool.name);
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
