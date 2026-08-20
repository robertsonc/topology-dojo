/**
 * Initiative A: `onToolSettled` must never change a tool's response. The
 * remote `TopologyMcp` records activity through this hook; a throw (storage
 * hiccup, analytics DO unreachable) has to stay off the MCP result, matching
 * `recordLogin`'s try/catch discipline.
 */
import { describe, expect, it } from 'vitest';
import { TopologyStore } from './store.js';
import { registerTopologyTools } from './register.js';
import { renderDocumentToSVG } from '../server/render.js';

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

function registeredHandler(
  onToolSettled?: (
    toolName: string,
    outcome: 'success' | 'error',
  ) => void | Promise<void>,
): (args: Record<string, unknown>) => Promise<ToolResult> {
  const handlers = new Map<
    string,
    (args: Record<string, unknown>) => Promise<ToolResult>
  >();
  const server = {
    registerTool(
      name: string,
      _meta: unknown,
      handler: (args: Record<string, unknown>) => Promise<ToolResult>,
    ) {
      handlers.set(name, handler);
    },
  };
  registerTopologyTools(
    server as never,
    { renderDocument: renderDocumentToSVG },
    new TopologyStore(),
    undefined,
    undefined,
    onToolSettled,
  );
  const handler = handlers.get('list_templates');
  if (!handler) throw new Error('list_templates was not registered');
  return handler;
}

describe('registerTopologyTools onToolSettled', () => {
  it('returns unchanged list_templates output when recording throws', async () => {
    const baseline = await registeredHandler()({});
    expect(baseline.isError).toBeUndefined();
    const parsed = JSON.parse(baseline.content[0]!.text) as { id: string }[];
    expect(parsed.length).toBeGreaterThanOrEqual(5);

    const withThrow = await registeredHandler(() => {
      throw new Error('record boom');
    })({});
    expect(withThrow).toEqual(baseline);
  });

  it('returns unchanged output when the async recorder rejects', async () => {
    const baseline = await registeredHandler()({});
    const withReject = await registeredHandler(async () => {
      throw new Error('record reject');
    })({});
    expect(withReject).toEqual(baseline);
  });

  it('still records an error outcome when the handler fails, without masking it', async () => {
    const seen: Array<{ tool: string; outcome: string }> = [];
    const handlers = new Map<
      string,
      (args: Record<string, unknown>) => Promise<ToolResult>
    >();
    const server = {
      registerTool(
        name: string,
        _meta: unknown,
        handler: (args: Record<string, unknown>) => Promise<ToolResult>,
      ) {
        handlers.set(name, handler);
      },
    };
    registerTopologyTools(
      server as never,
      { renderDocument: renderDocumentToSVG },
      new TopologyStore(),
      undefined,
      undefined,
      (tool, outcome) => {
        seen.push({ tool, outcome });
      },
    );
    const result = await handlers.get('get_topology')!({
      topologyId: 'missing',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/unknown topology/i);
    expect(seen).toEqual([{ tool: 'get_topology', outcome: 'error' }]);
  });
});
