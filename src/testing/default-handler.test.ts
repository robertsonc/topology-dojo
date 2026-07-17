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
    expect(res.headers.get('cache-control')).toContain('immutable');
    await expect(res.json()).resolves.toEqual(doc);
  });

  it('404s for an id with no stored snapshot', async () => {
    const res = await handle.fetch('/api/topology/does-not-exist');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not found' });
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
