/**
 * ANALYTICS_ENABLED gate + owner-only `/api/admin/sessions` surface
 * (Initiative A). Mirrors `admin-api.test.ts`:
 *
 * - default (flag unset) ⇒ DISABLED: 503 `admin_disabled` even for the owner;
 * - `"true"` ⇒ 401 unauth, 403 non-admin, 200 for the owner with session
 *   index + tool-call trail (metadata only).
 *
 * Worker-level harness (Miniflare, CI only).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { signSession } from '../server/session.js';
import type { SessionDetail, SessionList } from '../agent-activity/model.js';

const GITHUB_CLIENT_SECRET = 'admin-sessions-secret';
const ADMIN_UID = 'admin-1';

const SESSIONS_HANDLER_FIXTURE = String.raw`
import { DurableObject } from 'cloudflare:workers';
import { defaultHandler } from './worker/default-handler.ts';
export { AnalyticsLog } from './worker/analytics.ts';
export { TopologyRegistry } from './worker/registry.ts';

/** Stand-in for TopologyMcp's activity RPC — no McpAgent handshake required. */
export class TopologyMcp extends DurableObject {
  async getActivityTrail() {
    return (await this.ctx.storage.get('activity:trail')) ?? [];
  }
  async seedTrail(events) {
    await this.ctx.storage.put('activity:trail', events);
  }
}

function unimplemented(name) {
  return () => {
    throw new Error(
      'OAUTH_PROVIDER.' + name + ' is not stubbed by the admin-sessions fixture',
    );
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/__newSessionId' && request.method === 'GET') {
      const name = url.searchParams.get('name') || 'admin-session-1';
      return Response.json({
        id: env.MCP_OBJECT.idFromName(name).toString(),
      });
    }
    if (url.pathname === '/__seedSession' && request.method === 'POST') {
      const body = await request.json();
      const analytics = env.ANALYTICS.get(env.ANALYTICS.idFromName('global'));
      await analytics.recordSession(body.session);
      if (body.events) {
        const stub = env.MCP_OBJECT.get(
          env.MCP_OBJECT.idFromString(body.session.sessionId),
        );
        await stub.seedTrail(body.events);
      }
      return Response.json({ ok: true });
    }
    const stubbedEnv = Object.assign({}, env, {
      OAUTH_PROVIDER: {
        parseAuthRequest: unimplemented('parseAuthRequest'),
        completeAuthorization: unimplemented('completeAuthorization'),
      },
      ASSETS:
        env.ASSETS ??
        { fetch: async () => new Response('Not Found', { status: 404 }) },
    });
    return defaultHandler.fetch(request, stubbedEnv, ctx);
  },
};
`;

async function sessionCookie(uid: string, login: string): Promise<string> {
  const token = await signSession({ uid, login }, GITHUB_CLIENT_SECRET);
  return `tdg_session=${token}`;
}

describe('ANALYTICS_ENABLED="true" — owner-only session routes', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(SESSIONS_HANDLER_FIXTURE, {
      sourcefile: 'admin-sessions-enabled-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
      durableObjects: {
        ANALYTICS: { className: 'AnalyticsLog', useSQLite: true },
        TOPOLOGY_REGISTRY: { className: 'TopologyRegistry', useSQLite: true },
        MCP_OBJECT: { className: 'TopologyMcp', useSQLite: true },
      },
      vars: {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET,
        ANALYTICS_ENABLED: 'true',
        ADMIN_GITHUB_ID: ADMIN_UID,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('401s unauthenticated GET /api/admin/sessions', async () => {
    const res = await handle.fetch('/api/admin/sessions');
    expect(res.status).toBe(401);
  });

  it('403s a signed-in NON-admin', async () => {
    const res = await handle.fetch('/api/admin/sessions', {
      headers: { cookie: await sessionCookie('u2', 'bob') },
    });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'admin_forbidden' });
  });

  it('403s session detail for a non-admin', async () => {
    const res = await handle.fetch('/api/admin/sessions/nope', {
      headers: { cookie: await sessionCookie('u2', 'bob') },
    });
    expect(res.status).toBe(403);
  });

  it('lists recent sessions and serves a trail to the admin', async () => {
    const cookie = await sessionCookie(ADMIN_UID, 'owner');
    const idRes = await handle.fetch('/__newSessionId');
    const { id: sessionId } = (await idRes.json()) as { id: string };

    const seed = await handle.fetch('/__seedSession', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: {
          sessionId,
          ownerId: 'u_alice',
          ownerLogin: 'alice',
          startedAt: '2026-08-19T09:00:00.000Z',
          lastToolAt: '2026-08-19T09:01:00.000Z',
          toolCallCount: 2,
        },
        events: [
          {
            toolName: 'get_authoring_guidance',
            at: '2026-08-19T09:00:30.000Z',
            outcome: 'success',
          },
          {
            toolName: 'list_templates',
            at: '2026-08-19T09:01:00.000Z',
            outcome: 'success',
          },
        ],
      }),
    });
    expect(seed.status).toBe(200);

    const list = await handle.fetch('/api/admin/sessions', {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as SessionList;
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({
      sessionId,
      ownerLogin: 'alice',
      toolCallCount: 2,
    });

    const detail = await handle.fetch(
      `/api/admin/sessions/${encodeURIComponent(sessionId)}`,
      { headers: { cookie } },
    );
    expect(detail.status).toBe(200);
    const session = (await detail.json()) as SessionDetail;
    expect(session.session.ownerLogin).toBe('alice');
    expect(session.events.map((e) => e.toolName)).toEqual([
      'get_authoring_guidance',
      'list_templates',
    ]);
    expect(JSON.stringify(session)).not.toMatch(/prompt|argument|diagram/i);
  }, 30_000);

  it('404s an unknown session id', async () => {
    const cookie = await sessionCookie(ADMIN_UID, 'owner');
    const idRes = await handle.fetch('/__newSessionId?name=never-indexed');
    const { id } = (await idRes.json()) as { id: string };
    const res = await handle.fetch(
      `/api/admin/sessions/${encodeURIComponent(id)}`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(404);
  });
});

describe('ANALYTICS_ENABLED unset — session routes fail closed', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(SESSIONS_HANDLER_FIXTURE, {
      sourcefile: 'admin-sessions-disabled-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
      vars: {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET,
        ADMIN_GITHUB_ID: ADMIN_UID,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('503s /api/admin/sessions even for the admin', async () => {
    const res = await handle.fetch('/api/admin/sessions', {
      headers: { cookie: await sessionCookie(ADMIN_UID, 'owner') },
    });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'admin_disabled' });
  });
});
