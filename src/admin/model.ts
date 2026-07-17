/**
 * Shared shapes for the owner-only admin/analytics dashboard (MVP).
 *
 * Imported by BOTH `worker/` (the `AnalyticsLog` Durable Object + the
 * owner-gated `/api/admin` routes) and the browser client/UI, so — like
 * `src/profile/model.ts` — it lives under `src/` and carries types plus plain
 * data only (no runtime behavior, no DOM, no I/O).
 *
 * The dashboard is strictly metadata: who logged in and when, and how many
 * workspaces each user has (names/counts, read live from their registry). It
 * never carries diagram contents.
 */

/** One user in the login roster — upserted on every browser login. */
export interface RosterEntry {
  /** Stable GitHub numeric id (as a string). */
  uid: string;
  /** GitHub login (may change over time; the latest seen wins). */
  login: string;
  /** GitHub display name, when the account exposes one. */
  name?: string;
  /** ISO timestamp of the first login this deployment ever recorded. */
  firstSeenAt: string;
  /** ISO timestamp of the most recent login. */
  lastLoginAt: string;
  /** Total logins recorded for this user. */
  loginCount: number;
}

/** One recorded login, for the recent-activity view. Bounded + oldest-evicted
 * in the DO so the store never grows without limit. */
export interface LoginEvent {
  uid: string;
  login: string;
  /** ISO timestamp of the login. */
  at: string;
}

/** The `GET /api/admin/summary` payload. */
export interface AdminSummary {
  /** Roster, most-recently-active first. */
  users: RosterEntry[];
  /** Recent logins, newest first. */
  recentLogins: LoginEvent[];
  totals: { users: number; logins: number };
}
