/**
 * WORKSPACE_ENABLED gate on MCP tool discovery — `worker/mcp.ts`'s `init()`
 * only hands `registerTopologyTools` a `workspace` dep (which is what makes
 * the eight workspace tools appear in `tools/list`, per
 * `src/mcp/tools.test.ts`'s "registers the bounded shared-workspace tools
 * only when wired") when `workspaceToolNames(...).length > 0`. The
 * `TopologyMcp` Durable Object itself can't be constructed under the plain
 * Node test runner or cleanly driven through Miniflare here (it needs a real
 * MCP session handshake — tracked as M22 follow-up work), so this exercises
 * the pure decision function directly through the worker-harness, per the D2
 * packet's fallback guidance.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { WORKSPACE_TOOL_NAMES_FIXTURE } from './worker-fixtures.js';

const WORKSPACE_TOOL_NAMES = [
  'create_workspace',
  'list_workspaces',
  'get_workspace_manifest',
  'describe_workspace_operations',
  'get_workspace_changes',
  'get_workspace_elements',
  'propose_workspace_changes',
  'apply_workspace_changes',
  'create_checkpoint',
  'list_checkpoints',
];

let handle: MiniflareHandle;

beforeAll(async () => {
  const bundle = await buildWorkerBundle(WORKSPACE_TOOL_NAMES_FIXTURE, {
    sourcefile: 'mcp-workspace-gate-fixture.ts',
  });
  handle = await startMiniflare({ bundle });
}, 30_000);

afterAll(async () => {
  await handle?.dispose();
});

async function names(
  flag: string | undefined,
  hasWorkspaceService: boolean,
): Promise<string[]> {
  const params = new URLSearchParams();
  if (flag !== undefined) params.set('flag', flag);
  params.set('hasWorkspaceService', String(hasWorkspaceService));
  const res = await handle.fetch(`/?${params.toString()}`);
  return (await res.json()) as string[];
}

describe('workspaceToolNames — MCP tool-discovery gate', () => {
  it('registers the workspace tools when unset and a workspace service is available', async () => {
    expect(await names(undefined, true)).toEqual(WORKSPACE_TOOL_NAMES);
  });

  it('registers them when the flag is explicitly "true"', async () => {
    expect(await names('true', true)).toEqual(WORKSPACE_TOOL_NAMES);
  });

  it('excludes them entirely when the flag is "false", so they never reach tool discovery', async () => {
    expect(await names('false', true)).toEqual([]);
  });

  it('excludes them when no workspace service is available, regardless of the flag', async () => {
    expect(await names(undefined, false)).toEqual([]);
    expect(await names('true', false)).toEqual([]);
    expect(await names('false', false)).toEqual([]);
  });
});
