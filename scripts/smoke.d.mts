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
}

export function parseArgs(argv: string[]): SmokeArgs;
export function runSmoke(
  baseUrl: string,
  options: RunSmokeOptions,
): Promise<SmokeCheckResult[]>;
