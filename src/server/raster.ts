/**
 * Node loader for the server-side rasterizer: reads resvg's wasm from
 * node_modules once and hands it to the runtime-agnostic core
 * (`src/export/raster.ts`). Used by the stdio MCP server and tests; the
 * Worker has its own loader (`worker/raster.ts`).
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initRasterizer, type Rasterizer } from '../export/raster.js';

/** Pixel budget per page on Node (≈ ANSI E at 150 DPI). */
export const NODE_MAX_PIXELS = 40_000_000;

export function nodeRasterizer(): Promise<Rasterizer> {
  return initRasterizer(async () => {
    const require = createRequire(import.meta.url);
    return readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm'));
  });
}
