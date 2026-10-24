/**
 * hw-catalog Phase 1: the catalog loader — latest via the manifest, pinned
 * versions, LRU eviction, refusal of bad versions and mismatched bundles,
 * and the Node source over the published `public/catalog/`.
 */
import { describe, expect, it } from 'vitest';
import { CatalogLoader, isCatalogAssetPath } from './loader.js';
import { nodeCatalogLoader } from '../server/catalog.js';
import { BUNDLE_FORMAT } from './catalog.js';

function bundle(version: string): string {
  return JSON.stringify({
    format: BUNDLE_FORMAT,
    version,
    platforms: [],
    models: [],
    optics: { cage_accepts: {}, types: {} },
  });
}
const V = (n: number): string => n.toString(16).padStart(12, '0');

function memoryLoader(files: Record<string, string>, capacity = 2) {
  const reads: string[] = [];
  const loader = new CatalogLoader(async (f) => {
    reads.push(f);
    const text = files[f];
    if (text === undefined) throw new Error('404');
    return text;
  }, capacity);
  return { loader, reads };
}

describe('CatalogLoader', () => {
  it('serves the latest version from the manifest and caches it', async () => {
    const { loader, reads } = memoryLoader({
      'manifest.json': JSON.stringify({ latest: V(2), versions: [V(1), V(2)] }),
      [`catalog-${V(2)}.json`]: bundle(V(2)),
    });
    expect((await loader.get()).version).toBe(V(2));
    await loader.get(V(2));
    expect(reads).toEqual(['manifest.json', `catalog-${V(2)}.json`]);
  });

  it('evicts the least recently used version', async () => {
    const files: Record<string, string> = {};
    for (const n of [1, 2, 3]) files[`catalog-${V(n)}.json`] = bundle(V(n));
    const { loader } = memoryLoader(files, 2);
    await loader.get(V(1));
    await loader.get(V(2));
    await loader.get(V(1)); // touch 1 → 2 is now oldest
    await loader.get(V(3));
    expect(loader.cachedVersions()).toEqual([V(1), V(3)]);
  });

  it('rejects malformed versions, missing bundles and mismatched content', async () => {
    const { loader } = memoryLoader({ [`catalog-${V(5)}.json`]: bundle(V(6)) });
    await expect(loader.get('../etc/passwd')).rejects.toThrow(
      /invalid catalog version/,
    );
    await expect(loader.get(V(4))).rejects.toThrow(/unavailable/);
    await expect(loader.get(V(5))).rejects.toThrow(/declares version/);
    expect(loader.cachedVersions()).toEqual([]); // failures are not cached
  });
});

describe('nodeCatalogLoader (public/catalog)', () => {
  it('loads the published catalog and resolves seed interfaces', async () => {
    const loader = nodeCatalogLoader();
    const cat = await loader.get();
    expect(cat.version).toBe(await loader.latestVersion());
    expect(cat.models.size).toBe(5);
    expect(
      cat.resolveInterface('aruba-cx-6300m-jl664a', '2/1/25'),
    ).toMatchObject({
      physicalKind: 'sfp56',
      member: 2,
    });
  });
});

describe('isCatalogAssetPath', () => {
  it('matches the catalog folder however it is spelled', () => {
    for (const p of [
      '/catalog',
      '/catalog/',
      '/catalog/manifest.json',
      '/Catalog/manifest.json',
      '/%63atalog/manifest.json',
      '//catalog/manifest.json',
    ])
      expect(isCatalogAssetPath(p), p).toBe(true);
    for (const p of ['/', '/catalogue', '/v/catalog', '/assets/catalog.js'])
      expect(isCatalogAssetPath(p), p).toBe(false);
  });
});
