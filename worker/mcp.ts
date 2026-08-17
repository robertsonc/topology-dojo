/**
 * The MCP agent — a Durable Object (via Cloudflare's `McpAgent`) that holds one
 * authoring session's in-memory `TopologyStore` and exposes the shared Topology
 * Dojo tool set over Streamable HTTP. Same tools as the stdio server; only the
 * transport, the (bundled) renderer, and the KV-backed `share_topology` publish
 * step (remote-only) differ.
 */
import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTopologyTools } from '../src/mcp/register.js';
import type { ToolDeps } from '../src/mcp/tools.js';
import { TopologyStore } from '../src/mcp/store.js';
import {
  persistStore,
  rehydrateStore,
  type DocStorage,
} from '../src/mcp/persist-store.js';
import {
  openOwnerRegistry,
  type RegistryIdentity,
} from '../src/mcp/registry-address.js';
import { serializeDoc } from '../src/pages/persist.js';
import type { TopologyDocument } from '../src/pages/model.js';
import { EdgeConnectProvider } from '../src/connect/edgeconnect.js';
import { renderDocument } from './render.js';
import type { WorkerEnv } from './env.js';
import { WorkspaceService } from './workspaces.js';
import { workspaceToolNames } from './workspace-tools.js';
import { profileToolNames } from './profile-tools.js';
import {
  explainPreference,
  preferenceSummary,
  type GuidanceQuery,
  type GuidanceResult,
} from '../src/profile/guidance.js';
import type { AuthoringPreference } from '../src/profile/model.js';

/** Short, URL-safe id for a published snapshot (collision-negligible for this use). */
function shareId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

/** Snapshots live in KV for 30 days unless re-published (keeps the namespace bounded). */
const SHARE_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Tools that do not mutate the legacy in-memory TopologyStore. Workspace write
 * tools are included because they persist atomically through their document
 * coordinator; they must not trigger a stale legacy-store write-back. Anything
 * else is treated as a legacy mutation and triggers persistence by default.
 */
const NO_LEGACY_PERSIST_TOOLS = new Set<string>([
  'describe_capabilities',
  'list_topologies',
  'list_templates',
  'get_topology',
  'validate_topology',
  'layout_guidelines',
  'render_svg',
  'export_flipbook',
  'share_topology',
  'describe_data_source',
  'list_appliances',
  'list_tunnels',
  'get_overlay_policies',
  'list_flows',
  'get_flow_details',
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
  'get_authoring_guidance',
  'list_authoring_preferences',
  'explain_authoring_preference',
]);

export class TopologyMcp extends McpAgent<WorkerEnv> {
  server = new McpServer({ name: 'topology-dojo', version: '0.1.0' });
  private store = new TopologyStore();
  /** Session-local uid-keyed registry stub (dropped on hibernation). */
  private cachedRegistry?: DocStorage;

  async init(): Promise<void> {
    // Rehydrate from the per-USER registry DO (not this session DO's storage):
    // documents must survive and be shared across every MCP session the user
    // opens. Without this, a topology created on one call vanishes on the next
    // (the "unknown topology" bug) because each session lands on a fresh DO.
    await this.rehydrate();

    // Live-data provider, when the Orchestrator secrets are configured.
    const provider =
      this.env.ORCH_BASE_URL && this.env.ORCH_API_KEY
        ? new EdgeConnectProvider({
            baseUrl: this.env.ORCH_BASE_URL,
            apiKey: this.env.ORCH_API_KEY,
          })
        : undefined;
    // WORKSPACE_ENABLED gates whether the workspace tools are handed to
    // registerTopologyTools at all — see workspace-tools.ts for the pure
    // decision (kept out of this file so it stays unit-testable without the
    // McpAgent Durable Object; the class/binding/migration are untouched).
    const workspaceService = this.workspaceService();
    const workspace = workspaceToolNames(
      this.env,
      workspaceService !== undefined,
    ).length
      ? workspaceService
      : undefined;
    // Same shape for the read-only profile guidance tools: profileToolNames
    // (worker/profile-tools.ts) holds the pure PROFILES_ENABLED × authenticated
    // decision, so gating stays unit-testable outside this Durable Object.
    const profileService = this.profileService();
    const profile = profileToolNames(this.env, profileService !== undefined)
      .length
      ? profileService
      : undefined;
    registerTopologyTools(
      this.server,
      {
        renderDocument,
        publishTopology: (doc: TopologyDocument) => this.publish(doc),
        ...(provider ? { provider } : {}),
        ...(workspace ? { workspace } : {}),
        ...(profile ? { profile } : {}),
      },
      this.store,
      (toolName) => this.persistAfter(toolName),
      (toolName, args) => this.beforeTool(toolName, args),
    );
  }

  /**
   * The per-user registry DO for the signed-in GitHub user, exposed as the
   * `DocStorage` slice persist-store needs. Keyed on the stable OAuth `id`
   * (`user-id:<uid>`) from `this.props` (set by the provider before `init()`).
   * Login is display-only and only used to lazily copy drafts off the
   * pre-uid `user:<login>` name. Fails CLOSED: with no authenticated uid we
   * refuse to persist rather than fall back to a shared "anonymous" key
   * that would leak documents between users.
   */
  private async registry(): Promise<DocStorage> {
    if (this.cachedRegistry) return this.cachedRegistry;
    this.cachedRegistry = await openOwnerRegistry(
      this.env.TOPOLOGY_REGISTRY,
      this.registryIdentity(),
    );
    return this.cachedRegistry;
  }

  /**
   * Map MCP OAuth `props` (`{ id, login, name }`) onto the registry identity.
   * `id` is the stable GitHub uid — the same mapping `workspaceService()`
   * already does. Login stays display-only for the legacy `user:<login>` copy.
   */
  private registryIdentity(): RegistryIdentity {
    const props = this.props as { id?: number; login?: string } | undefined;
    return {
      ...(props?.id !== undefined
        ? { uid: String(props.id), id: props.id }
        : {}),
      ...(props?.login ? { login: props.login } : {}),
    };
  }

  /** Load the user's documents from the registry into the in-memory store. */
  private async rehydrate(): Promise<void> {
    try {
      const { failed } = await rehydrateStore(
        this.store,
        await this.registry(),
      );
      if (failed.length)
        console.error(
          `topology rehydrate: ${failed.length} unparseable doc(s) left intact`,
          failed,
        );
      const workspace = this.workspaceService();
      if (workspace)
        for (const id of await workspace.migratedIds()) this.store.unload(id);
    } catch (err) {
      // A storage hiccup (or a missing user) shouldn't block tool registration
      // — start empty. persist is explicit-delete only, so it can never mirror
      // an empty store back over the registry and wipe it.
      console.error('topology rehydrate failed', err);
    }
  }

  /**
   * After a mutating tool, write the store back to the user's registry. Errors
   * are logged, not thrown, so a write failure doesn't fail the user's call
   * (the mutation still took effect in memory for the rest of the session).
   */
  private async persistAfter(toolName: string): Promise<void> {
    if (NO_LEGACY_PERSIST_TOOLS.has(toolName)) return;
    try {
      const workspace = this.workspaceService();
      if (workspace)
        for (const id of await workspace.migratedIds()) this.store.unload(id);
      await persistStore(this.store, await this.registry());
    } catch (err) {
      console.error(`topology persist after ${toolName} failed`, err);
    }
  }

  /** Prevent an old session from reading or writing a stale legacy copy after
   * that topology has been handed to the canonical document coordinator. */
  private async beforeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const workspace = this.workspaceService();
    if (!workspace) return;
    if (toolName === 'list_topologies') {
      for (const id of await workspace.migratedIds()) this.store.unload(id);
      return;
    }
    if (args.topologyId === undefined) return;
    const id = String(args.topologyId);
    if (await workspace.isMigrated(id))
      throw new Error(
        `topology "${id}" is now a shared workspace; use get_workspace_manifest and the workspace change tools`,
      );
  }

  private workspaceService(): WorkspaceService | undefined {
    const props = this.props as
      | { id?: number; login?: string; name?: string | null }
      | undefined;
    if (props?.id === undefined || !props.login) return undefined;
    return new WorkspaceService(
      this.env,
      {
        uid: String(props.id),
        login: props.login,
        ...(props.name ? { name: props.name } : {}),
      },
      // The one-way legacy→workspace hand-off is an owner decision made in
      // the browser. Agent tools must never trigger it implicitly — a
      // workspace read on a legacy draft errors instead of migrating, so the
      // direct authoring tools keep working on that draft.
      { migrateLegacyOnAccess: false },
    );
  }

  /**
   * The read-only profile dep for the three guidance/inspection tools
   * (Packet P4). Addressed by the bare stable uid — the SAME key the
   * coordinator's outcome emission and the `/api/profile` routes use, so the
   * agent reads exactly the profile the owner manages. Strictly read-only:
   * only `getGuidance`/`listPreferences` are in the RPC view; the DO's
   * confirm/reject/pause/delete methods are deliberately not reachable from
   * any MCP tool (proposal guardrail #5).
   */
  private profileService(): NonNullable<ToolDeps['profile']> | undefined {
    const props = this.props as { id?: number } | undefined;
    if (props?.id === undefined) return undefined;
    const ownerId = String(props.id);
    const ns = this.env.AUTHORING_PROFILE;
    const stub = ns.get(ns.idFromName(ownerId)) as unknown as {
      listPreferences(ownerId: string): Promise<AuthoringPreference[]>;
      getGuidance(
        ownerId: string,
        query: GuidanceQuery & {
          lastProfileRevision?: number;
          lastGuidanceRevision?: number;
        },
      ): Promise<GuidanceResult>;
    };
    return {
      guidance: (query) => stub.getGuidance(ownerId, query),
      list: async () =>
        (await stub.listPreferences(ownerId)).map(preferenceSummary),
      explain: async (preferenceId) => {
        const pref = (await stub.listPreferences(ownerId)).find(
          (p) => p.id === preferenceId,
        );
        if (!pref) throw new Error(`unknown preference "${preferenceId}"`);
        return explainPreference(pref);
      },
    };
  }

  /** Store a document snapshot in KV and return the link that opens it. */
  private async publish(
    doc: TopologyDocument,
  ): Promise<{ id: string; url: string }> {
    const id = shareId();
    await this.env.TOPOLOGY_KV.put(`doc:${id}`, serializeDoc(doc), {
      expirationTtl: SHARE_TTL_SECONDS,
    });
    const base = (this.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
    return { id, url: `${base}/v/${id}` };
  }
}
