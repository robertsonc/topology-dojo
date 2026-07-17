/**
 * Pure decision for which authoring-profile MCP tools `mcp.ts`'s `init()`
 * registers (Packet P4 / proposal 0003-B). Mirrors `workspace-tools.ts` — its
 * own module so it stays importable without the `agents/mcp` dependency graph
 * and testable through the plain worker-harness
 * (`src/testing/mcp-profile-gate.test.ts`).
 */
import { profilesEnabled, type WorkerEnv } from './env.js';

/**
 * The read-only guidance/inspection tools that register when the profile
 * surface is live — mirrors `src/mcp/tools.ts`'s `if (deps.profile)` block.
 * Deliberately NO confirm, reject, pause, edit, or forget tool exists
 * (proposal guardrail #5): those stay browser-owner actions on the
 * cookie-authenticated `/api/profile` routes, so an agent can never promote
 * or broaden its own lesson through MCP.
 */
export const PROFILE_TOOL_NAMES = [
  'get_authoring_guidance',
  'list_authoring_preferences',
  'explain_authoring_preference',
] as const;

/**
 * The profile tool names `init()` should register, given whether a profile
 * service would otherwise be available (i.e. the caller is authenticated —
 * see `TopologyMcp.profileService()`) and the `PROFILES_ENABLED` flag. Both
 * must hold; note the flag is OPT-IN (unset ⇒ disabled), the opposite default
 * of `WORKSPACE_ENABLED`.
 */
export function profileToolNames(
  env: Pick<WorkerEnv, 'PROFILES_ENABLED'>,
  hasProfileService: boolean,
): readonly string[] {
  return hasProfileService && profilesEnabled(env) ? PROFILE_TOOL_NAMES : [];
}
