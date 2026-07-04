/**
 * The OAuthProvider's "default handler": everything that isn't the protected
 * MCP API route or the provider's own token/registration endpoints. That is:
 *
 *   GET /authorize          → start GitHub sign-in for an MCP client
 *   GET /callback           → GitHub redirect back; issue the MCP grant
 *   GET /api/topology/:id    → a published share snapshot (public, from KV)
 *   /v/:id and everything else → the static SPA (env.ASSETS)
 *
 * GitHub is the upstream identity provider. We deliberately skip our own consent
 * screen (GitHub already shows one) so connecting is a single authorize click.
 */
import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import type { WorkerEnv } from './env.js';
import {
  completeWebLogin,
  currentUser,
  handleLogout,
  handleMe,
  isDocumentNavigation,
  isWebCallback,
  loginPage,
  startWebLogin,
} from './auth.js';

const API_TOPOLOGY_PREFIX = '/api/topology/';

/**
 * Content-Security-Policy for every browser-facing response. `script-src 'self'`
 * (no `'unsafe-inline'`) is the key line: it blocks inline event handlers such
 * as an injected `<image onerror=…>`, so even a rendering-layer escaping miss on
 * untrusted topology data cannot execute script. The app has no inline scripts
 * and no runtime eval; all scripts (the app bundle + the vendored engine) are
 * same-origin. Styles keep `'unsafe-inline'` because the UI and login page use
 * inline `style="…"`/`<style>`; fonts/images allow `data:` for Vite-inlined
 * assets and inline SVG. `frame-ancestors 'none'` adds clickjacking protection.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
].join('; ');

/** Add CSP + hardening headers to a response, preserving its body and status. */
function withSecurityHeaders(resp: Response): Response {
  const headers = new Headers(resp.headers);
  if (!headers.has('content-security-policy'))
    headers.set('content-security-policy', CSP);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('x-frame-options', 'DENY');
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

/** Minimal shapes of the GitHub responses we read. */
interface GitHubToken {
  access_token?: string;
  error?: string;
}
interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
}

/** Serve a published snapshot's JSON from KV (the SPA fetches this for /v/:id). */
async function serveSnapshot(id: string, env: WorkerEnv): Promise<Response> {
  const json = await env.TOPOLOGY_KV.get(`doc:${id}`);
  if (!json) {
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(json, {
    headers: {
      'content-type': 'application/json',
      // A snapshot id is write-once (a fresh random id per publish), so its
      // payload never changes — cache it hard so repeat/shared views skip the
      // round trip. Bounded well under the KV 30-day TTL.
      'cache-control': 'public, max-age=86400, immutable',
    },
  });
}

/** Step 1: parse the MCP client's auth request and bounce to GitHub. */
async function handleAuthorize(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  if (!oauthReqInfo.clientId) {
    return new Response('Invalid OAuth request\n', { status: 400 });
  }
  const redirectUri = new URL('/callback', request.url).href;
  const gh = new URL('https://github.com/login/oauth/authorize');
  gh.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  gh.searchParams.set('redirect_uri', redirectUri);
  gh.searchParams.set('scope', 'read:user');
  // Round-trip the MCP auth request through GitHub's state parameter.
  gh.searchParams.set('state', btoa(JSON.stringify(oauthReqInfo)));
  return Response.redirect(gh.href, 302);
}

/** Step 2: GitHub redirects back; exchange the code and issue the MCP grant. */
async function handleCallback(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return new Response('Missing code/state\n', { status: 400 });
  }
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(atob(state)) as AuthRequest;
  } catch {
    return new Response('Bad state\n', { status: 400 });
  }
  if (!oauthReqInfo.clientId) {
    return new Response('Bad state\n', { status: 400 });
  }

  // Exchange the code for a GitHub access token.
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL('/callback', request.url).href,
    }),
  });
  const token = (await tokenRes.json()) as GitHubToken;
  if (!token.access_token) {
    return new Response('GitHub authorization failed\n', { status: 401 });
  }

  // Identify the user.
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${token.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'topology-dojo',
    },
  });
  if (!userRes.ok) {
    return new Response('Could not read GitHub profile\n', { status: 401 });
  }
  const user = (await userRes.json()) as GitHubUser;

  // Issue the MCP grant; `props` becomes `this.props` in the MCP agent.
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: String(user.id),
    metadata: { label: user.login },
    scope: oauthReqInfo.scope,
    props: { id: user.id, login: user.login, name: user.name },
  });
  return Response.redirect(redirectTo, 302);
}

export const defaultHandler = {
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return withSecurityHeaders(await route(request, env, ctx));
  },
};

async function route(
  request: Request,
  env: WorkerEnv,
  _ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  // Browser login flow (separate from the MCP OAuth flow below).
  if (pathname === '/login')
    return loginPage(url.searchParams.get('go') ?? '/');
  if (pathname === '/auth/github') return startWebLogin(request, env);
  if (pathname === '/logout') return handleLogout();
  if (pathname === '/api/me') return handleMe(request, env);

  // MCP OAuth provider flow. `/callback` is shared: the browser login uses a
  // `web.`-prefixed state, the MCP client flow does not.
  if (pathname === '/authorize') return handleAuthorize(request, env);
  if (pathname === '/callback') {
    return isWebCallback(url.searchParams.get('state'))
      ? completeWebLogin(request, env)
      : handleCallback(request, env);
  }

  // Public share snapshot API (backs the read-only /v/:id view).
  if (pathname.startsWith(API_TOPOLOGY_PREFIX)) {
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed\n', { status: 405 });
    }
    const id = pathname.slice(API_TOPOLOGY_PREFIX.length);
    if (!id) return new Response('Not Found\n', { status: 404 });
    return serveSnapshot(id, env);
  }

  // Gate the editor: a top-level navigation to the app needs a signed-in
  // session. Read-only shared views (/v/:id) stay public; sub-resource
  // fetches (scripts/styles/fonts) are served so the login + shared pages
  // work. Local Vite dev never hits the Worker, so dev is unauthenticated.
  const isSharedView = pathname === '/v' || pathname.startsWith('/v/');
  if (isDocumentNavigation(request) && !isSharedView) {
    const user = await currentUser(request, env);
    if (!user) {
      const go = encodeURIComponent(pathname + url.search);
      return Response.redirect(new URL(`/login?go=${go}`, url).href, 302);
    }
  }

  // /v/:id and everything else fall through to the SPA (the not-found handler
  // serves index.html, and the app reads the share id from the path).
  return env.ASSETS.fetch(request);
}
