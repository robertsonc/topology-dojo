/**
 * The MCP client authorization flow (the OAuthProvider's `/authorize` and the
 * MCP branch of `/callback`), plus the signed-in user's list of MCP grants.
 *
 *   GET  /authorize  → validate the client's request, keep it server-side
 *                      under a random flow key, and show our consent page
 *                      (or go straight to GitHub when this signed-in user
 *                      already approved this client)
 *   POST /authorize  → the consent decision (CSRF token + flow cookie)
 *   GET  /callback   → GitHub redirect back (state = the flow key); the
 *                      browser's flow cookie must match, the flow record is
 *                      single use, and only then is the grant issued
 *   GET  /api/connections, DELETE /api/connections/:grantId → list / revoke
 *
 * Storage (`OAUTH_KV`, alongside the provider's own `client:` / `grant:` /
 * `token:` records):
 *   `mcpflow:<key>`              one pending authorization, 10-minute TTL
 *   `mcpconsent:<uid>:<client>`  this GitHub user approved this client
 */
import type {
  AuthRequest,
  ClientInfo,
  GrantSummary,
} from '@cloudflare/workers-oauth-provider';
import type { WorkerEnv } from './env.js';
import { currentUser } from './auth.js';
import { parseCookies } from '../src/server/session.js';
import { timingSafeEqual } from '../src/server/api-key.js';

export const MCP_FLOW_COOKIE = 'tdg_mcp_auth';
const FLOW_TTL_SEC = 600;
const FLOW_PREFIX = 'mcpflow:';
const CONSENT_PREFIX = 'mcpconsent:';
/** 32 random bytes, base64url: the only shape a flow key can have. */
const FLOW_KEY_RE = /^[A-Za-z0-9_-]{43}$/;

interface FlowRecord {
  request: AuthRequest;
  csrf: string;
  /** The user approved this client on our consent page in this flow. */
  consented: boolean;
  /** Consent was skipped because this signed-in user approved before; the
   * GitHub identity at the callback must be the same user. */
  preapprovedUid?: string;
}

interface GitHubToken {
  access_token?: string;
}
interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function flowCookie(value: string, maxAge: number): string {
  return `${MCP_FLOW_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function consentKey(uid: string, clientId: string): string {
  return `${CONSENT_PREFIX}${uid}:${clientId}`;
}

function text(body: string, status: number, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('content-type', 'text/plain; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(body + '\n', { status, headers });
}

/** The flow key this browser holds, if it is well formed. */
function cookieFlowKey(request: Request): string | null {
  const value = parseCookies(request.headers.get('cookie'))[MCP_FLOW_COOKIE];
  return value && FLOW_KEY_RE.test(value) ? value : null;
}

async function loadFlow(
  env: WorkerEnv,
  key: string,
): Promise<FlowRecord | null> {
  const raw = await env.OAUTH_KV.get(FLOW_PREFIX + key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FlowRecord;
  } catch {
    return null;
  }
}

function saveFlow(env: WorkerEnv, key: string, flow: FlowRecord) {
  return env.OAUTH_KV.put(FLOW_PREFIX + key, JSON.stringify(flow), {
    expirationTtl: FLOW_TTL_SEC,
  });
}

function githubRedirect(request: Request, env: WorkerEnv, key: string) {
  const gh = new URL('https://github.com/login/oauth/authorize');
  gh.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  gh.searchParams.set('redirect_uri', new URL('/callback', request.url).href);
  gh.searchParams.set('scope', 'read:user');
  // Only the opaque flow key leaves the Worker; the request stays in KV.
  gh.searchParams.set('state', key);
  return new Response(null, {
    status: 302,
    headers: {
      location: gh.href,
      'set-cookie': flowCookie(key, FLOW_TTL_SEC),
      'cache-control': 'no-store',
    },
  });
}

/** How the redirect target is shown on the consent page. */
function redirectLabel(redirectUri: string): string {
  try {
    const u = new URL(redirectUri);
    return u.host ? `${u.protocol}//${u.host}` : `${u.protocol}${u.pathname}`;
  } catch {
    return redirectUri;
  }
}

/** `/authorize`: GET starts a flow, POST records the consent decision. */
export async function handleAuthorize(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  if (request.method === 'POST') return handleConsentDecision(request, env);
  if (request.method !== 'GET') return text('Method Not Allowed', 405);

  let authRequest: AuthRequest;
  try {
    // Checks the client exists, the redirect URI is registered for it, and
    // the PKCE method is allowed (`allowPlainPKCE: false`).
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (err) {
    return text(
      `Invalid OAuth request: ${err instanceof Error ? err.message : 'unparseable'}`,
      400,
    );
  }
  if (!authRequest.clientId || !authRequest.redirectUri) {
    return text(
      'Invalid OAuth request: client_id and redirect_uri are required',
      400,
    );
  }
  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  if (!client) return text('Invalid OAuth request: unknown client', 400);

  const key = randomKey();
  const flow: FlowRecord = {
    request: authRequest,
    csrf: randomKey(),
    consented: false,
  };

  const user = await currentUser(request, env);
  if (
    user &&
    (await env.OAUTH_KV.get(consentKey(user.uid, authRequest.clientId)))
  ) {
    flow.preapprovedUid = user.uid;
    await saveFlow(env, key, flow);
    return githubRedirect(request, env, key);
  }

  await saveFlow(env, key, flow);
  return consentPage(client, authRequest, flow.csrf, key);
}

async function handleConsentDecision(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return text('Cross-origin consent refused', 403);
  }
  const key = cookieFlowKey(request);
  if (!key)
    return text(
      'This authorization has expired; start again from your app',
      400,
    );
  const flow = await loadFlow(env, key);
  if (!flow)
    return text(
      'This authorization has expired; start again from your app',
      400,
    );

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return text('Bad consent form', 400);
  }
  const csrf = form.get('csrf');
  if (typeof csrf !== 'string' || !timingSafeEqual(csrf, flow.csrf)) {
    return text('Consent form token mismatch', 403);
  }
  const decision = form.get('decision');
  if (decision === 'approve') {
    flow.consented = true;
    await saveFlow(env, key, flow);
    return githubRedirect(request, env, key);
  }
  if (decision === 'cancel') {
    await env.OAUTH_KV.delete(FLOW_PREFIX + key);
    // The redirect URI was checked against the client's registration.
    const to = new URL(flow.request.redirectUri);
    to.searchParams.set('error', 'access_denied');
    if (flow.request.state) to.searchParams.set('state', flow.request.state);
    return new Response(null, {
      status: 302,
      headers: {
        location: to.href,
        'set-cookie': flowCookie('', 0),
        'cache-control': 'no-store',
      },
    });
  }
  return text('Bad consent decision', 400);
}

/** `/callback` for the MCP flow (the browser login uses `web.` states). */
export async function handleMcpCallback(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const bad = () =>
    text('Bad or expired authorization state', 400, {
      'set-cookie': flowCookie('', 0),
    });
  if (!code || !state || !FLOW_KEY_RE.test(state)) return bad();
  const key = cookieFlowKey(request);
  if (!key || !timingSafeEqual(key, state)) return bad();
  const flow = await loadFlow(env, key);
  if (!flow) return bad();
  // Single use: whatever happens next, this flow cannot be completed again.
  await env.OAUTH_KV.delete(FLOW_PREFIX + key);
  if (!flow.consented && !flow.preapprovedUid) return bad();

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL('/callback', request.url).href,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  let token: GitHubToken = {};
  try {
    token = (await tokenRes.json()) as GitHubToken;
  } catch {
    // non-JSON upstream response: handled by the guard below
  }
  if (!token.access_token) {
    return text('GitHub authorization failed', 401);
  }
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${token.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'topology-dojo',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!userRes.ok) return text('Could not read GitHub profile', 401);
  const user = (await userRes.json()) as GitHubUser;
  const uid = String(user.id);
  const clientId = flow.request.clientId;

  if (flow.consented) {
    await env.OAUTH_KV.put(
      consentKey(uid, clientId),
      JSON.stringify({ at: new Date().toISOString() }),
    );
  } else if (
    flow.preapprovedUid !== uid ||
    !(await env.OAUTH_KV.get(consentKey(uid, clientId)))
  ) {
    // Consent was skipped for a different signed-in user than the GitHub
    // account that came back; this account has not approved the client.
    return text(
      'This GitHub account has not approved this app; start again from your app',
      403,
      { 'set-cookie': flowCookie('', 0) },
    );
  }

  // Issue the MCP grant; `props` becomes `this.props` in the MCP agent.
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: flow.request,
    userId: uid,
    metadata: { label: user.login },
    scope: flow.request.scope,
    props: { id: user.id, login: user.login, name: user.name },
  });
  return new Response(null, {
    status: 302,
    headers: {
      location: redirectTo,
      'set-cookie': flowCookie('', 0),
      'cache-control': 'no-store',
    },
  });
}

function consentPage(
  client: ClientInfo,
  authRequest: AuthRequest,
  csrf: string,
  key: string,
): Response {
  const name = esc(client.clientName?.trim() || 'An unnamed app');
  const target = esc(redirectLabel(authRequest.redirectUri));
  const clientId = esc(client.clientId);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect an app · Topology Dojo</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --panel:#171a21; --line:#2a2f3a;
          --fg:#e6e8ee; --muted:#9aa3b2; --accent:#4cc38a; --warn:#f5b84b; }
  * { box-sizing: border-box; }
  body { margin:0; font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         background: var(--bg); color: var(--fg); }
  main { max-width: 520px; margin: 48px auto; padding: 0 16px; }
  section { background: var(--panel); border:1px solid var(--line); border-radius:10px; padding:24px; }
  h1 { font-size:20px; margin:0 0 12px; }
  p { margin: 10px 0; color: var(--muted); }
  b, code { color: var(--fg); overflow-wrap:anywhere; }
  code { font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .warn { color: var(--warn); }
  .row { display:flex; gap:10px; margin-top:20px; }
  button { padding:9px 16px; border-radius:6px; border:1px solid var(--line); background:#222734; color:var(--fg); cursor:pointer; font:inherit; }
  button.primary { background: var(--accent); color:#04130b; border-color: transparent; font-weight:600; }
</style>
</head>
<body>
<main>
  <section>
    <h1>Connect an app to Topology Dojo?</h1>
    <p><b>${name}</b> is asking to use the Topology Dojo MCP tools as you:
    read and change your drafts and, where your account allows, publish
    share links and work in shared workspaces.</p>
    <p>After you approve, GitHub asks you to sign in, and you are sent back
    to <code>${target}</code>.</p>
    <p class="warn">The app chose its own name. Approve only if you started
    this connection and recognise that address.</p>
    <p>Client ID <code>${clientId}</code>. You can disconnect it later from
    <code>/connections</code>.</p>
    <form method="post" action="/authorize">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <div class="row">
        <button type="submit" class="primary" name="decision" value="approve">Approve</button>
        <button type="submit" name="decision" value="cancel">Cancel</button>
      </div>
    </form>
  </section>
</main>
</body>
</html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': flowCookie(key, FLOW_TTL_SEC),
    },
  });
}

/* ── the signed-in user's MCP grants ─────────────────────────────────── */

async function allGrants(env: WorkerEnv, uid: string): Promise<GrantSummary[]> {
  const out: GrantSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.OAUTH_PROVIDER.listUserGrants(
      uid,
      cursor ? { cursor } : undefined,
    );
    out.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

/** `GET /api/connections`, `DELETE /api/connections/:grantId` (cookie auth). */
export async function handleConnectionsApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'authentication required' }, 401);
  const rest = new URL(request.url).pathname
    .slice('/api/connections'.length)
    .replace(/^\//, '');

  if (request.method === 'GET' && !rest) {
    const grants = await allGrants(env, user.uid);
    const connections = await Promise.all(
      grants.map(async (g) => {
        const client = await env.OAUTH_PROVIDER.lookupClient(g.clientId);
        return {
          id: g.id,
          clientId: g.clientId,
          clientName: client?.clientName ?? null,
          redirectHosts: (client?.redirectUris ?? []).map(redirectLabel),
          scope: g.scope,
          createdAt: g.createdAt,
        };
      }),
    );
    connections.sort((a, b) => b.createdAt - a.createdAt);
    return json({ connections });
  }

  if (request.method === 'DELETE' && rest && !rest.includes('/')) {
    const grantId = decodeURIComponent(rest);
    const grant = (await allGrants(env, user.uid)).find(
      (g) => g.id === grantId,
    );
    if (!grant) return json({ error: 'not found' }, 404);
    await env.OAUTH_PROVIDER.revokeGrant(grant.id, user.uid);
    // Forget the approval too, so reconnecting this app asks again.
    await env.OAUTH_KV.delete(consentKey(user.uid, grant.clientId));
    return json({ revoked: true });
  }

  return json({ error: 'method not allowed' }, 405);
}
