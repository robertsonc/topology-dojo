/**
 * Node source for the hardware catalog loader: reads the published bundles
 * from `public/catalog/` in this checkout (the stdio MCP server and tests).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogLoader } from '../catalog/loader.js';

const CATALOG_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public/catalog',
);

/** Only bundle / manifest names; never a path. */
const FILE_RE = /^(manifest|catalog-[0-9a-f]{12})\.json$/;

export function nodeCatalogLoader(dir = CATALOG_DIR): CatalogLoader {
  return new CatalogLoader(async (file) => {
    if (!FILE_RE.test(file)) throw new Error(`refusing catalog file "${file}"`);
    return readFile(path.join(dir, file), 'utf8');
  });
}
