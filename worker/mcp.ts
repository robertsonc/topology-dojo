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

export class TopologyMcp extends McpAgent<WorkerEnv> {
  server = new McpServer({ name: 'topology-dojo', version: '0.1.0' });
  private store = new TopologyStore();

  async init(): Promise<void> {
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
    );
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
