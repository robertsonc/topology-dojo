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
 * The HMAC key for the session cookie is GITHUB_CLIENT_SECRET (already a
 * configured server secret) — no new secret to provision.
 */
import type { WorkerEnv } from './env.js';
import { analyticsEnabled, isAdmin } from './env.js';
import {
  parseCookies,
  signSession,
  verifySession,
  SESSION_TTL_SEC,
  type SessionUser,
} from '../src/server/session.js';
import { safePath } from '../src/server/safe-path.js';

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

const COOKIE_SESSION = 'tdg_session';
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
  return verifySession(token, env.GITHUB_CLIENT_SECRET);
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
  const session = await signSession(sessionUser, env.GITHUB_CLIENT_SECRET);
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

/**
 * The branded login page. Self-contained HTML/CSS; the only sub-resources are
 * the showcase filmstrip stills under `/showcase/*` (static assets copied from
 * `public/`), which the Worker serves ungated because image requests are not
 * document navigations (see `isDocumentNavigation` / the gate in
 * default-handler.ts). The stills are self-contained — no dependency on any
 * ephemeral `/v/:id` share snapshot — so the page never rots.
 */
export function loginPage(go = '/'): Response {
  const auth = `/auth/github?go=${encodeURIComponent(safePath(go))}`;
  // A pre-login showcase of diagrams authored in Topology Dojo, so a visitor
  // gets a feel for the tool before signing in. Each still is an animated WebP
  // (the traffic particles keep flowing), rendered twice back-to-back so the
  // marquee can loop seamlessly with a -50% translate.
  const shots = [
    {
      src: '/showcase/hub-spoke.webp',
      alt: 'Hub-and-spoke WAN: six tunneled branch sites converging on a central hub',
    },
    {
      src: '/showcase/spine-leaf.webp',
      alt: 'Data-center spine-leaf fabric with dual-homed hosts and an EdgeConnect pair to an ISP',
    },
    {
      src: '/showcase/sdwan.webp',
      alt: 'SD-WAN branch routed through a SASE point of presence to the internet and SaaS',
    },
    {
      src: '/showcase/three-tier.webp',
      alt: 'Three-tier web application with a firewall and a DMZ web tier',
    },
  ];
  const frames = [...shots, ...shots]
    .map(
      (s) =>
        `<div class="frame"><img src="${s.src}" alt="${s.alt}" loading="lazy" width="300" height="200"/></div>`,
    )
    .join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Sign in · Topology Dojo</title><style>
:root{--bg:#1d1f27;--panel:#22252e;--border:#3e4550;--text:#e6e8e9;--muted:#7d8a92;--accent:#01a982;--font:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}html{height:100%}
body{margin:0;min-height:100%;background:radial-gradient(1200px 600px at 50% -10%,rgba(1,169,130,.12),transparent),var(--bg);color:var(--text);font-family:var(--font);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:36px 16px}
.card{width:340px;max-width:90vw;background:rgba(34,37,46,.9);border:1px solid var(--border);border-radius:14px;padding:28px;text-align:center;backdrop-filter:blur(8px);box-shadow:0 20px 60px rgba(0,0,0,.4)}
.mark{width:46px;height:46px;border-radius:11px;border:1px solid var(--accent);display:inline-flex;align-items:center;justify-content:center;color:var(--accent);font-size:22px;margin-bottom:14px}
h1{font-size:16px;margin:0 0 4px;letter-spacing:.3px}p{color:var(--muted);font-size:12px;margin:0 0 20px;line-height:1.5}
a.btn{display:flex;align-items:center;justify-content:center;gap:10px;text-decoration:none;background:var(--accent);color:#08130f;font-weight:700;font-size:13px;padding:11px 14px;border-radius:9px}
a.btn:hover{filter:brightness(1.07)}svg{width:18px;height:18px;fill:currentColor}.foot{margin-top:16px;color:var(--muted);font-size:10px}
.showcase{width:min(940px,94vw);text-align:center}
.showcase .cap{color:var(--muted);font-size:11px;margin:0 0 10px;line-height:1.5}
.strip{position:relative;overflow:hidden;border:1px solid var(--border);border-radius:12px;background:linear-gradient(#191b22,#141117);padding:15px 0;-webkit-mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent);mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent)}
.strip::before,.strip::after{content:"";position:absolute;left:0;right:0;height:6px;background:repeating-linear-gradient(90deg,transparent 0 9px,rgba(255,255,255,.13) 9px 15px);pointer-events:none}
.strip::before{top:3px}.strip::after{bottom:3px}
.reel{display:flex;gap:14px;width:max-content;padding:0 7px;animation:reel 60s linear infinite}
.strip:hover .reel{animation-play-state:paused}
.frame{flex:0 0 auto;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#0e1613;box-shadow:0 6px 18px rgba(0,0,0,.35);transition:transform .2s,box-shadow .2s,border-color .2s}
.frame:hover{transform:translateY(-2px) scale(1.02);border-color:var(--accent);box-shadow:0 10px 26px rgba(1,169,130,.25)}
.frame img{display:block;width:300px;height:200px;object-fit:cover}
@keyframes reel{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media (prefers-reduced-motion:reduce){.reel{animation:none}}
</style></head><body><div class="card">
<div class="mark">△</div><h1>Topology Dojo</h1><p>Sign in with GitHub to open the editor.</p>
<a class="btn" href="${auth}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>Sign in with GitHub</a>
<div class="foot">Open to any GitHub account — sign-in identifies your workspaces.</div>
</div>
<div class="showcase">
<p class="cap">Built with Topology Dojo — network topologies authored by AI agents through its MCP server. Sign in to make your own.</p>
<div class="strip"><div class="reel">${frames}</div></div>
</div></body></html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
