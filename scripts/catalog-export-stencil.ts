/**
 * catalog export-stencil (hw-catalog Phase 5): write a Visio stencil (.vssx)
 * of the hardware masters from a published catalog bundle.
 *
 *   npm run catalog:stencil -- --out stencils/hardware.vssx
 *   npm run catalog:stencil -- --out all.vssx --all          # include non-GA
 *   npm run catalog:stencil -- --out x.vssx --version 868980b39f5b
 *
 * Reads public/catalog (the bundles documents pin), so a stencil's
 * CatalogVersion Shape Data matches what a document was bound with.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { nodeCatalogLoader } from '../src/server/catalog.js';
import { catalogToVssx } from '../src/export/vssx.js';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      all: { type: 'boolean', default: false },
      version: { type: 'string' },
    },
  });
  if (!values.out) {
    console.error(
      'usage: catalog:stencil -- --out <file.vssx> [--all] [--version <hash>]',
    );
    return 2;
  }
  const catalog = await nodeCatalogLoader().get(values.version);
  const r = catalogToVssx(catalog, { all: values.all });
  const out = path.resolve(values.out);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, r.bytes);
  console.log(
    `wrote ${out}: ${r.models.length} masters (catalog ${catalog.version})` +
      (r.skipped.length
        ? `; not GA-eligible, left out: ${r.skipped.join(', ')} (--all includes them)`
        : ''),
  );
  return 0;
}

main().then(
  (code) => (process.exitCode = code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  },
);
