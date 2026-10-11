/**
 * Initiative A: `onToolSettled` must never change a tool's response. The
 * remote `TopologyMcp` records activity through this hook; a throw (storage
 * hiccup, analytics DO unreachable) has to stay off the MCP result, matching
 * `recordLogin`'s try/catch discipline.
 */
import { describe, expect, it } from 'vitest';
import { TopologyStore } from './store.js';
import { registerTopologyTools, type BeforeToolCall } from './register.js';
import { serveWorkspaceRead } from './workspace-reads.js';
import { renderDocumentToSVG } from '../server/render.js';
import type { TopologyDocument } from '../pages/model.js';

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

/**
 * Issue #276: a `beforeToolCall` guard may return a `ToolCallContext` that
 * serves a read from a shared workspace snapshot. The dispatcher stamps the
 * revision onto the result and runs `release` once the handler settles,
 * whether it succeeded or failed — and never persists the snapshot.
 */
describe('registerTopologyTools ToolCallContext (workspace reads)', () => {
  const WORKSPACE_DOC: TopologyDocument = {
    title: 'Workspace copy',
    customNodes: [],
    layers: [{ id: 'overlay', name: 'Overlay' }],
    legend: { show: true },
    pages: [
      {
        id: 'p1',
        name: 'Frame 1',
        viewBox: '0 0 1050 700',
        nodes: [],
        links: [],
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
      },
    ],
  };

  function harness(migrated: Set<string>, revision: number) {
    const store = new TopologyStore();
    const persisted: string[] = [];
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
    // The same shape as TopologyMcp.beforeTool: a migrated id is either
    // served from the snapshot (read allowlist) or refused.
    const beforeTool: BeforeToolCall = async (toolName, args) => {
      if (args.topologyId === undefined) return;
      const id = String(args.topologyId);
      if (!migrated.has(id)) return;
      return serveWorkspaceRead(toolName, id, store, {
        snapshot: async () => ({
          revision,
          document: structuredClone(WORKSPACE_DOC),
        }),
      });
    };
    registerTopologyTools(
      server as never,
      { renderDocument: renderDocumentToSVG },
      store,
      (toolName) => {
        persisted.push(toolName);
      },
      beforeTool,
    );
    const call = (name: string, args: Record<string, unknown>) => {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`${name} was not registered`);
      return handler(args);
    };
    return { store, persisted, call };
  }

  it('serves get_topology from the snapshot, stamps the revision, and unloads it', async () => {
    const { store, call } = harness(new Set(['w1']), 5);
    const result = await call('get_topology', { topologyId: 'w1' });
    expect(result.isError).toBeUndefined();
    const doc = JSON.parse(result.content[0]!.text) as TopologyDocument & {
      workspaceRevision: number;
    };
    expect(doc.title).toBe('Workspace copy');
    expect(doc.layers).toEqual([{ id: 'overlay', name: 'Overlay' }]);
    expect(doc.legend).toEqual({ show: true });
    expect(doc.workspaceRevision).toBe(5);
    // Released after the call: the store holds no copy of the workspace.
    expect(store.list()).toEqual([]);
    expect(store.drainPendingDeletes()).toEqual([]);
  });

  it('stamps the revision into a rendered SVG and a validation report', async () => {
    const { call } = harness(new Set(['w1']), 9);
    const svg = (await call('render_svg', { topologyId: 'w1' })).content[0]!
      .text;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<!-- workspace revision 9 -->');
    const validation = JSON.parse(
      (await call('validate_topology', { topologyId: 'w1' })).content[0]!.text,
    ) as { valid: boolean; workspaceRevision: number };
    expect(validation.valid).toBe(true);
    expect(validation.workspaceRevision).toBe(9);
  });

  it('leaves a legacy topology’s result unchanged (no workspaceRevision)', async () => {
    const { store, call } = harness(new Set(['w1']), 5);
    const { id } = store.create('Private draft');
    const doc = JSON.parse(
      (await call('get_topology', { topologyId: id })).content[0]!.text,
    ) as Record<string, unknown>;
    expect(doc.title).toBe('Private draft');
    expect('workspaceRevision' in doc).toBe(false);
  });

  it('still refuses a mutating tool on a migrated id', async () => {
    const { store, persisted, call } = harness(new Set(['w1']), 5);
    const result = await call('add_node', {
      topologyId: 'w1',
      type: 'router',
      label: 'R1',
      x: 10,
      y: 10,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain(
      'topology "w1" is now a shared workspace',
    );
    expect(result.content[0]!.text).toContain('propose_workspace_changes');
    expect(store.list()).toEqual([]);
    expect(persisted).toEqual([]);
  });

  it('releases the snapshot even when the handler throws', async () => {
    const { store, call } = harness(new Set(['w1']), 5);
    const result = await call('inspect_render', {
      topologyId: 'w1',
      pageIndex: 42,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/page index 42 out of range/);
    expect(store.list()).toEqual([]);
  });
});
