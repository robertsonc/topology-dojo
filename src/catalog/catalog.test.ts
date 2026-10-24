/**
 * hw-catalog Phase 1: the TypeScript catalog core against the Python
 * executable spec. `catalog/fixtures/resolve/golden.json` is written by
 * `catalog/tools/resolve_probe.py` (CI regenerates it and fails on any
 * difference); every probe must resolve identically here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildBundle, loadCatalogDir } from './build.js';
import { Catalog } from './catalog.js';
import { generateCatalogTypes, TYPES_PATH } from './gen-types.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = new Catalog(buildBundle(loadCatalogDir(`${root}catalog/data`)));

interface Probe {
  model: string;
  name: string;
  result: null | {
    name: string;
    model_id: string;
    physical_id: string;
    physical_kind: string;
    role: string;
    speeds: number[];
    member: number | null;
  };
}
const golden = (
  JSON.parse(
    readFileSync(`${root}catalog/fixtures/resolve/golden.json`, 'utf8'),
  ) as { probes: Probe[] }
).probes;

describe('resolveInterface parity with catalog_lib.py', () => {
  it('covers every seed model', () => {
    expect(new Set(golden.map((p) => p.model))).toEqual(
      new Set(catalog.models.keys()),
    );
    expect(golden.length).toBeGreaterThan(300);
  });

  it('resolves every probe exactly as Python does', () => {
    const mismatches: string[] = [];
    for (const p of golden) {
      const r = catalog.resolveInterface(p.model, p.name);
      const got =
        r === null
          ? null
          : {
              name: r.name,
              model_id: r.modelId,
              physical_id: r.physicalId,
              physical_kind: r.physicalKind,
              role: r.role,
              speeds: [...r.speeds].sort((a, b) => a - b),
              member: r.member,
            };
      if (JSON.stringify(got) !== JSON.stringify(p.result))
        mismatches.push(
          `${p.model} ${JSON.stringify(p.name)}: py ${JSON.stringify(p.result)} ts ${JSON.stringify(got)}`,
        );
    }
    expect(mismatches).toEqual([]);
  });

  it('resolves every seed interface row (members 1 and 2 for templates)', () => {
    for (const m of catalog.models.values())
      for (const row of m.interfaces) {
        const names = row.name.includes('{member}')
          ? [1, 2].map((k) => row.name.replace('{member}', String(k)))
          : [row.name];
        for (const n of names)
          expect(
            catalog.resolveInterface(m.id, n)?.physicalId,
            `${m.id} ${n}`,
          ).toBe(row.physical);
      }
  });

  it('keeps shared-chassis models apart (9004 vs EC-10104)', () => {
    expect(catalog.platformFor('aruba-9004').id).toBe(
      catalog.platformFor('edgeconnect-ec-10104').id,
    );
    expect(catalog.resolveInterface('aruba-9004', 'lan0')).toBeNull();
    expect(
      catalog.resolveInterface('edgeconnect-ec-10104', 'lan0'),
    ).not.toBeNull();
  });

  it('throws on an unknown model, as Python raises KeyError', () => {
    expect(() => catalog.resolveInterface('no-such-model', 'lan0')).toThrow(
      /unknown catalog model/,
    );
  });
});

describe('generated catalog types', () => {
  it('match the schema (run npm run catalog:types if this fails)', async () => {
    const committed = readFileSync(`${root}${TYPES_PATH}`, 'utf8');
    expect(await generateCatalogTypes(root)).toBe(committed);
  });
});
