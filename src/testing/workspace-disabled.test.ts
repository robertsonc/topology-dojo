/**
 * WORKSPACE_ENABLED HTTP gate on `/api/workspaces` + `/api/workspaces/*`
 * (worker/default-handler.ts). Covers both flag states named in the D2
 * packet: unset/`"true"` behave exactly as before (401 unauthenticated, 201
 * when authenticated); `"false"` returns the stable 503 body for GET/POST/
 * nested paths without ever touching a DO/KV binding — proven here by simply
 * not configuring those bindings for the disabled suite's Miniflare instance,
 * so a regression that routed into `handleWorkspaceApi` before the flag check
 * would throw instead of quietly 503ing. `/api/topology/:id` and the auth
 * routes are asserted untouched by the gate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { DEFAULT_HANDLER_FIXTURE } from './worker-fixtures.js';
import { signSession } from '../server/session.js';

const GITHUB_CLIENT_SECRET = 'd2-workspace-flag-secret';

function minimalDocument(title: string) {
  return {
    title,
    customNodes: [],
    pages: [
      {
        id: 'p1',
        name: 'Frame 1',
        viewBox: '0 0 1050 700',
        nodes: [],
        links: [],
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
      },
    ],
  };
}

async function sessionCookie(uid: string, login: string): Promise<string> {
  const token = await signSession({ uid, login }, GITHUB_CLIENT_SECRET);
  return `tdg_session=${token}`;
}

describe('WORKSPACE_ENABLED unset — enabled by default', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
      sourcefile: 'workspace-enabled-unset-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
      durableObjects: {
        TOPOLOGY_DOCUMENT: { className: 'TopologyDocument', useSQLite: true },
        TOPOLOGY_REGISTRY: { className: 'TopologyRegistry', useSQLite: true },
      },
      vars: { GITHUB_CLIENT_ID: 'test-client-id', GITHUB_CLIENT_SECRET },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('401s an unauthenticated GET /api/workspaces, same as today', async () => {
    const res = await handle.fetch('/api/workspaces');
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: 'authentication required',
    });
  });

  it('creates a workspace normally for an authenticated POST', async () => {
    const cookie = await sessionCookie('u1', 'alice');
    const res = await handle.fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ document: minimalDocument('t') }),
    });
    expect(res.status).toBe(201);
  });
});

describe('WORKSPACE_ENABLED="true" — explicit enable behaves the same', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
      sourcefile: 'workspace-enabled-true-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
      durableObjects: {
        TOPOLOGY_DOCUMENT: { className: 'TopologyDocument', useSQLite: true },
        TOPOLOGY_REGISTRY: { className: 'TopologyRegistry', useSQLite: true },
      },
      vars: {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET,
        WORKSPACE_ENABLED: 'true',
      },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('401s an unauthenticated GET /api/workspaces', async () => {
    const res = await handle.fetch('/api/workspaces');
    expect(res.status).toBe(401);
  });

  it('creates a workspace normally for an authenticated POST', async () => {
    const cookie = await sessionCookie('u2', 'bob');
    const res = await handle.fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ document: minimalDocument('t') }),
    });
    expect(res.status).toBe(201);
  });
});

describe('WORKSPACE_ENABLED="false" — disabled gate', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
      sourcefile: 'workspace-disabled-fixture.ts',
    });
    // Deliberately no `durableObjects` binding for TOPOLOGY_DOCUMENT/
    // TOPOLOGY_REGISTRY: if the 503 gate ever regressed to routing into
    // handleWorkspaceApi before checking the flag, touching those unbound
    // Durable Objects would throw instead of cleanly 503ing, and this whole
    // suite would fail loudly rather than silently passing for the wrong
    // reason.
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['OAUTH_KV', 'TOPOLOGY_KV'],
      vars: {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET,
        WORKSPACE_ENABLED: 'false',
      },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('503s an unauthenticated GET /api/workspaces with the stable JSON body', async () => {
    const res = await handle.fetch('/api/workspaces');
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({ error: 'workspace_disabled' });
  });

  it('503s even when authenticated (the gate runs before auth/DO access)', async () => {
    const cookie = await sessionCookie('u3', 'carol');
    const res = await handle.fetch('/api/workspaces', {
      headers: { cookie },
    });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'workspace_disabled' });
  });

  it('503s a POST /api/workspaces', async () => {
    const res = await handle.fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ document: minimalDocument('t') }),
    });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'workspace_disabled' });
  });

  it('503s a nested workspace path', async () => {
    const res = await handle.fetch('/api/workspaces/w_abc123/manifest');
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'workspace_disabled' });
  });

  it('leaves GET /api/topology/:id untouched', async () => {
    const kv = await handle.miniflare.getKVNamespace('TOPOLOGY_KV');
    const doc = { title: 'Shared', customNodes: [], pages: [] };
    await kv.put('doc:share1', JSON.stringify(doc));

    const res = await handle.fetch('/api/topology/share1');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(doc);

    const missing = await handle.fetch('/api/topology/does-not-exist');
    expect(missing.status).toBe(404);
  });

  it('leaves the auth routes untouched', async () => {
    const login = await handle.fetch('/login');
    expect(login.status).toBe(200);

    const me = await handle.fetch('/api/me');
    expect(me.status).toBe(401);

    const auth = await handle.fetch('/auth/github', { redirect: 'manual' });
    expect(auth.status).toBe(302);
  });
});
