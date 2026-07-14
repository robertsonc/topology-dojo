/**
 * Pure decision for which workspace MCP tools `mcp.ts`'s `init()` registers,
 * kept in its own module — separate from `mcp.ts` — so it stays importable
 * without dragging in `agents/mcp`'s dependency graph (which reaches
 * `cloudflare:workers` and needs the `nodejs_compat` runtime). That keeps it
 * testable through the plain esbuild + Miniflare worker-harness without any
 * Durable Object bindings; see `src/testing/mcp-workspace-gate.test.ts`. The
 * only non-type-only import here (`workspaceEnabled`) is itself a tiny pure
 * function, so this file has no runtime dependencies at all.
 */
import { workspaceEnabled, type WorkerEnv } from './env.js';

/**
 * The MCP tools that only register when a canonical workspace is wired in —
 * mirrors `src/mcp/tools.ts`'s `if (deps.workspace)` block, which is already
 * covered by its own "registers the bounded shared-workspace tools only when
 * wired" test. This list exists so the *additional* `WORKSPACE_ENABLED` cutover
 * has something concrete to assert against. `create_checkpoint` /
 * `list_checkpoints` are agent-available (checkpoint before a risky batch);
 * restore and fork stay browser-owner actions, so they are deliberately absent.
 */
export const WORKSPACE_TOOL_NAMES = [
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
] as const;

/**
 * The workspace tool names `init()` should register, given whether a
 * workspace service would otherwise be available (i.e. the caller is
 * authenticated — see `TopologyMcp.workspaceService()`) and the
 * `WORKSPACE_ENABLED` flag. Both must hold for the eight tools above to
 * appear in `tools/list`; otherwise this returns an empty list.
 */
export function workspaceToolNames(
  env: Pick<WorkerEnv, 'WORKSPACE_ENABLED'>,
  hasWorkspaceService: boolean,
): readonly string[] {
  return hasWorkspaceService && workspaceEnabled(env)
    ? WORKSPACE_TOOL_NAMES
    : [];
}
