/**
 * Owner-only admin/analytics API (`/api/admin/*`, MVP + Initiative A). Mirrors
 * `worker/profile-api.ts`: the caller identity always comes from the session
 * cookie (`currentUser`), never request input. Two gates:
 *
 *   1. the deployment-level `ANALYTICS_ENABLED` flag is checked in the router
 *      (`default-handler.ts`) before this handler is ever reached (503);
 *   2. here, the caller must be signed in (401) AND be the configured admin
 *      (`isAdmin` → 403). Fail-closed: with `ADMIN_GITHUB_ID` unset there is no
 *      admin and every request 403s.
 *
 * Strictly metadata: the roster (who logged in, when, how often), each user's
 * workspace names/counts, and MCP-session activity (tool name / timestamp /
 * coarse outcome — never prompts, arguments, or diagram contents). Workspace
 * metadata is read LIVE from their registry via the same two-registry merge
 * the browser/MCP list path uses.
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
import type {
  SessionDetail,
  SessionList,
  SessionSummary,
  ToolCallEvent,
} from '../src/agent-activity/model.js';

/** Narrow RPC view of the analytics DO (explicit — see `profile-api.ts`). */
interface AnalyticsReadRpc {
  listRoster(): Promise<RosterEntry[]>;
  recentLogins(limit?: number): Promise<LoginEvent[]>;
  listSessions(limit?: number): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<SessionSummary | null>;
}

/** Narrow RPC view of a per-session `TopologyMcp` DO's activity trail. */
interface McpActivityRpc {
  getActivityTrail(): Promise<ToolCallEvent[]>;
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

    // GET /api/admin/sessions — recent MCP sessions across all owners.
    if (parts.length === 3 && parts[2] === 'sessions') {
      if (request.method !== 'GET') return methodNotAllowed();
      const sessions = await analytics.listSessions(50);
      const body: SessionList = { sessions };
      return json(body);
    }

    // GET /api/admin/sessions/:id — that session's tool-call trail.
    if (parts.length === 4 && parts[2] === 'sessions') {
      if (request.method !== 'GET') return methodNotAllowed();
      const sessionId = decodeURIComponent(parts[3] ?? '');
      if (!sessionId) return json({ error: 'session id is required' }, 400);
      const session = await analytics.getSession(sessionId);
      let events: ToolCallEvent[] = [];
      try {
        const ns = env.MCP_OBJECT;
        const stub = ns.get(
          ns.idFromString(sessionId),
        ) as unknown as McpActivityRpc;
        events = await stub.getActivityTrail();
      } catch (err) {
        // Malformed ids throw from idFromString; an evicted/uninitialized
        // session DO just has an empty trail. Either way, fall through to
        // the index row if we have one.
        console.error('agent activity trail fetch failed', err);
      }
      if (!session && events.length === 0)
        return json({ error: 'unknown session' }, 404);
      const detail: SessionDetail = {
        session: session ?? {
          sessionId,
          ownerId: '',
          startedAt: events[0]?.at ?? '',
          toolCallCount: events.length,
        },
        events,
      };
      return json(detail);
    }

    return json({ error: 'not found' }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 400);
  }
}
