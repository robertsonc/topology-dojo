/**
 * User-tied API keys (proposal 0005) — `worker/api-keys.ts`.
 *
 * Two halves, like share-api.test.ts:
 * 1. The pure store + resolver against an in-memory KV: create / list /
 *    revoke, hash-at-rest, constant-time verify, expiry, the per-user cap,
 *    the hourly `lastUsedAt` write throttle, the per-IP failure budget, the
 *    fail-closed flag, and the scope gate `worker/mcp.ts` consults.
 * 2. Miniflare through the real default handler: cookie-gated `/api/keys`
 *    mint → list (no secret) → resolve through the provider hook → foreign
 *    revoke 404 → owner revoke → resolve 401; the `/keys` page gate; and
 *    the 503 `api_keys_disabled` contract on a deployment with the flag off.
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
  type ApiKeyKv,
} from '../../worker/api-keys.js';
import { MAX_API_KEYS_PER_USER, parseApiKey } from '../server/api-key.js';
import { signSession, type SessionUser } from '../server/session.js';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { API_KEY_RESOLVE_FIXTURE } from './worker-fixtures.js';

/* ── half 1: the pure store ───────────────────────────────────────────── */

type MemoryKv = ApiKeyKv & {
  dump(): Map<string, { value: string; ttl?: number }>;
  puts: number;
  failGets: boolean;
};
function memoryKv(): MemoryKv {
  const map = new Map<string, { value: string; ttl?: number }>();
  const kv: MemoryKv = {
    puts: 0,
    failGets: false,
    async get(key) {
      if (kv.failGets) throw new Error('kv unavailable');
      return map.get(key)?.value ?? null;
    },
    async put(key, value, options) {
      kv.puts += 1;
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
    const { token, key } = await createApiKey(
      kv,
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
    expect(JSON.parse(kv.dump().get('apikeys:42')!.value)).toEqual([key.keyId]);
    expect(kv.dump().get(`apikey:${key.keyId}`)!.ttl).toBeUndefined();
  });

  it('gives expiring keys a matching KV TTL and drops them from listings once expired', async () => {
    const kv = memoryKv();
    const { key } = await createApiKey(
      kv,
      octocat,
      { label: 'temp', expiresInDays: 30 },
      NOW,
    );
    expect(key.expiresAt).toBe(new Date(NOW + 30 * 86_400_000).toISOString());
    const ttl = kv.dump().get(`apikey:${key.keyId}`)!.ttl!;
    expect(ttl).toBeGreaterThan(30 * 86_400);
    expect(ttl).toBeLessThan(30 * 86_400 + 120);
    expect(await listApiKeys(kv, '42', NOW)).toHaveLength(1);
    expect(await listApiKeys(kv, '42', NOW + 31 * 86_400_000)).toHaveLength(0);
  });

  it('rejects bad input with typed errors and enforces the per-user cap', async () => {
    const kv = memoryKv();
    await expect(
      createApiKey(kv, octocat, { label: '' }, NOW),
    ).rejects.toMatchObject({ code: 'invalid_label', status: 400 });
    await expect(
      createApiKey(kv, octocat, { label: 'x', scopes: ['nope'] }, NOW),
    ).rejects.toMatchObject({ code: 'invalid_scopes' });
    await expect(
      createApiKey(kv, octocat, { label: 'x', expiresInDays: 7 }, NOW),
    ).rejects.toMatchObject({ code: 'invalid_expiry' });
    for (let i = 0; i < MAX_API_KEYS_PER_USER; i++)
      await createApiKey(kv, octocat, { label: `k${i}` }, NOW);
    const err = await createApiKey(
      kv,
      octocat,
      { label: 'one more' },
      NOW,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiKeyRequestError);
    expect((err as ApiKeyRequestError).status).toBe(409);
  });

  it('resolves a live key to the OAuth-shaped principal and refuses wrong/unknown secrets', async () => {
    const kv = memoryKv();
    const { token } = await createApiKey(
      kv,
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

  it('writes lastUsedAt at most once an hour', async () => {
    const kv = memoryKv();
    const { token, key } = await createApiKey(kv, octocat, { label: 'a' }, NOW);
    const before = kv.puts;
    await resolveApiKey(kv, token, NOW);
    await resolveApiKey(kv, token, NOW + 60_000);
    await resolveApiKey(kv, token, NOW + LAST_USED_WRITE_INTERVAL_MS - 1);
    expect(kv.puts - before).toBe(1);
    await resolveApiKey(kv, token, NOW + LAST_USED_WRITE_INTERVAL_MS + 1);
    expect(kv.puts - before).toBe(2);
    const listed = await listApiKeys(
      kv,
      '42',
      NOW + LAST_USED_WRITE_INTERVAL_MS + 2,
    );
    expect(listed[0]?.keyId).toBe(key.keyId);
    expect(listed[0]?.lastUsedAt).toBe(
      new Date(NOW + LAST_USED_WRITE_INTERVAL_MS + 1).toISOString(),
    );
  });

  it('revokes owner-only, answering not_found for foreign or unknown ids', async () => {
    const kv = memoryKv();
    const { token, key } = await createApiKey(kv, octocat, { label: 'a' }, NOW);
    expect(await revokeApiKey(kv, '99', key.keyId)).toBe('not_found');
    expect(await resolveApiKey(kv, token, NOW)).not.toBeNull();
    expect(await revokeApiKey(kv, '42', 'nope')).toBe('not_found');
    expect(await revokeApiKey(kv, '42', key.keyId)).toBe('revoked');
    expect(await resolveApiKey(kv, token, NOW)).toBeNull();
    expect(await listApiKeys(kv, '42', NOW)).toEqual([]);
    expect(kv.dump().has('apikeys:42')).toBe(false);
  });

  it('expired keys stop resolving even before KV prunes the record', async () => {
    const kv = memoryKv();
    const { token } = await createApiKey(
      kv,
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
    const { token } = await createApiKey(kv, octocat, { label: 'a' }, NOW);
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
    const { token } = await createApiKey(kv, octocat, { label: 'a' }, NOW);
    kv.failGets = true;
    expect(
      await resolveApiKeyToken({
        token,
        request: request('1.1.1.1'),
        env: env(kv),
      }),
    ).toBeNull();
  });

  it('budgets failed authentications per client IP, without counting successes', async () => {
    const kv = memoryKv();
    const { token } = await createApiKey(kv, octocat, { label: 'a' }, NOW);
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
    expect(raw).not.toContain(token.split('_')[2]!);

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
