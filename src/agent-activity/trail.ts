/**
 * Pure shaping/eviction helpers for the per-session tool-call ring buffer and
 * the per-owner session index. Side-effect-free and deterministic — time is
 * an injected ISO string, never a clock — so the Durable Object shells
 * (`TopologyMcp` trail storage, `AnalyticsLog` session index) have real LOCAL
 * unit coverage independent of the workerd-only harness. Same split as
 * `src/admin/roster.ts`.
 */
import {
  GUIDANCE_TOOL_NAME,
  type SessionSummary,
  type ToolCallEvent,
} from './model.js';

/** Max tool-call events retained on one MCP session DO; oldest are evicted. */
export const MAX_TRAIL_EVENTS = 200;

/** Max session-index rows retained globally on AnalyticsLog; oldest evicted. */
export const MAX_SESSION_INDEX = 200;

/** Max string length at the store trust boundary (tool names, ids, logins). */
export const MAX_ACTIVITY_STR = 200;

/** ISO timestamp cap (same ballpark as `worker/analytics.ts` MAX_TS). */
export const MAX_ACTIVITY_TS = 40;

/**
 * Append a tool-call event to the bounded trail (newest last), evicting the
 * oldest once over the cap. Returns a NEW array.
 */
export function appendTrail(
  existing: readonly ToolCallEvent[],
  event: ToolCallEvent,
): ToolCallEvent[] {
  const next = [...existing, event];
  return next.length > MAX_TRAIL_EVENTS
    ? next.slice(next.length - MAX_TRAIL_EVENTS)
    : next;
}

/**
 * Fold a session into the owner's (global) index: a first-seen sessionId
 * becomes a new row; a returning session keeps `startedAt`, refreshes
 * `ownerLogin` / `lastToolAt` / `toolCallCount`, and moves to newest-last
 * so recent activity is not evicted. Returns a NEW array, capped.
 */
export function upsertSessionIndex(
  existing: readonly SessionSummary[],
  next: SessionSummary,
): SessionSummary[] {
  const idx = existing.findIndex((s) => s.sessionId === next.sessionId);
  let row: SessionSummary;
  let without: SessionSummary[];
  if (idx === -1) {
    row = next;
    without = [...existing];
  } else {
    const prev = existing[idx]!;
    row = {
      ...prev,
      ownerId: next.ownerId || prev.ownerId,
      ...(next.ownerLogin
        ? { ownerLogin: next.ownerLogin }
        : prev.ownerLogin
          ? { ownerLogin: prev.ownerLogin }
          : {}),
      lastToolAt: next.lastToolAt ?? prev.lastToolAt,
      toolCallCount: next.toolCallCount,
      startedAt: prev.startedAt,
    };
    without = [...existing.slice(0, idx), ...existing.slice(idx + 1)];
  }
  const list = [...without, row];
  return list.length > MAX_SESSION_INDEX
    ? list.slice(list.length - MAX_SESSION_INDEX)
    : list;
}

/** Sessions ordered for the dashboard: most-recently-active first. */
export function sortSessions(
  entries: readonly SessionSummary[],
): SessionSummary[] {
  return [...entries].sort((a, b) => {
    const aAt = a.lastToolAt ?? a.startedAt;
    const bAt = b.lastToolAt ?? b.startedAt;
    return (
      bAt.localeCompare(aAt) ||
      b.startedAt.localeCompare(a.startedAt) ||
      a.sessionId.localeCompare(b.sessionId)
    );
  });
}

/**
 * Honest, non-causal signal: `get_authoring_guidance` succeeded in this
 * trail. Callers that pass `beforeIso` only count events at-or-before that
 * instant (so a later guidance call cannot back-date onto an earlier edit).
 */
export function guidanceConsultedBefore(
  events: readonly ToolCallEvent[],
  beforeIso?: string,
): boolean {
  return events.some(
    (event) =>
      event.toolName === GUIDANCE_TOOL_NAME &&
      event.outcome === 'success' &&
      (beforeIso === undefined || event.at <= beforeIso),
  );
}

/** Bound a string at the store trust boundary. Empty for non-strings. */
export function boundActivityString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}
