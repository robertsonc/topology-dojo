/**
 * ANALYTICS_ENABLED gate + owner-only route surface for `/api/admin/*`
 * (worker/default-handler.ts → worker/admin-api.ts, admin dashboard MVP).
 * Mirrors `profile-api.test.ts`:
 *
 * - default (flag unset) ⇒ DISABLED: the stable 503 `{"error":"admin_disabled"}`
 *   body, proven to run before any binding read by simply NOT configuring the
 *   ANALYTICS Durable Object for that instance;
 * - `"true"` ⇒ enabled: 401 without a session, **403 for a non-admin session**
 *   (uid ≠ ADMIN_GITHUB_ID), and for the admin the roster (through the same
 *   `idFromName('global')` key the login path writes) + per-user workspaces
 *   (read live from the seeded registry).
 *
 * Worker-level harness (Miniflare, CI only — fails to start locally with
 * `File is not defined`, same as the other suites in this directory).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { signSession } from '../server/session.js';
import type { AdminSummary } from '../admin/model.js';
import type { WorkspaceListItem } from '../workspace/model.js';

const GITHUB_CLIENT_SECRET = 'admin-flag-secret';
const ADMIN_UID = 'admin-1';

/** Wraps `defaultHandler` (OAUTH_PROVIDER/ASSETS stubbed) and adds two
 * test-only seed routes writing through the EXACT identity keys the real code
 * uses: a login through `ANALYTICS.idFromName('global')` (admin-api reads that
 * instance) and a workspace directory record through the owner's
 * `TOPOLOGY_REGISTRY.idFromName('user-id:<uid>')` (what WorkspaceService.list
 * reads). */
const ADMIN_HANDLER_FIXTURE = String.raw`
import { defaultHandler } from './worker/default-handler.ts';
export { AnalyticsLog } from './worker/analytics.ts';
export { TopologyRegistry } from './worker/registry.ts';

function unimplemented(name) {
  return () => {
    throw new Error(
      'OAUTH_PROVIDER.' + name + ' is not stubbed by the admin-api fixture',
    );
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/__seedLogin' && request.method === 'POST') {
      const login = await request.json();
      const ns = env.ANALYTICS;
      await ns.get(ns.idFromName('global')).recordLogin(login);
      return Response.json({ ok: true });
    }
    if (url.pathname === '/__seedWorkspace' && request.method === 'POST') {
      const { uid, record } = await request.json();
      const ns = env.TOPOLOGY_REGISTRY;
      await ns.get(ns.idFromName('user-id:' + String(uid))).markWorkspace(record);
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

describe('ANALYTICS_ENABLED="true" — owner-only admin routes', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(ADMIN_HANDLER_FIXTURE, {
      sourcefile: 'admin-api-enabled-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
      durableObjects: {
        ANALYTICS: { className: 'AnalyticsLog', useSQLite: true },
        TOPOLOGY_REGISTRY: { className: 'TopologyRegistry', useSQLite: true },
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

  it('401s an unauthenticated GET /api/admin/summary', async () => {
    const res = await handle.fetch('/api/admin/summary');
    expect(res.status).toBe(401);
  });

  it('403s a signed-in NON-admin (uid ≠ ADMIN_GITHUB_ID)', async () => {
    const res = await handle.fetch('/api/admin/summary', {
      headers: { cookie: await sessionCookie('u2', 'bob') },
    });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'admin_forbidden' });
  });

  it('serves the roster to the admin, counting logins through the global key', async () => {
    const cookie = await sessionCookie(ADMIN_UID, 'owner');
    // Two logins for alice, one for bob — recorded through idFromName('global'),
    // in chronological order (as real logins arrive: `at` is server-assigned at
    // login, so the append log's insertion order is always chronological).
    for (const login of [
      { uid: 'u_alice', login: 'alice', at: '2026-07-17T09:00:00.000Z' },
      { uid: 'u_bob', login: 'bob', at: '2026-07-17T10:00:00.000Z' },
      { uid: 'u_alice', login: 'alice', at: '2026-07-17T12:00:00.000Z' },
    ]) {
      const seed = await handle.fetch('/__seedLogin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(login),
      });
      expect(seed.status).toBe(200);
    }

    const res = await handle.fetch('/api/admin/summary', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const summary = (await res.json()) as AdminSummary;
    expect(summary.totals).toEqual({ users: 2, logins: 3 });
    // Most-recently-active first: alice (12:00) before bob (10:00).
    expect(summary.users.map((u) => u.login)).toEqual(['alice', 'bob']);
    const alice = summary.users[0]!;
    expect(alice.loginCount).toBe(2);
    expect(alice.firstSeenAt).toBe('2026-07-17T09:00:00.000Z');
    expect(alice.lastLoginAt).toBe('2026-07-17T12:00:00.000Z');
    // Recent logins newest-first.
    expect(summary.recentLogins[0]!.login).toBe('alice');
    expect(summary.recentLogins).toHaveLength(3);
  }, 30_000);

  it('returns a user’s workspaces (metadata only) read live from their registry', async () => {
    const cookie = await sessionCookie(ADMIN_UID, 'owner');
    await handle.fetch('/__seedLogin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uid: 'u_carol',
        login: 'carol',
        at: '2026-07-17T08:00:00.000Z',
      }),
    });
    await handle.fetch('/__seedWorkspace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uid: 'u_carol',
        record: {
          id: 'w_1',
          title: 'Carol Net',
          pages: 3,
          revision: 7,
          updatedAt: '2026-07-17T08:30:00.000Z',
          migratedFromLegacy: false,
        },
      }),
    });

    const res = await handle.fetch('/api/admin/users/u_carol/workspaces', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      uid: string;
      login: string;
      workspaces: WorkspaceListItem[];
    };
    expect(body.login).toBe('carol');
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0]).toMatchObject({
      id: 'w_1',
      title: 'Carol Net',
      pages: 3,
      revision: 7,
    });
  }, 30_000);

  it('404s workspaces for an unknown user, and 404s an unknown admin path', async () => {
    const cookie = await sessionCookie(ADMIN_UID, 'owner');
    const unknown = await handle.fetch('/api/admin/users/nope/workspaces', {
      headers: { cookie },
    });
    expect(unknown.status).toBe(404);
    const bad = await handle.fetch('/api/admin/bogus', {
      headers: { cookie },
    });
    expect(bad.status).toBe(404);
  });
});

describe('ANALYTICS_ENABLED unset — disabled by default (opt-in flag)', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(ADMIN_HANDLER_FIXTURE, {
      sourcefile: 'admin-api-disabled-fixture.ts',
    });
    // Deliberately NO ANALYTICS Durable Object binding: if the 503 gate ever
    // regressed to routing into handleAdminApi before checking the flag,
    // touching the unbound namespace would throw instead of cleanly 503ing.
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

  it('503s /api/admin/summary with the stable JSON body (even for the admin)', async () => {
    const res = await handle.fetch('/api/admin/summary', {
      headers: { cookie: await sessionCookie(ADMIN_UID, 'owner') },
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({ error: 'admin_disabled' });
  });
});
