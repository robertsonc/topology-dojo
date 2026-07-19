/**
 * Staging-only synthetic fault injection (`worker/staging-fault.ts`,
 * initiative O / docs/GAME_DAY.md). Two halves:
 *
 * 1. The pure gate matrix (`evaluateStagingFaultGate`) — every combination
 *    of environment marker / token secret / presented token, including all
 *    the production-rejection cases, without a Workers runtime.
 * 2. Miniflare suites through the real `worker/default-handler.ts` routing,
 *    proving (a) a production-shaped deployment keeps `/__staging/fault`
 *    completely inert even when a token secret is accidentally present and
 *    the caller knows it, and (b) a configured staging deployment enforces
 *    the token and produces only clearly-labelled synthetic responses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  evaluateStagingFaultGate,
  MIN_DIAGNOSTICS_TOKEN_LENGTH,
  STAGING_FAULT_HEADER,
  STAGING_FAULT_PATH,
  SYNTHETIC_FAULT_RESPONSE_HEADER,
} from '../../worker/staging-fault.js';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { DEFAULT_HANDLER_FIXTURE } from './worker-fixtures.js';

const TOKEN = 'game-day-diagnostics-token-0123456789';
const GITHUB_CLIENT_SECRET = 'staging-fault-secret';

describe('evaluateStagingFaultGate — the pure gate matrix', () => {
  it('rejects a production-shaped env (no DIAGNOSTICS_ENV) even with a valid token presented', () => {
    expect(evaluateStagingFaultGate({ DIAGNOSTICS_TOKEN: TOKEN }, TOKEN)).toBe(
      'not-staging',
    );
  });

  it('rejects an empty env', () => {
    expect(evaluateStagingFaultGate({}, TOKEN)).toBe('not-staging');
  });

  it('rejects any DIAGNOSTICS_ENV value other than the literal "staging"', () => {
    for (const value of ['production', 'Staging', 'STAGING', 'staging ', '']) {
      expect(
        evaluateStagingFaultGate(
          { DIAGNOSTICS_ENV: value, DIAGNOSTICS_TOKEN: TOKEN },
          TOKEN,
        ),
      ).toBe('not-staging');
    }
  });

  it('treats staging without a token secret as unconfigured (default off)', () => {
    expect(
      evaluateStagingFaultGate({ DIAGNOSTICS_ENV: 'staging' }, TOKEN),
    ).toBe('unconfigured');
  });

  it('treats a too-short token secret as unconfigured (fail closed)', () => {
    const short = 'x'.repeat(MIN_DIAGNOSTICS_TOKEN_LENGTH - 1);
    expect(
      evaluateStagingFaultGate(
        { DIAGNOSTICS_ENV: 'staging', DIAGNOSTICS_TOKEN: short },
        short,
      ),
    ).toBe('unconfigured');
  });

  it('rejects a missing or wrong presented token in a configured staging', () => {
    const env = { DIAGNOSTICS_ENV: 'staging', DIAGNOSTICS_TOKEN: TOKEN };
    expect(evaluateStagingFaultGate(env, null)).toBe('forbidden');
    expect(evaluateStagingFaultGate(env, '')).toBe('forbidden');
    expect(evaluateStagingFaultGate(env, TOKEN.slice(0, -1))).toBe('forbidden');
    expect(evaluateStagingFaultGate(env, `${TOKEN}x`)).toBe('forbidden');
  });

  it('authorizes only the exact token in a configured staging', () => {
    expect(
      evaluateStagingFaultGate(
        { DIAGNOSTICS_ENV: 'staging', DIAGNOSTICS_TOKEN: TOKEN },
        TOKEN,
      ),
    ).toBe('authorized');
  });
});

describe('production posture — token secret present but no DIAGNOSTICS_ENV', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
      sourcefile: 'staging-fault-production-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      vars: {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET,
        // Deliberately hostile setup: the staging-only secret somehow exists
        // on a production-shaped deployment. The route must stay inert.
        DIAGNOSTICS_TOKEN: TOKEN,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('stays inert for a caller presenting the valid token', async () => {
    const res = await handle.fetch(`${STAGING_FAULT_PATH}?mode=error`, {
      headers: { [STAGING_FAULT_HEADER]: TOKEN },
    });
    expect(res.headers.get(SYNTHETIC_FAULT_RESPONSE_HEADER)).toBeNull();
    // Falls through to the unknown-path behavior (the fixture's ASSETS stub
    // 404); the synthetic 500/403 contract must never appear.
    expect(res.status).toBe(404);
  });

  it('redirects an unauthenticated document navigation to /login like any unknown path', async () => {
    const res = await handle.fetch(STAGING_FAULT_PATH, {
      headers: {
        accept: 'text/html',
        'sec-fetch-dest': 'document',
        [STAGING_FAULT_HEADER]: TOKEN,
      },
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toContain('/login');
  });

  it('keeps /healthz serving normally', async () => {
    const res = await handle.fetch('/healthz');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });
});

describe('staging posture — DIAGNOSTICS_ENV set but no token secret', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
      sourcefile: 'staging-fault-unconfigured-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      vars: {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET,
        DIAGNOSTICS_ENV: 'staging',
      },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('stays inert (default off) — no token secret means no fault route', async () => {
    const res = await handle.fetch(`${STAGING_FAULT_PATH}?mode=error`, {
      headers: { [STAGING_FAULT_HEADER]: TOKEN },
    });
    expect(res.headers.get(SYNTHETIC_FAULT_RESPONSE_HEADER)).toBeNull();
    expect(res.status).toBe(404);
  });
});

describe('staging posture — fully configured', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
      sourcefile: 'staging-fault-configured-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      vars: {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET,
        DIAGNOSTICS_ENV: 'staging',
        DIAGNOSTICS_TOKEN: TOKEN,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('403s without the token header (fault never fires uncredentialed)', async () => {
    const res = await handle.fetch(`${STAGING_FAULT_PATH}?mode=error`);
    expect(res.status).toBe(403);
    expect(res.headers.get(SYNTHETIC_FAULT_RESPONSE_HEADER)).toBeNull();
    await expect(res.json()).resolves.toEqual({
      error: 'diagnostics_forbidden',
    });
  });

  it('403s a wrong token', async () => {
    const res = await handle.fetch(`${STAGING_FAULT_PATH}?mode=error`, {
      headers: { [STAGING_FAULT_HEADER]: `${TOKEN}-wrong` },
    });
    expect(res.status).toBe(403);
  });

  it('405s a POST even with the valid token', async () => {
    const res = await handle.fetch(STAGING_FAULT_PATH, {
      method: 'POST',
      headers: { [STAGING_FAULT_HEADER]: TOKEN },
    });
    expect(res.status).toBe(405);
  });

  it('fires a clearly-labelled synthetic 500 for mode=error (the default)', async () => {
    const res = await handle.fetch(STAGING_FAULT_PATH, {
      headers: { [STAGING_FAULT_HEADER]: TOKEN },
    });
    expect(res.status).toBe(500);
    expect(res.headers.get(SYNTHETIC_FAULT_RESPONSE_HEADER)).toBe('error');
    await expect(res.json()).resolves.toMatchObject({
      error: 'synthetic_fault',
      synthetic: true,
      mode: 'error',
    });
  });

  it('delays then 200s for mode=slow, with the bounded delay echoed', async () => {
    const res = await handle.fetch(`${STAGING_FAULT_PATH}?mode=slow&ms=50`, {
      headers: { [STAGING_FAULT_HEADER]: TOKEN },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get(SYNTHETIC_FAULT_RESPONSE_HEADER)).toBe('slow');
    await expect(res.json()).resolves.toEqual({
      ok: true,
      delayMs: 50,
      synthetic: true,
      mode: 'slow',
    });
  });

  it('clamps an oversized mode=slow delay to the 5s bound', async () => {
    const res = await handle.fetch(
      `${STAGING_FAULT_PATH}?mode=slow&ms=999999`,
      { headers: { [STAGING_FAULT_HEADER]: TOKEN } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { delayMs: number };
    expect(body.delayMs).toBe(5000);
  }, 15_000);

  it('produces a real uncaught exception (runtime 500, not the synthetic JSON) for mode=exception', async () => {
    const res = await handle.fetch(`${STAGING_FAULT_PATH}?mode=exception`, {
      headers: { [STAGING_FAULT_HEADER]: TOKEN },
    });
    expect(res.status).toBe(500);
    // The throw escapes the fetch handler, so the runtime's error response —
    // not our labelled synthetic body — is what the caller sees. That is the
    // point: it registers as an uncaught exception in Workers metrics.
    expect(res.headers.get(SYNTHETIC_FAULT_RESPONSE_HEADER)).toBeNull();
  });

  it('400s an unknown mode', async () => {
    const res = await handle.fetch(`${STAGING_FAULT_PATH}?mode=chaos`, {
      headers: { [STAGING_FAULT_HEADER]: TOKEN },
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'unknown_fault_mode',
      synthetic: true,
    });
  });

  it('keeps /healthz serving normally alongside a configured fault route', async () => {
    const res = await handle.fetch('/healthz');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });
});
