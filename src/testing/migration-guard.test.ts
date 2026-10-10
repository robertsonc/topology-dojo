/**
 * Unit tests for `scripts/migration-guard.mjs` (proposal 0007 — merge is the
 * release). The guard is the only thing standing between an unattended
 * `push` to `main` and a production Durable Object migration, so every
 * branch of its classification and ack/provenance rules is pinned here:
 *
 * - identical arrays → routine (allowed unattended);
 * - a strict prefix → migration, held until the typed ack matches exactly;
 * - anything else (behind production, re-classed, reordered, reused tag) →
 *   forbidden with the first differing index named;
 * - an assumed deployed config (not read from /healthz) is never trusted:
 *   the public class is `unknown` and the diff moves to `assumed_*`.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  decide,
  diffMigrations,
  evaluate,
  parseAck,
  parseArgs,
} from '../../scripts/migration-guard.mjs';
import { parseWranglerJsonc } from '../../scripts/check-wrangler-env.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WRANGLER_JSONC_PATH = path.join(REPO_ROOT, 'wrangler.jsonc');
const GUARD_PATH = path.join(REPO_ROOT, 'scripts', 'migration-guard.mjs');

function migrations(n: number) {
  const classes = [
    'TopologyMcp',
    'TopologyRegistry',
    'TopologyDocument',
    'AuthoringProfile',
    'AnalyticsLog',
    'NextClass',
    'AnotherClass',
  ];
  return Array.from({ length: n }, (_, i) => ({
    tag: `v${i + 1}`,
    new_sqlite_classes: [classes[i] ?? `Class${i + 1}`],
  }));
}

function cfg(n: number) {
  return { migrations: migrations(n) };
}

describe('migration-guard: diffMigrations', () => {
  it('identical arrays → routine with no new tags', () => {
    const diff = diffMigrations(cfg(5), cfg(5));
    expect(diff).toEqual({ releaseClass: 'routine', newTags: [] });
  });

  it('v1..v5 vs v1..v6 → migration with newTags [v6]', () => {
    const diff = diffMigrations(cfg(5), cfg(6));
    expect(diff.releaseClass).toBe('migration');
    expect(diff.newTags).toEqual(['v6']);
    expect(diff.firstDiff).toBeUndefined();
  });

  it('two appended tags → migration with newTags [v6, v7]', () => {
    const diff = diffMigrations(cfg(5), cfg(7));
    expect(diff.releaseClass).toBe('migration');
    expect(diff.newTags).toEqual(['v6', 'v7']);
  });

  it('candidate behind production (v1..v6 vs v1..v5) → forbidden', () => {
    const diff = diffMigrations(cfg(6), cfg(5));
    expect(diff.releaseClass).toBe('forbidden');
    expect(diff.firstDiff).toEqual({
      index: 5,
      deployed: { tag: 'v6', new_sqlite_classes: ['NextClass'] },
      candidate: undefined,
    });
  });

  it('same tag with a different class list → forbidden at that index', () => {
    const candidate = cfg(5);
    candidate.migrations[2] = {
      tag: 'v3',
      new_sqlite_classes: ['SomethingElse'],
    };
    const diff = diffMigrations(cfg(5), candidate);
    expect(diff.releaseClass).toBe('forbidden');
    expect(diff.firstDiff?.index).toBe(2);
    expect(diff.firstDiff?.deployed).toEqual({
      tag: 'v3',
      new_sqlite_classes: ['TopologyDocument'],
    });
    expect(diff.firstDiff?.candidate).toEqual({
      tag: 'v3',
      new_sqlite_classes: ['SomethingElse'],
    });
  });

  it('reordered entries → forbidden with the first differing index', () => {
    const candidate = cfg(5);
    const [a, b] = [candidate.migrations[3]!, candidate.migrations[4]!];
    candidate.migrations[3] = b;
    candidate.migrations[4] = a;
    const diff = diffMigrations(cfg(5), candidate);
    expect(diff.releaseClass).toBe('forbidden');
    expect(diff.firstDiff?.index).toBe(3);
  });

  it('a renamed applied tag → forbidden', () => {
    const candidate = cfg(5);
    candidate.migrations[4] = { ...candidate.migrations[4]!, tag: 'v5b' };
    expect(diffMigrations(cfg(5), candidate).releaseClass).toBe('forbidden');
  });

  it('an appended entry reusing an applied tag → forbidden', () => {
    const candidate = cfg(5);
    candidate.migrations.push({ tag: 'v5', new_sqlite_classes: ['Dup'] });
    const diff = diffMigrations(cfg(5), candidate);
    expect(diff.releaseClass).toBe('forbidden');
    expect(diff.firstDiff?.index).toBe(5);
  });

  it('an appended entry without a tag → forbidden', () => {
    const candidate = cfg(5);
    (candidate.migrations as unknown[]).push({ new_sqlite_classes: ['X'] });
    expect(diffMigrations(cfg(5), candidate).releaseClass).toBe('forbidden');
  });

  it('a config with no migrations array is treated as empty', () => {
    expect(diffMigrations({}, cfg(2))).toEqual({
      releaseClass: 'migration',
      newTags: ['v1', 'v2'],
    });
    expect(diffMigrations({}, {}).releaseClass).toBe('routine');
  });

  it('the real wrangler.jsonc vs itself → routine', () => {
    const real = parseWranglerJsonc(readFileSync(WRANGLER_JSONC_PATH, 'utf8'));
    expect(diffMigrations(real, real)).toEqual({
      releaseClass: 'routine',
      newTags: [],
    });
  });
});

describe('migration-guard: parseAck', () => {
  it('splits, trims, and drops empties', () => {
    expect(parseAck(' v6 , v7 ,')).toEqual(['v6', 'v7']);
    expect(parseAck('')).toEqual([]);
    expect(parseAck(undefined)).toEqual([]);
  });
});

describe('migration-guard: decide (live /healthz provenance)', () => {
  it('routine is allowed with no ack', () => {
    const d = decide({
      releaseClass: 'routine',
      newTags: [],
      ack: '',
      deployedSource: 'healthz',
    });
    expect(d.allowed).toBe(true);
  });

  it('routine is allowed with ack "none"', () => {
    const d = decide({
      releaseClass: 'routine',
      newTags: [],
      ack: 'none',
      deployedSource: 'healthz',
    });
    expect(d.allowed).toBe(true);
  });

  it('routine with a stray migration ack is refused (wrong candidate?)', () => {
    const d = decide({
      releaseClass: 'routine',
      newTags: [],
      ack: 'v6',
      deployedSource: 'healthz',
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/no new migration tag/);
  });

  it('migration [v6] is held without an ack and allowed only with "v6"', () => {
    const base = {
      releaseClass: 'migration',
      newTags: ['v6'],
      deployedSource: 'healthz',
    };
    expect(decide({ ...base, ack: '' }).allowed).toBe(false);
    expect(decide({ ...base, ack: '' }).reason).toMatch(/held/);
    expect(decide({ ...base, ack: 'v5' }).allowed).toBe(false);
    expect(decide({ ...base, ack: 'v6,v7' }).allowed).toBe(false);
    expect(decide({ ...base, ack: 'none' }).allowed).toBe(false);
    expect(decide({ ...base, ack: 'v6' }).allowed).toBe(true);
    expect(decide({ ...base, ack: ' v6 ' }).allowed).toBe(true);
  });

  it('two new tags need the exact comma-joined ack "v6,v7"', () => {
    const base = {
      releaseClass: 'migration',
      newTags: ['v6', 'v7'],
      deployedSource: 'healthz',
    };
    expect(decide({ ...base, ack: 'v6' }).allowed).toBe(false);
    expect(decide({ ...base, ack: 'v7,v6' }).allowed).toBe(false);
    expect(decide({ ...base, ack: 'v6,v7' }).allowed).toBe(true);
    expect(decide({ ...base, ack: 'v6, v7' }).allowed).toBe(true);
  });

  it('forbidden is never allowed, whatever the ack', () => {
    for (const ack of ['', 'none', 'v6', 'v1,v2,v3,v4,v5']) {
      const d = decide({
        releaseClass: 'forbidden',
        newTags: [],
        ack,
        deployedSource: 'healthz',
      });
      expect(d.allowed).toBe(false);
      expect(d.reason).toMatch(/^forbidden/);
    }
  });
});

describe('migration-guard: decide + evaluate (assumed provenance)', () => {
  it('assumed source → public class unknown, diff moves to assumed_*', () => {
    const out = evaluate({
      deployedCfg: cfg(5),
      candidateCfg: cfg(6),
      ack: '',
      deployedSource: 'assumed',
      deployedSha: 'a'.repeat(40),
    });
    expect(out.release_class).toBe('unknown');
    expect(out.new_tags).toBe('');
    expect(out.assumed_class).toBe('migration');
    expect(out.assumed_new_tags).toBe('v6');
    expect(out.allowed).toBe('false');
    expect(out.deployed_source).toBe('assumed');
    expect(out.deployed_sha).toBe('a'.repeat(40));
  });

  it('assumed migration is allowed only with the exact ack', () => {
    const base = {
      releaseClass: 'migration',
      newTags: ['v6'],
      deployedSource: 'assumed',
    };
    expect(decide({ ...base, ack: '' }).allowed).toBe(false);
    expect(decide({ ...base, ack: 'none' }).allowed).toBe(false);
    expect(decide({ ...base, ack: 'v6' }).allowed).toBe(true);
  });

  it('assumed routine requires ack "none" and is then allowed', () => {
    const base = {
      releaseClass: 'routine',
      newTags: [],
      deployedSource: 'assumed',
    };
    expect(decide({ ...base, ack: '' }).allowed).toBe(false);
    expect(decide({ ...base, ack: 'v6' }).allowed).toBe(false);
    expect(decide({ ...base, ack: 'none' }).allowed).toBe(true);
    expect(decide({ ...base, ack: 'NONE' }).allowed).toBe(true);

    const out = evaluate({
      deployedCfg: cfg(5),
      candidateCfg: cfg(5),
      ack: 'none',
      deployedSource: 'assumed',
    });
    expect(out.release_class).toBe('unknown');
    expect(out.assumed_class).toBe('routine');
    expect(out.allowed).toBe('true');
  });

  it('assumed + forbidden stays forbidden (not unknown)', () => {
    const out = evaluate({
      deployedCfg: cfg(6),
      candidateCfg: cfg(5),
      ack: 'none',
      deployedSource: 'assumed',
    });
    expect(out.release_class).toBe('forbidden');
    expect(out.allowed).toBe('false');
    expect(out.firstDiff?.index).toBe(5);
  });
});

describe('migration-guard: evaluate (live provenance outputs)', () => {
  it('reports tag lists and the routine verdict for the real config', () => {
    const real = parseWranglerJsonc(readFileSync(WRANGLER_JSONC_PATH, 'utf8'));
    const out = evaluate({
      deployedCfg: real,
      candidateCfg: real,
      ack: '',
      deployedSource: 'healthz',
      deployedSha: 'b'.repeat(40),
    });
    expect(out.release_class).toBe('routine');
    expect(out.allowed).toBe('true');
    expect(out.deployed_tags).toBe(out.candidate_tags);
    expect(out.deployed_tags.split(',')).toContain('v5');
    expect(out.assumed_class).toBe('');
  });

  it('reports migration + new_tags for an appended tag', () => {
    const out = evaluate({
      deployedCfg: cfg(5),
      candidateCfg: cfg(6),
      ack: 'v6',
      deployedSource: 'healthz',
    });
    expect(out.release_class).toBe('migration');
    expect(out.new_tags).toBe('v6');
    expect(out.allowed).toBe('true');
  });
});

describe('migration-guard: CLI', () => {
  it('parses its arguments', () => {
    expect(
      parseArgs([
        '--deployed',
        'a.jsonc',
        '--head',
        'b.jsonc',
        '--ack',
        'v6',
        '--deployed-source',
        'assumed',
        '--deployed-sha',
        'abc',
      ]),
    ).toEqual({
      deployed: 'a.jsonc',
      head: 'b.jsonc',
      ack: 'v6',
      deployedSource: 'assumed',
      deployedSha: 'abc',
      help: false,
    });
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument/);
  });

  function run(args: string[], outputFile?: string) {
    try {
      const stdout = execFileSync(process.execPath, [GUARD_PATH, ...args], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: outputFile ?? '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, stdout, stderr: '' };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { code: e.status, stdout: e.stdout, stderr: e.stderr };
    }
  }

  it('exits 0 and prints routine outputs for the real wrangler.jsonc vs itself', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'migration-guard-'));
    const outputFile = path.join(dir, 'outputs');
    writeFileSync(outputFile, '');
    const r = run(
      ['--deployed', WRANGLER_JSONC_PATH, '--head', WRANGLER_JSONC_PATH],
      outputFile,
    );
    expect(r.code).toBe(0);
    const outputs = readFileSync(outputFile, 'utf8');
    expect(outputs).toMatch(/^release_class=routine$/m);
    expect(outputs).toMatch(/^allowed=true$/m);
    expect(outputs).toMatch(/^new_tags=$/m);
  });

  it('exits 1 (held) for an appended tag without an ack, 0 with it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'migration-guard-'));
    const deployed = path.join(dir, 'deployed.jsonc');
    const head = path.join(dir, 'head.jsonc');
    writeFileSync(deployed, JSON.stringify(cfg(5)));
    writeFileSync(head, JSON.stringify(cfg(6)));

    const held = run(['--deployed', deployed, '--head', head]);
    expect(held.code).toBe(1);
    expect(held.stdout).toMatch(/^release_class=migration$/m);
    expect(held.stdout).toMatch(/^new_tags=v6$/m);
    expect(held.stdout).toMatch(/^allowed=false$/m);
    expect(held.stderr).toMatch(/HELD/);

    const ok = run(['--deployed', deployed, '--head', head, '--ack', 'v6']);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toMatch(/^allowed=true$/m);
  });

  it('exits 2 for a forbidden diff and names the first differing index', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'migration-guard-'));
    const deployed = path.join(dir, 'deployed.jsonc');
    const head = path.join(dir, 'head.jsonc');
    writeFileSync(deployed, JSON.stringify(cfg(6)));
    writeFileSync(head, JSON.stringify(cfg(5)));
    const r = run(['--deployed', deployed, '--head', head, '--ack', 'v6']);
    expect(r.code).toBe(2);
    expect(r.stdout).toMatch(/^release_class=forbidden$/m);
    expect(r.stderr).toMatch(/FORBIDDEN at migrations\[5\]/);
  });

  it('exits 2 on a missing argument or an unparsable config', () => {
    expect(run(['--head', WRANGLER_JSONC_PATH]).code).toBe(2);
    const dir = mkdtempSync(path.join(tmpdir(), 'migration-guard-'));
    const bad = path.join(dir, 'bad.jsonc');
    writeFileSync(bad, '{ not json');
    expect(run(['--deployed', bad, '--head', WRANGLER_JSONC_PATH]).code).toBe(
      2,
    );
  });
});
