/**
 * The OAuthProvider's "default handler": everything that isn't the protected
 * MCP API route or the provider's own token/registration endpoints. That is:
 *
 *   GET /authorize          → start GitHub sign-in for an MCP client
 *   GET /callback           → GitHub redirect back; issue the MCP grant
 *   GET /api/topology/:id    → a published share snapshot (public, from KV)
 *   DELETE /api/topology/:id → owner-only revoke of that snapshot
 *   /v/:id and everything else → the static SPA (env.ASSETS)
 *
 * GitHub is the upstream identity provider. We deliberately skip our own consent
 * screen (GitHub already shows one) so connecting is a single authorize click.
 */
import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import {
  analyticsEnabled,
  profilesEnabled,
  workspaceEnabled,
  type WorkerEnv,
} from './env.js';
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
import { handleWorkspaceApi } from './workspace-api.js';
import { handleProfileApi } from './profile-api.js';
import { handleAdminApi } from './admin-api.js';
import { handleStagingFault, STAGING_FAULT_PATH } from './staging-fault.js';
import {
  SNAPSHOT_GET_LIMIT,
  consumeFixedWindow,
  snapshotClientIp,
  snapshotRateLimitKey,
} from '../src/mcp/rate-limit.js';
import {
  getShareSnapshot,
  revokeShareSnapshot,
  SHARE_CACHE_CONTROL,
} from '../src/share/snapshot.js';

const API_TOPOLOGY_PREFIX = '/api/topology/';

/** Stable 503 body for the `WORKSPACE_ENABLED=false` gate below — see
 * `env.ts`'s `workspaceEnabled` doc comment for the flag semantics. */
const WORKSPACE_DISABLED_BODY = JSON.stringify({ error: 'workspace_disabled' });

/**
 * The workspace surface is off for this deployment: reject before touching
 * `handleWorkspaceApi` (and therefore before any DO/KV binding is read), so
 * the production `v3` bootstrap can ship the `TopologyDocument` binding and
 * migration while staying operationally inert.
 */
function workspaceDisabledResponse(): Response {
  return new Response(WORKSPACE_DISABLED_BODY, {
    status: 503,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

/** Stable 503 body for the `PROFILES_ENABLED` gate — the profile surface's
 * mirror of `WORKSPACE_DISABLED_BODY` above (see `env.ts`'s `profilesEnabled`;
 * unlike workspaces this flag defaults OFF). */
const PROFILES_DISABLED_BODY = JSON.stringify({ error: 'profiles_disabled' });

/**
 * The authoring-profile surface is off for this deployment: reject before
 * touching `handleProfileApi` (and therefore before the `AUTHORING_PROFILE`
 * DO binding is read), so an un-activated production deploy stays inert.
 */
function profilesDisabledResponse(): Response {
  return new Response(PROFILES_DISABLED_BODY, {
    status: 503,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

/** Stable 503 body for the `ANALYTICS_ENABLED` gate on `/api/admin/*` — the
 * admin surface's mirror of the profile gate (also opt-in, default off). */
const ADMIN_DISABLED_BODY = JSON.stringify({ error: 'admin_disabled' });

/**
 * The owner-analytics surface is off for this deployment: reject before
 * touching `handleAdminApi` (and therefore before the `ANALYTICS` DO binding
 * is read), so an un-activated production deploy stays inert.
 */
function adminDisabledResponse(): Response {
  return new Response(ADMIN_DISABLED_BODY, {
    status: 503,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

const NO_STORE = 'no-store';

/** 405 for a non-GET request to a GET-only health/readiness route. */
function methodNotAllowed(): Response {
  return new Response('Method Not Allowed\n', {
    status: 405,
    headers: { 'cache-control': NO_STORE },
  });
}

/**
 * `GET /healthz` — unauthenticated liveness. Proves the Worker script is
 * running and reports its build identity, nothing more: no KV, no Durable
 * Object, no `ASSETS` fetch, no session check. That is what lets it live
 * outside the `isDocumentNavigation` login gate below (see `route()`) and
 * why `scripts/smoke.mjs` can call it with zero credentials against
 * production at any time.
 */
function handleHealthz(request: Request, env: WorkerEnv): Response {
  if (request.method !== 'GET') return methodNotAllowed();
  const body = {
    ok: true,
    sha: env.GIT_SHA ?? null,
    workspaceEnabled: workspaceEnabled(env),
  };
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': NO_STORE },
  });
}

/** Result of one binding probe in `GET /readyz`'s response body. */
interface ReadyCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

function describeProbeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `TOPOLOGY_KV` liveness: a `get` of a key namespaced so it can never collide
 * with a real `doc:<id>` share snapshot (see `serveSnapshot` above). A miss
 * is the expected, and only, result — it still proves the binding round-trips
 * through the KV RPC layer, without ever writing a probe key that would need
 * cleanup or could rot into stale storage.
 */
async function probeKv(env: WorkerEnv): Promise<ReadyCheck> {
  try {
    await env.TOPOLOGY_KV.get('__readyz_probe__');
    return { name: 'kv', ok: true };
  } catch (error) {
    return { name: 'kv', ok: false, detail: describeProbeError(error) };
  }
}

/**
 * `TOPOLOGY_REGISTRY` liveness: `workspaceIds()` against the caller's own
 * per-owner directory DO (`worker/workspaces.ts`'s `user-id:<uid>` naming).
 * It is the cheapest existing read on that class — a single storage `list`
 * already used by the real directory listing path — and, unlike a synthetic
 * probe id, it addresses a DO the owner's normal traffic already touches.
 * The id list itself never leaves this function; only pass/fail is reported.
 */
async function probeRegistry(
  env: WorkerEnv,
  ownerId: string,
): Promise<ReadyCheck> {
  try {
    const ns = env.TOPOLOGY_REGISTRY;
    const stub = ns.get(ns.idFromName(`user-id:${ownerId}`));
    await stub.workspaceIds();
    return { name: 'registry', ok: true };
  } catch (error) {
    return { name: 'registry', ok: false, detail: describeProbeError(error) };
  }
}

/**
 * `TOPOLOGY_DOCUMENT` liveness, only performed when `workspaceEnabled(env)`
 * (mirrors the traffic gate on `/api/workspaces`). There is no per-owner
 * "list" RPC on this class — each instance is one document — so this probes
 * a dedicated coordinator id that follows the real
 * `document:<owner>:<workspaceId>` naming scheme
 * (`worker/workspaces.ts`'s `WorkspaceService.document`) but with a
 * workspace id (`__readyz_probe__`) that `WorkspaceService.create` can never
 * mint (real ids are `w_<uuid>`), so this coordinator is guaranteed to never
 * be a real user's document. `isInitialized` only reads
 * `this.ctx.storage.get(META_KEY)` (see `worker/document.ts`) and returns
 * `false` for an uninitialized coordinator without writing anything — a
 * true read-only echo, not a disguised initialize call.
 */
async function probeDocument(
  env: WorkerEnv,
  ownerId: string,
): Promise<ReadyCheck> {
  try {
    const ns = env.TOPOLOGY_DOCUMENT;
    const stub = ns.get(ns.idFromName(`document:${ownerId}:__readyz_probe__`));
    await stub.isInitialized(ownerId);
    return { name: 'document', ok: true };
  } catch (error) {
    return { name: 'document', ok: false, detail: describeProbeError(error) };
  }
}

/**
 * `GET /readyz` — owner-authenticated readiness. Reuses the exact session
 * check `handleMe`/`/api/me` uses (`currentUser`), then round-trips every
 * binding this deployment depends on (KV always; the registry DO always; the
 * document DO only when the workspace surfaces are live) and reports
 * per-binding pass/fail. Never returns document/workspace content — only
 * booleans and, on failure, a bounded error message.
 */
async function handleReadyz(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed();
  const user = await currentUser(request, env);
  if (!user) {
    return new Response(JSON.stringify({ error: 'authentication required' }), {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'cache-control': NO_STORE,
      },
    });
  }
  const pending: Promise<ReadyCheck>[] = [
    probeKv(env),
    probeRegistry(env, user.uid),
  ];
  if (workspaceEnabled(env)) pending.push(probeDocument(env, user.uid));
  const checks = await Promise.all(pending);
  const ok = checks.every((check) => check.ok);
  return new Response(JSON.stringify({ ok, checks }), {
    status: ok ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': NO_STORE },
  });
}

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

/**
 * Per-IP quota on public snapshot GETs. Uses TOPOLOGY_KV (already on this
 * path) with a short-TTL counter — no new Durable Object. Fail-open if the
 * client IP is missing or KV throws, so a probe/blip cannot take the share
 * API down. 429s are never cached (the successful snapshot is immutable).
 */
async function limitSnapshotGet(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const ip = snapshotClientIp(request);
  if (!ip) return null;
  try {
    const now = Date.now();
    const key = snapshotRateLimitKey(ip, now);
    const raw = await env.TOPOLOGY_KV.get(key);
    const parsed = raw === null ? 0 : Number(raw);
    const current =
      Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
    const outcome = consumeFixedWindow(current, now, SNAPSHOT_GET_LIMIT);
    if (!outcome.result.allowed) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(outcome.result.retryAfterMs / 1000),
      );
      return new Response(
        JSON.stringify({ error: 'rate_limited', retryAfterSeconds }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'retry-after': String(retryAfterSeconds),
          },
        },
      );
    }
    await env.TOPOLOGY_KV.put(key, String(outcome.next), {
      expirationTtl: Math.ceil(SNAPSHOT_GET_LIMIT.windowMs / 1000) + 1,
    });
    return null;
  } catch {
    return null;
  }
}

/** Serve a published snapshot's JSON from KV (the SPA fetches this for /v/:id). */
<<<<<<< HEAD
async function serveSnapshot(
  id: string,
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const limited = await limitSnapshotGet(request, env);
  if (limited) return limited;
  const json = await env.TOPOLOGY_KV.get(`doc:${id}`);
=======
async function serveSnapshot(id: string, env: WorkerEnv): Promise<Response> {
  const json = await getShareSnapshot(env.TOPOLOGY_KV, id);
>>>>>>> origin/main
  if (!json) {
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(json, {
    headers: {
      'content-type': 'application/json',
      // Short public cache so an owner revoke can take effect without a 24h
      // immutable window. GET stays unauthenticated on purpose.
      'cache-control': SHARE_CACHE_CONTROL,
    },
  });
}

/** Owner-only unpublish: delete `doc:<id>` when the session matches the publisher. */
async function revokeSnapshot(
  id: string,
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) {
    return new Response(JSON.stringify({ error: 'authentication required' }), {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'cache-control': NO_STORE,
      },
    });
  }
  const result = await revokeShareSnapshot(env.TOPOLOGY_KV, id, user.uid);
  if (result === 'not_found') {
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: {
        'content-type': 'application/json',
        'cache-control': NO_STORE,
      },
    });
  }
  if (result === 'forbidden') {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: {
        'content-type': 'application/json',
        'cache-control': NO_STORE,
      },
    });
  }
  return new Response(JSON.stringify({ revoked: true }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': NO_STORE,
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
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  // Browser login flow (separate from the MCP OAuth flow below).
  if (pathname === '/login')
    return loginPage(url.searchParams.get('go') ?? '/');
  if (pathname === '/auth/github') return startWebLogin(request, env);
  if (pathname === '/logout') return handleLogout();
  if (pathname === '/api/me') return handleMe(request, env);
  // Health/readiness: handled before the document-navigation login gate
  // below so a direct browser visit to /healthz (which does send an
  // `accept: text/html` document navigation) never redirects to /login —
  // it must stay reachable, unauthenticated, from outside at all times.
  if (pathname === '/healthz') return handleHealthz(request, env);
  if (pathname === '/readyz') return handleReadyz(request, env);
  // Staging-only synthetic fault injection (game-day drills). Inert — the
  // handler returns null and the path falls through to the normal
  // unknown-path behavior below — unless this deployment says
  // DIAGNOSTICS_ENV="staging" AND the staging-only DIAGNOSTICS_TOKEN secret
  // is configured; see worker/staging-fault.ts for the full gate chain and
  // scripts/check-wrangler-env.mjs for the CI rule keeping both out of
  // production config.
  if (pathname === STAGING_FAULT_PATH) {
    const fault = handleStagingFault(request, env);
    if (fault) return fault;
  }
  if (
    pathname === '/api/workspaces' ||
    pathname.startsWith('/api/workspaces/')
  ) {
    if (!workspaceEnabled(env)) return workspaceDisabledResponse();
    return handleWorkspaceApi(request, env);
  }
  if (pathname === '/api/profile' || pathname.startsWith('/api/profile/')) {
    if (!profilesEnabled(env)) return profilesDisabledResponse();
    return handleProfileApi(request, env);
  }
  if (pathname === '/api/admin' || pathname.startsWith('/api/admin/')) {
    if (!analyticsEnabled(env)) return adminDisabledResponse();
    return handleAdminApi(request, env);
  }

  // MCP OAuth provider flow. `/callback` is shared: the browser login uses a
  // `web.`-prefixed state, the MCP client flow does not.
  if (pathname === '/authorize') return handleAuthorize(request, env);
  if (pathname === '/callback') {
    return isWebCallback(url.searchParams.get('state'))
      ? completeWebLogin(request, env, ctx)
      : handleCallback(request, env);
  }

  // Public share snapshot API (backs the read-only /v/:id view). GET is
  // unauthenticated on purpose; DELETE is owner-only revoke.
  if (pathname.startsWith(API_TOPOLOGY_PREFIX)) {
    const id = pathname.slice(API_TOPOLOGY_PREFIX.length);
    if (!id) return new Response('Not Found\n', { status: 404 });
<<<<<<< HEAD
    return serveSnapshot(id, request, env);
=======
    if (request.method === 'GET') return serveSnapshot(id, env);
    if (request.method === 'DELETE') return revokeSnapshot(id, request, env);
    return new Response('Method Not Allowed\n', { status: 405 });
>>>>>>> origin/main
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
