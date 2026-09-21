/**
 * User-tied API keys (proposal 0005) — `worker/api-keys.ts`.
 *
 * Two halves, like share-api.test.ts:
 * 1. The pure store + resolver against an in-memory KV + index: create /
 *    list / revoke, hash-at-rest, constant-time verify, expiry, the per-user
 *    cap (atomic under concurrent creates), the read-only auth path (usage
 *    telemetry on its own key, hourly), the per-IP failure budget, the
 *    fail-closed flag, and the scope gate `worker/mcp.ts` consults.
 * 2. Miniflare through the real default handler + the real per-user registry
 *    DO: cookie-gated `/api/keys` mint → list (no secret) → resolve through
 *    the provider hook → foreign revoke 404 → owner revoke → resolve 401;
 *    concurrent mints hitting the cap exactly; the `/keys` page gate; and the
 *    503 `api_keys_disabled` contract on a deployment with the flag off.
 * 3. Miniflare through the REAL `OAuthProvider` (`resolveExternalToken` wired
 *    exactly as `worker/index.ts` does): a minted key reaches the API handler
 *    as `ctx.props`, an unknown key is an `invalid_token` 401, a revoked key
 *    stops, and the flag off refuses everything.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_KEY_AUTH_FAILURE_LIMIT,
  ApiKeyRequestError,
  LAST_USED_WRITE_INTERVAL_MS,
  apiKeysEnabled,
  createApiKey,
  listApiKeys,
  principalAllows,
  resolveApiKey,
  resolveApiKeyToken,
  revokeApiKey,
  type ApiKeyEnv,
  type ApiKeyIndex,
  type ApiKeyKv,
} from '../../worker/api-keys.js';
import { MAX_API_KEYS_PER_USER, parseApiKey } from '../server/api-key.js';
import { signSession, type SessionUser } from '../server/session.js';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import {
  API_KEY_PROVIDER_FIXTURE,
  API_KEY_RESOLVE_FIXTURE,
} from './worker-fixtures.js';

/* ── half 1: the pure store ───────────────────────────────────────────── */

type MemoryKv = ApiKeyKv & {
  dump(): Map<string, { value: string; ttl?: number }>;
  puts: number;
  /** Every key ever written, in order — to prove what the auth path touches. */
  putKeys: string[];
  failGets: boolean;
};
function memoryKv(): MemoryKv {
  const map = new Map<string, { value: string; ttl?: number }>();
  const kv: MemoryKv = {
    puts: 0,
    putKeys: [],
    failGets: false,
    async get(key) {
      if (kv.failGets) throw new Error('kv unavailable');
      return map.get(key)?.value ?? null;
    },
    async put(key, value, options) {
      kv.puts += 1;
      kv.putKeys.push(key);
      map.set(key, {
        value,
        ...(options?.expirationTtl !== undefined
          ? { ttl: options.expirationTtl }
          : {}),
      });
    },
    async delete(key) {
      map.delete(key);
    },
    dump: () => map,
  };
  return kv;
}

/**
 * In-memory stand-in for the registry DO's index. `reserve` has no await, so
 * it is atomic the way a DO method is (one request at a time).
 */
function memoryIndex(
  clock: () => number = Date.now,
): ApiKeyIndex & { held(): string[] } {
  const held = new Map<string, string | undefined>(); // keyId → expiresAt
  const prune = () => {
    for (const [id, expiresAt] of held)
      if (expiresAt && Date.parse(expiresAt) <= clock()) held.delete(id);
  };
  return {
    async reserve(keyId, max, expiresAt) {
      prune();
      if (held.has(keyId)) return true;
      if (held.size >= max) return false;
      held.set(keyId, expiresAt);
      return true;
    },
    async release(keyId) {
      held.delete(keyId);
    },
    async ids() {
      prune();
      return [...held.keys()];
    },
    held: () => {
      prune();
      return [...held.keys()];
    },
  };
}

const octocat: SessionUser = {
  uid: '42',
  login: 'octocat',
  name: 'The Octocat',
};
const NOW = Date.parse('2026-09-20T12:00:00Z');

function request(ip?: string): Request {
  return new Request('https://dojo.example/mcp', {
    method: 'POST',
    headers: ip ? { 'CF-Connecting-IP': ip } : {},
  });
}

function env(kv: ApiKeyKv, enabled = true): ApiKeyEnv {
  return {
    OAUTH_KV: kv,
    GITHUB_CLIENT_SECRET: 'test-secret',
    ...(enabled ? { API_KEYS_ENABLED: 'true' } : {}),
  };
}

describe('api-keys store (pure, in-memory KV)', () => {
  it('creates a key: hash at rest, secret returned once, owner index written', async () => {
    const kv = memoryKv();
    const index = memoryIndex();
    const { token, key } = await createApiKey(
      kv,
      index,
      octocat,
      { label: ' ci  runner ', scopes: ['share'] },
      NOW,
    );
    const parsed = parseApiKey(token)!;
    expect(key.keyId).toBe(parsed.keyId);
    expect(key.label).toBe('ci runner');
    expect(key.scopes).toEqual(['author', 'share']);
    expect(key.expiresAt).toBeUndefined();
    const stored = JSON.parse(kv.dump().get(`apikey:${key.keyId}`)!.value);
    expect(stored.uid).toBe('42');
    expect(stored.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(parsed.secret);
    expect(index.held()).toEqual([key.keyId]);
    expect([...kv.dump().keys()]).toEqual([`apikey:${key.keyId}`]);
    expect(kv.dump().get(`apikey:${key.keyId}`)!.ttl).toBeUndefined();
  });

  it('gives expiring keys a matching KV TTL and drops them from listings once expired', async () => {
    const kv = memoryKv();
    const index = memoryIndex();
    const { key } = await createApiKey(
      kv,
      index,
      octocat,
      { label: 'temp', expiresInDays: 30 },
      NOW,
    );
    expect(key.expiresAt).toBe(new Date(NOW + 30 * 86_400_000).toISOString());
    const ttl = kv.dump().get(`apikey:${key.keyId}`)!.ttl!;
    expect(ttl).toBeGreaterThan(30 * 86_400);
    expect(ttl).toBeLessThan(30 * 86_400 + 120);
    expect(await listApiKeys(kv, index, '42', NOW)).toHaveLength(1);
    expect(
      await listApiKeys(kv, index, '42', NOW + 31 * 86_400_000),
    ).toHaveLength(0);
  });

  it('rejects bad input with typed errors and enforces the per-user cap', async () => {
    const kv = memoryKv();
    const index = memoryIndex();
    await expect(
      createApiKey(kv, index, octocat, { label: '' }, NOW),
    ).rejects.toMatchObject({ code: 'invalid_label', status: 400 });
    await expect(
      createApiKey(kv, index, octocat, { label: 'x', scopes: ['nope'] }, NOW),
    ).rejects.toMatchObject({ code: 'invalid_scopes' });
    await expect(
      createApiKey(kv, index, octocat, { label: 'x', expiresInDays: 7 }, NOW),
    ).rejects.toMatchObject({ code: 'invalid_expiry' });
    for (let i = 0; i < MAX_API_KEYS_PER_USER; i++)
      await createApiKey(kv, index, octocat, { label: `k${i}` }, NOW);
    const err = await createApiKey(
      kv,
      index,
      octocat,
      { label: 'one more' },
      NOW,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiKeyRequestError);
    expect((err as ApiKeyRequestError).status).toBe(409);
  });

  it('resolves a live key to the OAuth-shaped principal and refuses wrong/unknown secrets', async () => {
    const kv = memoryKv();
    const index = memoryIndex();
    const { token } = await createApiKey(
      kv,
      index,
      octocat,
      { label: 'agent', scopes: ['workspace'] },
      NOW,
    );
    const principal = await resolveApiKey(kv, token, NOW);
    expect(principal).toEqual({
      id: 42,
      login: 'octocat',
      name: 'The Octocat',
      auth: 'api_key',
      keyId: parseApiKey(token)!.keyId,
      scopes: ['author', 'workspace'],
    });
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(await resolveApiKey(kv, tampered, NOW)).toBeNull();
    expect(
      await resolveApiKey(kv, 'tdk_zzzzzzzzzz_' + 'x'.repeat(43), NOW),
    ).toBeNull();
    expect(await resolveApiKey(kv, 'not-a-key', NOW)).toBeNull();
  });

  it('authentication is read-only for the credential: lastUsedAt lives on its own key, hourly', async () => {
    const kv = memoryKv();
    const index = memoryIndex();
    const { token, key } = await createApiKey(
      kv,
      index,
      octocat,
      { label: 'a' },
      NOW,
    );
    const recordBefore = kv.dump().get(`apikey:${key.keyId}`)!.value;
    const before = kv.puts;
    await resolveApiKey(kv, token, NOW);
    await resolveApiKey(kv, token, NOW + 60_000);
    await resolveApiKey(kv, token, NOW + LAST_USED_WRITE_INTERVAL_MS - 1);
    expect(kv.puts - before).toBe(1);
    await resolveApiKey(kv, token, NOW + LAST_USED_WRITE_INTERVAL_MS + 1);
    expect(kv.puts - before).toBe(2);
    // Only the telemetry key was written; the credential record is byte-identical.
    expect(kv.putKeys.slice(before)).toEqual([
      `apikeyuse:${key.keyId}`,
      `apikeyuse:${key.keyId}`,
    ]);
    expect(kv.dump().get(`apikey:${key.keyId}`)!.value).toBe(recordBefore);
    const listed = await listApiKeys(
      kv,
      index,
      '42',
      NOW + LAST_USED_WRITE_INTERVAL_MS + 2,
    );
    expect(listed[0]?.keyId).toBe(key.keyId);
    expect(listed[0]?.lastUsedAt).toBe(
      new Date(NOW + LAST_USED_WRITE_INTERVAL_MS + 1).toISOString(),
    );
  });

  it('a revoke racing an authentication cannot resurrect the key', async () => {
    const kv = memoryKv();
    const index = memoryIndex();
    const { token, key } = await createApiKey(
      kv,
      index,
      octocat,
      { label: 'a' },
      NOW,
    );
    // Interleave: the resolver has read the record, then the owner revokes
    // before the resolver finishes. With a read-only auth path the record
    // stays deleted whatever the resolver does afterwards.
    const originalGet = kv.get.bind(kv);
    let revokeDuringRead: Promise<unknown> | null = null;
    kv.get = async (k: string) => {
      const value = await originalGet(k);
      if (k === `apikey:${key.keyId}` && !revokeDuringRead)
        revokeDuringRead = revokeApiKey(kv, index, '42', key.keyId);
      return value;
    };
    const principal = await resolveApiKey(kv, token, NOW);
    await revokeDuringRead;
    expect(principal?.keyId).toBe(key.keyId); // that one request had a valid read
    expect(kv.dump().has(`apikey:${key.keyId}`)).toBe(false);
    expect(await resolveApiKey(kv, token, NOW + 1)).toBeNull();
    expect(await listApiKeys(kv, index, '42', NOW)).toEqual([]);
    expect(index.held()).toEqual([]);
  });

  it('the per-user cap holds under concurrent creates (index is the serialization point)', async () => {
    const kv = memoryKv();
    const index = memoryIndex();
    const outcomes = await Promise.all(
      Array.from({ length: MAX_API_KEYS_PER_USER + 5 }, (_, i) =>
        createApiKey(kv, index, octocat, { label: `k${i}` }, NOW).then(
          () => 'ok' as const,
          (e: unknown) => (e as ApiKeyRequestError).code,
        ),
      ),
    );
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(
      MAX_API_KEYS_PER_USER,
    );
    expect(outcomes.filter((o) => o === 'too_many_keys')).toHaveLength(5);
    expect(index.held()).toHaveLength(MAX_API_KEYS_PER_USER);
    expect(await listApiKeys(kv, index, '42', NOW)).toHaveLength(
      MAX_API_KEYS_PER_USER,
    );
    // Every stored credential is in the index: nothing valid-but-invisible.
    const stored = [...kv.dump().keys()].filter((k) => k.startsWith('apikey:'));
    expect(stored.sort()).toEqual(
      index
        .held()
        .map((id) => `apikey:${id}`)
        .sort(),
    );
  });

  it('a listing never releases a slot whose record is not (yet) in KV', async () => {
    const kv = memoryKv();
    const index = memoryIndex();
    // Another request has reserved a slot and not yet written its record —
    // the exact window a concurrent create is in.
    await index.reserve('inflight000', MAX_API_KEYS_PER_USER);
    expect(await listApiKeys(kv, index, '42', NOW)).toEqual([]);
    expect(index.held()).toEqual(['inflight000']);
    await createApiKey(kv, index, octocat, { label: 'a' }, NOW);
    expect(index.held()).toHaveLength(2);
  });

  it('expired keys free their slot through the index, not through KV', async () => {
    let now = NOW;
    const kv = memoryKv();
    const index = memoryIndex(() => now);
    for (let i = 0; i < MAX_API_KEYS_PER_USER; i++)
      await createApiKey(
        kv,
        index,
        octocat,
        { label: `k${i}`, expiresInDays: 30 },
        NOW,
      );
    await expect(
      createApiKey(kv, index, octocat, { label: 'full' }, NOW),
    ).rejects.toMatchObject({ code: 'too_many_keys' });
    now = NOW + 31 * 86_400_000;
    expect(index.held()).toEqual([]);
    const { key } = await createApiKey(
      kv,
      index,
      octocat,
      { label: 'after expiry' },
      now,
    );
    expect(await listApiKeys(kv, index, '42', now)).toMatchObject([
      { keyId: key.keyId },
    ]);
  });

  it('a failed record write releases the reserved slot', async () => {
    const kv = memoryKv();
    const index = memoryIndex();
    const originalPut = kv.put.bind(kv);
    kv.put = async () => {
      throw new Error('kv write failed');
    };
    await expect(
      createApiKey(kv, index, octocat, { label: 'a' }, NOW),
    ).rejects.toThrow('kv write failed');
    expect(index.held()).toEqual([]);
    kv.put = originalPut;
    await createApiKey(kv, index, octocat, { label: 'a' }, NOW);
    expect(index.held()).toHaveLength(1);
  });

  it('revokes owner-only, answering not_found for foreign or unknown ids', async () => {
    const kv = memoryKv();
    const index = memoryIndex();
    const { token, key } = await createApiKey(
      kv,
      index,
      octocat,
      { label: 'a' },
      NOW,
    );
    expect(await revokeApiKey(kv, index, '99', key.keyId)).toBe('not_found');
    expect(await resolveApiKey(kv, token, NOW)).not.toBeNull();
    expect(await revokeApiKey(kv, index, '42', 'nope')).toBe('not_found');
    expect(await revokeApiKey(kv, index, '42', key.keyId)).toBe('revoked');
    expect(await resolveApiKey(kv, token, NOW)).toBeNull();
    expect(await listApiKeys(kv, index, '42', NOW)).toEqual([]);
    expect(index.held()).toEqual([]);
  });

  it('expired keys stop resolving even before KV prunes the record', async () => {
    const kv = memoryKv();
    const index = memoryIndex();
    const { token } = await createApiKey(
      kv,
      index,
      octocat,
      { label: 'temp', expiresInDays: 30 },
      NOW,
    );
    expect(
      await resolveApiKey(kv, token, NOW + 29 * 86_400_000),
    ).not.toBeNull();
    expect(await resolveApiKey(kv, token, NOW + 30 * 86_400_000)).toBeNull();
  });

  it('flag off ⇒ the provider hook rejects every bearer, valid or not', async () => {
    const kv = memoryKv();
    const index = memoryIndex();
    const { token } = await createApiKey(
      kv,
      index,
      octocat,
      { label: 'a' },
      NOW,
    );
    expect(apiKeysEnabled({ API_KEYS_ENABLED: 'true' })).toBe(true);
    expect(apiKeysEnabled({ API_KEYS_ENABLED: 'TRUE' })).toBe(false);
    expect(apiKeysEnabled({})).toBe(false);
    expect(
      await resolveApiKeyToken({
        token,
        request: request('1.1.1.1'),
        env: env(kv, false),
      }),
    ).toBeNull();
    expect(
      await resolveApiKeyToken({
        token,
        request: request('1.1.1.1'),
        env: env(kv),
      }),
    ).toEqual({ props: expect.objectContaining({ id: 42, auth: 'api_key' }) });
  });

  it('never touches storage for a bearer that is not tdk_-shaped', async () => {
    const kv = memoryKv();
    kv.failGets = true; // any read would throw
    expect(
      await resolveApiKeyToken({
        token: 'user:grant:secret',
        request: request('1.1.1.1'),
        env: env(kv),
      }),
    ).toBeNull();
  });

  it('fails closed on a storage error during lookup', async () => {
    const kv = memoryKv();
    const index = memoryIndex();
    const { token } = await createApiKey(
      kv,
      index,
      octocat,
      { label: 'a' },
      NOW,
    );
    kv.failGets = true;
    expect(
      await resolveApiKeyToken({
        token,
        request: request('1.1.1.1'),
        env: env(kv),
      }),
    ).toBeNull();
  });

  it('budgets failed authentications per client IP (best-effort counter), without counting successes', async () => {
    const kv = memoryKv();
    const index = memoryIndex();
    const { token } = await createApiKey(
      kv,
      index,
      octocat,
      { label: 'a' },
      NOW,
    );
    const bogus = 'tdk_zzzzzzzzzz_' + 'x'.repeat(43);
    for (let i = 0; i < API_KEY_AUTH_FAILURE_LIMIT.limit; i++) {
      expect(
        await resolveApiKeyToken({
          token: bogus,
          request: request('9.9.9.9'),
          env: env(kv),
        }),
      ).toBeNull();
    }
    // Budget spent: even the real key is refused from that IP…
    expect(
      await resolveApiKeyToken({
        token,
        request: request('9.9.9.9'),
        env: env(kv),
      }),
    ).toBeNull();
    // …while another client is unaffected, and its successes never count.
    for (let i = 0; i < API_KEY_AUTH_FAILURE_LIMIT.limit + 5; i++) {
      expect(
        await resolveApiKeyToken({
          token,
          request: request('8.8.8.8'),
          env: env(kv),
        }),
      ).not.toBeNull();
    }
    const counter = [...kv.dump().entries()].find(([k]) =>
      k.startsWith('rl:apikeyfail:9.9.9.9:'),
    );
    expect(Number(counter?.[1].value)).toBe(API_KEY_AUTH_FAILURE_LIMIT.limit);
    expect(counter?.[1].ttl).toBe(
      Math.ceil(API_KEY_AUTH_FAILURE_LIMIT.windowMs / 1000) + 1,
    );
  });

  it('principalAllows: OAuth sessions keep the full grant, keys get exactly their scopes', () => {
    expect(principalAllows({ id: 1, login: 'x' }, 'share')).toBe(true);
    expect(principalAllows(undefined, 'live-data')).toBe(true);
    const key = {
      id: 1,
      login: 'x',
      auth: 'api_key',
      keyId: 'k',
      scopes: ['author', 'share'],
    };
    expect(principalAllows(key, 'share')).toBe(true);
    expect(principalAllows(key, 'workspace')).toBe(false);
    expect(principalAllows(key, 'live-data')).toBe(false);
    expect(principalAllows({ auth: 'api_key' }, 'share')).toBe(false);
  });
});

/* ── half 2: through the Worker (Miniflare) ───────────────────────────── */

const GITHUB_CLIENT_SECRET = 'w1-test-secret';

async function cookieFor(uid: string, login = 'octocat'): Promise<string> {
  const token = await signSession(
    { uid, login, name: 'The Octocat' },
    GITHUB_CLIENT_SECRET,
  );
  return `tdg_session=${token}`;
}

describe('/api/keys, /keys and the provider hook (Miniflare, API_KEYS_ENABLED)', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(API_KEY_RESOLVE_FIXTURE, {
      sourcefile: 'api-key-resolve-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
      durableObjects: {
        TOPOLOGY_REGISTRY: { className: 'TopologyRegistry', useSQLite: true },
      },
      vars: {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET,
        API_KEYS_ENABLED: 'true',
      },
    });
  }, 30_000);

  it('enforces the per-user cap exactly under concurrent mints (real registry DO)', async () => {
    const cookie = await cookieFor('777', 'capuser');
    const responses = await Promise.all(
      Array.from({ length: MAX_API_KEYS_PER_USER + 4 }, (_, i) =>
        handle.fetch('/api/keys', {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ label: `burst ${i}` }),
        }),
      ),
    );
    const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses.filter((s) => s === 201)).toHaveLength(
      MAX_API_KEYS_PER_USER,
    );
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    const listed = (await (
      await handle.fetch('/api/keys', { headers: { cookie } })
    ).json()) as { keys: { keyId: string }[] };
    expect(listed.keys).toHaveLength(MAX_API_KEYS_PER_USER);
    // Every credential in KV for this user is visible in the listing —
    // nothing valid-but-invisible survived the burst.
    const kv = await handle.miniflare.getKVNamespace('OAUTH_KV');
    const visible = new Set(listed.keys.map((k) => k.keyId));
    let storedForUser = 0;
    for (const { name } of (await kv.list({ prefix: 'apikey:' })).keys) {
      const raw = await kv.get(name);
      if (!raw?.includes('"uid":"777"')) continue;
      storedForUser += 1;
      expect(visible.has(name.slice('apikey:'.length))).toBe(true);
    }
    expect(storedForUser).toBe(MAX_API_KEYS_PER_USER);
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('gates every route on the browser session', async () => {
    expect((await handle.fetch('/api/keys')).status).toBe(401);
    expect((await handle.fetch('/api/keys', { method: 'POST' })).status).toBe(
      401,
    );
    expect(
      (await handle.fetch('/api/keys/abc', { method: 'DELETE' })).status,
    ).toBe(401);
    const page = await handle.fetch('/keys', { redirect: 'manual' });
    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe(
      'http://worker.test/login?go=%2Fkeys',
    );
  });

  it('serves the management page and its script to a signed-in user', async () => {
    const page = await handle.fetch('/keys', {
      headers: { cookie: await cookieFor('42') },
    });
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('@octocat');
    expect(html).toContain('<script src="/keys.js"></script>');
    expect(html).not.toContain('onclick=');
    const script = await handle.fetch('/keys.js');
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('javascript');
    expect(await script.text()).toContain("api('/api/keys'");
  });

  it('mints once, lists without the secret, resolves through the hook, and revokes owner-only', async () => {
    const cookie = await cookieFor('42');
    const created = await handle.fetch('/api/keys', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'netclaw', scopes: ['share'] }),
    });
    expect(created.status).toBe(201);
    const { token, key } = (await created.json()) as {
      token: string;
      key: { keyId: string; prefix: string; scopes: string[] };
    };
    expect(token).toMatch(/^tdk_[a-z0-9]{10}_[A-Za-z0-9_-]{43}$/);
    expect(key.scopes).toEqual(['author', 'share']);

    const listed = await handle.fetch('/api/keys', { headers: { cookie } });
    const listing = await listed.text();
    expect(listing).toContain(key.keyId);
    expect(listing).not.toContain(token);
    expect(listing).not.toContain('secretHash');

    // The record in real KV holds only the hash.
    const kv = await handle.miniflare.getKVNamespace('OAUTH_KV');
    const raw = await kv.get(`apikey:${key.keyId}`);
    expect(raw).not.toContain(parseApiKey(token)!.secret);

    const resolved = await handle.fetch('/__resolve-key', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '1.2.3.4',
      },
    });
    expect(resolved.status).toBe(200);
    await expect(resolved.json()).resolves.toEqual({
      id: 42,
      login: 'octocat',
      name: 'The Octocat',
      auth: 'api_key',
      keyId: key.keyId,
      scopes: ['author', 'share'],
    });
    const wrong = await handle.fetch('/__resolve-key', {
      method: 'POST',
      headers: { authorization: `Bearer ${token.slice(0, -2)}zz` },
    });
    expect(wrong.status).toBe(401);

    const foreign = await handle.fetch(`/api/keys/${key.keyId}`, {
      method: 'DELETE',
      headers: { cookie: await cookieFor('99', 'mallory') },
    });
    expect(foreign.status).toBe(404);
    const revoked = await handle.fetch(`/api/keys/${key.keyId}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toEqual({ revoked: true });
    const after = await handle.fetch('/__resolve-key', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
    await expect(
      handle.fetch('/api/keys', { headers: { cookie } }).then((r) => r.json()),
    ).resolves.toEqual({ keys: [] });
  });

  it('rejects malformed bodies and unknown scopes with 400', async () => {
    const cookie = await cookieFor('42');
    const bad = await handle.fetch('/api/keys', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(bad.status).toBe(400);
    const scopes = await handle.fetch('/api/keys', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'x', scopes: ['admin'] }),
    });
    expect(scopes.status).toBe(400);
    await expect(scopes.json()).resolves.toEqual({ error: 'invalid_scopes' });
  });
});

describe('/api/keys on a deployment with the flag off', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(API_KEY_RESOLVE_FIXTURE, {
      sourcefile: 'api-key-resolve-fixture-off.ts',
    });
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
      vars: { GITHUB_CLIENT_ID: 'test-client-id', GITHUB_CLIENT_SECRET },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('answers 503 api_keys_disabled before reading KV, and the hook rejects keys', async () => {
    const res = await handle.fetch('/api/keys', {
      headers: { cookie: await cookieFor('42') },
    });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'api_keys_disabled' });
    const resolved = await handle.fetch('/__resolve-key', {
      method: 'POST',
      headers: { authorization: 'Bearer tdk_abcdefghij_' + 'x'.repeat(43) },
    });
    expect(resolved.status).toBe(401);
    const page = await handle.fetch('/keys', {
      headers: { cookie: await cookieFor('42') },
    });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('API keys are disabled');
  });
});

/* ── half 3: through the REAL OAuthProvider ───────────────────────────── */

describe('OAuthProvider → resolveExternalToken → API handler (Miniflare)', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(API_KEY_PROVIDER_FIXTURE, {
      sourcefile: 'api-key-provider-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
      durableObjects: {
        TOPOLOGY_REGISTRY: { className: 'TopologyRegistry', useSQLite: true },
      },
      vars: {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET,
        API_KEYS_ENABLED: 'true',
      },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  async function mint(cookie: string, scopes: string[]) {
    const created = await handle.fetch('/api/keys', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'provider path', scopes }),
    });
    expect(created.status).toBe(201);
    return (await created.json()) as { token: string; key: { keyId: string } };
  }

  it('a minted key reaches the API handler as ctx.props via the provider', async () => {
    const cookie = await cookieFor('42');
    const { token, key } = await mint(cookie, ['share']);
    const res = await handle.fetch('/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { props: Record<string, unknown> };
    expect(body.props).toMatchObject({
      id: 42,
      login: 'octocat',
      name: 'The Octocat',
      auth: 'api_key',
      keyId: key.keyId,
      scopes: ['author', 'share'],
    });
    // Same identity shape an OAuth grant produces — and nothing more.
    expect(body.props).not.toHaveProperty('secretHash');
    expect(JSON.stringify(body.props)).not.toContain(
      parseApiKey(token)!.secret,
    );
  }, 30_000);

  it('the provider keeps its 401 for no bearer, an unknown key, and a tampered key', async () => {
    const cookie = await cookieFor('42');
    const { token } = await mint(cookie, []);
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    for (const authorization of [
      undefined,
      'Bearer tdk_zzzzzzzzzz_' + 'x'.repeat(43),
      `Bearer ${tampered}`,
      'Bearer 42:grant:secret',
    ]) {
      const res = await handle.fetch('/mcp', {
        method: 'POST',
        headers: authorization ? { authorization } : {},
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate') ?? '').toContain('Bearer');
    }
  }, 30_000);

  it('a revoked key is refused by the provider on the next request', async () => {
    const cookie = await cookieFor('42');
    const { token, key } = await mint(cookie, []);
    expect(
      (
        await handle.fetch('/mcp', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await handle.fetch(`/api/keys/${key.keyId}`, {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await handle.fetch('/mcp', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(401);
  }, 30_000);
});
