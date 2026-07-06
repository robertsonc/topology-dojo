/**
 * Per-user document registry — a Durable Object addressed by
 * `idFromName("user:<login>")`, so every MCP session a user opens routes to the
 * SAME storage. This decouples authored documents from the ephemeral,
 * per-session `McpAgent` DO (named `streamable-http:<sessionId>`): a topology
 * created in one tool call must be visible to the next even when the client
 * doesn't carry an `mcp-session-id` and each call lands on a fresh session DO
 * (the "unknown topology" bug).
 *
 * It exposes exactly the `DocStorage` slice `persist-store` needs, so the same
 * rehydrate/persist logic runs unchanged against a registry stub over RPC.
 */
import { DurableObject } from 'cloudflare:workers';
import type { WorkerEnv } from './env.js';
import type { DocStorage } from '../src/mcp/persist-store.js';

export class TopologyRegistry
  extends DurableObject<WorkerEnv>
  implements DocStorage
{
  async list<T = string>(options: { prefix: string }): Promise<Map<string, T>> {
    return this.ctx.storage.list<T>(options);
  }

  async put(key: string, value: string): Promise<void> {
    await this.ctx.storage.put(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.ctx.storage.delete(key);
  }
}
