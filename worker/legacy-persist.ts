/**
 * Which MCP tools must NOT write the in-memory `TopologyStore` back to the
 * legacy per-user registry after they run (`TopologyMcp.persistAfter`).
 *
 * Its own module — like `workspace-tools.ts` and `profile-tools.ts` — so the
 * list is importable without `agents/mcp`'s dependency graph and can be
 * cross-checked in a plain Node test against the workspace read allowlist
 * (`src/mcp/workspace-reads.ts`): every tool that may be served from a shared
 * workspace snapshot has to be in here, or the snapshot could be persisted
 * into the stale legacy copy (issue #276).
 */

/**
 * Tools that do not mutate the legacy in-memory TopologyStore. Workspace
 * tools are included because they read from, or persist atomically through,
 * their document coordinator; they must not trigger a stale legacy-store
 * write-back. Anything else is treated as a legacy mutation and triggers
 * persistence by default.
 */
export const NO_LEGACY_PERSIST_TOOLS: ReadonlySet<string> = new Set<string>([
  'describe_capabilities',
  'list_topologies',
  'list_templates',
  'get_topology',
  'validate_topology',
  'layout_guidelines',
  'inspect_render',
  'render_svg',
  'export_flipbook',
  'share_topology',
  'list_shares',
  'unpublish_topology',
  'describe_data_source',
  'list_appliances',
  'list_tunnels',
  'get_overlay_policies',
  'list_flows',
  'get_flow_details',
  'create_workspace',
  'list_workspaces',
  'get_workspace_manifest',
  'get_workspace_document',
  'describe_workspace_operations',
  'get_workspace_changes',
  'get_workspace_elements',
  'propose_workspace_changes',
  'apply_workspace_changes',
  'create_checkpoint',
  'list_checkpoints',
  'get_authoring_guidance',
  'list_authoring_preferences',
  'explain_authoring_preference',
]);

/** Whether a tool's success should persist the legacy store. */
export function persistsLegacyStore(toolName: string): boolean {
  return !NO_LEGACY_PERSIST_TOOLS.has(toolName);
}
