/**
 * Thin browser client for the owner-only admin API (`/api/admin/*`, MVP).
 * Mirrors `src/profile/client.ts`: plain fetch wrappers plus typed errors for
 * the deployment-level gate (503) and the non-owner gate (403), so the
 * dashboard can show clean states instead of raw statuses.
 */
import type { WorkspaceListItem } from '../workspace/model.js';
import type { AdminSummary } from './model.js';
import type { SessionDetail, SessionList } from '../agent-activity/model.js';

/** The analytics/admin surface is disabled on this deployment
 * (`ANALYTICS_ENABLED` unset/!== "true"). */
export class AdminDisabledError extends Error {
  constructor() {
    super('The admin dashboard is not enabled on this deployment.');
    this.name = 'AdminDisabledError';
  }
}

/** The signed-in user is not the configured admin (`ADMIN_GITHUB_ID`). */
export class AdminForbiddenError extends Error {
  constructor() {
    super('You are not authorized to view the admin dashboard.');
    this.name = 'AdminForbiddenError';
  }
}

async function decode<T>(response: Response): Promise<T> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`admin request failed (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const message = (value as { error?: unknown }).error;
    if (response.status === 503 && message === 'admin_disabled')
      throw new AdminDisabledError();
    if (response.status === 403) throw new AdminForbiddenError();
    throw new Error(
      typeof message === 'string'
        ? message
        : `admin request failed (HTTP ${response.status})`,
    );
  }
  return value as T;
}

async function request<T>(path: string): Promise<T> {
  return decode<T>(
    await fetch(path, { headers: { accept: 'application/json' } }),
  );
}

/** The roster + recent logins + totals. */
export function fetchAdminSummary(): Promise<AdminSummary> {
  return request('/api/admin/summary');
}

/** One user's workspaces (metadata only), read live from their registry. */
export function fetchUserWorkspaces(
  uid: string,
): Promise<{ uid: string; login: string; workspaces: WorkspaceListItem[] }> {
  return request(`/api/admin/users/${encodeURIComponent(uid)}/workspaces`);
}

/** Recent MCP sessions (metadata only — tool names, not arguments). */
export function fetchAdminSessions(): Promise<SessionList> {
  return request('/api/admin/sessions');
}

/** One session's bounded tool-call trail. */
export function fetchAdminSession(id: string): Promise<SessionDetail> {
  return request(`/api/admin/sessions/${encodeURIComponent(id)}`);
}
