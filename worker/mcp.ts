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
import { TopologyStore } from '../src/mcp/store.js';
import {
  persistStore,
  rehydrateStore,
  type DocStorage,
} from '../src/mcp/persist-store.js';
import { serializeDoc } from '../src/pages/persist.js';
import type { TopologyDocument } from '../src/pages/model.js';
import { EdgeConnectProvider } from '../src/connect/edgeconnect.js';
import { renderDocument } from './render.js';
import type { WorkerEnv } from './env.js';

/** Short, URL-safe id for a published snapshot (collision-negligible for this use). */
function shareId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

/** Snapshots live in KV for 30 days unless re-published (keeps the namespace bounded). */
const SHARE_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Tools that only read the registry — no persistence needed after them. Anything
 * NOT listed is treated as a mutation and triggers a write-back, so a new
 * mutating tool is durable by default (fail safe). The connect/* tools query a
 * live data source and never touch the store.
 */
const READONLY_TOOLS = new Set<string>([
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
]);

export class TopologyMcp extends McpAgent<WorkerEnv> {
  server = new McpServer({ name: 'topology-dojo', version: '0.1.0' });
  private store = new TopologyStore();

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
    registerTopologyTools(
      this.server,
      {
        renderDocument,
        publishTopology: (doc: TopologyDocument) => this.publish(doc),
        ...(provider ? { provider } : {}),
      },
      this.store,
      (toolName) => this.persistAfter(toolName),
    );
  }

  /**
   * The per-user registry DO for the signed-in GitHub user, exposed as the
   * `DocStorage` slice persist-store needs. Keyed on the OAuth `login` from
   * `this.props` (set by the provider before `init()`). Fails CLOSED: with no
   * authenticated user we refuse to persist rather than fall back to a shared
   * "anonymous" key that would leak documents between users.
   */
  private registry(): DocStorage {
    const login = (this.props as { login?: string } | undefined)?.login;
    if (!login)
      throw new Error(
        'no authenticated user (props.login) — refusing to persist',
      );
    const ns = this.env.TOPOLOGY_REGISTRY;
    return ns.get(ns.idFromName(`user:${login}`));
  }

  /** Load the user's documents from the registry into the in-memory store. */
  private async rehydrate(): Promise<void> {
    try {
      const { failed } = await rehydrateStore(this.store, this.registry());
      if (failed.length)
        console.error(
          `topology rehydrate: ${failed.length} unparseable doc(s) left intact`,
          failed,
        );
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
    if (READONLY_TOOLS.has(toolName)) return;
    try {
      await persistStore(this.store, this.registry());
    } catch (err) {
      console.error(`topology persist after ${toolName} failed`, err);
    }
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
