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
import type { TopologyDocument } from '../src/pages/model.js';
import { EdgeConnectProvider } from '../src/connect/edgeconnect.js';
import { renderDocument } from './render.js';
import type { WorkerEnv } from './env.js';
import { analyticsEnabled } from './env.js';
import { WorkspaceService } from './workspaces.js';
import { workspaceToolNames } from './workspace-tools.js';
import { profileToolNames } from './profile-tools.js';
import { liveDataToolNames } from './live-data-tools.js';
import {
  explainPreference,
  preferenceSummary,
  type GuidanceQuery,
  type GuidanceResult,
} from '../src/profile/guidance.js';
import type { AuthoringPreference } from '../src/profile/model.js';
import {
  formatRateLimitError,
  rateLimitBucketForTool,
  type RateLimitResult,
} from '../src/mcp/rate-limit.js';
import { listShares, publishSnapshot, revokeShare } from './share.js';
import type { ToolCallEvent } from '../src/agent-activity/model.js';
import {
  indexSession,
  loadTrail,
  persistTrail,
  sessionGuidanceConsulted,
} from './agent-activity.js';
import {
  MAX_ACTIVITY_STR,
  MAX_ACTIVITY_TS,
  appendTrail,
  boundActivityString,
} from '../src/agent-activity/trail.js';

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
  /**
   * In-memory copy of this session's tool-call trail (Initiative A). Rehydrated
   * from `ctx.storage` in `init()` so hibernation doesn't drop same-session
   * explainability; appends stay in memory even if persist/index throws.
   */
  private activityTrail: ToolCallEvent[] = [];

  async init(): Promise<void> {
    // Rehydrate from the per-USER registry DO (not this session DO's storage):
    // documents must survive and be shared across every MCP session the user
    // opens. Without this, a topology created on one call vanishes on the next
    // (the "unknown topology" bug) because each session lands on a fresh DO.
    await this.rehydrate();
    await this.rehydrateActivity();
    this.indexSessionStart();

    // Live-data provider: LIVE_DATA_ENABLED (opt-in) × optional owner
    // allowlist × Orchestrator secrets. Secret presence alone must not
    // register the fabric tools (issue #228). liveDataToolNames holds the
    // pure decision so the gate stays unit-testable outside this DO.
    const ownerId = (this.props as { id?: number } | undefined)?.id;
    const provider =
      liveDataToolNames(
        this.env,
        ownerId !== undefined ? String(ownerId) : undefined,
      ).length &&
      this.env.ORCH_BASE_URL &&
      this.env.ORCH_API_KEY
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
        unpublishTopology: (shareId: string) => this.unpublish(shareId),
        listShares: () => listShares(this.env, this.ownerId()),
        ...(provider ? { provider } : {}),
        ...(workspace ? { workspace } : {}),
        ...(profile ? { profile } : {}),
      },
      this.store,
      (toolName) => this.persistAfter(toolName),
      (toolName, args) => this.beforeTool(toolName, args),
      (toolName, outcome) => this.recordActivity(toolName, outcome),
    );
  }

  /**
   * Owner-gated admin read of this session's tool-call trail (metadata only).
   * Always served from storage so a hibernated DO still answers.
   */
  async getActivityTrail(): Promise<ToolCallEvent[]> {
    try {
      return await loadTrail(this.ctx.storage);
    } catch (err) {
      console.error('agent activity trail read failed', err);
      return [];
    }
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
    const bucket = rateLimitBucketForTool(toolName);
    if (bucket) {
      const registryWithQuota = (await this.registry()) as unknown as {
        consumeQuota(bucket: string): Promise<RateLimitResult>;
      };
      const result = await registryWithQuota.consumeQuota(bucket);
      if (!result.allowed) throw new Error(formatRateLimitError(result));
    }
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
      {
        migrateLegacyOnAccess: false,
        mcpSession: {
          sessionId: this.sessionId(),
          guidanceConsultedBefore: () =>
            sessionGuidanceConsulted(this.activityTrail),
        },
      },
    );
  }

  /** Durable Object id hex — the lookup key for `GET /api/admin/sessions/:id`. */
  private sessionId(): string {
    return this.ctx.id.toString();
  }

  private sessionOwner(): { uid: string; login?: string } | undefined {
    const props = this.props as { id?: number; login?: string } | undefined;
    if (props?.id === undefined) return undefined;
    return {
      uid: String(props.id),
      ...(props.login ? { login: props.login } : {}),
    };
  }

  /** Rehydrate the trail after hibernation. Failure starts empty, never blocks. */
  private async rehydrateActivity(): Promise<void> {
    if (!analyticsEnabled(this.env)) return;
    try {
      this.activityTrail = await loadTrail(this.ctx.storage);
    } catch (err) {
      console.error('agent activity trail rehydrate failed', err);
      this.activityTrail = [];
    }
  }

  /** Best-effort session-index row at init; `waitUntil` so it never blocks tools. */
  private indexSessionStart(): void {
    if (!analyticsEnabled(this.env)) return;
    const owner = this.sessionOwner();
    if (!owner) return;
    const startedAt = this.activityTrail[0]?.at ?? new Date().toISOString();
    this.ctx.waitUntil(
      indexSession(this.env, {
        sessionId: this.sessionId(),
        ownerId: owner.uid,
        ownerLogin: owner.login,
        startedAt,
        toolCallCount: this.activityTrail.length,
      }),
    );
  }

  /**
   * Append a bounded trail event in memory (so the next tool in this session
   * can see it for explainability) and flush storage + the session index off
   * the response path. Try/catch: a storage hiccup must never throw into the
   * tool response (mirrors `recordLogin`).
   */
  private recordActivity(toolName: string, outcome: 'success' | 'error'): void {
    if (!analyticsEnabled(this.env)) return;
    try {
      const name = boundActivityString(toolName, MAX_ACTIVITY_STR);
      if (!name) return;
      const at = boundActivityString(new Date().toISOString(), MAX_ACTIVITY_TS);
      this.activityTrail = appendTrail(this.activityTrail, {
        toolName: name,
        at,
        outcome,
      });
      this.ctx.waitUntil(this.flushActivity());
    } catch (err) {
      console.error('agent activity record failed', err);
    }
  }

  private async flushActivity(): Promise<void> {
    try {
      await persistTrail(this.ctx.storage, this.activityTrail);
      const owner = this.sessionOwner();
      if (!owner) return;
      await indexSession(this.env, {
        sessionId: this.sessionId(),
        ownerId: owner.uid,
        ownerLogin: owner.login,
        lastToolAt: this.activityTrail.at(-1)?.at,
        toolCallCount: this.activityTrail.length,
      });
    } catch (err) {
      console.error('agent activity record failed', err);
    }
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

  /**
   * GitHub numeric id as a string — the same key the browser session cookie
   * uses (`SessionUser.uid`), so MCP publish and DELETE /api/topology/:id
   * agree on ownership.
   */
  private ownerId(): string {
    const id = (this.props as { id?: number } | undefined)?.id;
    if (id === undefined)
      throw new Error(
        'no authenticated user (props.id) — refusing to publish or revoke a share',
      );
    return String(id);
  }

  /**
   * Store a document snapshot in KV and return the link that opens it —
   * through the shared publish path (`worker/share.ts`), so the snapshot
   * carries owner metadata (the canonical revocation check) AND lands in the
   * owner's listing index like a browser-published one.
   */
  private async publish(
    doc: TopologyDocument,
  ): Promise<{ id: string; url: string }> {
    return publishSnapshot(this.env, this.ownerId(), doc);
  }

  /** Owner-only delete of a published snapshot (prunes the listing index). */
  private async unpublish(shareId: string): Promise<{ revoked: true }> {
    const result = await revokeShare(this.env, this.ownerId(), shareId);
    if (result === 'not_found')
      throw new Error(`share "${shareId}" was not found (it may have expired)`);
    if (result === 'forbidden')
      throw new Error(
        `share "${shareId}" can only be unpublished by the publisher`,
      );
    return { revoked: true };
  }
}
