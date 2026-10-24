/**
 * Build and publish the hardware catalog bundle (hw-catalog Phase 1).
 *
 *   npm run catalog:build            lint catalog/data, write the bundle
 *   npm run catalog:build -- --check lint, and fail if the published
 *                                    bundle is not the current data
 *
 * Lints with the TypeScript port of check_seed.py (errors fail the build;
 * WARN lines are printed), then writes `public/catalog/catalog-<hash>.json`
 * and records it in `public/catalog/manifest.json`. Earlier bundles are kept
 * — documents pin the version they were bound with — so the folder only
 * grows. Vite copies `public/` into `dist/`, where the Worker reads it
 * through its ASSETS binding (public HTTP access to /catalog/ is refused).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBundle,
  bundleFileName,
  canonicalJson,
  checkCatalog,
  loadCatalogDir,
} from '../src/catalog/build.js';
import { MANIFEST_FILE, type CatalogManifest } from '../src/catalog/loader.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'catalog/data');
const schemaFile = path.join(root, 'catalog/schema/catalog.schema.json');
const outDir = path.join(root, 'public/catalog');

function main(): number {
  const check = process.argv.includes('--check');
  const cat = loadCatalogDir(dataDir);
  const findings = checkCatalog(cat, schemaFile);
  for (const f of findings) console.log(f);
  const errors = findings.filter((f) => !f.startsWith('WARN'));
  console.log(
    `${cat.platforms.size} platforms, ${cat.models.size} models, ${errors.length} errors, ${findings.length - errors.length} warnings`,
  );
  if (errors.length) return 1;

  const bundle = buildBundle(cat);
  const file = path.join(outDir, bundleFileName(bundle.version));
  const manifestFile = path.join(outDir, MANIFEST_FILE);
  const manifest: CatalogManifest = existsSync(manifestFile)
    ? (JSON.parse(readFileSync(manifestFile, 'utf8')) as CatalogManifest)
    : { latest: '', versions: [] };

  if (check) {
    if (manifest.latest !== bundle.version || !existsSync(file)) {
      console.error(
        `catalog data is at ${bundle.version} but public/catalog publishes ${manifest.latest || 'nothing'} — run npm run catalog:build`,
      );
      return 1;
    }
    console.log(`public/catalog is current (${bundle.version})`);
    return 0;
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(file, canonicalJson(bundle) + '\n');
  if (!manifest.versions.includes(bundle.version))
    manifest.versions.push(bundle.version);
  manifest.latest = bundle.version;
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`published ${path.relative(root, file)}`);
  return 0;
}

process.exitCode = main();
