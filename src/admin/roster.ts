/**
 * Pure roster/login-log shaping for the admin analytics store (MVP). Kept
 * side-effect-free and deterministic — time is an injected ISO string, never a
 * clock — so the upsert/eviction rules have real LOCAL unit coverage
 * (`roster.test.ts`) independent of the workerd-only DO harness. The
 * `AnalyticsLog` DO (`worker/analytics.ts`) is a thin `ctx.storage` shell over
 * these functions, exactly as `worker/profile.ts` shells `src/profile/learner.ts`.
 */
import type { LoginEvent, RosterEntry } from './model.js';

/** Max recent-login events retained globally; the oldest are evicted so the
 * store stays bounded (same discipline as `MAX_CANDIDATES_PER_OWNER`). */
export const MAX_RECENT_LOGINS = 1000;

/** One recorded login, already coerced/bounded at the DO trust boundary. */
export interface LoginInput {
  uid: string;
  login: string;
  name?: string;
  /** ISO timestamp of the login. */
  at: string;
}

/**
 * Fold a login into the roster: a first-seen user becomes a new entry; a
 * returning user keeps `firstSeenAt`, refreshes `login`/`name`/`lastLoginAt`,
 * and increments `loginCount`. Returns a NEW record.
 */
export function upsertRoster(
  existing: RosterEntry | undefined,
  login: LoginInput,
): RosterEntry {
  if (!existing) {
    return {
      uid: login.uid,
      login: login.login,
      ...(login.name ? { name: login.name } : {}),
      firstSeenAt: login.at,
      lastLoginAt: login.at,
      loginCount: 1,
    };
  }
  return {
    ...existing,
    login: login.login,
    // A later login with a name replaces a stale/absent one; a login without a
    // name never erases a name we already know.
    ...(login.name
      ? { name: login.name }
      : existing.name
        ? { name: existing.name }
        : {}),
    lastLoginAt: login.at,
    loginCount: existing.loginCount + 1,
  };
}

/** Append a login to the bounded recent-events list (newest last), evicting
 * the oldest once over the cap. */
export function appendRecent(
  existing: readonly LoginEvent[],
  event: LoginEvent,
): LoginEvent[] {
  const next = [...existing, event];
  return next.length > MAX_RECENT_LOGINS
    ? next.slice(next.length - MAX_RECENT_LOGINS)
    : next;
}

/** Roster ordered for the dashboard: most-recently-active first, then login,
 * then uid — a total, stable order. */
export function sortRoster(entries: readonly RosterEntry[]): RosterEntry[] {
  return [...entries].sort(
    (a, b) =>
      b.lastLoginAt.localeCompare(a.lastLoginAt) ||
      a.login.localeCompare(b.login) ||
      a.uid.localeCompare(b.uid),
  );
}
