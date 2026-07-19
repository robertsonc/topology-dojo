/**
 * `scripts/smoke.mjs` exercised end-to-end against the real
 * `worker/default-handler.ts` (via the SMOKE_TARGET_FIXTURE stubs for the
 * OAuthProvider-owned surfaces), served over Miniflare's local HTTP server.
 * Locks the smoke suite's contract to the worker's actual behavior in both
 * feature-flag postures:
 *
 *   - flags enabled  → every check passes (nothing skipped), including the
 *     deployed-SHA assertion;
 *   - flags disabled → the three `--expect-*-disabled` contracts pass, and a
 *     run WITHOUT those expectations fails exactly those three checks — the
 *     mismatch detection the game-day forward-disable drills rely on
 *     (docs/GAME_DAY.md).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseArgs, runSmoke } from '../../scripts/smoke.mjs';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { SMOKE_TARGET_FIXTURE } from './worker-fixtures.js';

const GITHUB_CLIENT_SECRET = 'smoke-checks-secret';
const FIXTURE_SHA = 'smoke-fixture-sha-0123456';

function statusByName(
  results: { name: string; status: string; detail: string }[],
): Record<string, string> {
  return Object.fromEntries(results.map((r) => [r.name, r.status]));
}

describe('parseArgs — the new expectation flags', () => {
  it('defaults every expectation off', () => {
    const args = parseArgs(['https://example.test']);
    expect(args.expectWorkspaceDisabled).toBe(false);
    expect(args.expectProfilesDisabled).toBe(false);
    expect(args.expectAnalyticsDisabled).toBe(false);
  });

  it('parses each --expect-*-disabled flag independently', () => {
    const args = parseArgs([
      'https://example.test',
      '--expect-profiles-disabled',
      '--expect-analytics-disabled',
    ]);
    expect(args.expectWorkspaceDisabled).toBe(false);
    expect(args.expectProfilesDisabled).toBe(true);
    expect(args.expectAnalyticsDisabled).toBe(true);
    expect(args.baseUrl).toBe('https://example.test');
  });
});

describe('smoke suite against a fully-enabled deployment', () => {
  let handle: MiniflareHandle;
  let base: string;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(SMOKE_TARGET_FIXTURE, {
      sourcefile: 'smoke-target-enabled-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV'],
      vars: {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET,
        GIT_SHA: FIXTURE_SHA,
        WORKSPACE_ENABLED: 'true',
        PROFILES_ENABLED: 'true',
        ANALYTICS_ENABLED: 'true',
      },
    });
    base = (await handle.miniflare.ready).href;
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('passes every check — nothing skipped — with the SHA asserted', async () => {
    const results = await runSmoke(base, { sha: FIXTURE_SHA });
    const failures = results.filter((r) => r.status !== 'pass');
    expect(failures.map((r) => `${r.name}: ${r.status} — ${r.detail}`)).toEqual(
      [],
    );
    // The full expected check list, in order — a new check must be added
    // here deliberately (and to docs/DEPLOYMENT_RUNBOOK.md's smoke table).
    expect(results.map((r) => r.name)).toEqual([
      'healthz',
      'readyz-unauth',
      'app',
      'login',
      'me-unauth',
      'oauth-metadata',
      'mcp-unauth',
      'workspaces-unauth',
      'profile-unauth',
      'admin-unauth',
      'share-404',
      'viewer-shell',
      'showcase',
      'fault-inert',
    ]);
  }, 30_000);

  it('fails the healthz check on a SHA mismatch (deployed-SHA verification)', async () => {
    const results = await runSmoke(base, { sha: 'expected-other-sha' });
    const byName = statusByName(results);
    expect(byName.healthz).toBe('fail');
  }, 30_000);
});

describe('smoke suite against a flags-disabled deployment', () => {
  let handle: MiniflareHandle;
  let base: string;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(SMOKE_TARGET_FIXTURE, {
      sourcefile: 'smoke-target-disabled-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      kvNamespaces: ['TOPOLOGY_KV'],
      vars: {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET,
        GIT_SHA: FIXTURE_SHA,
        // The forward-disable posture: workspaces explicitly off; profiles
        // and analytics disabled by omission (both are opt-in flags).
        WORKSPACE_ENABLED: 'false',
      },
    });
    base = (await handle.miniflare.ready).href;
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('passes with the three disabled-contract expectations set', async () => {
    const results = await runSmoke(base, {
      sha: FIXTURE_SHA,
      expectWorkspaceDisabled: true,
      expectProfilesDisabled: true,
      expectAnalyticsDisabled: true,
    });
    const failures = results.filter((r) => r.status !== 'pass');
    expect(failures.map((r) => `${r.name}: ${r.status} — ${r.detail}`)).toEqual(
      [],
    );
  }, 30_000);

  it('fails exactly the three flag checks when the disabled state is not expected', async () => {
    const results = await runSmoke(base, { sha: FIXTURE_SHA });
    const byName = statusByName(results);
    expect(byName['workspaces-unauth']).toBe('fail');
    expect(byName['profile-unauth']).toBe('fail');
    expect(byName['admin-unauth']).toBe('fail');
    const otherFailures = results.filter(
      (r) =>
        r.status === 'fail' &&
        !['workspaces-unauth', 'profile-unauth', 'admin-unauth'].includes(
          r.name,
        ),
    );
    expect(otherFailures).toEqual([]);
  }, 30_000);
});
