#!/usr/bin/env node
/**
 * Durable Object migration guard (proposal 0007, "merge is the release").
 *
 * Classifies a production release candidate by comparing the top-level
 * `migrations` array of the wrangler.jsonc that production currently serves
 * (the config at the commit `/healthz` reports) with the candidate commit's
 * array, entry-wise with `deepEqual`:
 *
 *   routine    — the arrays are identical. Safe to release unattended.
 *   migration  — production's array is a strict prefix of the candidate's.
 *                The release applies the new tag(s). It is held until a human
 *                dispatches release.yml with `apply_migration_tag` equal to
 *                exactly those tags (comma-joined, in order) — the typed ack.
 *   forbidden  — production's array is NOT a prefix of the candidate's: an
 *                entry was removed, renamed, reordered, re-classed, or a tag
 *                was reused. Never deployable (docs/ROLLBACK.md first
 *                principle). The only exits are a PR restoring the array, or a
 *                `recovery_sha` of the last `main` commit whose array equals
 *                production's.
 *   unknown    — the deployed config did not come from a live `/healthz`
 *                read (it was supplied via `assume_deployed_sha`), so the diff
 *                is advisory (`assumed_class` / `assumed_new_tags`) and a
 *                release requires BOTH `assume_deployed_sha` and a matching
 *                `apply_migration_tag` (`none` when the assumed class is
 *                routine).
 *
 * Usage:
 *   node scripts/migration-guard.mjs --deployed <deployed.jsonc> \
 *     --head <candidate.jsonc> [--ack "<tags>"] \
 *     [--deployed-source healthz|assumed] [--deployed-sha <sha>]
 *
 * Prints GitHub Actions outputs (`name=value` lines) to `$GITHUB_OUTPUT`
 * when set, else to stdout. Exit codes: 0 allowed, 1 held (not allowed, not
 * forbidden — e.g. a migration release without its typed ack), 2 forbidden.
 *
 * Dependency-free; the pure functions are exported for
 * `src/testing/migration-guard.test.ts` (same shape as check-wrangler-env.mjs).
 */
/* global console, process */
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deepEqual, parseWranglerJsonc } from './check-wrangler-env.mjs';

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

function migrationsOf(config) {
  const m = config?.migrations;
  return Array.isArray(m) ? m : [];
}

/**
 * Compare production's migrations (`deployedCfg`) with the candidate's
 * (`candidateCfg`). Returns `{ releaseClass, newTags, firstDiff? }` where
 * `releaseClass` is 'routine' | 'migration' | 'forbidden'. `firstDiff` names
 * the first index at which the arrays disagree (present only for forbidden).
 */
export function diffMigrations(deployedCfg, candidateCfg) {
  const deployed = migrationsOf(deployedCfg);
  const candidate = migrationsOf(candidateCfg);

  const common = Math.min(deployed.length, candidate.length);
  for (let i = 0; i < common; i++) {
    if (!deepEqual(deployed[i], candidate[i])) {
      return {
        releaseClass: 'forbidden',
        newTags: [],
        firstDiff: { index: i, deployed: deployed[i], candidate: candidate[i] },
      };
    }
  }

  if (candidate.length < deployed.length) {
    // The candidate dropped one or more applied entries (it is behind
    // production, or someone deleted a tag).
    return {
      releaseClass: 'forbidden',
      newTags: [],
      firstDiff: {
        index: candidate.length,
        deployed: deployed[candidate.length],
        candidate: undefined,
      },
    };
  }

  const appended = candidate.slice(deployed.length);
  if (appended.length === 0) return { releaseClass: 'routine', newTags: [] };

  const seen = new Set(deployed.map((m) => m?.tag));
  const newTags = [];
  for (let i = 0; i < appended.length; i++) {
    const entry = appended[i];
    const tag = entry?.tag;
    if (typeof tag !== 'string' || tag.length === 0 || seen.has(tag)) {
      // A missing/invalid tag, or a tag reused from an applied entry (or
      // duplicated within the appended entries), is never deployable.
      return {
        releaseClass: 'forbidden',
        newTags: [],
        firstDiff: {
          index: deployed.length + i,
          deployed: undefined,
          candidate: entry,
        },
      };
    }
    seen.add(tag);
    newTags.push(tag);
  }
  return { releaseClass: 'migration', newTags };
}

/** Split a typed ack ("v6" / "v6,v7" / " v6 , v7 ") into trimmed tags. */
export function parseAck(ack) {
  return String(ack ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function sameList(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The ack / provenance rule. `deployedSource` is 'healthz' (the deployed
 * config came from a live `/healthz` 200 JSON body) or 'assumed' (it came
 * from the `assume_deployed_sha` dispatch input). Returns `{ allowed, reason }`.
 */
export function decide({ releaseClass, newTags, ack, deployedSource }) {
  const tags = Array.isArray(newTags) ? newTags : [];
  const acked = parseAck(ack);
  const ackIsNone = acked.length === 1 && acked[0].toLowerCase() === 'none';
  const expected = tags.join(',');

  if (releaseClass === 'forbidden') {
    return {
      allowed: false,
      reason:
        'forbidden: the deployed migrations array is not a prefix of the ' +
        'candidate array (an applied tag was removed, renamed, reordered, ' +
        're-classed, or reused). Restore the array in a PR, or dispatch ' +
        'with recovery_sha pointing at the last main commit whose array ' +
        'equals production’s (docs/ROLLBACK.md).',
    };
  }

  if (deployedSource === 'assumed') {
    if (releaseClass === 'routine') {
      return ackIsNone
        ? {
            allowed: true,
            reason:
              'assumed-routine acknowledged: deployed config was assumed ' +
              '(not read from /healthz) and apply_migration_tag is "none".',
          }
        : {
            allowed: false,
            reason:
              'unknown: deployed config was assumed via assume_deployed_sha, ' +
              'so the diff (assumed routine) is advisory. Dispatch with ' +
              'apply_migration_tag "none" to release.',
          };
    }
    if (releaseClass === 'migration') {
      return sameList(acked, tags)
        ? {
            allowed: true,
            reason:
              `assumed-migration acknowledged: apply_migration_tag matches ` +
              `the assumed new tag(s) "${expected}".`,
          }
        : {
            allowed: false,
            reason:
              'unknown: deployed config was assumed via assume_deployed_sha, ' +
              `so the diff (assumed migration, new tag(s) "${expected}") is ` +
              `advisory. Dispatch with apply_migration_tag "${expected}" ` +
              'exactly to release.',
          };
    }
    return { allowed: false, reason: 'unknown: unclassifiable candidate.' };
  }

  if (releaseClass === 'routine') {
    if (acked.length === 0 || ackIsNone) {
      return { allowed: true, reason: 'routine: migrations unchanged.' };
    }
    return {
      allowed: false,
      reason:
        `routine release but apply_migration_tag "${acked.join(',')}" was ` +
        'supplied: no new migration tag exists between production and this ' +
        'candidate. Check the candidate SHA; re-dispatch without an ack.',
    };
  }

  if (releaseClass === 'migration') {
    if (sameList(acked, tags)) {
      return {
        allowed: true,
        reason: `migration acknowledged: new tag(s) "${expected}".`,
      };
    }
    return {
      allowed: false,
      reason:
        `migration release held: this candidate appends migration tag(s) ` +
        `"${expected}" that production has not applied. Dispatch release.yml ` +
        `with apply_migration_tag "${expected}" exactly` +
        (acked.length ? ` (got "${acked.join(',')}")` : '') +
        ' — docs/DEPLOYMENT_RUNBOOK.md "Production deployment with a new migration".',
    };
  }

  return { allowed: false, reason: `unknown release class "${releaseClass}".` };
}

/**
 * The full set of workflow outputs for one guard evaluation, applying the
 * provenance rule: with an assumed deployed config the public
 * `release_class` is 'unknown' and the diff result moves to
 * `assumed_class` / `assumed_new_tags` (forbidden stays forbidden regardless).
 */
export function evaluate({
  deployedCfg,
  candidateCfg,
  ack,
  deployedSource = 'healthz',
  deployedSha = '',
}) {
  const diff = diffMigrations(deployedCfg, candidateCfg);
  const verdict = decide({
    releaseClass: diff.releaseClass,
    newTags: diff.newTags,
    ack,
    deployedSource,
  });
  const assumed = deployedSource === 'assumed';
  const publicClass =
    diff.releaseClass === 'forbidden'
      ? 'forbidden'
      : assumed
        ? 'unknown'
        : diff.releaseClass;
  return {
    deployed_sha: deployedSha,
    deployed_source: deployedSource,
    release_class: publicClass,
    new_tags: assumed ? '' : diff.newTags.join(','),
    assumed_class: assumed ? diff.releaseClass : '',
    assumed_new_tags: assumed ? diff.newTags.join(',') : '',
    deployed_tags: migrationsOf(deployedCfg)
      .map((m) => m?.tag)
      .join(','),
    candidate_tags: migrationsOf(candidateCfg)
      .map((m) => m?.tag)
      .join(','),
    allowed: verdict.allowed ? 'true' : 'false',
    reason: verdict.reason,
    firstDiff: diff.firstDiff,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = {
    deployed: undefined,
    head: undefined,
    ack: '',
    deployedSource: 'healthz',
    deployedSha: '',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--deployed') args.deployed = argv[++i];
    else if (arg === '--head') args.head = argv[++i];
    else if (arg === '--ack') args.ack = argv[++i] ?? '';
    else if (arg === '--deployed-source') args.deployedSource = argv[++i];
    else if (arg === '--deployed-sha') args.deployedSha = argv[++i] ?? '';
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/migration-guard.mjs --deployed <deployed.jsonc> --head <candidate.jsonc>',
    '         [--ack "<tag[,tag]>|none"] [--deployed-source healthz|assumed] [--deployed-sha <sha>]',
    '',
    'Exit codes: 0 allowed, 1 held (needs a typed ack / provenance), 2 forbidden.',
  ].join('\n');
}

function emitOutputs(outputs) {
  const lines = Object.entries(outputs)
    .filter(([k]) => k !== 'firstDiff')
    .map(([k, v]) => `${k}=${String(v ?? '').replace(/\r?\n/g, ' ')}`);
  const target = process.env.GITHUB_OUTPUT;
  if (target) {
    appendFileSync(target, lines.join('\n') + '\n');
  }
  // Always echo for the job log.
  for (const line of lines) console.log(line);
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(usage());
    process.exit(2);
    return;
  }
  if (args.help) {
    console.log(usage());
    process.exit(0);
    return;
  }
  if (!args.deployed || !args.head) {
    console.error('both --deployed and --head are required');
    console.error(usage());
    process.exit(2);
    return;
  }
  if (args.deployedSource !== 'healthz' && args.deployedSource !== 'assumed') {
    console.error('--deployed-source must be "healthz" or "assumed"');
    process.exit(2);
    return;
  }

  let deployedCfg;
  let candidateCfg;
  try {
    deployedCfg = parseWranglerJsonc(readFileSync(args.deployed, 'utf8'));
    candidateCfg = parseWranglerJsonc(readFileSync(args.head, 'utf8'));
  } catch (err) {
    console.error('Failed to read/parse a wrangler config:');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
    return;
  }

  const result = evaluate({
    deployedCfg,
    candidateCfg,
    ack: args.ack,
    deployedSource: args.deployedSource,
    deployedSha: args.deployedSha,
  });
  emitOutputs(result);

  if (result.release_class === 'forbidden') {
    const d = result.firstDiff;
    console.error(
      `::error::migration guard FORBIDDEN at migrations[${d?.index}]: ` +
        `deployed=${JSON.stringify(d?.deployed)} candidate=${JSON.stringify(d?.candidate)}. ` +
        result.reason,
    );
    process.exit(2);
    return;
  }
  if (result.allowed !== 'true') {
    console.error(`::error::migration guard HELD — ${result.reason}`);
    process.exit(1);
    return;
  }
  console.log(`migration guard OK — ${result.reason}`);
  process.exit(0);
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main();
