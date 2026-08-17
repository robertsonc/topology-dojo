#!/usr/bin/env node
/**
 * Wrangler config safety check (proposal 0004, decision 2; Packet D1).
 *
 * `env.staging` bindings are hand-maintained JSON, not inherited from the
 * top-level Worker config (Wrangler does not inherit `vars`, `kv_namespaces`,
 * `durable_objects`, or `migrations` into named environments — see
 * docs/proposals/0004-isolated-staging-and-deployment-pipeline.md,
 * "Wrangler configuration shape"). A copy/paste slip there is a
 * production-data incident: it would point the staging Worker at production
 * KV, or bind a staging Durable Object at the production script via
 * `script_name`. This script parses `wrangler.jsonc` (dependency-free — no
 * `jsonc-parser`, no `strip-json-comments`) and asserts the isolation
 * invariants from proposal 0004's "Every stateful resource is
 * environment-specific" table. It lists every violation it finds rather than
 * stopping at the first.
 *
 * Usage:
 *   node scripts/check-wrangler-env.mjs [path/to/wrangler.jsonc]
 *
 * Exits non-zero (and prints every violation) if any check fails. Exits 0
 * ("wrangler config OK") if the config is safe.
 *
 * The check functions are also exported so `src/testing/check-wrangler-env.test.ts`
 * can unit-test them against the real config and synthetic bad fixtures
 * without shelling out.
 */
/* global console, process, URL */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** The three Durable Object bindings every environment must repeat in full. */
const REQUIRED_DO_BINDINGS = [
  { name: 'MCP_OBJECT', class_name: 'TopologyMcp' },
  { name: 'TOPOLOGY_REGISTRY', class_name: 'TopologyRegistry' },
  { name: 'TOPOLOGY_DOCUMENT', class_name: 'TopologyDocument' },
];

/** The two KV bindings every environment must repeat in full. */
const REQUIRED_KV_BINDINGS = ['TOPOLOGY_KV', 'OAUTH_KV'];

// ---------------------------------------------------------------------------
// JSONC parsing (comments + trailing commas; no new dependency)
// ---------------------------------------------------------------------------

/**
 * Strip `//` line comments, `/* *\/` block comments, and trailing commas
 * before `}`/`]` from a JSONC document, leaving valid JSON. Comment-like
 * sequences inside string literals are left untouched by tracking string
 * state (including `\"` escapes) as the scanner walks the text.
 */
export function stripJsonc(input) {
  let out = '';
  let inString = false;
  const n = input.length;
  for (let i = 0; i < n; i++) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < n) {
        // Preserve the escaped character verbatim (handles `\"` so it does
        // not end the string, and `\\` so the following char isn't
        // mis-treated as its own escape).
        out += next;
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < n && input[i] !== '\n') i++;
      out += '\n';
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i++; // consume the closing '/'
      continue;
    }

    out += ch;
  }

  // Trailing commas: `,` followed only by whitespace/newlines then `}` or `]`.
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Parse a wrangler.jsonc file's text into a plain config object. */
export function parseWranglerJsonc(text) {
  return JSON.parse(stripJsonc(text));
}

// ---------------------------------------------------------------------------
// Deep equality (no lodash — migrations arrays are small, plain JSON)
// ---------------------------------------------------------------------------

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (!deepEqual(aKeys, bKeys)) return false;
    return aKeys.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * Run every proposal-0004 isolation check against a parsed wrangler config.
 * Returns an array of human-readable violation strings (empty = safe). Never
 * throws on a malformed/partial config — missing structure is itself a
 * violation, not a crash, so the CLI and tests always get a full report.
 */
export function checkWranglerConfig(config) {
  const violations = [];
  const top = config ?? {};
  const staging = top.env?.staging;

  if (!staging) {
    violations.push('env.staging is missing from wrangler.jsonc');
    return violations;
  }

  const topVars = top.vars ?? {};
  const stagingVars = staging.vars ?? {};
  const topKv = Array.isArray(top.kv_namespaces) ? top.kv_namespaces : [];
  const stagingKv = Array.isArray(staging.kv_namespaces)
    ? staging.kv_namespaces
    : [];
  const topDo = Array.isArray(top.durable_objects?.bindings)
    ? top.durable_objects.bindings
    : [];
  const stagingDo = Array.isArray(staging.durable_objects?.bindings)
    ? staging.durable_objects.bindings
    : [];
  const topMigrations = Array.isArray(top.migrations) ? top.migrations : [];
  const stagingMigrations = Array.isArray(staging.migrations)
    ? staging.migrations
    : [];

  // (a) every env.staging KV id differs from every top-level KV id.
  for (const s of stagingKv) {
    for (const t of topKv) {
      if (s?.id && t?.id && s.id === t.id) {
        violations.push(
          `[kv-id-shared] env.staging.kv_namespaces binding "${s.binding}" ` +
            `reuses production id "${s.id}" (top-level binding "${t.binding}"); ` +
            'staging must use a dedicated KV namespace.',
        );
      }
    }
  }

  // (b) no env.staging Durable Object binding sets `script_name`.
  for (const b of stagingDo) {
    if (b?.script_name) {
      violations.push(
        `[do-script-name] env.staging.durable_objects binding "${b.name}" ` +
          `sets script_name "${b.script_name}"; this points the staging ` +
          'binding at another Worker’s Durable Object namespace (likely ' +
          'production) instead of owning its own.',
      );
    }
  }

  // (c) env.staging migrations array is deeply identical to top-level.
  if (!deepEqual(stagingMigrations, topMigrations)) {
    violations.push(
      '[migrations-mismatch] env.staging.migrations does not match the ' +
        'top-level migrations array; staging must repeat the full, ' +
        'identical migration history (v1..vN) so it applies the same ' +
        'Durable Object classes as production.',
    );
  }

  // (d) staging worker name and PUBLIC_BASE_URL differ from production's.
  if (!staging.name) {
    violations.push(
      '[name-missing] env.staging.name is not set explicitly; relying on ' +
        "Wrangler's `<name>-<env>` auto-suffix is unsafe here — set it " +
        'explicitly.',
    );
  } else if (staging.name === top.name) {
    violations.push(
      `[name-shared] env.staging.name ("${staging.name}") matches the ` +
        'top-level (production) Worker name; staging must deploy as a ' +
        'separate script.',
    );
  }

  if (!stagingVars.PUBLIC_BASE_URL) {
    violations.push(
      '[public-base-url-missing] env.staging.vars.PUBLIC_BASE_URL is not set.',
    );
  } else if (stagingVars.PUBLIC_BASE_URL === topVars.PUBLIC_BASE_URL) {
    violations.push(
      '[public-base-url-shared] env.staging.vars.PUBLIC_BASE_URL matches ' +
        'the production PUBLIC_BASE_URL; staging must use its own origin.',
    );
  }

  // Feature flags (WORKSPACE_ENABLED, PROFILES_ENABLED, ANALYTICS_ENABLED,
  // LIVE_DATA_ENABLED) and identity allowlists (ADMIN_GITHUB_ID,
  // LIVE_DATA_GITHUB_IDS) may match across environments — they are not
  // identity-provider or data-plane resources. LIVE_DATA_ENABLED is opt-in
  // and currently "false" in both envs (issue #228); do not treat a shared
  // "false" as isolation drift.

  // (e) staging GITHUB_CLIENT_ID differs from production's.
  if (!stagingVars.GITHUB_CLIENT_ID) {
    violations.push(
      '[client-id-missing] env.staging.vars.GITHUB_CLIENT_ID is not set.',
    );
  } else if (stagingVars.GITHUB_CLIENT_ID === topVars.GITHUB_CLIENT_ID) {
    violations.push(
      '[client-id-shared] env.staging.vars.GITHUB_CLIENT_ID matches the ' +
        'production GITHUB_CLIENT_ID; staging must use its own GitHub ' +
        'OAuth App (proposal 0004, decision 2).',
    );
  }

  // (f) env.staging repeats all three DO bindings and both KV bindings.
  for (const required of REQUIRED_DO_BINDINGS) {
    const match = stagingDo.find((b) => b?.name === required.name);
    if (!match) {
      violations.push(
        `[do-binding-missing] env.staging.durable_objects is missing the ` +
          `"${required.name}" binding (class "${required.class_name}"); ` +
          'every environment must declare all three Durable Object bindings ' +
          '— they are not inherited.',
      );
    } else if (match.class_name !== required.class_name) {
      violations.push(
        `[do-binding-class-mismatch] env.staging.durable_objects binding ` +
          `"${required.name}" targets class "${match.class_name}", expected ` +
          `"${required.class_name}".`,
      );
    }
  }

  for (const binding of REQUIRED_KV_BINDINGS) {
    const match = stagingKv.find((k) => k?.binding === binding);
    if (!match) {
      violations.push(
        `[kv-binding-missing] env.staging.kv_namespaces is missing the ` +
          `"${binding}" binding; every environment must declare both KV ` +
          'bindings — they are not inherited.',
      );
    } else if (!match.id) {
      violations.push(
        `[kv-binding-no-id] env.staging.kv_namespaces binding "${binding}" ` +
          'has no id.',
      );
    }
  }

  // (g) Staging-only diagnostics can never reach production config. The
  // synthetic-fault route (worker/staging-fault.ts) activates only when
  // DIAGNOSTICS_ENV === "staging" plus a staging-only secret; this rule makes
  // the var half impossible to ship through the sole authorized deploy path:
  // both deploy workflows and CI run this script before `wrangler deploy`,
  // so a top-level (production) DIAGNOSTICS_* var fails the build outright.
  for (const key of Object.keys(topVars)) {
    if (key.startsWith('DIAGNOSTICS_')) {
      violations.push(
        `[diagnostics-in-production] top-level (production) vars defines ` +
          `"${key}"; DIAGNOSTICS_* keys are staging-only diagnostics controls ` +
          '(worker/staging-fault.ts) and must never be configured for ' +
          'production.',
      );
    }
  }
  if (
    'DIAGNOSTICS_ENV' in stagingVars &&
    stagingVars.DIAGNOSTICS_ENV !== 'staging'
  ) {
    violations.push(
      `[diagnostics-env-invalid] env.staging.vars.DIAGNOSTICS_ENV is ` +
        `"${stagingVars.DIAGNOSTICS_ENV}"; when present it must be exactly ` +
        '"staging" (the only value worker/staging-fault.ts accepts).',
    );
  }

  // Sanity: the top-level config itself should also declare all three DO
  // bindings and both KV bindings — otherwise the "differs from production"
  // checks above are comparing against an incomplete baseline.
  for (const required of REQUIRED_DO_BINDINGS) {
    if (!topDo.some((b) => b?.name === required.name)) {
      violations.push(
        `[top-level-do-binding-missing] top-level durable_objects is ` +
          `missing the "${required.name}" binding; cannot verify staging ` +
          'isolation against an incomplete production config.',
      );
    }
  }

  return violations;
}

/** Read, parse, and check a wrangler.jsonc file at `filePath`. */
export function checkWranglerEnvFile(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const config = parseWranglerJsonc(text);
  return checkWranglerConfig(config);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function defaultWranglerPath() {
  const scriptDir = fileURLToPath(new URL('.', import.meta.url));
  return path.join(scriptDir, '..', 'wrangler.jsonc');
}

function main() {
  const target = process.argv[2] ?? defaultWranglerPath();
  let violations;
  try {
    violations = checkWranglerEnvFile(target);
  } catch (err) {
    console.error(`Failed to read/parse ${target}:`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  if (violations.length === 0) {
    console.log(`wrangler config OK (${target}): env.staging is isolated.`);
    process.exit(0);
    return;
  }

  console.error(
    `wrangler config check FAILED (${target}) — ${violations.length} ` +
      `violation(s):`,
  );
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main();
