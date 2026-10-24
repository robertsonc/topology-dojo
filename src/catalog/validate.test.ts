/**
 * hw-catalog Phase 2: the TypeScript wiring validator against the golden
 * fixtures `catalog/tools/ref_validate.py` passes (CI runs both). Each
 * fixture becomes a Dojo document; its rule-code multiset must match.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { buildBundle, loadCatalogDir } from './build.js';
import { Catalog } from './catalog.js';
import { pageBonds, validateWiring } from './validate.js';
import { fixtureToDocument, loadWiringFixtures } from './wiring-fixtures.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = new Catalog(buildBundle(loadCatalogDir(`${root}catalog/data`)));
const fixtures = loadWiringFixtures(`${root}catalog/fixtures/wiring`);

const codes = (doc: Parameters<typeof validateWiring>[0]): string[] =>
  validateWiring(doc, catalog)
    .map((f) => f.code)
    .sort();

describe('validateWiring — golden fixtures', () => {
  it('loads all fixtures', () => {
    expect(fixtures.length).toBe(15);
  });

  for (const fx of fixtures)
    it(`${fx.file}: ${fx.description}`, () => {
      expect(codes(fixtureToDocument(fx))).toEqual([...fx.expect].sort());
    });

  it('maps every fixture bond onto a lag bundle', () => {
    for (const fx of fixtures) {
      const doc = fixtureToDocument(fx);
      const bonds = pageBonds(doc, doc.pages[0]!);
      const norm = (b: {
        node: string;
        name: string;
        members: string[];
        lacp: boolean;
      }): string =>
        `${b.node}/${b.name}/${[...b.members].sort().join(',')}/${b.lacp}`;
      expect(bonds.map(norm).sort()).toEqual(fx.bonds.map(norm).sort());
    }
  });
});

describe('validateWiring — levels and scope', () => {
  it('levels follow the code prefix', () => {
    for (const fx of fixtures)
      for (const f of validateWiring(fixtureToDocument(fx), catalog))
        expect(f.level).toBe(
          f.code.startsWith('E_')
            ? 'error'
            : f.code.startsWith('W_')
              ? 'warning'
              : 'note',
        );
  });

  it('ignores unbound nodes entirely', () => {
    const doc = fixtureToDocument(fixtures[1]!); // 02_port_unknown
    for (const n of doc.pages[0]!.nodes) delete n.hw;
    expect(validateWiring(doc, catalog)).toEqual([]);
  });

  it('validates each page independently', () => {
    const doc = fixtureToDocument(fixtures[9]!); // 10_port_reused
    const [page] = doc.pages;
    // Split the two cables onto two pages: no longer a reuse on either.
    doc.pages = [
      { ...page!, id: 'a', links: [page!.links[0]!] },
      { ...page!, id: 'b', links: [page!.links[1]!] },
    ];
    expect(codes(doc)).toEqual([]);
  });

  it('locations name the page', () => {
    const doc = fixtureToDocument(fixtures[1]!);
    expect(
      validateWiring(doc, catalog).every((f) => f.where.startsWith('page[0].')),
    ).toBe(true);
  });

  it('a non-lag bundle is not a bond', () => {
    const fx = fixtures[6]!; // 07_ecxs_bad_bonds
    const doc = fixtureToDocument(fx);
    for (const b of doc.bundles!) b.kind = 'ecmp';
    expect(codes(doc)).toEqual([]);
  });
});
