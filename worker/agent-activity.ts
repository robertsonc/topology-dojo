/**
 * Best-effort MCP-session activity recording (Initiative A).
 *
 * The per-call trail lives on the existing per-session `TopologyMcp` Durable
 * Object (`ctx.storage`); the cross-session index lives on already-live
 * `AnalyticsLog` (migration `v5`). Gated by `ANALYTICS_ENABLED` — the same
 * owner-visibility flag as the admin dashboard this extends; no new flag.
 *
 * Every public helper swallows errors: activity recording must never throw
 * into a tool response (same discipline as `worker/auth.ts` `recordLogin`).
 */
import type { WorkerEnv } from './env.js';
import { analyticsEnabled } from './env.js';
import type {
  SessionSummary,
  ToolCallEvent,
} from '../src/agent-activity/model.js';
import {
  MAX_ACTIVITY_STR,
  MAX_ACTIVITY_TS,
  appendTrail,
  boundActivityString,
  guidanceConsultedBefore,
} from '../src/agent-activity/trail.js';

export const TRAIL_KEY = 'activity:trail';

/** Narrow RPC view of the analytics DO session-index methods. */
export interface AnalyticsSessionRpc {
  recordSession(input: {
    sessionId: string;
    ownerId: string;
    ownerLogin?: string;
    startedAt?: string;
    lastToolAt?: string;
    toolCallCount?: number;
  }): Promise<void>;
}

/** Storage slice the trail helpers need (Durable Object `ctx.storage`). */
export interface TrailStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export async function loadTrail(
  storage: TrailStorage,
): Promise<ToolCallEvent[]> {
  return (await storage.get<ToolCallEvent[]>(TRAIL_KEY)) ?? [];
}

export async function persistTrail(
  storage: TrailStorage,
  events: readonly ToolCallEvent[],
): Promise<void> {
  await storage.put(TRAIL_KEY, [...events]);
}

export function boundToolEvent(input: {
  toolName: unknown;
  at?: unknown;
  outcome: unknown;
}): ToolCallEvent | null {
  const toolName = boundActivityString(input.toolName, MAX_ACTIVITY_STR);
  if (!toolName) return null;
  const outcome = input.outcome === 'error' ? 'error' : 'success';
  const at =
    boundActivityString(input.at, MAX_ACTIVITY_TS) || new Date().toISOString();
  return { toolName, at, outcome };
}

/**
 * Append one event to the in-memory trail and persist it. Returns the new
 * trail (or the previous one if persistence throws — memory still advances
 * so same-session explainability is not lost).
 */
export async function recordTrailEvent(
  storage: TrailStorage,
  existing: readonly ToolCallEvent[],
  input: { toolName: string; outcome: 'success' | 'error'; at?: string },
): Promise<ToolCallEvent[]> {
  const event = boundToolEvent(input);
  if (!event) return [...existing];
  const next = appendTrail(existing, event);
  try {
    await persistTrail(storage, next);
  } catch (err) {
    console.error('agent activity trail persist failed', err);
  }
  return next;
}

/** Best-effort index upsert on AnalyticsLog. Never throws. */
export async function indexSession(
  env: WorkerEnv,
  input: {
    sessionId: string;
    ownerId: string;
    ownerLogin?: string;
    startedAt?: string;
    lastToolAt?: string;
    toolCallCount: number;
  },
): Promise<void> {
  if (!analyticsEnabled(env)) return;
  const sessionId = boundActivityString(input.sessionId, MAX_ACTIVITY_STR);
  const ownerId = boundActivityString(input.ownerId, MAX_ACTIVITY_STR);
  if (!sessionId || !ownerId) return;
  try {
    const ns = env.ANALYTICS;
    const stub = ns.get(
      ns.idFromName('global'),
    ) as unknown as AnalyticsSessionRpc;
    await stub.recordSession({
      sessionId,
      ownerId,
      ...(input.ownerLogin
        ? {
            ownerLogin: boundActivityString(input.ownerLogin, MAX_ACTIVITY_STR),
          }
        : {}),
      ...(input.startedAt
        ? { startedAt: boundActivityString(input.startedAt, MAX_ACTIVITY_TS) }
        : {}),
      ...(input.lastToolAt
        ? { lastToolAt: boundActivityString(input.lastToolAt, MAX_ACTIVITY_TS) }
        : {}),
      toolCallCount: input.toolCallCount,
    });
  } catch (err) {
    console.error('agent activity session index failed', err);
  }
}

export function sessionGuidanceConsulted(
  events: readonly ToolCallEvent[],
): boolean {
  return guidanceConsultedBefore(events);
}

export type { SessionSummary, ToolCallEvent };
