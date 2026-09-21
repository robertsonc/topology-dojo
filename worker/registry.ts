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
import { API_KEY_PENDING_TTL_MS } from '../src/server/api-key.js';
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
/** Owner index of user-tied API keys (proposal 0005): `apikey:<keyId>` → entry. */
const API_KEY_PREFIX = 'apikey:';
interface ApiKeyIndexRecord {
  createdAt: string;
  expiresAt?: string;
  /** True between `reserve` and `confirm`. */
  pending?: boolean;
}
export interface ApiKeyIndexEntry {
  keyId: string;
  createdAt: string;
  expiresAt?: string;
  pending: boolean;
}
function normalizeApiKeyEntry(
  raw: ApiKeyIndexRecord | string | undefined,
): ApiKeyIndexRecord | null {
  if (raw === undefined) return null;
  // Tolerate the first-cut shape (a bare createdAt string) as confirmed.
  if (typeof raw === 'string') return { createdAt: raw, pending: false };
  if (typeof raw.createdAt !== 'string') return null;
  return raw;
}

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
  /* ── API key owner index (proposal 0005) ──────────────────────────────
   * The credential records live in OAUTH_KV (global, edge-cached reads on
   * the auth path); the OWNER INDEX and the per-user cap live here because a
   * Durable Object executes one request at a time — a count-then-put inside
   * one method cannot interleave with another create, so the cap is strict
   * and the index never loses an entry to a lost read-modify-write.
   *
   * Lifecycle of a slot: `reserve` (pending) → the caller writes the KV
   * record → `confirm`. A reservation that is never confirmed (the record
   * write failed AND the release failed) expires on its own after
   * API_KEY_PENDING_TTL_MS, so no failure sequence can strand a slot forever.
   * Expired keys are pruned here by their own `expiresAt`. Nothing in this
   * object consults KV: a confirmed slot is released only by an explicit
   * `release` (revoke, or the store's grace-gated orphan reconciliation).
   */

  /** Reserve a pending slot for `keyId`; false when the owner already holds `max` live keys. Idempotent. */
  async apiKeyReserve(
    keyId: string,
    max: number,
    expiresAt?: string,
  ): Promise<boolean> {
    const live = await this.liveApiKeyEntries();
    if (live.has(keyId)) return true;
    if (live.size >= max) return false;
    const entry: ApiKeyIndexRecord = {
      createdAt: new Date().toISOString(),
      pending: true,
      ...(expiresAt ? { expiresAt } : {}),
    };
    await this.ctx.storage.put(API_KEY_PREFIX + keyId, entry);
    return true;
  }

  /**
   * Mark the slot durable once its KV record exists. Re-creates the entry if
   * a pending reservation was pruned meanwhile, so a confirmed credential is
   * always visible on /keys.
   */
  async apiKeyConfirm(keyId: string, expiresAt?: string): Promise<void> {
    const existing = await this.ctx.storage.get<ApiKeyIndexRecord | string>(
      API_KEY_PREFIX + keyId,
    );
    const prior = normalizeApiKeyEntry(existing);
    const entry: ApiKeyIndexRecord = {
      createdAt: prior?.createdAt ?? new Date().toISOString(),
      pending: false,
      ...((expiresAt ?? prior?.expiresAt)
        ? { expiresAt: expiresAt ?? prior?.expiresAt }
        : {}),
    };
    await this.ctx.storage.put(API_KEY_PREFIX + keyId, entry);
  }

  async apiKeyRelease(keyId: string): Promise<void> {
    await this.ctx.storage.delete(API_KEY_PREFIX + keyId);
  }

  /** The owner's live entries (confirmed and still-pending), oldest first. */
  async apiKeyEntries(): Promise<ApiKeyIndexEntry[]> {
    const live = await this.liveApiKeyEntries();
    return [...live.entries()]
      .sort(
        (a, b) =>
          a[1].createdAt.localeCompare(b[1].createdAt) ||
          a[0].localeCompare(b[0]),
      )
      .map(([keyId, entry]) => ({
        keyId,
        createdAt: entry.createdAt,
        pending: entry.pending === true,
        ...(entry.expiresAt ? { expiresAt: entry.expiresAt } : {}),
      }));
  }

  /** Entries that are neither expired nor stale-pending; the rest are deleted on the way. */
  private async liveApiKeyEntries(
    nowMs = Date.now(),
  ): Promise<Map<string, ApiKeyIndexRecord>> {
    const held = await this.ctx.storage.list<ApiKeyIndexRecord | string>({
      prefix: API_KEY_PREFIX,
    });
    const live = new Map<string, ApiKeyIndexRecord>();
    for (const [key, raw] of held) {
      const entry = normalizeApiKeyEntry(raw);
      if (!entry) {
        await this.ctx.storage.delete(key);
        continue;
      }
      const expired =
        entry.expiresAt !== undefined && Date.parse(entry.expiresAt) <= nowMs;
      const stalePending =
        entry.pending === true &&
        Date.parse(entry.createdAt) + API_KEY_PENDING_TTL_MS <= nowMs;
      if (expired || stalePending) {
        await this.ctx.storage.delete(key);
        continue;
      }
      live.set(key.slice(API_KEY_PREFIX.length), entry);
    }
    return live;
  }

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
