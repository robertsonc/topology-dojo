/**
 * Type declarations for `smoke.mjs`, so `src/testing/smoke-checks.test.ts`
 * can import it under `strict` without widening `tsconfig.json`'s
 * `allowJs`/`checkJs` settings. Kept in sync by hand — the script has no
 * build step of its own (same pattern as `check-wrangler-env.d.mts`).
 */

export interface SmokeArgs {
  baseUrl: string | undefined;
  sha: string | undefined;
  waitLiveSeconds: number;
  expectWorkspaceDisabled: boolean;
  expectProfilesDisabled: boolean;
  expectAnalyticsDisabled: boolean;
  json: boolean;
  help: boolean;
}

export interface SmokeCheckResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}

export interface RunSmokeOptions {
  sha?: string | undefined;
  expectWorkspaceDisabled?: boolean;
  expectProfilesDisabled?: boolean;
  expectAnalyticsDisabled?: boolean;
  /** How long the healthz check keeps retrying a sha mismatch (post-deploy settle). */
  shaSettleSeconds?: number;
}

export interface WaitForLiveOptions {
  /** Consecutive matching /healthz polls required before the origin counts as live. */
  consecutive?: number;
  /** Delay between polls while the streak is building. */
  confirmIntervalMs?: number;
  /** Delay between polls after a miss or an unreachable origin. */
  retryIntervalMs?: number;
}

export function parseArgs(argv: string[]): SmokeArgs;
/** Poll until the origin is live (and, with a sha, serves it consistently) or the window closes. */
export function waitForLiveOrigin(
  baseUrl: string,
  seconds: number,
  expectedSha?: string | undefined,
  options?: WaitForLiveOptions,
): Promise<boolean>;
export function runSmoke(
  baseUrl: string,
  options: RunSmokeOptions,
): Promise<SmokeCheckResult[]>;
