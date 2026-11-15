/**
 * SEC-1115-01: the MCP OAuth authorize flow, end to end through the REAL
 * `OAuthProvider` and the real default handler in Miniflare
 * (`MCP_OAUTH_FIXTURE`; GitHub's two endpoints are stubbed inside it).
 *
 * Covers: a consent page of our own before any upstream redirect; the
 * approve action needs its CSRF token; the upstream state is an opaque key
 * bound to the browser by a cookie, single use, and only ever issued by
 * `/authorize`; plain PKCE is refused; consent is remembered per user and
 * client; the browser login on the shared `/callback` still works; and a
 * signed-in user can list and revoke their MCP grants.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signSession } from '../server/session.js';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { MCP_OAUTH_FIXTURE } from './worker-fixtures.js';

const GITHUB_CLIENT_SECRET = 'sec-1115-01-test-secret';
const FLOW_COOKIE = 'tdg_mcp_auth';
const REDIRECT = 'https://client.example/cb';

async function sessionCookie(uid: string): Promise<string> {
  const token = await signSession(
    { uid, login: 'user' + uid, name: 'User ' + uid },
    GITHUB_CLIENT_SECRET,
  );
  return `tdg_session=${token}`;
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

/** `name=value` pairs from every Set-Cookie on a response. */
function setCookies(res: { headers: Headers }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const eq = pair!.indexOf('=');
    out[pair!.slice(0, eq).trim()] = pair!.slice(eq + 1).trim();
  }
  return out;
}

describe('MCP OAuth consent and state binding (Miniflare, real OAuthProvider)', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(MCP_OAUTH_FIXTURE, {
      sourcefile: 'mcp-oauth-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
      vars: { GITHUB_CLIENT_ID: 'gh-client', GITHUB_CLIENT_SECRET },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  async function register(clientName: string): Promise<string> {
    const res = await handle.fetch('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'none',
      }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { client_id: string }).client_id;
  }

  function authorizePath(
    clientId: string,
    challenge: string,
    method = 'S256',
  ): string {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      state: 'client-state-1',
      code_challenge: challenge,
      code_challenge_method: method,
    });
    return `/authorize?${q}`;
  }

  async function grantKeys(uid: string): Promise<string[]> {
    const kv = await handle.miniflare.getKVNamespace('OAUTH_KV');
    const listed = await kv.list({ prefix: `grant:${uid}:` });
    return listed.keys.map((k) => k.name);
  }

  /** GET /authorize → consent page; returns the flow cookie and CSRF token. */
  async function openConsent(clientId: string, challenge: string) {
    const res = await handle.fetch(authorizePath(clientId, challenge), {
      redirect: 'manual',
    });
    const html = await res.text();
    const flow = setCookies(res)[FLOW_COOKIE];
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
    return { res, html, flow, csrf };
  }

  async function decide(
    flow: string | undefined,
    fields: Record<string, string>,
  ) {
    return handle.fetch('/authorize', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'http://worker.test',
        ...(flow ? { cookie: `${FLOW_COOKIE}=${flow}` } : {}),
      },
      body: new URLSearchParams(fields).toString(),
    });
  }

  async function callback(state: string, code: string, cookie?: string) {
    return handle.fetch(`/callback?${new URLSearchParams({ code, state })}`, {
      redirect: 'manual',
      headers: cookie ? { cookie } : {},
    });
  }

  /** Consent → approve → upstream redirect; returns the opaque state. */
  async function approved(clientId: string, challenge: string) {
    const { flow, csrf } = await openConsent(clientId, challenge);
    expect(flow).toBeTruthy();
    expect(csrf).toBeTruthy();
    const res = await decide(flow, { csrf: csrf!, decision: 'approve' });
    expect(res.status).toBe(302);
    const gh = new URL(res.headers.get('location')!);
    expect(gh.origin + gh.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    return { flow: flow!, state: gh.searchParams.get('state')! };
  }

  it('shows a consent page naming the client and redirect host, and issues no grant without approval', async () => {
    const clientId = await register('Acme <i>Agent</i> "x"');
    const { challenge } = await pkce();
    const { res, html, flow } = await openConsent(clientId, challenge);
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-security-policy')).toContain(
      "script-src 'self'",
    );
    // Client-supplied strings are escaped; the redirect host is shown.
    expect(html).toContain('Acme &lt;i&gt;Agent&lt;/i&gt; &quot;x&quot;');
    expect(html).not.toContain('<i>Agent</i>');
    expect(html).toContain('client.example');
    // No inline script (the CSP would block it anyway).
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
    expect(html).toMatch(/<form[^>]*method="post"/i);
    // The flow cookie is HttpOnly, Secure, SameSite=Lax.
    const line = res.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${FLOW_COOKIE}=`))!;
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/Secure/);
    expect(line).toMatch(/SameSite=Lax/);

    // Going straight to the callback without approving issues nothing.
    const early = await callback(flow!, 'user-42', `${FLOW_COOKIE}=${flow}`);
    expect(early.status).toBeGreaterThanOrEqual(400);
    expect(await grantKeys('42')).toEqual([]);
  });

  it('refuses an approve POST without the matching CSRF token or flow cookie', async () => {
    const clientId = await register('CSRF client');
    const { challenge } = await pkce();
    const { flow, csrf } = await openConsent(clientId, challenge);
    expect((await decide(flow, { decision: 'approve' })).status).toBe(403);
    expect(
      (await decide(flow, { csrf: csrf + 'x', decision: 'approve' })).status,
    ).toBe(403);
    expect(
      (await decide(undefined, { csrf: csrf!, decision: 'approve' })).status,
    ).toBe(400);
  });

  it('cancel returns access_denied to the client and leaves no grant', async () => {
    const clientId = await register('Cancel client');
    const { challenge } = await pkce();
    const { flow, csrf } = await openConsent(clientId, challenge);
    const res = await decide(flow, { csrf: csrf!, decision: 'cancel' });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location')!);
    expect(to.origin + to.pathname).toBe(REDIRECT);
    expect(to.searchParams.get('error')).toBe('access_denied');
    expect(to.searchParams.get('state')).toBe('client-state-1');
    expect(
      (await callback(flow!, 'user-43', `${FLOW_COOKIE}=${flow}`)).status,
    ).toBe(400);
    expect(await grantKeys('43')).toEqual([]);
  });

  it('the approved flow completes and its token reaches the API handler', async () => {
    const clientId = await register('Good client');
    const { verifier, challenge } = await pkce();
    const { flow, state } = await approved(clientId, challenge);
    // The upstream state is the opaque flow key, not the auth request.
    expect(state).toBe(flow);
    expect(state).not.toContain(clientId);

    const res = await callback(state, 'user-42', `${FLOW_COOKIE}=${flow}`);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location')!);
    expect(to.origin + to.pathname).toBe(REDIRECT);
    expect(to.searchParams.get('state')).toBe('client-state-1');
    const code = to.searchParams.get('code')!;
    expect(code).toBeTruthy();

    const tokenRes = await handle.fetch('/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }).toString(),
    });
    expect(tokenRes.status).toBe(200);
    const { access_token } = (await tokenRes.json()) as {
      access_token: string;
    };
    const api = await handle.fetch('/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${access_token}` },
    });
    expect(api.status).toBe(200);
    expect(((await api.json()) as { props: unknown }).props).toMatchObject({
      id: 42,
      login: 'user42',
    });
  });

  it('a callback state is single use', async () => {
    const clientId = await register('Replay client');
    const { challenge } = await pkce();
    const { flow, state } = await approved(clientId, challenge);
    const cookie = `${FLOW_COOKIE}=${flow}`;
    expect((await callback(state, 'user-44', cookie)).status).toBe(302);
    const grants = await grantKeys('44');
    expect(grants).toHaveLength(1);
    expect((await callback(state, 'user-44', cookie)).status).toBe(400);
    expect(await grantKeys('44')).toEqual(grants);
  });

  it('a callback without the flow cookie of the browser that started it is refused', async () => {
    const clientId = await register('Other browser client');
    const { challenge } = await pkce();
    const { state } = await approved(clientId, challenge);
    expect((await callback(state, 'user-45')).status).toBe(400);
    expect(
      (await callback(state, 'user-45', `${FLOW_COOKIE}=not-the-flow`)).status,
    ).toBe(400);
    expect(await grantKeys('45')).toEqual([]);
  });

  it('a state that /authorize did not issue is refused', async () => {
    const clientId = await register('Unissued state client');
    const { challenge } = await pkce();
    const request = {
      responseType: 'code',
      clientId,
      redirectUri: REDIRECT,
      scope: [],
      state: 'x',
      codeChallenge: challenge,
      codeChallengeMethod: 'plain',
    };
    const encoded = btoa(JSON.stringify(request));
    for (const [state, cookie] of [
      [encoded, undefined],
      [encoded, `${FLOW_COOKIE}=${encoded}`],
      ['random-key', `${FLOW_COOKIE}=random-key`],
    ] as const) {
      expect((await callback(state, 'user-46', cookie)).status).toBe(400);
    }
    expect(await grantKeys('46')).toEqual([]);
  });

  it('refuses the plain PKCE method at /authorize', async () => {
    const clientId = await register('Plain PKCE client');
    const res = await handle.fetch(
      authorizePath(clientId, 'a'.repeat(43), 'plain'),
      { redirect: 'manual' },
    );
    expect(res.status).toBe(400);
    expect(setCookies(res)[FLOW_COOKIE]).toBeUndefined();
  });

  it('asks a signed-in user once per client, and only for that user', async () => {
    const clientId = await register('Remembered client');
    const { challenge } = await pkce();
    const first = await approved(clientId, challenge);
    expect(
      (await callback(first.state, 'user-47', `${FLOW_COOKIE}=${first.flow}`))
        .status,
    ).toBe(302);

    // Same user, same client: straight to GitHub, no consent page.
    const again = await handle.fetch(authorizePath(clientId, challenge), {
      redirect: 'manual',
      headers: { cookie: await sessionCookie('47') },
    });
    expect(again.status).toBe(302);
    const flow = setCookies(again)[FLOW_COOKIE]!;
    const state = new URL(again.headers.get('location')!).searchParams.get(
      'state',
    )!;
    expect(state).toBe(flow);
    // ...but if GitHub signs in as someone else, that user never consented.
    expect(
      (await callback(state, 'user-48', `${FLOW_COOKIE}=${flow}`)).status,
    ).toBe(403);
    expect(await grantKeys('48')).toEqual([]);

    // A different client still gets the consent page.
    const other = await register('Unapproved client');
    const page = await handle.fetch(authorizePath(other, challenge), {
      redirect: 'manual',
      headers: { cookie: await sessionCookie('47') },
    });
    expect(page.status).toBe(200);
  });

  it('the browser login still completes through the shared /callback', async () => {
    const start = await handle.fetch('/auth/github?go=%2Fkeys', {
      redirect: 'manual',
    });
    expect(start.status).toBe(302);
    const state = new URL(start.headers.get('location')!).searchParams.get(
      'state',
    )!;
    expect(state.startsWith('web.')).toBe(true);
    const cookie = Object.entries(setCookies(start))
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    const done = await callback(state, 'user-49', cookie);
    expect(done.status).toBe(302);
    expect(done.headers.get('location')).toBe('/keys');
    expect(setCookies(done)['tdg_session']).toBeTruthy();
  });

  it('a signed-in user can list and revoke their MCP grants', async () => {
    const clientId = await register('Revocable <b>client</b>');
    const { challenge } = await pkce();
    const { flow, state } = await approved(clientId, challenge);
    expect(
      (await callback(state, 'user-50', `${FLOW_COOKIE}=${flow}`)).status,
    ).toBe(302);
    const cookie = await sessionCookie('50');

    expect(
      (await handle.fetch('/connections', { redirect: 'manual' })).status,
    ).toBe(302);
    const page = await handle.fetch('/connections', { headers: { cookie } });
    expect(page.status).toBe(200);
    const pageHtml = await page.text();
    expect(pageHtml).toContain('<script src="/connections.js"></script>');
    expect(pageHtml).not.toMatch(/<script(?![^>]*\bsrc=)/i);
    expect((await handle.fetch('/api/connections')).status).toBe(401);

    const listed = await handle.fetch('/api/connections', {
      headers: { cookie },
    });
    expect(listed.status).toBe(200);
    const { connections } = (await listed.json()) as {
      connections: { id: string; clientId: string; clientName: string }[];
    };
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      clientId,
      clientName: 'Revocable <b>client</b>',
    });

    // Another user cannot revoke it.
    const foreign = await handle.fetch(
      `/api/connections/${connections[0]!.id}`,
      { method: 'DELETE', headers: { cookie: await sessionCookie('51') } },
    );
    expect(foreign.status).toBe(404);
    expect(await grantKeys('50')).toHaveLength(1);

    const revoked = await handle.fetch(
      `/api/connections/${connections[0]!.id}`,
      { method: 'DELETE', headers: { cookie } },
    );
    expect(revoked.status).toBe(200);
    expect(await grantKeys('50')).toEqual([]);
    // Revoking also forgets the consent: the next connect asks again.
    const next = await handle.fetch(authorizePath(clientId, challenge), {
      redirect: 'manual',
      headers: { cookie },
    });
    expect(next.status).toBe(200);
  });
});
