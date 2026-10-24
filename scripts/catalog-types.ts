/**
 * Generate the catalog's TypeScript types from its JSON Schema, so the two
 * cannot drift (hw-catalog Phase 1).
 *
 *   npm run catalog:types            write src/catalog/types.generated.ts
 *   npm run catalog:types -- --check exit 1 if the committed file is stale
 *
 * `src/catalog/types.test.ts` runs the same check in the unit suite.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCatalogTypes } from '../src/catalog/gen-types.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'src/catalog/types.generated.ts');

async function main(): Promise<number> {
  const next = await generateCatalogTypes(root);
  if (process.argv.includes('--check')) {
    const current = readFileSync(out, 'utf8');
    if (current !== next) {
      console.error(
        'src/catalog/types.generated.ts is stale — run npm run catalog:types',
      );
      return 1;
    }
    return 0;
  }
  writeFileSync(out, next);
  console.log(`wrote ${path.relative(root, out)}`);
  return 0;
}

process.exitCode = await main();
