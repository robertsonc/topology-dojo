/**
 * Staging-only synthetic fault injection (`GET /__staging/fault`).
 *
 * Purpose: give game-day drills (docs/GAME_DAY.md) a way to produce real,
 * observable failure signals — a 5xx response, an uncaught exception, or a
 * slow response — in the STAGING Worker only, so Cloudflare-side metrics,
 * alert wiring, and the nightly smoke's issue automation can be exercised
 * without ever touching production behavior.
 *
 * Defense in depth — the fault can fire only when ALL of these hold:
 *
 *   1. `DIAGNOSTICS_ENV` is exactly the literal string `"staging"`. This var
 *      is set only in `wrangler.jsonc`'s `env.staging.vars`;
 *      `scripts/check-wrangler-env.mjs` (run in CI and by both deploy
 *      workflows before `wrangler deploy`) FAILS the build if any
 *      `DIAGNOSTICS_*` key appears in the top-level (production) vars, so the
 *      sole authorized production deploy path cannot ship this enabled.
 *   2. A `DIAGNOSTICS_TOKEN` secret is configured (staging-only, via
 *      `wrangler secret put DIAGNOSTICS_TOKEN --env staging`) and is at least
 *      MIN_DIAGNOSTICS_TOKEN_LENGTH characters. Unset ⇒ the route is inert.
 *   3. The request presents that exact token in the
 *      `x-diagnostics-token` header (compared in constant time).
 *
 * Fail-closed shape: when gate 1 or 2 fails, `handleStagingFault` returns
 * `null` and the router treats the path like any other unknown path (login
 * redirect / SPA fall-through) — production behavior is indistinguishable
 * from the route not existing at all, even if a token secret were somehow
 * present. Only a configured staging deployment ever acknowledges the route
 * (403 without the token, a clearly-labelled synthetic response with it).
 *
 * Every synthetic response is identifiable: JSON bodies carry
 * `synthetic: true` and the `x-synthetic-fault` response header names the
 * mode, so no synthetic result can be mistaken for a real failure when
 * reading logs or metrics after a drill.
 *
 * This module is deliberately import-free (its env parameter is a narrow
 * inline type, not `WorkerEnv`) so `src/testing/staging-fault.test.ts` can
 * unit-test the gate matrix directly under the root tsconfig, alongside the
 * Miniflare integration suites that exercise the real routing.
 */

export const STAGING_FAULT_PATH = '/__staging/fault';
export const STAGING_FAULT_HEADER = 'x-diagnostics-token';
/** Response header present on every synthetic response (names the mode). */
export const SYNTHETIC_FAULT_RESPONSE_HEADER = 'x-synthetic-fault';
/** A shorter configured token is treated as unconfigured (fail closed). */
export const MIN_DIAGNOSTICS_TOKEN_LENGTH = 16;

/** `mode=slow` delay bound — a drill must not be able to wedge staging. */
const MAX_SLOW_DELAY_MS = 5_000;
const DEFAULT_SLOW_DELAY_MS = 2_000;

export type StagingFaultGate =
  /** Not a staging deployment (`DIAGNOSTICS_ENV` !== "staging") — inert. */
  | 'not-staging'
  /** Staging, but no (or too-short) `DIAGNOSTICS_TOKEN` secret — inert. */
  | 'unconfigured'
  /** Staging + token configured, but the request's token is absent/wrong. */
  | 'forbidden'
  /** All three gates passed — the requested fault may fire. */
  | 'authorized';

/**
 * Evaluate the three activation gates. Pure and dependency-free so the full
 * environment matrix (including the production-rejection cases) is unit
 * tested without a Workers runtime.
 */
export function evaluateStagingFaultGate(
  env: { DIAGNOSTICS_ENV?: string; DIAGNOSTICS_TOKEN?: string },
  presentedToken: string | null,
): StagingFaultGate {
  if (env.DIAGNOSTICS_ENV !== 'staging') return 'not-staging';
  const token = env.DIAGNOSTICS_TOKEN;
  if (typeof token !== 'string' || token.length < MIN_DIAGNOSTICS_TOKEN_LENGTH)
    return 'unconfigured';
  if (!presentedToken || !timingSafeStringEqual(presentedToken, token))
    return 'forbidden';
  return 'authorized';
}

/**
 * Constant-time string comparison (XOR-accumulate over UTF-8 bytes). Length
 * is compared first — leaking the token's length is acceptable; leaking
 * per-character match position is not.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++)
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  return diff === 0;
}

function syntheticJson(
  status: number,
  mode: string,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify({ ...body, synthetic: true, mode }), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      [SYNTHETIC_FAULT_RESPONSE_HEADER]: mode,
    },
  });
}

/**
 * Handle `GET /__staging/fault?mode=error|exception|slow[&ms=<n>]`.
 *
 * Returns `null` when the deployment-level gates say this route must stay
 * inert (`not-staging` / `unconfigured`) — the caller falls through to the
 * normal unknown-path behavior, so the route is unobservable there. Returns
 * a Response (or a Promise that may REJECT, for `mode=exception`) otherwise.
 */
export function handleStagingFault(
  request: Request,
  env: { DIAGNOSTICS_ENV?: string; DIAGNOSTICS_TOKEN?: string },
): Promise<Response> | null {
  const gate = evaluateStagingFaultGate(
    env,
    request.headers.get(STAGING_FAULT_HEADER),
  );
  if (gate === 'not-staging' || gate === 'unconfigured') return null;
  return respond(request, gate);
}

async function respond(
  request: Request,
  gate: 'forbidden' | 'authorized',
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed\n', {
      status: 405,
      headers: { 'cache-control': 'no-store' },
    });
  }
  if (gate === 'forbidden') {
    return new Response(JSON.stringify({ error: 'diagnostics_forbidden' }), {
      status: 403,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') ?? 'error';

  if (mode === 'error') {
    return syntheticJson(500, 'error', {
      error: 'synthetic_fault',
      note: 'deliberate staging-only diagnostic failure (docs/GAME_DAY.md)',
    });
  }

  if (mode === 'exception') {
    // Deliberately uncaught: propagates out of the fetch handler so the
    // Workers runtime records an exception (visible in staging's metrics /
    // logs), which a 500-status response alone would not produce.
    throw new Error(
      'synthetic_fault: deliberate staging-only diagnostic exception (mode=exception, docs/GAME_DAY.md)',
    );
  }

  if (mode === 'slow') {
    const requested = Number(
      url.searchParams.get('ms') ?? DEFAULT_SLOW_DELAY_MS,
    );
    const delayMs = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 0), MAX_SLOW_DELAY_MS)
      : DEFAULT_SLOW_DELAY_MS;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return syntheticJson(200, 'slow', { ok: true, delayMs });
  }

  return syntheticJson(400, 'unknown', {
    error: 'unknown_fault_mode',
    supported: ['error', 'exception', 'slow'],
  });
}
