/**
 * Worker-level proof that /api/me uses sessionHmacSecret: prefer
 * SESSION_HMAC_SECRET when set, otherwise GITHUB_CLIENT_SECRET.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { DEFAULT_HANDLER_FIXTURE } from './worker-fixtures.js';
import { signSession } from '../server/session.js';

const GITHUB_CLIENT_SECRET = 'fallback-oauth-client-secret';
const SESSION_HMAC_SECRET = 'dedicated-session-hmac-secret';
const USER = { uid: '42', login: 'octocat', name: 'The Octocat' };

async function cookieFor(secret: string): Promise<string> {
  return `tdg_session=${await signSession(USER, secret)}`;
}

describe('session HMAC secret — fallback to GITHUB_CLIENT_SECRET', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
      sourcefile: 'session-hmac-fallback-fixture.ts',
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

  it('accepts a cookie signed with GITHUB_CLIENT_SECRET', async () => {
    const res = await handle.fetch('/api/me', {
      headers: { cookie: await cookieFor(GITHUB_CLIENT_SECRET) },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      login: 'octocat',
      name: 'The Octocat',
      admin: false,
    });
  });

  it('rejects a cookie signed with an unused dedicated secret', async () => {
    const res = await handle.fetch('/api/me', {
      headers: { cookie: await cookieFor(SESSION_HMAC_SECRET) },
    });
    expect(res.status).toBe(401);
  });
});

describe('session HMAC secret — prefers SESSION_HMAC_SECRET', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
      sourcefile: 'session-hmac-prefer-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
      vars: {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET,
        SESSION_HMAC_SECRET,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('accepts a cookie signed with SESSION_HMAC_SECRET', async () => {
    const res = await handle.fetch('/api/me', {
      headers: { cookie: await cookieFor(SESSION_HMAC_SECRET) },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      login: 'octocat',
      name: 'The Octocat',
      admin: false,
    });
  });

  it('rejects a cookie signed only with GITHUB_CLIENT_SECRET', async () => {
    const res = await handle.fetch('/api/me', {
      headers: { cookie: await cookieFor(GITHUB_CLIENT_SECRET) },
    });
    expect(res.status).toBe(401);
  });
});
