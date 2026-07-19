#!/usr/bin/env node
/**
 * External deployment smoke test.
 *
 * Verifies a running Topology Dojo deployment (staging or production) from
 * the outside, using only unauthenticated HTTP requests — it never sends a
 * session cookie, bearer token, or other credential. Safe to run against
 * production at any time.
 *
 * Usage:
 *   node scripts/smoke.mjs <baseUrl> [--sha <expected-sha>] \
 *     [--expect-workspace-disabled] [--expect-profiles-disabled] \
 *     [--expect-analytics-disabled] [--json]
 *
 * All checks run regardless of earlier failures. The process exits non-zero
 * only if at least one check FAILED; SKIPPED checks (a route that does not
 * exist on this deployment yet) do not fail the run.
 *
 * The `--expect-*-disabled` flags flip the corresponding feature-flag
 * contract check from its enabled shape (401 for an unauthenticated caller)
 * to the disabled shape (the stable 503 body) — used by the game-day
 * forward-disable drills (docs/GAME_DAY.md) and the bootstrap deploys.
 *
 * See docs/DEPLOYMENT_RUNBOOK.md ("Smoke checklist") for the manual checks
 * (browser OAuth, MCP session, shared workspace flows) this script does not
 * and cannot cover unauthenticated.
 *
 * The check/runner functions are exported so
 * `src/testing/smoke-checks.test.ts` can exercise them against a
 * Miniflare-served worker without shelling out; `main()` runs only when the
 * script is executed directly (same pattern as check-wrangler-env.mjs).
 */
/* global fetch, AbortSignal, URL, console, process, setTimeout */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Per-request timeout: a hung deployment must fail the run, not hang CI. */
const TIMEOUT_MS = 15_000;

const WORKSPACE_DISABLED_BODY = { error: 'workspace_disabled' };
const PROFILES_DISABLED_BODY = { error: 'profiles_disabled' };
const ADMIN_DISABLED_BODY = { error: 'admin_disabled' };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = {
    baseUrl: undefined,
    sha: undefined,
    waitLiveSeconds: 0,
    expectWorkspaceDisabled: false,
    expectProfilesDisabled: false,
    expectAnalyticsDisabled: false,
    json: false,
    help: false,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--sha') {
      args.sha = argv[++i];
    } else if (arg === '--wait-live') {
      args.waitLiveSeconds = Number(argv[++i]);
    } else if (arg === '--expect-workspace-disabled') {
      args.expectWorkspaceDisabled = true;
    } else if (arg === '--expect-profiles-disabled') {
      args.expectProfilesDisabled = true;
    } else if (arg === '--expect-analytics-disabled') {
      args.expectAnalyticsDisabled = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      positionals.push(arg);
    }
  }
  args.baseUrl = positionals[0];
  return args;
}

function usage() {
  return [
    'Usage: node scripts/smoke.mjs <baseUrl> [--sha <expected-sha>] [--wait-live <seconds>] [--expect-workspace-disabled] [--expect-profiles-disabled] [--expect-analytics-disabled] [--json]',
    '',
    'Runs an unauthenticated HTTP smoke suite against a deployed Topology Dojo',
    'origin (e.g. https://topology-dojo-staging.<account>.workers.dev). Never',
    'sends credentials. Exits non-zero if any check fails; SKIPPED checks do',
    'not fail the run.',
    '',
    'Options:',
    '  --sha <sha>                  assert /healthz reports this commit sha',
    '                                (also turns a missing /healthz into a',
    '                                failure instead of a skip)',
    '  --expect-workspace-disabled   assert GET /api/workspaces returns the',
    '                                503 workspace_disabled contract instead',
    '                                of the normal 401',
    '  --expect-profiles-disabled    assert GET /api/profile/preferences',
    '                                returns the 503 profiles_disabled',
    '                                contract instead of the normal 401',
    '  --expect-analytics-disabled   assert GET /api/admin/summary returns',
    '                                the 503 admin_disabled contract instead',
    '                                of the normal 401',
    '  --json                       also print a one-line JSON summary after',
    '                                the human-readable table',
    '  --wait-live <seconds>        poll GET / until the origin stops serving',
    "                                Cloudflare's generic 404 before running",
    '                                the checks — a brand-new workers.dev',
    '                                subdomain takes a little while to become',
    '                                routable after its first-ever deploy',
  ].join('\n');
}

/**
 * Deploying leaves two short race windows, both observed live on the first
 * staging deploys:
 *
 *  1. A first-ever deployment of a new Worker: the fresh workers.dev
 *     subdomain returns Cloudflare's generic 404 for every path until it
 *     becomes routable (run #2 — the same suite passed 7/7 minutes later).
 *  2. A redeploy of an existing Worker: the origin is live but still serving
 *     the previous version for a few seconds, so `/healthz` reports the old
 *     sha (run #3 — 6/7 passed, healthz saw the prior deploy's sha).
 *
 * When an expected sha is known, poll `/healthz` until it reports exactly
 * that sha — which covers both windows at once. Without a sha, fall back to
 * polling `GET /` until the origin stops serving the generic 404. Either
 * way, when the deadline passes the real checks run and judge for
 * themselves.
 */
async function waitForLiveOrigin(baseUrl, seconds, expectedSha) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    try {
      if (expectedSha) {
        const res = await request(baseUrl + '/healthz');
        if (
          res.status === 200 &&
          (res.headers.get('content-type') ?? '').includes('application/json')
        ) {
          const data = await res.json();
          if (data && data.ok === true && data.sha === expectedSha) return true;
        }
      } else {
        const res = await request(baseUrl + '/', {
          headers: { accept: 'text/html' },
        });
        if (res.status !== 404) return true;
      }
    } catch {
      // Unreachable/timeout — keep waiting until the deadline.
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

// ---------------------------------------------------------------------------
// HTTP + result helpers
// ---------------------------------------------------------------------------

/**
 * fetch with a hard timeout, manual redirect handling (checks decide how to
 * treat a redirect themselves), and credentials always omitted — every check
 * in this script must stay valid for an unauthenticated caller.
 */
async function request(url, init = {}) {
  return fetch(url, {
    ...init,
    redirect: init.redirect ?? 'manual',
    credentials: 'omit',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function pass(name, detail) {
  return { name, status: 'pass', detail };
}
function fail(name, detail) {
  return { name, status: 'fail', detail };
}
function skip(name, detail) {
  return { name, status: 'skip', detail };
}

function describeError(err) {
  if (err && err.name === 'TimeoutError') {
    return `timed out after ${TIMEOUT_MS}ms`;
  }
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * GET /healthz → 200 { ok: true, ... }; sha checked when --sha is given.
 *
 * A separate packet (D3) adds /healthz — it does not exist in production
 * yet, so an unimplemented route is SKIPPED (warn), not failed, unless --sha
 * was explicitly passed: the caller demanded sha verification, so an
 * unimplemented endpoint can't satisfy that and must fail instead.
 *
 * "Unimplemented" covers two shapes, both observed against a real Worker:
 * a bare 404, and (because this Worker's assets binding uses
 * `not_found_handling: "single-page-application"`) a 200 that is actually
 * the SPA's index.html falling through as the catch-all for any unmatched
 * non-navigation route — recognized here by its non-JSON content-type
 * rather than by status code alone.
 */
async function checkHealthz(base, sha) {
  const name = 'healthz';
  let res;
  try {
    res = await request(new URL('/healthz', base));
  } catch (err) {
    return fail(name, `request failed: ${describeError(err)}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  const looksUnimplemented =
    res.status === 404 ||
    (res.status === 200 && !contentType.includes('application/json'));
  if (looksUnimplemented) {
    const shape = `status ${res.status}, content-type "${contentType}"`;
    if (sha) {
      return fail(
        name,
        `/healthz is not implemented on this deployment (${shape}) but --sha was passed, so the deployed commit could not be verified`,
      );
    }
    return skip(
      name,
      `/healthz is not implemented on this deployment yet (${shape})`,
    );
  }
  if (res.status !== 200) {
    return fail(
      name,
      `expected 200 JSON (or a not-implemented response), got ${res.status}`,
    );
  }
  let data;
  try {
    data = await res.json();
  } catch {
    return fail(name, 'response body was not valid JSON');
  }
  if (!data || data.ok !== true) {
    return fail(
      name,
      `expected { ok: true, ... }, got ${JSON.stringify(data)}`,
    );
  }
  if (sha && data.sha !== sha) {
    return fail(name, `expected sha "${sha}", got ${JSON.stringify(data.sha)}`);
  }
  return pass(
    name,
    sha
      ? `200 ok:true, sha matches ${sha}`
      : `200 ok:true${data.sha ? `, sha=${data.sha}` : ''}`,
  );
}

/**
 * GET / → an unauthenticated document navigation. Production gates the SPA
 * behind sign-in, so the expected shape is a redirect to /login; some
 * deployments may instead serve the SPA directly (ungated). Both are
 * accepted; the check records which one this deployment did.
 */
async function checkApp(base) {
  const name = 'app';
  let res;
  try {
    // `accept: text/html` mimics a real document navigation — Node's fetch
    // does not send Sec-Fetch-Dest, and worker/auth.ts's isDocumentNavigation
    // falls back to an HTML-accepting GET to decide whether to gate.
    res = await request(new URL('/', base), {
      headers: { accept: 'text/html' },
    });
  } catch (err) {
    return fail(name, `request failed: ${describeError(err)}`);
  }
  if (res.status === 302 || res.status === 303) {
    const location = res.headers.get('location') ?? '';
    if (location.includes('/login')) {
      return pass(
        name,
        `${res.status} redirect to "${location}" (SPA gated behind sign-in)`,
      );
    }
    return fail(
      name,
      `${res.status} redirect to unexpected location "${location}"`,
    );
  }
  if (res.status === 200) {
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) {
      return fail(
        name,
        `200 response was not HTML (content-type "${contentType}")`,
      );
    }
    const body = await res.text();
    if (body.includes('id="app"') && body.includes('Topology Dojo')) {
      return pass(
        name,
        '200 HTML containing the app bundle (SPA served ungated)',
      );
    }
    return fail(name, '200 HTML response did not look like the app bundle');
  }
  return fail(
    name,
    `expected a redirect to /login or 200 HTML, got ${res.status}`,
  );
}

/** GET /login → 200 HTML containing a GitHub sign-in affordance. */
async function checkLogin(base) {
  const name = 'login';
  let res;
  try {
    res = await request(new URL('/login', base));
  } catch (err) {
    return fail(name, `request failed: ${describeError(err)}`);
  }
  if (res.status !== 200) return fail(name, `expected 200, got ${res.status}`);
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) {
    return fail(name, `expected HTML, got content-type "${contentType}"`);
  }
  const body = await res.text();
  if (!body.includes('Sign in with GitHub')) {
    return fail(name, '200 HTML did not contain a GitHub sign-in affordance');
  }
  return pass(name, '200 HTML with a GitHub sign-in affordance');
}

/** GET /.well-known/oauth-authorization-server → 200 valid OAuth metadata. */
async function checkOAuthMetadata(base) {
  const name = 'oauth-metadata';
  let res;
  try {
    res = await request(
      new URL('/.well-known/oauth-authorization-server', base),
    );
  } catch (err) {
    return fail(name, `request failed: ${describeError(err)}`);
  }
  if (res.status !== 200) return fail(name, `expected 200, got ${res.status}`);
  let data;
  try {
    data = await res.json();
  } catch {
    return fail(name, 'response body was not valid JSON');
  }
  if (
    typeof data?.authorization_endpoint !== 'string' ||
    typeof data?.token_endpoint !== 'string'
  ) {
    return fail(
      name,
      `missing authorization_endpoint/token_endpoint in ${JSON.stringify(data)}`,
    );
  }
  return pass(
    name,
    'valid metadata (authorization_endpoint, token_endpoint present)',
  );
}

/**
 * POST /mcp with a minimal JSON-RPC-shaped body, no credentials → 401.
 * The remote MCP endpoint is OAuth-protected; an unauthenticated caller must
 * always be rejected, regardless of body shape.
 */
async function checkMcpUnauth(base) {
  const name = 'mcp-unauth';
  let res;
  try {
    res = await request(new URL('/mcp', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    });
  } catch (err) {
    return fail(name, `request failed: ${describeError(err)}`);
  }
  if (res.status !== 401) return fail(name, `expected 401, got ${res.status}`);
  return pass(
    name,
    '401 without credentials, as required by the OAuth provider',
  );
}

/**
 * GET /api/workspaces unauthenticated. Normally 401; with
 * --expect-workspace-disabled, this packet instead asserts the 503
 * workspace_disabled contract introduced by Packet D2 (hardcoded per
 * IMPLEMENTATION_PLAN.md §4 Packet D2, since D2 may not be deployed yet).
 */
async function checkWorkspacesUnauth(base, expectWorkspaceDisabled) {
  const name = 'workspaces-unauth';
  let res;
  try {
    res = await request(new URL('/api/workspaces', base));
  } catch (err) {
    return fail(name, `request failed: ${describeError(err)}`);
  }
  if (expectWorkspaceDisabled) {
    if (res.status !== 503) {
      return fail(name, `expected 503 (workspace disabled), got ${res.status}`);
    }
    let data;
    try {
      data = await res.json();
    } catch {
      return fail(name, '503 response body was not valid JSON');
    }
    if (JSON.stringify(data) !== JSON.stringify(WORKSPACE_DISABLED_BODY)) {
      return fail(
        name,
        `expected exactly ${JSON.stringify(WORKSPACE_DISABLED_BODY)}, got ${JSON.stringify(data)}`,
      );
    }
    return pass(
      name,
      `503 ${JSON.stringify(WORKSPACE_DISABLED_BODY)} as expected`,
    );
  }
  if (res.status !== 401) return fail(name, `expected 401, got ${res.status}`);
  return pass(name, '401 without a session, as expected');
}

/** GET /api/topology/<id that does not exist> → 404. */
async function checkShare404(base) {
  const name = 'share-404';
  let res;
  try {
    res = await request(new URL('/api/topology/nonexistent-smoke-probe', base));
  } catch (err) {
    return fail(name, `request failed: ${describeError(err)}`);
  }
  if (res.status !== 404) return fail(name, `expected 404, got ${res.status}`);
  return pass(name, '404 for a nonexistent share id');
}

/**
 * GET /readyz unauthenticated → 401. The deeper readiness probe is
 * owner-authenticated (worker/default-handler.ts `handleReadyz`); an
 * unauthenticated caller must always be refused BEFORE any binding probe
 * runs. A 200/503 here would mean the auth gate on the probe was lost. Uses
 * the same not-implemented recognition as /healthz (bare 404, or the SPA
 * shell served as a non-JSON 200) so older deployments skip instead of fail.
 */
async function checkReadyzUnauth(base) {
  const name = 'readyz-unauth';
  let res;
  try {
    res = await request(new URL('/readyz', base));
  } catch (err) {
    return fail(name, `request failed: ${describeError(err)}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  const looksUnimplemented =
    res.status === 404 ||
    (res.status === 200 && !contentType.includes('application/json'));
  if (looksUnimplemented) {
    return skip(
      name,
      `/readyz is not implemented on this deployment yet (status ${res.status}, content-type "${contentType}")`,
    );
  }
  if (res.status !== 401) {
    return fail(
      name,
      `expected 401 for an unauthenticated caller, got ${res.status} — the readiness probe must never run without a session`,
    );
  }
  return pass(name, '401 without a session, as required');
}

/** GET /api/me unauthenticated → 401 (the session-identity endpoint). */
async function checkMeUnauth(base) {
  const name = 'me-unauth';
  let res;
  try {
    res = await request(new URL('/api/me', base));
  } catch (err) {
    return fail(name, `request failed: ${describeError(err)}`);
  }
  if (res.status !== 401) return fail(name, `expected 401, got ${res.status}`);
  return pass(name, '401 without a session, as expected');
}

/**
 * GET /api/profile/preferences unauthenticated. Normally 401 (profiles
 * enabled, caller has no session); with --expect-profiles-disabled, asserts
 * the stable 503 profiles_disabled contract instead
 * (worker/default-handler.ts `profilesDisabledResponse`). A deployment
 * predating the profile surface is SKIPPED.
 */
async function checkProfileUnauth(base, expectProfilesDisabled) {
  const name = 'profile-unauth';
  let res;
  try {
    res = await request(new URL('/api/profile/preferences', base));
  } catch (err) {
    return fail(name, `request failed: ${describeError(err)}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  const looksUnimplemented =
    (res.status === 404 && !contentType.includes('application/json')) ||
    (res.status === 200 && !contentType.includes('application/json'));
  if (looksUnimplemented) {
    return skip(
      name,
      `the profile API is not implemented on this deployment yet (status ${res.status}, content-type "${contentType}")`,
    );
  }
  if (expectProfilesDisabled) {
    if (res.status !== 503) {
      return fail(name, `expected 503 (profiles disabled), got ${res.status}`);
    }
    let data;
    try {
      data = await res.json();
    } catch {
      return fail(name, '503 response body was not valid JSON');
    }
    if (JSON.stringify(data) !== JSON.stringify(PROFILES_DISABLED_BODY)) {
      return fail(
        name,
        `expected exactly ${JSON.stringify(PROFILES_DISABLED_BODY)}, got ${JSON.stringify(data)}`,
      );
    }
    return pass(
      name,
      `503 ${JSON.stringify(PROFILES_DISABLED_BODY)} as expected`,
    );
  }
  if (res.status !== 401) return fail(name, `expected 401, got ${res.status}`);
  return pass(name, '401 without a session, as expected');
}

/**
 * GET /api/admin/summary unauthenticated. Normally 401 (analytics enabled,
 * caller has no session — the admin identity check comes after auth); with
 * --expect-analytics-disabled, asserts the stable 503 admin_disabled
 * contract (worker/default-handler.ts `adminDisabledResponse`). A deployment
 * predating the admin surface is SKIPPED.
 */
async function checkAdminUnauth(base, expectAnalyticsDisabled) {
  const name = 'admin-unauth';
  let res;
  try {
    res = await request(new URL('/api/admin/summary', base));
  } catch (err) {
    return fail(name, `request failed: ${describeError(err)}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  const looksUnimplemented =
    (res.status === 404 && !contentType.includes('application/json')) ||
    (res.status === 200 && !contentType.includes('application/json'));
  if (looksUnimplemented) {
    return skip(
      name,
      `the admin API is not implemented on this deployment yet (status ${res.status}, content-type "${contentType}")`,
    );
  }
  if (expectAnalyticsDisabled) {
    if (res.status !== 503) {
      return fail(name, `expected 503 (analytics disabled), got ${res.status}`);
    }
    let data;
    try {
      data = await res.json();
    } catch {
      return fail(name, '503 response body was not valid JSON');
    }
    if (JSON.stringify(data) !== JSON.stringify(ADMIN_DISABLED_BODY)) {
      return fail(
        name,
        `expected exactly ${JSON.stringify(ADMIN_DISABLED_BODY)}, got ${JSON.stringify(data)}`,
      );
    }
    return pass(name, `503 ${JSON.stringify(ADMIN_DISABLED_BODY)} as expected`);
  }
  if (res.status !== 401) return fail(name, `expected 401, got ${res.status}`);
  return pass(name, '401 without a session, as expected');
}

/**
 * GET /showcase/hub-spoke.webp → 200 image. The login page's pre-login
 * showcase filmstrip depends on these static assets serving UNGATED (image
 * requests are not document navigations, so the sign-in gate must not
 * apply). A redirect to /login here is a gating regression that would blank
 * the login page's showcase. Missing entirely (older deployment) → skip.
 */
async function checkShowcase(base) {
  const name = 'showcase';
  let res;
  try {
    res = await request(new URL('/showcase/hub-spoke.webp', base));
  } catch (err) {
    return fail(name, `request failed: ${describeError(err)}`);
  }
  if (res.status === 302 || res.status === 303) {
    return fail(
      name,
      `showcase asset redirected (${res.status} → "${res.headers.get('location') ?? ''}") — static assets must serve ungated`,
    );
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (
    res.status === 404 ||
    (res.status === 200 && contentType.includes('text/html'))
  ) {
    return skip(
      name,
      `showcase assets not present on this deployment (status ${res.status}, content-type "${contentType}")`,
    );
  }
  if (res.status !== 200 || !contentType.includes('image/')) {
    return fail(
      name,
      `expected 200 image, got ${res.status} content-type "${contentType}"`,
    );
  }
  return pass(
    name,
    `200 ${contentType} (login-page showcase asset serves ungated)`,
  );
}

/**
 * GET /v/<nonexistent id> as a document navigation → 200 HTML app shell.
 * Public read-only shared views must stay reachable WITHOUT sign-in (the
 * carve-out in worker/default-handler.ts's navigation gate); the SPA itself
 * then renders "not found" client-side after /api/topology/:id 404s. A
 * redirect to /login here means the public share surface got gated — a
 * regression for every previously shared link.
 */
async function checkViewerShell(base) {
  const name = 'viewer-shell';
  let res;
  try {
    res = await request(new URL('/v/nonexistent-smoke-probe', base), {
      headers: { accept: 'text/html' },
    });
  } catch (err) {
    return fail(name, `request failed: ${describeError(err)}`);
  }
  if (res.status === 302 || res.status === 303) {
    return fail(
      name,
      `${res.status} redirect to "${res.headers.get('location') ?? ''}" — the public /v/:id shared view must not require sign-in`,
    );
  }
  if (res.status !== 200) {
    return fail(name, `expected 200 HTML app shell, got ${res.status}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) {
    return fail(name, `expected HTML, got content-type "${contentType}"`);
  }
  const body = await res.text();
  if (!body.includes('id="app"')) {
    return fail(name, '200 HTML did not look like the app shell');
  }
  return pass(name, '200 app shell served without sign-in (public share view)');
}

/**
 * GET /__staging/fault WITHOUT a diagnostics token must never fire a
 * synthetic fault, in any environment. In production the route is fully
 * inert (worker/staging-fault.ts returns null and the path falls through to
 * the SPA/login behavior); in a configured staging it must answer 403
 * without the token. The ONLY failing shape is an actual synthetic fault
 * response — the x-synthetic-fault marker header, or a 500 whose JSON body
 * says synthetic:true — which would mean the fault gate fired without
 * credentials.
 */
async function checkFaultInert(base) {
  const name = 'fault-inert';
  let res;
  try {
    res = await request(new URL('/__staging/fault', base));
  } catch (err) {
    return fail(name, `request failed: ${describeError(err)}`);
  }
  const marker = res.headers.get('x-synthetic-fault');
  if (marker) {
    return fail(
      name,
      `synthetic fault fired without a token (x-synthetic-fault: ${marker}) — the staging fault gate is broken`,
    );
  }
  if (res.status === 500) {
    let synthetic = false;
    try {
      const data = await res.json();
      synthetic = data?.synthetic === true;
    } catch {
      // Non-JSON 500: a real server error, not the synthetic contract.
    }
    if (synthetic) {
      return fail(
        name,
        '500 synthetic fault body without a token — the staging fault gate is broken',
      );
    }
    return fail(name, 'unexpected (non-synthetic) 500 from the fault path');
  }
  if (res.status === 403) {
    return pass(
      name,
      '403 without a token (staging gate configured; fault did not fire)',
    );
  }
  return pass(
    name,
    `inert (${res.status} — behaves like any unknown path; no synthetic fault without a token)`,
  );
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runSmoke(
  baseUrl,
  {
    sha,
    expectWorkspaceDisabled = false,
    expectProfilesDisabled = false,
    expectAnalyticsDisabled = false,
  },
) {
  const tasks = [
    ['healthz', () => checkHealthz(baseUrl, sha)],
    ['readyz-unauth', () => checkReadyzUnauth(baseUrl)],
    ['app', () => checkApp(baseUrl)],
    ['login', () => checkLogin(baseUrl)],
    ['me-unauth', () => checkMeUnauth(baseUrl)],
    ['oauth-metadata', () => checkOAuthMetadata(baseUrl)],
    ['mcp-unauth', () => checkMcpUnauth(baseUrl)],
    [
      'workspaces-unauth',
      () => checkWorkspacesUnauth(baseUrl, expectWorkspaceDisabled),
    ],
    [
      'profile-unauth',
      () => checkProfileUnauth(baseUrl, expectProfilesDisabled),
    ],
    ['admin-unauth', () => checkAdminUnauth(baseUrl, expectAnalyticsDisabled)],
    ['share-404', () => checkShare404(baseUrl)],
    ['viewer-shell', () => checkViewerShell(baseUrl)],
    ['showcase', () => checkShowcase(baseUrl)],
    ['fault-inert', () => checkFaultInert(baseUrl)],
  ];
  // allSettled (not fail-fast): every check runs and reports independently,
  // even if a check function throws something its own try/catch didn't
  // anticipate.
  const settled = await Promise.allSettled(tasks.map(([, run]) => run()));
  return settled.map((outcome, i) => {
    const [name] = tasks[i];
    if (outcome.status === 'fulfilled') return outcome.value;
    return fail(name, `check crashed: ${describeError(outcome.reason)}`);
  });
}

function printTable(baseUrl, results) {
  const STATUS_LABEL = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' };
  const nameWidth = Math.max(...results.map((r) => r.name.length));
  console.log(`Smoke: ${baseUrl}`);
  for (const r of results) {
    console.log(
      `  [${STATUS_LABEL[r.status].padEnd(4)}] ${r.name.padEnd(nameWidth)}  ${r.detail}`,
    );
  }
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
}

function printJsonSummary(baseUrl, results) {
  const summary = {
    baseUrl,
    ok: results.every((r) => r.status !== 'fail'),
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'fail').length,
    skipped: results.filter((r) => r.status === 'skip').length,
    checks: results,
  };
  console.log(JSON.stringify(summary));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.baseUrl) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
    return;
  }

  let baseUrl;
  try {
    baseUrl = new URL(args.baseUrl).origin;
  } catch {
    console.error(`Invalid base URL: "${args.baseUrl}"`);
    process.exit(1);
    return;
  }

  if (args.waitLiveSeconds > 0) {
    const live = await waitForLiveOrigin(
      baseUrl,
      args.waitLiveSeconds,
      args.sha,
    );
    console.log(
      live
        ? args.sha
          ? `Origin is live and serving sha ${args.sha} (within ${args.waitLiveSeconds}s window).`
          : `Origin is live (checked within ${args.waitLiveSeconds}s window).`
        : `Origin not confirmed ${args.sha ? `on sha ${args.sha}` : 'live'} after ${args.waitLiveSeconds}s — running checks anyway.`,
    );
  }

  const results = await runSmoke(baseUrl, {
    sha: args.sha,
    expectWorkspaceDisabled: args.expectWorkspaceDisabled,
    expectProfilesDisabled: args.expectProfilesDisabled,
    expectAnalyticsDisabled: args.expectAnalyticsDisabled,
  });

  printTable(baseUrl, results);
  if (args.json) printJsonSummary(baseUrl, results);

  process.exit(results.some((r) => r.status === 'fail') ? 1 : 0);
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error('smoke run crashed:', err);
    process.exit(1);
  });
}
