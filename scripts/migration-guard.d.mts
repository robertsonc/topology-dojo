/**
 * Type declarations for `migration-guard.mjs`, so
 * `src/testing/migration-guard.test.ts` can import it under `strict` without
 * widening `tsconfig.json`'s `allowJs`/`checkJs` settings. Kept in sync by
 * hand — the script has no build step of its own (same pattern as
 * `check-wrangler-env.d.mts`).
 */
import type { WranglerMigration } from './check-wrangler-env.d.mts';

export type ReleaseClass = 'routine' | 'migration' | 'forbidden';
export type PublicReleaseClass = ReleaseClass | 'unknown';
export type DeployedSource = 'healthz' | 'assumed';

export interface MigrationDiff {
  releaseClass: ReleaseClass;
  newTags: string[];
  firstDiff?: {
    index: number;
    deployed: WranglerMigration | undefined;
    candidate: WranglerMigration | undefined;
  };
}

export interface Decision {
  allowed: boolean;
  reason: string;
}

export interface GuardOutputs {
  deployed_sha: string;
  deployed_source: DeployedSource;
  release_class: PublicReleaseClass;
  new_tags: string;
  assumed_class: ReleaseClass | '';
  assumed_new_tags: string;
  deployed_tags: string;
  candidate_tags: string;
  allowed: 'true' | 'false';
  reason: string;
  firstDiff?: MigrationDiff['firstDiff'];
}

export interface GuardArgs {
  deployed: string | undefined;
  head: string | undefined;
  ack: string;
  deployedSource: string;
  deployedSha: string;
  help: boolean;
}

export function diffMigrations(
  deployedCfg: unknown,
  candidateCfg: unknown,
): MigrationDiff;
export function parseAck(ack: string | null | undefined): string[];
export function decide(input: {
  releaseClass: ReleaseClass | string;
  newTags: string[];
  ack?: string | null | undefined;
  deployedSource: DeployedSource | string;
}): Decision;
export function evaluate(input: {
  deployedCfg: unknown;
  candidateCfg: unknown;
  ack?: string | null | undefined;
  deployedSource?: DeployedSource;
  deployedSha?: string;
}): GuardOutputs;
export function parseArgs(argv: string[]): GuardArgs;
