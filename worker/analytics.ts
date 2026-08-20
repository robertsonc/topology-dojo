/**
 * Owner-analytics store for the admin dashboard (MVP, migration `v5`).
 *
 * A SINGLE global Durable Object instance (`idFromName('global')`) that holds a
 * bounded login roster + recent-login log and, as of Initiative A, a bounded
 * MCP-session index — metadata only, never any diagram content, prompts, or
 * tool arguments. Logins are written from the browser-login success path
 * (`worker/auth.ts` `completeWebLogin`, best-effort via `ctx.waitUntil`);
 * sessions are written from `TopologyMcp.init()` / tool dispatch the same way.
 * Read only by the owner-gated `/api/admin` routes (`worker/admin-api.ts`).
 *
 * Hibernation-safe: the only state is `ctx.storage`; every record is (re)read
 * from storage on each call. The shaping/eviction logic is pure and unit-tested
 * in `src/admin/roster.ts` — this class is a thin storage shell over it, the
 * same split `worker/profile.ts` uses over `src/profile/learner.ts`.
 *
 * Gated OFF by default (`ANALYTICS_ENABLED`, opt-in): the `v5` migration ships
 * this class inert in production and a later deploy activates it, mirroring the
 * `AuthoringProfile`/`PROFILES_ENABLED` bootstrap.
 */
import { DurableObject } from 'cloudflare:workers';
import type { WorkerEnv } from './env.js';
import type { LoginEvent, RosterEntry } from '../src/admin/model.js';
import type { SessionSummary } from '../src/agent-activity/model.js';
import { appendRecent, sortRoster, upsertRoster } from '../src/admin/roster.js';
import {
  sortSessions,
  upsertSessionIndex,
} from '../src/agent-activity/trail.js';

const ROSTER_PREFIX = 'user:';
const RECENT_KEY = 'recent';
const SESSIONS_KEY = 'sessions';
const MAX_STR = 200;
const MAX_TS = 40;

/** Coerce + bound a string at the RPC trust boundary (belt-and-suspenders: the
 * caller already passes clean session fields, but the store must never be
 * poisoned by an oversized value). */
function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** Inbound login shape (from the coordinator's best-effort record call). */
interface RecordLoginInput {
  uid: string;
  login: string;
  name?: string;
  at?: string;
}

export class AnalyticsLog extends DurableObject<WorkerEnv> {
  /**
   * Record one browser login: upsert the user's roster entry and append a
   * bounded recent-login event. Called via `ctx.waitUntil` off the login
   * response path, so it must never throw back into the login flow — the caller
   * wraps it, and inputs are re-bounded here regardless.
   */
  async recordLogin(input: RecordLoginInput): Promise<void> {
    const uid = str(input?.uid, MAX_STR);
    if (!uid) return;
    const login = str(input?.login, MAX_STR);
    const at = str(input?.at, MAX_TS) || nowIso();
    const name = input?.name !== undefined ? str(input.name, MAX_STR) : '';
    await this.ctx.storage.transaction(async (tx) => {
      const existing = await tx.get<RosterEntry>(ROSTER_PREFIX + uid);
      const entry = upsertRoster(existing, {
        uid,
        login,
        ...(name ? { name } : {}),
        at,
      });
      await tx.put(ROSTER_PREFIX + uid, entry);
      const recent = (await tx.get<LoginEvent[]>(RECENT_KEY)) ?? [];
      await tx.put(RECENT_KEY, appendRecent(recent, { uid, login, at }));
    });
  }

  /** The full roster, most-recently-active first. */
  async listRoster(): Promise<RosterEntry[]> {
    const map = await this.ctx.storage.list<RosterEntry>({
      prefix: ROSTER_PREFIX,
    });
    return sortRoster([...map.values()]);
  }

  /** The most recent logins, newest first (bounded by `limit`). */
  async recentLogins(limit = 50): Promise<LoginEvent[]> {
    const recent = (await this.ctx.storage.get<LoginEvent[]>(RECENT_KEY)) ?? [];
    const n = Math.max(1, Math.min(limit, recent.length));
    return recent.slice(recent.length - n).reverse();
  }

  /**
   * Upsert one MCP session into the bounded index. First-seen creates a row;
   * a returning sessionId keeps `startedAt` and refreshes count / lastToolAt.
   * Called via `ctx.waitUntil` off the MCP tool path — must never throw back
   * into a tool response (the caller also wraps it).
   */
  async recordSession(input: {
    sessionId: string;
    ownerId: string;
    ownerLogin?: string;
    startedAt?: string;
    lastToolAt?: string;
    toolCallCount?: number;
  }): Promise<void> {
    const sessionId = str(input?.sessionId, MAX_STR);
    const ownerId = str(input?.ownerId, MAX_STR);
    if (!sessionId || !ownerId) return;
    const startedAt = str(input?.startedAt, MAX_TS) || nowIso();
    const lastToolAt = str(input?.lastToolAt, MAX_TS);
    const ownerLogin = str(input?.ownerLogin, MAX_STR);
    const toolCallCount =
      typeof input?.toolCallCount === 'number' &&
      Number.isFinite(input.toolCallCount)
        ? Math.max(0, Math.floor(input.toolCallCount))
        : 0;
    const next: SessionSummary = {
      sessionId,
      ownerId,
      startedAt,
      toolCallCount,
      ...(ownerLogin ? { ownerLogin } : {}),
      ...(lastToolAt ? { lastToolAt } : {}),
    };
    const existing =
      (await this.ctx.storage.get<SessionSummary[]>(SESSIONS_KEY)) ?? [];
    await this.ctx.storage.put(
      SESSIONS_KEY,
      upsertSessionIndex(existing, next),
    );
  }

  /** Recent MCP sessions, most-recently-active first (bounded by `limit`). */
  async listSessions(limit = 50): Promise<SessionSummary[]> {
    const sessions =
      (await this.ctx.storage.get<SessionSummary[]>(SESSIONS_KEY)) ?? [];
    const ordered = sortSessions(sessions);
    const n = Math.max(0, Math.min(limit, ordered.length));
    return ordered.slice(0, n);
  }

  /** One session-index row, or null if this deployment has never indexed it. */
  async getSession(sessionId: string): Promise<SessionSummary | null> {
    const id = str(sessionId, MAX_STR);
    if (!id) return null;
    const sessions =
      (await this.ctx.storage.get<SessionSummary[]>(SESSIONS_KEY)) ?? [];
    return sessions.find((s) => s.sessionId === id) ?? null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}
