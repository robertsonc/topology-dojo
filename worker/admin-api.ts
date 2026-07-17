/**
 * Owner-only admin/analytics API (`/api/admin/*`, MVP). Mirrors
 * `worker/profile-api.ts`: the caller identity always comes from the session
 * cookie (`currentUser`), never request input. Two gates:
 *
 *   1. the deployment-level `ANALYTICS_ENABLED` flag is checked in the router
 *      (`default-handler.ts`) before this handler is ever reached (503);
 *   2. here, the caller must be signed in (401) AND be the configured admin
 *      (`isAdmin` → 403). Fail-closed: with `ADMIN_GITHUB_ID` unset there is no
 *      admin and every request 403s.
 *
 * Strictly metadata: the roster (who logged in, when, how often) and each
 * user's workspace names/counts — read LIVE from their registry via the same
 * two-registry merge the browser/MCP list path uses. Never diagram contents.
 */
import type { WorkerEnv } from './env.js';
import { isAdmin } from './env.js';
import { currentUser } from './auth.js';
import { WorkspaceService } from './workspaces.js';
import type {
  AdminSummary,
  LoginEvent,
  RosterEntry,
} from '../src/admin/model.js';

/** Narrow RPC view of the analytics DO (explicit — see `profile-api.ts`). */
interface AnalyticsReadRpc {
  listRoster(): Promise<RosterEntry[]>;
  recentLogins(limit?: number): Promise<LoginEvent[]>;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function methodNotAllowed(): Response {
  return json({ error: 'method not allowed' }, 405);
}

export async function handleAdminApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'authentication required' }, 401);
  if (!isAdmin(env, user.uid)) return json({ error: 'admin_forbidden' }, 403);

  const ns = env.ANALYTICS;
  const analytics = ns.get(
    ns.idFromName('global'),
  ) as unknown as AnalyticsReadRpc;
  const url = new URL(request.url);
  // ['api', 'admin', 'summary'] | ['api', 'admin', 'users', :uid, 'workspaces']
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    // GET /api/admin/summary — roster + recent logins + totals.
    if (parts.length === 3 && parts[2] === 'summary') {
      if (request.method !== 'GET') return methodNotAllowed();
      const [users, recentLogins] = await Promise.all([
        analytics.listRoster(),
        analytics.recentLogins(50),
      ]);
      const summary: AdminSummary = {
        users,
        recentLogins,
        totals: {
          users: users.length,
          logins: users.reduce((n, u) => n + u.loginCount, 0),
        },
      };
      return json(summary);
    }

    // GET /api/admin/users/:uid/workspaces — that user's workspaces (metadata
    // only), read live from BOTH their current + legacy registries via the
    // same merge WorkspaceService.list() performs.
    if (
      parts.length === 5 &&
      parts[2] === 'users' &&
      parts[4] === 'workspaces'
    ) {
      if (request.method !== 'GET') return methodNotAllowed();
      const uid = decodeURIComponent(parts[3] ?? '');
      if (!uid) return json({ error: 'user id is required' }, 400);
      const entry = (await analytics.listRoster()).find((u) => u.uid === uid);
      if (!entry) return json({ error: 'unknown user' }, 404);
      const workspaces = await new WorkspaceService(env, {
        uid: entry.uid,
        login: entry.login,
        ...(entry.name ? { name: entry.name } : {}),
      }).list();
      return json({ uid, login: entry.login, workspaces });
    }

    return json({ error: 'not found' }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 400);
  }
}
