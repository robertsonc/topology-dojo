/**
 * hw-catalog Phase 1: the catalog build — the check_seed.py port finds the
 * same things on the seed and on broken copies of it, the bundle hash
 * depends only on content, and the published bundle is the current data.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBundle,
  bundleFileName,
  canonicalJson,
  checkCatalog,
  CatalogLoadError,
  loadCatalogDir,
} from './build.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const DATA = path.join(root, 'catalog/data');
const SCHEMA = path.join(root, 'catalog/schema/catalog.schema.json');
const temps: string[] = [];
afterAll(() =>
  temps.forEach((d) => rmSync(d, { recursive: true, force: true })),
);

/** A scratch copy of the seed, edited by `mutate` (paths relative to it). */
function variant(mutate: (dir: string) => void): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'dojo-catalog-'));
  temps.push(dir);
  cpSync(DATA, dir, { recursive: true });
  mutate(dir);
  return dir;
}
function editJson(
  file: string,
  edit: (j: Record<string, unknown>) => void,
): void {
  const j = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  edit(j);
  writeFileSync(file, JSON.stringify(j, null, 2));
}
const lint = (dir: string): string[] =>
  checkCatalog(loadCatalogDir(dir), SCHEMA);
const errorsOf = (f: string[]): string[] =>
  f.filter((x) => !x.startsWith('WARN'));

describe('checkCatalog (check_seed.py port)', () => {
  it('reports exactly what check_seed.py reports on the seed', () => {
    expect(lint(DATA)).toEqual([
      'WARN MODEL aruba-cx-6300m-jl664a: no official_doc/internal_doc provenance; not GA-eligible',
    ]);
  });

  it('catches schema violations per entry', () => {
    const dir = variant((d) =>
      editJson(path.join(d, 'models/juniper-srx300.json'), (j) => {
        j.os = 'windows';
      }),
    );
    expect(errorsOf(lint(dir)).join('\n')).toMatch(
      /^SCHEMA juniper-srx300: .* at \/os$/m,
    );
  });

  it('catches cross-reference errors', () => {
    const dir = variant((d) =>
      editJson(path.join(d, 'models/edgeconnect-ec-xs.json'), (j) => {
        const ifs = j.interfaces as { name: string; physical: string }[];
        ifs[0]!.physical = 'nope';
        ifs[1]!.name = ifs[2]!.name;
        (j.bond_groups as { members: string[] }[])[0]!.members = [
          'lan0',
          'ghost',
        ];
        j.symbol = 'missing-symbol';
      }),
    );
    const e = errorsOf(lint(dir));
    expect(e).toEqual(
      expect.arrayContaining([
        'MODEL edgeconnect-ec-xs: duplicate interface names',
        "MODEL edgeconnect-ec-xs: interface mgmt0 -> unknown physical 'nope'",
        "MODEL edgeconnect-ec-xs: bond blan0 members not on model: ['ghost']",
      ]),
    );
    expect(
      e.some((x) => x.startsWith('MODEL edgeconnect-ec-xs: missing symbol')),
    ).toBe(true);
  });

  it('catches panel and SVG anchor problems, including a missing coordinate', () => {
    const dir = variant((d) => {
      const svg = path.join(d, 'glyphs/platforms/ec-xs.front.svg');
      writeFileSync(
        svg,
        readFileSync(svg, 'utf8').replace(
          /(data-port="lan0" data-kind="rj45") data-cx="[0-9.]+"/,
          '$1',
        ),
      );
      editJson(path.join(d, 'platforms/srx300.json'), (j) => {
        (j.ports as { x: number }[])[0]!.x = -5;
      });
    });
    const e = errorsOf(lint(dir));
    expect(e.some((x) => x.endsWith('lan0 anchor not numeric'))).toBe(true);
    expect(
      e.some((x) => /^PLATFORM srx300: port \S+ center outside panel$/.test(x)),
    ).toBe(true);
    // The moved port no longer matches its SVG anchor either.
    expect(
      e.some((x) => /srx300\.front\.svg: \S+ anchor .* != catalog/.test(x)),
    ).toBe(true);
  });

  it('checks the optics table shape', () => {
    const dir = variant((d) =>
      editJson(path.join(d, 'optics.json'), (j) => {
        (j.types as Record<string, unknown>)['BAD'] = {
          form: 'sfp',
          media: 'air',
          speeds_mbps: [],
        };
      }),
    );
    expect(errorsOf(lint(dir))).toEqual([
      'OPTICS: BAD media must be copper | mmf | smf | dac',
      'OPTICS: BAD needs speeds_mbps',
    ]);
  });

  it('refuses duplicate ids at load time', () => {
    const dir = variant((d) =>
      cpSync(
        path.join(d, 'models/juniper-srx300.json'),
        path.join(d, 'models/zz-copy.json'),
      ),
    );
    expect(() => loadCatalogDir(dir)).toThrow(CatalogLoadError);
  });
});

describe('buildBundle', () => {
  it('hashes content only — file order and key order do not matter', () => {
    const a = buildBundle(loadCatalogDir(DATA));
    const dir = variant((d) => {
      // Same content, keys reversed and renamed file.
      const f = path.join(d, 'models/juniper-srx300.json');
      const j = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
      const rev = Object.fromEntries(Object.entries(j).reverse());
      rmSync(f);
      writeFileSync(path.join(d, 'models/000-srx.json'), JSON.stringify(rev));
    });
    expect(buildBundle(loadCatalogDir(dir)).version).toBe(a.version);
    const changed = variant((d) =>
      editJson(path.join(d, 'models/juniper-srx300.json'), (j) => {
        j.name = 'SRX300 (renamed)';
      }),
    );
    expect(buildBundle(loadCatalogDir(changed)).version).not.toBe(a.version);
    expect(a.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('canonical JSON sorts keys at every level', () => {
    expect(
      canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }),
    ).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it('the published bundle is the current catalog data (run npm run catalog:build)', () => {
    const bundle = buildBundle(loadCatalogDir(DATA));
    const manifest = JSON.parse(
      readFileSync(path.join(root, 'public/catalog/manifest.json'), 'utf8'),
    ) as { latest: string; versions: string[] };
    expect(manifest.latest).toBe(bundle.version);
    expect(manifest.versions).toContain(bundle.version);
    const published = readFileSync(
      path.join(root, 'public/catalog', bundleFileName(bundle.version)),
      'utf8',
    );
    expect(published).toBe(canonicalJson(bundle) + '\n');
  });
});
