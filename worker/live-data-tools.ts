/**
 * Pure decision for which live-data / EdgeConnect fabric MCP tools
 * `mcp.ts`'s `init()` registers. Mirrors `workspace-tools.ts` /
 * `profile-tools.ts` — its own module so it stays importable without the
 * `agents/mcp` dependency graph and testable through the plain
 * worker-harness (`src/testing/mcp-live-data-gate.test.ts`).
 */
import {
  liveDataAllowedForOwner,
  liveDataEnabled,
  type WorkerEnv,
} from './env.js';

/**
 * The read-only fabric tools that register when a provider is wired in —
 * mirrors `src/mcp/tools.ts`'s `if (deps.provider)` block. Credentials
 * never pass through these tools; the blast radius is "this deployment's
 * Orchestrator key is reachable from every allowed MCP session".
 */
export const LIVE_DATA_TOOL_NAMES = [
  'describe_data_source',
  'list_appliances',
  'list_tunnels',
  'get_overlay_policies',
  'list_flows',
  'get_flow_details',
  'build_flow_topology',
] as const;

/**
 * The live-data tool names `init()` should register. All of the following
 * must hold: the caller is an authenticated owner, `LIVE_DATA_ENABLED` is
 * exactly `"true"`, the optional `LIVE_DATA_GITHUB_IDS` allowlist (when
 * set) includes that owner, and both Orchestrator secrets are present.
 * The flag is OPT-IN (unset ⇒ disabled), independent of secret presence.
 */
export function liveDataToolNames(
  env: Pick<
    WorkerEnv,
    | 'LIVE_DATA_ENABLED'
    | 'LIVE_DATA_GITHUB_IDS'
    | 'ORCH_BASE_URL'
    | 'ORCH_API_KEY'
  >,
  ownerId: string | undefined,
): readonly string[] {
  return ownerId !== undefined &&
    liveDataEnabled(env) &&
    liveDataAllowedForOwner(env, ownerId) &&
    !!env.ORCH_BASE_URL &&
    !!env.ORCH_API_KEY
    ? LIVE_DATA_TOOL_NAMES
    : [];
}
