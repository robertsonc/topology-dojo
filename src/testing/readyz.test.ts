/**
 * `GET /readyz` (worker/default-handler.ts, packet D3): owner-authenticated
 * readiness, proving the `TOPOLOGY_KV`, `TOPOLOGY_REGISTRY`, and (when
 * `WORKSPACE_ENABLED`) `TOPOLOGY_DOCUMENT` bindings are live. The
 * missing-binding suite follows the `workspace-disabled.test.ts` idiom:
 * deliberately omit a binding from the Miniflare config so a regression
 * that stopped actually touching it would throw loudly instead of the
 * suite passing for the wrong reason.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { DEFAULT_HANDLER_FIXTURE } from './worker-fixtures.js';
import { signSession } from '../server/session.js';

const GITHUB_CLIENT_SECRET = 'd3-readyz-secret';

async function sessionCookie(uid: string, login: string): Promise<string> {
  const token = await signSession({ uid, login }, GITHUB_CLIENT_SECRET);
  return `tdg_session=${token}`;
}

interface ReadyCheck {
  name: string;
  ok: boolean;
  detail?: string;
}
interface ReadyBody {
  ok: boolean;
  checks: ReadyCheck[];
}

describe('GET /readyz — fully bound, workspace enabled', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
      sourcefile: 'readyz-full-fixture.ts',
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

  it('401s without a session', async () => {
    const res = await handle.fetch('/readyz');
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({
      error: 'authentication required',
    });
  });

  it('200s with kv, registry, and document all ok', async () => {
    const cookie = await sessionCookie('r1', 'ready-user');
    const res = await handle.fetch('/readyz', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const data = (await res.json()) as ReadyBody;
    expect(data.ok).toBe(true);
    expect(data.checks).toHaveLength(3);
    expect(data.checks.map((c) => c.name).sort()).toEqual([
      'document',
      'kv',
      'registry',
    ]);
    for (const check of data.checks) expect(check.ok).toBe(true);
  });

  it('405s a POST', async () => {
    const res = await handle.fetch('/readyz', { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('GET /readyz — workspace disabled', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
      sourcefile: 'readyz-flagoff-fixture.ts',
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
        WORKSPACE_ENABLED: 'false',
      },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('omits the document probe and still reports ok for kv + registry', async () => {
    const cookie = await sessionCookie('r2', 'flagoff-user');
    const res = await handle.fetch('/readyz', { headers: { cookie } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as ReadyBody;
    expect(data.ok).toBe(true);
    expect(data.checks.map((c) => c.name).sort()).toEqual(['kv', 'registry']);
  });
});

describe('GET /readyz — TOPOLOGY_REGISTRY binding missing', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
      sourcefile: 'readyz-missing-registry-fixture.ts',
    });
    // Deliberately no TOPOLOGY_REGISTRY binding: proves the registry probe's
    // try/catch actually exercises the real binding rather than trivially
    // succeeding, and that one failing binding does not block the others.
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
      durableObjects: {
        TOPOLOGY_DOCUMENT: { className: 'TopologyDocument', useSQLite: true },
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

  it('503s with only the registry binding marked not-ok', async () => {
    const cookie = await sessionCookie('r3', 'missing-registry-user');
    const res = await handle.fetch('/readyz', { headers: { cookie } });
    expect(res.status).toBe(503);
    const data = (await res.json()) as ReadyBody;
    expect(data.ok).toBe(false);
    const byName = new Map(data.checks.map((c) => [c.name, c]));
    expect(byName.get('kv')?.ok).toBe(true);
    expect(byName.get('document')?.ok).toBe(true);
    expect(byName.get('registry')?.ok).toBe(false);
    expect(byName.get('registry')?.detail).toBeTruthy();
  });
});
