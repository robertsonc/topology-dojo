/**
 * Worker source for the hardware catalog loader: bundles are static assets
 * under /catalog/ (built by `npm run catalog:build`, copied into dist/ by
 * Vite) and are read through the ASSETS binding. Public HTTP requests to
 * /catalog/ are refused in `default-handler.ts`, because provenance rows
 * name internal documents; this in-Worker read is the only way in.
 */
import { CatalogLoader } from '../src/catalog/loader.js';
import type { WorkerEnv } from './env.js';

/** Only bundle / manifest names; never a path. */
const FILE_RE = /^(manifest|catalog-[0-9a-f]{12})\.json$/;

/** Assets are addressed by path; the origin is ignored by the binding. */
const ASSET_ORIGIN = 'https://assets.invalid';

let loader: CatalogLoader | null = null;

/** One loader (and so one LRU) per isolate. */
export function workerCatalogLoader(
  assets: WorkerEnv['ASSETS'],
): CatalogLoader {
  loader ??= new CatalogLoader(async (file) => {
    if (!FILE_RE.test(file)) throw new Error(`refusing catalog file "${file}"`);
    const res = await assets.fetch(
      new Request(`${ASSET_ORIGIN}/catalog/${file}`),
    );
    if (!res.ok)
      throw new Error(`asset /catalog/${file} returned ${res.status}`);
    return res.text();
  });
  return loader;
}
