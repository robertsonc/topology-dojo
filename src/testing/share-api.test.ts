/**
 * Share publish / list / revoke (finding M20, unified with PR #240) —
 * `worker/share.ts` layered over the canonical snapshot contract
 * (`src/share/snapshot.ts`) plus the `/api/share` + `DELETE
 * /api/topology/:id` routes in `worker/default-handler.ts`.
 *
 * Two halves:
 * 1. Pure unit tests of the share layer against an in-memory KV — publish
 *    writes owner METADATA (authoritative) and a listing-index record;
 *    revoke goes through the metadata check (foreign = forbidden, never a
 *    delete) and prunes the index; listings prune expired records; the
 *    index is capped.
 * 2. A Miniflare suite through the real default handler: session-gated
 *    publish → list → public serve (revocation-compatible 60s caching) →
 *    foreign-owner revoke 403 → owner revoke via the canonical
 *    `DELETE /api/topology/:id` → the public link 404s and the listing
 *    empties.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  listShares,
  publishSnapshot,
  revokeShare,
  SHARE_TTL_SECONDS,
  type ShareEnv,
  type ShareIndexStore,
} from '../../worker/share.js';
import type { TopologyDocument } from '../pages/model.js';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { DEFAULT_HANDLER_FIXTURE } from './worker-fixtures.js';
import { signSession } from '../server/session.js';

/* ── half 1: the pure share layer ─────────────────────────────────────── */

type MemoryKv = ShareIndexStore & {
  dump(): Map<string, { value: string; metadata?: unknown }>;
};
function memoryKv(): MemoryKv {
  const map = new Map<string, { value: string; metadata?: unknown }>();
  return {
    async get(key: string) {
      return map.get(key)?.value ?? null;
    },
    async getWithMetadata(key: string) {
      const entry = map.get(key);
      return { value: entry?.value ?? null, metadata: entry?.metadata };
    },
    async put(
      key: string,
      value: string,
      options?: { expirationTtl?: number; metadata?: unknown },
    ) {
      map.set(key, {
        value,
        ...(options?.metadata !== undefined
          ? { metadata: options.metadata }
          : {}),
      });
    },
    async delete(key: string) {
      map.delete(key);
    },
    dump() {
      return map;
    },
  } as MemoryKv;
}

function env(kv: ShareIndexStore): ShareEnv {
  return {
    TOPOLOGY_KV: kv,
    PUBLIC_BASE_URL: 'https://dojo.example',
  };
}

function doc(title = 'Test topology'): TopologyDocument {
  return {
    title,
    pages: [
      {
        id: 'p1',
        name: 'Frame 1',
        viewBox: '0 0 1050 700',
        nodes: [{ id: 'n1', type: 'host', x: 100, y: 100, label: 'H' }],
        links: [],
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
      },
    ],
    customNodes: [],
  };
}

describe('share layer (worker/share.ts over src/share/snapshot.ts)', () => {
  it('publish stores the snapshot WITH owner metadata and indexes it', async () => {
    const kv = memoryKv();
    const e = env(kv);
    const out = await publishSnapshot(e, '42', doc('Branch WAN'));
    expect(out.url).toBe(`https://dojo.example/v/${out.id}`);
    const stored = kv.dump().get(`doc:${out.id}`);
    expect(stored).toBeDefined();
    // The canonical ownership record — what every revoke path checks.
    expect(stored!.metadata).toEqual({ ownerId: '42' });
    const shares = await listShares(e, '42');
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ id: out.id, title: 'Branch WAN' });
    expect(shares[0]!.expiresAt).toBeGreaterThan(Date.now());
    expect(shares[0]!.expiresAt).toBeLessThanOrEqual(
      Date.now() + SHARE_TTL_SECONDS * 1000,
    );
  });

  it('newest publish lists first', async () => {
    const e = env(memoryKv());
    const a = await publishSnapshot(e, 'u', doc('first'));
    const b = await publishSnapshot(e, 'u', doc('second'));
    const shares = await listShares(e, 'u');
    expect(shares.map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it('revoke deletes the snapshot and prunes the index record', async () => {
    const kv = memoryKv();
    const e = env(kv);
    const out = await publishSnapshot(e, 'owner', doc());
    expect(await revokeShare(e, 'owner', out.id)).toBe('revoked');
    expect(kv.dump().has(`doc:${out.id}`)).toBe(false);
    expect(await listShares(e, 'owner')).toEqual([]);
  });

  it("a foreign owner's revoke is FORBIDDEN and touches nothing", async () => {
    const kv = memoryKv();
    const e = env(kv);
    const out = await publishSnapshot(e, 'alice', doc());
    expect(await revokeShare(e, 'mallory', out.id)).toBe('forbidden');
    expect(kv.dump().has(`doc:${out.id}`)).toBe(true); // still live
    expect(await listShares(e, 'alice')).toHaveLength(1); // still listed
    expect(await revokeShare(e, 'alice', 'nope')).toBe('not_found');
  });

  it('a legacy snapshot without metadata cannot be revoked (fail closed)', async () => {
    const kv = memoryKv();
    const e = env(kv);
    await kv.put('doc:legacy1', '{"pages":[]}'); // no metadata
    expect(await revokeShare(e, 'anyone', 'legacy1')).toBe('forbidden');
    expect(kv.dump().has('doc:legacy1')).toBe(true);
  });

  it('expired records are pruned from listings', async () => {
    const kv = memoryKv();
    const e = env(kv);
    const out = await publishSnapshot(e, 'u', doc());
    const key = 'shares:u';
    const idx = JSON.parse(kv.dump().get(key)!.value) as {
      expiresAt: number;
    }[];
    idx[0]!.expiresAt = Date.now() - 1000;
    await kv.put(key, JSON.stringify(idx));
    expect(await listShares(e, 'u')).toEqual([]);
    expect(JSON.parse(kv.dump().get(key)!.value)).toEqual([]);
    expect(out.id).toBeTruthy();
  });

  it('caps the per-owner index at 50 records', async () => {
    const e = env(memoryKv());
    for (let i = 0; i < 55; i++) await publishSnapshot(e, 'u', doc(`t${i}`));
    const shares = await listShares(e, 'u');
    expect(shares).toHaveLength(50);
    expect(shares[0]!.title).toBe('t54'); // newest kept
  });
});

/* ── half 2: the routes through the real handler ──────────────────────── */

const GITHUB_CLIENT_SECRET = 'share-api-secret';

async function sessionCookie(uid: string, login: string): Promise<string> {
  const token = await signSession({ uid, login }, GITHUB_CLIENT_SECRET);
  return `tdg_session=${token}`;
}

describe('/api/share + DELETE /api/topology/:id (Miniflare)', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
      sourcefile: 'share-api-fixture.ts',
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

  it('401s without a session (publish, list, revoke)', async () => {
    for (const [path, method] of [
      ['/api/share', 'POST'],
      ['/api/share', 'GET'],
      ['/api/topology/abc', 'DELETE'],
    ] as const) {
      const res = await handle.fetch(path, { method });
      expect(res.status).toBe(401);
    }
  });

  it('publish → list → public serve → foreign 403 → owner revoke → gone', async () => {
    const cookie = await sessionCookie('900', 'share-owner');

    // Publish.
    const pub = await handle.fetch('/api/share', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ document: doc('Live demo') }),
    });
    expect(pub.status).toBe(201);
    const { id, url } = (await pub.json()) as { id: string; url: string };
    expect(id).toBeTruthy();
    expect(url).toContain(`/v/${id}`);

    // List shows it.
    const list = await handle.fetch('/api/share', { headers: { cookie } });
    const { shares } = (await list.json()) as {
      shares: { id: string; title: string }[];
    };
    expect(shares.some((s) => s.id === id && s.title === 'Live demo')).toBe(
      true,
    );

    // The public snapshot serves with revocation-compatible caching
    // (finding M20): 60s, never immutable.
    const snap = await handle.fetch(`/api/topology/${id}`);
    expect(snap.status).toBe(200);
    expect(snap.headers.get('cache-control')).toBe('public, max-age=60');

    // A different user cannot revoke it (metadata ownership → 403).
    const other = await sessionCookie('901', 'not-the-owner');
    const foreign = await handle.fetch(`/api/topology/${id}`, {
      method: 'DELETE',
      headers: { cookie: other },
    });
    expect(foreign.status).toBe(403);

    // The owner revokes via the canonical route; the link stops resolving
    // and the listing empties.
    const rev = await handle.fetch(`/api/topology/${id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(rev.status).toBe(200);
    const gone = await handle.fetch(`/api/topology/${id}`);
    expect(gone.status).toBe(404);
    const after = await handle.fetch('/api/share', { headers: { cookie } });
    expect(((await after.json()) as { shares: unknown[] }).shares).toEqual([]);
  });

  it('rejects a body that is not a topology document', async () => {
    const cookie = await sessionCookie('902', 'bad-body');
    const res = await handle.fetch('/api/share', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ document: { nope: true } }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE on /api/share is no longer a route (405) — revoke is canonical', async () => {
    const cookie = await sessionCookie('903', 'route-check');
    const res = await handle.fetch('/api/share/whatever', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(res.status).toBe(405);
  });
});
