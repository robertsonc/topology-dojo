/**
 * Unit tests for `scripts/check-wrangler-env.mjs` (Packet D1 — proposal 0004
 * decision 2). Two halves:
 *
 * 1. The real `wrangler.jsonc` at the repo root must pass with zero
 *    violations — this is the regression guard CI runs on every change to
 *    that file.
 * 2. Synthetic good/bad fixture configs exercise each individual assertion
 *    in isolation, so a change to one check can't silently stop catching its
 *    class of mistake.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  checkWranglerConfig,
  checkWranglerEnvFile,
  deepEqual,
  parseWranglerJsonc,
  stripJsonc,
} from '../../scripts/check-wrangler-env.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WRANGLER_JSONC_PATH = path.join(REPO_ROOT, 'wrangler.jsonc');

/**
 * A minimal but complete config shaped like `wrangler.jsonc`, valid under
 * every check. Individual tests clone this with `structuredClone` and mutate
 * one thing to provoke exactly one violation.
 */
function validConfig() {
  return {
    name: 'topology-dojo',
    vars: {
      PUBLIC_BASE_URL: 'https://topology-dojo.example.workers.dev',
      GITHUB_CLIENT_ID: 'prod-client-id',
    },
    kv_namespaces: [
      { binding: 'TOPOLOGY_KV', id: 'prod-topology-kv-id' },
      { binding: 'OAUTH_KV', id: 'prod-oauth-kv-id' },
    ],
    durable_objects: {
      bindings: [
        { name: 'MCP_OBJECT', class_name: 'TopologyMcp' },
        { name: 'TOPOLOGY_REGISTRY', class_name: 'TopologyRegistry' },
        { name: 'TOPOLOGY_DOCUMENT', class_name: 'TopologyDocument' },
      ],
    },
    migrations: [
      { tag: 'v1', new_sqlite_classes: ['TopologyMcp'] },
      { tag: 'v2', new_sqlite_classes: ['TopologyRegistry'] },
      { tag: 'v3', new_sqlite_classes: ['TopologyDocument'] },
    ],
    env: {
      staging: {
        name: 'topology-dojo-staging',
        vars: {
          PUBLIC_BASE_URL: 'https://topology-dojo-staging.example.workers.dev',
          GITHUB_CLIENT_ID: 'staging-client-id',
          WORKSPACE_ENABLED: 'true',
        },
        kv_namespaces: [
          { binding: 'TOPOLOGY_KV', id: 'staging-topology-kv-id' },
          { binding: 'OAUTH_KV', id: 'staging-oauth-kv-id' },
        ],
        durable_objects: {
          bindings: [
            { name: 'MCP_OBJECT', class_name: 'TopologyMcp' },
            { name: 'TOPOLOGY_REGISTRY', class_name: 'TopologyRegistry' },
            { name: 'TOPOLOGY_DOCUMENT', class_name: 'TopologyDocument' },
          ],
        },
        migrations: [
          { tag: 'v1', new_sqlite_classes: ['TopologyMcp'] },
          { tag: 'v2', new_sqlite_classes: ['TopologyRegistry'] },
          { tag: 'v3', new_sqlite_classes: ['TopologyDocument'] },
        ],
      },
    },
  };
}

function codesOf(violations: string[]): string[] {
  return violations.map((v) => v.match(/^\[([a-z-]+)\]/)?.[1] ?? '');
}

describe('check-wrangler-env: the real wrangler.jsonc', () => {
  it('passes every isolation check', () => {
    const violations = checkWranglerEnvFile(WRANGLER_JSONC_PATH);
    expect(violations).toEqual([]);
  });

  it('parses via the JSONC stripper into an object with env.staging', () => {
    // Read through the same path the CLI uses, to also exercise stripJsonc
    // against the real file's comment/trailing-comma style.
    const config = parseWranglerJsonc(
      readFileSync(WRANGLER_JSONC_PATH, 'utf8'),
    );
    expect(config.env?.staging).toBeDefined();
    expect(config.env?.staging?.name).toBe('topology-dojo-staging');
  });
});

describe('check-wrangler-env: synthetic fixtures', () => {
  it('a well-formed config produces zero violations', () => {
    expect(checkWranglerConfig(validConfig())).toEqual([]);
  });

  it('flags a shared KV id between staging and production', () => {
    const config = structuredClone(validConfig());
    config.env.staging.kv_namespaces[0]!.id = config.kv_namespaces[0]!.id;
    const violations = checkWranglerConfig(config);
    expect(codesOf(violations)).toContain('kv-id-shared');
  });

  it('flags a staging DO binding that sets script_name', () => {
    const config = structuredClone(validConfig());
    (
      config.env.staging.durable_objects.bindings[0] as Record<string, unknown>
    ).script_name = 'topology-dojo';
    const violations = checkWranglerConfig(config);
    expect(codesOf(violations)).toContain('do-script-name');
  });

  it('flags migration drift between staging and top-level', () => {
    const config = structuredClone(validConfig());
    config.env.staging.migrations.pop(); // drop v3
    const violations = checkWranglerConfig(config);
    expect(codesOf(violations)).toContain('migrations-mismatch');
  });

  it('flags migration drift when order differs', () => {
    const config = structuredClone(validConfig());
    config.env.staging.migrations.reverse();
    const violations = checkWranglerConfig(config);
    expect(codesOf(violations)).toContain('migrations-mismatch');
  });

  it('flags a staging name equal to the production name', () => {
    const config = structuredClone(validConfig());
    config.env.staging.name = config.name;
    const violations = checkWranglerConfig(config);
    expect(codesOf(violations)).toContain('name-shared');
  });

  it('flags a missing staging name', () => {
    const config = structuredClone(validConfig());
    delete (config.env.staging as Record<string, unknown>).name;
    const violations = checkWranglerConfig(config);
    expect(codesOf(violations)).toContain('name-missing');
  });

  it('flags a staging PUBLIC_BASE_URL equal to production', () => {
    const config = structuredClone(validConfig());
    config.env.staging.vars.PUBLIC_BASE_URL = config.vars.PUBLIC_BASE_URL;
    const violations = checkWranglerConfig(config);
    expect(codesOf(violations)).toContain('public-base-url-shared');
  });

  it('flags a staging GITHUB_CLIENT_ID equal to production', () => {
    const config = structuredClone(validConfig());
    config.env.staging.vars.GITHUB_CLIENT_ID = config.vars.GITHUB_CLIENT_ID;
    const violations = checkWranglerConfig(config);
    expect(codesOf(violations)).toContain('client-id-shared');
  });

  it('flags a missing Durable Object binding in env.staging', () => {
    const config = structuredClone(validConfig());
    config.env.staging.durable_objects.bindings =
      config.env.staging.durable_objects.bindings.filter(
        (b) => b.name !== 'TOPOLOGY_DOCUMENT',
      );
    const violations = checkWranglerConfig(config);
    expect(codesOf(violations)).toContain('do-binding-missing');
  });

  it('flags a Durable Object binding pointed at the wrong class', () => {
    const config = structuredClone(validConfig());
    config.env.staging.durable_objects.bindings[2]!.class_name = 'WrongClass';
    const violations = checkWranglerConfig(config);
    expect(codesOf(violations)).toContain('do-binding-class-mismatch');
  });

  it('flags a missing KV binding in env.staging', () => {
    const config = structuredClone(validConfig());
    config.env.staging.kv_namespaces = config.env.staging.kv_namespaces.filter(
      (k) => k.binding !== 'OAUTH_KV',
    );
    const violations = checkWranglerConfig(config);
    expect(codesOf(violations)).toContain('kv-binding-missing');
  });

  it('flags any DIAGNOSTICS_* var in the top-level (production) vars', () => {
    const config = structuredClone(validConfig());
    (config.vars as Record<string, string>).DIAGNOSTICS_ENV = 'staging';
    (config.vars as Record<string, string>).DIAGNOSTICS_TOKEN = 'oops';
    const violations = checkWranglerConfig(config);
    const codes = codesOf(violations);
    expect(codes.filter((c) => c === 'diagnostics-in-production')).toHaveLength(
      2,
    );
  });

  it('flags a staging DIAGNOSTICS_ENV that is not exactly "staging"', () => {
    const config = structuredClone(validConfig());
    (config.env.staging.vars as Record<string, string>).DIAGNOSTICS_ENV =
      'production';
    const violations = checkWranglerConfig(config);
    expect(codesOf(violations)).toContain('diagnostics-env-invalid');
  });

  it('accepts DIAGNOSTICS_ENV="staging" in env.staging vars', () => {
    const config = structuredClone(validConfig());
    (config.env.staging.vars as Record<string, string>).DIAGNOSTICS_ENV =
      'staging';
    expect(checkWranglerConfig(config)).toEqual([]);
  });

  it('flags env.staging missing entirely', () => {
    const config = structuredClone(validConfig()) as Record<string, unknown>;
    delete config.env;
    const violations = checkWranglerConfig(config);
    expect(violations).toEqual(['env.staging is missing from wrangler.jsonc']);
  });

  it('reports every violation, not just the first', () => {
    const config = structuredClone(validConfig());
    config.env.staging.kv_namespaces[0]!.id = config.kv_namespaces[0]!.id;
    config.env.staging.vars.GITHUB_CLIENT_ID = config.vars.GITHUB_CLIENT_ID;
    config.env.staging.migrations.pop();
    const violations = checkWranglerConfig(config);
    const codes = codesOf(violations);
    expect(codes).toContain('kv-id-shared');
    expect(codes).toContain('client-id-shared');
    expect(codes).toContain('migrations-mismatch');
  });
});

describe('check-wrangler-env: JSONC stripping', () => {
  it('strips line comments without touching string content', () => {
    const input = `{
      // a comment
      "a": "http://not-a-comment.example/x", // trailing
      "b": 1,
    }`;
    const parsed = JSON.parse(stripJsonc(input));
    expect(parsed).toEqual({ a: 'http://not-a-comment.example/x', b: 1 });
  });

  it('strips block comments', () => {
    const input = `{ /* block \n comment */ "a": 1 /* inline */ , "b": 2 }`;
    const parsed = JSON.parse(stripJsonc(input));
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  it('strips trailing commas in objects and arrays', () => {
    const input = `{ "a": [1, 2, 3,], "b": { "c": 1, }, }`;
    const parsed = JSON.parse(stripJsonc(input));
    expect(parsed).toEqual({ a: [1, 2, 3], b: { c: 1 } });
  });

  it('preserves an escaped quote inside a string', () => {
    const input = String.raw`{ "a": "she said \"hi\"" }`;
    const parsed = JSON.parse(stripJsonc(input));
    expect(parsed).toEqual({ a: 'she said "hi"' });
  });
});

describe('check-wrangler-env: deepEqual', () => {
  it('treats key order as insignificant', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('distinguishes array order', () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });

  it('recurses into nested structures', () => {
    expect(
      deepEqual(
        [{ tag: 'v1', new_sqlite_classes: ['A'] }],
        [{ new_sqlite_classes: ['A'], tag: 'v1' }],
      ),
    ).toBe(true);
  });
});
