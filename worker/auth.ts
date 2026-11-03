/**
 * Browser login flow (gates the SPA), reusing the same GitHub OAuth App as the
 * MCP auth — but a separate, parallel flow: instead of issuing an MCP grant it
 * sets a signed session cookie (see src/server/session). The MCP authorization
 * endpoints (`/authorize`, the MCP `/callback` branch) are untouched.
 *
 *   GET /login          → branded "Sign in with GitHub" page
 *   GET /auth/github    → start: set a state nonce, bounce to GitHub
 *   GET /callback?state=web… → finish: set the session cookie (handled here)
 *   GET /logout         → clear the session, back to /login
 *   GET /api/me         → { login, name } for the signed-in user (or 401)
 *
 * The HMAC key for the session cookie is SESSION_HMAC_SECRET when set,
 * otherwise GITHUB_CLIENT_SECRET (see sessionHmacSecret). The dedicated
 * secret is optional so existing deployments keep working.
 */
import type { WorkerEnv } from './env.js';
import { analyticsEnabled, isAdmin } from './env.js';
import {
  SESSION_COOKIE_NAME,
  parseCookies,
  sessionHmacSecret,
  signSession,
  verifySession,
  SESSION_TTL_SEC,
  type SessionUser,
} from '../src/server/session.js';
import { safePath } from '../src/server/safe-path.js';
import { cinematicLoginPage } from './landing.js';

/** Narrow RPC view of the analytics DO — kept explicit so the cross-DO call
 * typechecks without Cloudflare's conservative Stubable<> inference (same
 * pattern as `profile-api.ts`). */
interface AnalyticsRecordRpc {
  recordLogin(input: {
    uid: string;
    login: string;
    name?: string;
    at: string;
  }): Promise<void>;
}

/**
 * Best-effort: record a browser login into the owner-analytics store. Wrapped
 * so a storage hiccup can never fail the login (it runs under `ctx.waitUntil`,
 * off the response path). Gated by the caller via `analyticsEnabled`.
 */
async function recordLogin(env: WorkerEnv, user: SessionUser): Promise<void> {
  try {
    const ns = env.ANALYTICS;
    const stub = ns.get(
      ns.idFromName('global'),
    ) as unknown as AnalyticsRecordRpc;
    await stub.recordLogin({
      uid: user.uid,
      login: user.login,
      ...(user.name ? { name: user.name } : {}),
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('login analytics record failed', err);
  }
}

const COOKIE_SESSION = SESSION_COOKIE_NAME;
const COOKIE_STATE = 'tdg_oauth_state';
const WEB_STATE_PREFIX = 'web.';

interface GitHubToken {
  access_token?: string;
}
interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
}

/** A path is a safe same-origin redirect target (no open-redirect). */

function cookie(name: string, value: string, maxAgeSec: number): string {
  return (
    `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; ` +
    `Max-Age=${maxAgeSec}`
  );
}

/** The signed-in user for this request (verified session cookie), or null. */
export async function currentUser(
  request: Request,
  env: WorkerEnv,
): Promise<SessionUser | null> {
  const token = parseCookies(request.headers.get('cookie'))[COOKIE_SESSION];
  return verifySession(token, sessionHmacSecret(env));
}

/** Start the browser login: stash a state nonce + return path, go to GitHub. */
export function startWebLogin(request: Request, env: WorkerEnv): Response {
  const url = new URL(request.url);
  const go = safePath(url.searchParams.get('go'));
  const nonce = crypto.randomUUID();
  const gh = new URL('https://github.com/login/oauth/authorize');
  gh.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  gh.searchParams.set('redirect_uri', new URL('/callback', request.url).href);
  gh.searchParams.set('scope', 'read:user');
  gh.searchParams.set('state', WEB_STATE_PREFIX + nonce);
  return new Response(null, {
    status: 302,
    headers: {
      location: gh.href,
      'set-cookie': cookie(COOKIE_STATE, `${nonce}|${go}`, 600),
    },
  });
}

/** True when a `/callback` request belongs to the browser flow (not MCP). */
export function isWebCallback(state: string | null): boolean {
  return !!state && state.startsWith(WEB_STATE_PREFIX);
}

/** Finish the browser login: validate state, exchange code, set the session.
 * `ctx` is threaded through so a successful login can be recorded off the
 * response path (`ctx.waitUntil`, best-effort, gated by `ANALYTICS_ENABLED`). */
export async function completeWebLogin(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  const nonce = state.slice(WEB_STATE_PREFIX.length);
  const stateCookie = parseCookies(request.headers.get('cookie'))[COOKIE_STATE];
  const [cookieNonce, go] = (stateCookie ?? '').split('|');
  if (!code || !nonce || !cookieNonce || nonce !== cookieNonce) {
    return new Response('Bad sign-in state\n', { status: 400 });
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      // Match the redirect_uri sent at /authorize (parity with the MCP flow).
      redirect_uri: new URL('/callback', request.url).href,
    }),
  });
  const tokenText = await tokenRes.text();
  let token: GitHubToken = {};
  try {
    token = JSON.parse(tokenText) as GitHubToken;
  } catch {
    // non-JSON token response — fall through to the guard below
  }
  if (!token.access_token) {
    // Log the upstream detail server-side; keep the user-facing message terse.
    console.error(
      'web login: token exchange failed',
      tokenRes.status,
      tokenText,
    );
    return new Response('GitHub authorization failed\n', { status: 401 });
  }
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${token.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'topology-dojo',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!userRes.ok) {
    console.error(
      'web login: GET /user failed',
      userRes.status,
      await userRes.text(),
    );
    return new Response('Could not read GitHub profile\n', { status: 401 });
  }
  const user = (await userRes.json()) as GitHubUser;
  const sessionUser: SessionUser = {
    uid: String(user.id),
    login: user.login,
    ...(user.name ? { name: user.name } : {}),
  };
  const session = await signSession(sessionUser, sessionHmacSecret(env));
  // Owner-analytics: record the login off the response path, gated + best-effort
  // (never blocks or fails the sign-in). Inert unless ANALYTICS_ENABLED.
  if (analyticsEnabled(env)) ctx.waitUntil(recordLogin(env, sessionUser));
  const headers = new Headers();
  headers.append('location', safePath(go ?? '/'));
  headers.append(
    'set-cookie',
    cookie(COOKIE_SESSION, session, SESSION_TTL_SEC),
  );
  // Clear the one-shot state cookie.
  headers.append('set-cookie', `${COOKIE_STATE}=; Path=/; Max-Age=0`);
  return new Response(null, { status: 302, headers });
}

/** Sign out: clear the session cookie and return to the login page. */
export function handleLogout(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: '/login',
      'set-cookie': `${COOKIE_SESSION}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
}

/** GET /api/me → the signed-in user, or 401. Used by the app header chip. */
export async function handleMe(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return new Response('{}', { status: 401, headers: json });
  // `admin` lets the app reveal the owner-only Admin chip without exposing the
  // configured admin id; the real gate is the `/api/admin` routes, not this.
  return new Response(
    JSON.stringify({
      login: user.login,
      name: user.name,
      admin: isAdmin(env, user.uid),
    }),
    { headers: json },
  );
}

const json = { 'content-type': 'application/json' };

/** Is this a top-level page navigation (vs a sub-resource fetch)? */
export function isDocumentNavigation(request: Request): boolean {
  if (request.method !== 'GET') return false;
  if (request.headers.get('sec-fetch-dest') === 'document') return true;
  // Fallback for clients without Fetch Metadata: an HTML-accepting GET.
  return (request.headers.get('accept') ?? '').includes('text/html');
}

/** Public cinematic landing page; editor, OAuth flow and redirects stay unchanged. */
export function loginPage(go = '/'): Response {
  const auth = `/auth/github?go=${encodeURIComponent(safePath(go))}`;
  return cinematicLoginPage(auth);
}
