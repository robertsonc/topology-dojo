/**
 * Per-owner directory and private-draft registry. New drafts and workspace
 * directories use the stable `idFromName("user-id:<numeric-id>")`. The
 * pre-uid `idFromName("user:<login>")` name is a read-only migration source
 * so a GitHub login rename cannot orphan drafts. Both decouple owner state
 * from the ephemeral per-session `McpAgent` DO.
 *
 * It exposes exactly the `DocStorage` slice `persist-store` needs, so the same
 * rehydrate/persist logic runs unchanged against a registry stub over RPC.
 */
import { DurableObject } from 'cloudflare:workers';
import type { WorkerEnv } from './env.js';
import type { DocStorage } from '../src/mcp/persist-store.js';
import {
  RATE_LIMITS,
  consumeSlidingWindow,
  registryRateLimitKey,
  type RateLimitBucket,
  type RateLimitResult,
} from '../src/mcp/rate-limit.js';
import type {
  WorkspaceDirectoryRecord,
  WorkspaceListItem,
} from '../src/workspace/model.js';

const WORKSPACE_PREFIX = 'workspace:';
const LEGACY_PREFIX = 'tdoc:';

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

  async legacyDocument(id: string): Promise<string | null> {
    return (await this.ctx.storage.get<string>(LEGACY_PREFIX + id)) ?? null;
  }

  async workspaceRecord(id: string): Promise<WorkspaceDirectoryRecord | null> {
    return (
      (await this.ctx.storage.get<WorkspaceDirectoryRecord>(
        WORKSPACE_PREFIX + id,
      )) ?? null
    );
  }

  async hasWorkspace(id: string): Promise<boolean> {
    return Boolean(await this.workspaceRecord(id));
  }

  async markWorkspace(record: WorkspaceDirectoryRecord): Promise<void> {
    await this.ctx.storage.put(WORKSPACE_PREFIX + record.id, record);
  }

  async workspaceIds(): Promise<string[]> {
    const records = await this.ctx.storage.list<WorkspaceDirectoryRecord>({
      prefix: WORKSPACE_PREFIX,
    });
    return [...records.values()].map((record) => record.id);
  }

  /**
   * Per-user request quota (issue #227). The registry DO is already one
   * instance per GitHub login — the same place draft persist lives — so a
   * sliding window here applies across every MCP session the user opens
   * without a new Durable Object class or migration.
   */
  async consumeQuota(
    bucket: RateLimitBucket,
    now = Date.now(),
  ): Promise<RateLimitResult> {
    const spec = RATE_LIMITS[bucket];
    const key = registryRateLimitKey(bucket);
    const hits = (await this.ctx.storage.get<number[]>(key)) ?? [];
    const outcome = consumeSlidingWindow(hits, now, spec);
    await this.ctx.storage.put(key, outcome.hits);
    return outcome.result;
  }

  /**
   * Directory listing used by both browser and MCP. Legacy values have no
   * metadata key, so their title/page count is read defensively in-place; the
   * full JSON never leaves this registry RPC merely to produce a listing.
   */
  async listWorkspaceSources(): Promise<WorkspaceListItem[]> {
    const [workspaces, legacy] = await Promise.all([
      this.ctx.storage.list<WorkspaceDirectoryRecord>({
        prefix: WORKSPACE_PREFIX,
      }),
      this.ctx.storage.list<string>({ prefix: LEGACY_PREFIX }),
    ]);
    const migrated = new Set(
      [...workspaces.values()].map((record) => record.id),
    );
    const current: WorkspaceListItem[] = [...workspaces.values()].map(
      (record) => ({
        id: record.id,
        title: record.title,
        pages: record.pages,
        revision: record.revision,
        migrated: true,
        updatedAt: record.updatedAt,
      }),
    );
    for (const [key, json] of legacy) {
      const id = key.slice(LEGACY_PREFIX.length);
      if (migrated.has(id)) continue;
      let title = 'Untitled';
      let pages = 0;
      try {
        const raw = JSON.parse(json) as { title?: unknown; pages?: unknown };
        if (typeof raw.title === 'string') title = raw.title;
        if (Array.isArray(raw.pages)) pages = raw.pages.length;
      } catch {
        // Keep corrupt legacy entries visible; opening one reports the parse error.
      }
      current.push({ id, title, pages, revision: null, migrated: false });
    }
    return current.sort((a, b) => a.title.localeCompare(b.title));
  }
}
