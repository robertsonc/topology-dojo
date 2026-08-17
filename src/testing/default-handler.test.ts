import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { DEFAULT_HANDLER_FIXTURE } from './worker-fixtures.js';
import { signSession } from '../server/session.js';

const GITHUB_CLIENT_SECRET = 'w1-test-secret';

let handle: MiniflareHandle;

beforeAll(async () => {
  const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
    sourcefile: 'default-handler-fixture.ts',
  });
  handle = await startMiniflare({
    bundle,
    kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
    vars: {
      GITHUB_CLIENT_ID: 'test-client-id',
      GITHUB_CLIENT_SECRET,
    },
  });
}, 30_000);

afterAll(async () => {
  await handle?.dispose();
});

describe('GET /login', () => {
  it('serves the branded sign-in page linking to /auth/github', async () => {
    const res = await handle.fetch('/login');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Sign in with GitHub');
    expect(body).toContain('/auth/github?go=%2F');
  });

  it('includes the pre-login showcase filmstrip (ungated static stills)', async () => {
    const res = await handle.fetch('/login');
    const body = await res.text();
    expect(body).toContain('class="strip"');
    // Each showcase frame (an animated WebP) is referenced twice — the
    // duplication that makes the -50% marquee loop seamless.
    for (const src of [
      '/showcase/hub-spoke.webp',
      '/showcase/spine-leaf.webp',
      '/showcase/sdwan.webp',
      '/showcase/three-tier.webp',
    ]) {
      expect(body.split(src).length - 1).toBe(2);
    }
  });

  it('does not gate showcase image requests behind sign-in', async () => {
    // Image sub-resources are not document navigations, so the editor gate must
    // fall through to ASSETS rather than 302-redirecting to /login. (The test
    // harness stubs ASSETS, so a non-redirect status is the signal.)
    const res = await handle.fetch('/showcase/spine-leaf.webp', {
      headers: { accept: 'image/webp' },
      redirect: 'manual',
    });
    expect(res.status).not.toBe(302);
  });
});

describe('GET /auth/github', () => {
  it('redirects to GitHub and sets a state cookie', async () => {
    const res = await handle.fetch('/auth/github', { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(
      /^https:\/\/github\.com\/login\/oauth\/authorize\?/,
    );
    expect(location).toContain('client_id=test-client-id');
    expect(location).toContain('state=web.');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^tdg_oauth_state=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=600');
    expect(cookie).toContain('Path=/');
  });
});

describe('GET /logout', () => {
  it('clears the session cookie and redirects to /login', async () => {
    const res = await handle.fetch('/logout', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^tdg_session=;/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=0');
  });
});

describe('GET /callback (web flow) — M18 regression guard', () => {
  it('rejects a mismatched state/nonce with 400 instead of completing sign-in', async () => {
    const res = await handle.fetch(
      '/callback?state=web.attacker-nonce&code=some-code',
      { headers: { cookie: 'tdg_oauth_state=real-nonce|%2F' } },
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Bad sign-in state');
    // No session must be granted on a mismatch.
    expect(res.headers.get('set-cookie')).toBeFalsy();
  });

  it('rejects when no state cookie was ever set', async () => {
    const res = await handle.fetch(
      '/callback?state=web.some-nonce&code=some-code',
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/topology/:id', () => {
  it('serves a stored share snapshot from KV', async () => {
    const kv = await handle.miniflare.getKVNamespace('TOPOLOGY_KV');
    const doc = { title: 'Shared', customNodes: [], pages: [] };
    await kv.put('doc:share123', JSON.stringify(doc));

    const res = await handle.fetch('/api/topology/share123');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    // Revocation-compatible caching (finding M20): NEVER immutable — a
    // revoked link must stop resolving within a bounded cache window.
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(res.headers.get('cache-control')).not.toContain('immutable');
    await expect(res.json()).resolves.toEqual(doc);
  });

  it('404s for an id with no stored snapshot', async () => {
    const res = await handle.fetch('/api/topology/does-not-exist');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not found' });
  });

  it('429s a public snapshot GET after the per-IP window is exhausted', async () => {
    const kv = await handle.miniflare.getKVNamespace('TOPOLOGY_KV');
    await kv.put('doc:ratelimit', JSON.stringify({ title: 'RL' }));
    const headers = { 'CF-Connecting-IP': '198.51.100.77' };
    let limited: Awaited<ReturnType<typeof handle.fetch>> | undefined;
    for (let i = 0; i < 61; i++) {
      const res = await handle.fetch('/api/topology/ratelimit', { headers });
      if (res.status === 429) {
        limited = res;
        break;
      }
      expect(res.status).toBe(200);
      await res.arrayBuffer();
    }
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(limited?.headers.get('cache-control')).toContain('no-store');
    await expect(limited!.json()).resolves.toMatchObject({
      error: 'rate_limited',
    });
  });

  it("does not let one IP's quota block a different client", async () => {
    const kv = await handle.miniflare.getKVNamespace('TOPOLOGY_KV');
    await kv.put('doc:other-ip', JSON.stringify({ title: 'Other' }));
    const res = await handle.fetch('/api/topology/other-ip', {
      headers: { 'CF-Connecting-IP': '203.0.113.10' },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ title: 'Other' });
  });
});

describe('DELETE /api/topology/:id', () => {
  const doc = { title: 'Shared', customNodes: [], pages: [] };

  async function sessionCookie(
    uid: string,
    login = 'octocat',
  ): Promise<string> {
    const token = await signSession(
      { uid, login, name: 'The Octocat' },
      GITHUB_CLIENT_SECRET,
    );
    return `tdg_session=${token}`;
  }

  it('401s without a session cookie', async () => {
    const res = await handle.fetch('/api/topology/owned123', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: 'authentication required',
    });
  });

  it('lets the publisher revoke and then 404s the public GET', async () => {
    const kv = await handle.miniflare.getKVNamespace('TOPOLOGY_KV');
    await kv.put('doc:owned123', JSON.stringify(doc), {
      metadata: { ownerId: '99' },
    });

    const res = await handle.fetch('/api/topology/owned123', {
      method: 'DELETE',
      headers: { cookie: await sessionCookie('99') },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ revoked: true });

    const get = await handle.fetch('/api/topology/owned123');
    expect(get.status).toBe(404);
    await expect(get.json()).resolves.toEqual({ error: 'not found' });
  });

  it('403s when a different signed-in user tries to revoke', async () => {
    const kv = await handle.miniflare.getKVNamespace('TOPOLOGY_KV');
    await kv.put('doc:owned456', JSON.stringify(doc), {
      metadata: { ownerId: '99' },
    });

    const res = await handle.fetch('/api/topology/owned456', {
      method: 'DELETE',
      headers: { cookie: await sessionCookie('7', 'other') },
    });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });

    const get = await handle.fetch('/api/topology/owned456');
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toEqual(doc);
  });

  it('403s a legacy snapshot that has no owner metadata', async () => {
    const kv = await handle.miniflare.getKVNamespace('TOPOLOGY_KV');
    await kv.put('doc:legacy123', JSON.stringify(doc));

    const res = await handle.fetch('/api/topology/legacy123', {
      method: 'DELETE',
      headers: { cookie: await sessionCookie('99') },
    });
    expect(res.status).toBe(403);

    const get = await handle.fetch('/api/topology/legacy123');
    expect(get.status).toBe(200);
  });

  it('404s when the snapshot is already gone', async () => {
    const res = await handle.fetch('/api/topology/does-not-exist', {
      method: 'DELETE',
      headers: { cookie: await sessionCookie('99') },
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not found' });
  });

  it('leaves GET unauthenticated after an owner session exists', async () => {
    const kv = await handle.miniflare.getKVNamespace('TOPOLOGY_KV');
    await kv.put('doc:public123', JSON.stringify(doc), {
      metadata: { ownerId: '99' },
    });
    const res = await handle.fetch('/api/topology/public123');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(doc);
  });
});

describe('GET /api/me', () => {
  it('401s with no session cookie', async () => {
    const res = await handle.fetch('/api/me');
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({});
  });

  it('returns the signed-in user for a valid session cookie', async () => {
    const token = await signSession(
      { uid: '99', login: 'octocat', name: 'The Octocat' },
      GITHUB_CLIENT_SECRET,
    );
    const res = await handle.fetch('/api/me', {
      headers: { cookie: `tdg_session=${token}` },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      login: 'octocat',
      name: 'The Octocat',
      admin: false,
    });
  });
});
