/**
 * Share publish / list / revoke (finding M20) — `worker/share.ts` and the
 * `/api/share` routes in `worker/default-handler.ts`.
 *
 * Two halves:
 * 1. Pure unit tests of the share store against an in-memory KV — the index
 *    shape, ownership enforcement, expiry pruning, and the cap.
 * 2. A Miniflare suite through the real default handler: session-gated
 *    publish → list → public snapshot serve (revocation-compatible caching)
 *    → revoke → the public link stops resolving.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  listShares,
  publishSnapshot,
  revokeShare,
  SHARE_TTL_SECONDS,
  type ShareEnv,
  type ShareKv,
} from '../../worker/share.js';
import type { TopologyDocument } from '../pages/model.js';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { DEFAULT_HANDLER_FIXTURE } from './worker-fixtures.js';
import { signSession } from '../server/session.js';

/* ── half 1: the pure share store ─────────────────────────────────────── */

type MemoryKv = ShareKv & { dump(): Map<string, string> };
function memoryKv(): MemoryKv {
  const map = new Map<string, string>();
  return {
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async put(key: string, value: string) {
      map.set(key, value);
    },
    async delete(key: string) {
      map.delete(key);
    },
    dump() {
      return map;
    },
  };
}

function env(kv: ShareKv): ShareEnv {
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

describe('share store (worker/share.ts)', () => {
  it('publish stores the snapshot and indexes it for the owner', async () => {
    const kv = memoryKv();
    const e = env(kv);
    const out = await publishSnapshot(e, '42', doc('Branch WAN'));
    expect(out.url).toBe(`https://dojo.example/v/${out.id}`);
    expect(kv.dump().has(`doc:${out.id}`)).toBe(true);
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

  it('publishing without an owner stores the snapshot unindexed', async () => {
    const kv = memoryKv();
    const e = env(kv);
    const out = await publishSnapshot(e, null, doc());
    expect(kv.dump().has(`doc:${out.id}`)).toBe(true);
    expect([...kv.dump().keys()].some((k) => k.startsWith('shares:'))).toBe(
      false,
    );
  });

  it('revoke deletes the snapshot and the index record', async () => {
    const kv = memoryKv();
    const e = env(kv);
    const out = await publishSnapshot(e, 'owner', doc());
    expect(await revokeShare(e, 'owner', out.id)).toBe('revoked');
    expect(kv.dump().has(`doc:${out.id}`)).toBe(false);
    expect(await listShares(e, 'owner')).toEqual([]);
  });

  it("cannot revoke another owner's snapshot (or an unknown id)", async () => {
    const kv = memoryKv();
    const e = env(kv);
    const out = await publishSnapshot(e, 'alice', doc());
    expect(await revokeShare(e, 'mallory', out.id)).toBe('not-found');
    expect(kv.dump().has(`doc:${out.id}`)).toBe(true); // still live
    expect(await revokeShare(e, 'alice', 'nope')).toBe('not-found');
  });

  it('expired records are pruned from listings', async () => {
    const kv = memoryKv();
    const e = env(kv);
    const out = await publishSnapshot(e, 'u', doc());
    // Rewind the record's expiry to the past.
    const key = 'shares:u';
    const idx = JSON.parse(kv.dump().get(key)!) as { expiresAt: number }[];
    idx[0]!.expiresAt = Date.now() - 1000;
    kv.dump().set(key, JSON.stringify(idx));
    expect(await listShares(e, 'u')).toEqual([]);
    // And the prune persisted.
    expect(JSON.parse(kv.dump().get(key)!)).toEqual([]);
    // (The doc:<id> value itself is retired by the KV TTL in production.)
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

/* ── half 2: the /api/share routes through the real handler ───────────── */

const GITHUB_CLIENT_SECRET = 'share-api-secret';

async function sessionCookie(uid: string, login: string): Promise<string> {
  const token = await signSession({ uid, login }, GITHUB_CLIENT_SECRET);
  return `tdg_session=${token}`;
}

describe('/api/share routes (Miniflare)', () => {
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
      ['/api/share/abc', 'DELETE'],
    ] as const) {
      const res = await handle.fetch(path, { method });
      expect(res.status).toBe(401);
    }
  });

  it('publish → list → public serve → revoke → gone', async () => {
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

    // The public snapshot serves — WITHOUT the immutable cache directive
    // that made revocation ineffective (finding M20).
    const snap = await handle.fetch(`/api/topology/${id}`);
    expect(snap.status).toBe(200);
    const cache = snap.headers.get('cache-control') ?? '';
    expect(cache).not.toContain('immutable');
    expect(cache).toContain('max-age=300');

    // A different user cannot revoke it.
    const other = await sessionCookie('901', 'not-the-owner');
    const foreign = await handle.fetch(`/api/share/${id}`, {
      method: 'DELETE',
      headers: { cookie: other },
    });
    expect(foreign.status).toBe(404);

    // The owner revokes it; the public link stops resolving.
    const rev = await handle.fetch(`/api/share/${id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(rev.status).toBe(200);
    const gone = await handle.fetch(`/api/topology/${id}`);
    expect(gone.status).toBe(404);
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
});
