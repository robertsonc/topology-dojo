/**
 * Worker loader for the server-side rasterizer: resvg's wasm is bundled by
 * Wrangler as a compiled module (no runtime fetch, no eval), then handed to
 * the runtime-agnostic core (`src/export/raster.ts`).
 */
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import { initRasterizer, type Rasterizer } from '../src/export/raster.js';

/**
 * Pixel budget per rasterized page in a Worker isolate (128 MB memory): the
 * RGBA bitmap lives in wasm memory and again in JS while a PDF is built, so
 * stay near 16 MP (ANSI C at ~150 DPI). Larger requests are scaled down and
 * the result says so.
 */
export const WORKER_MAX_PIXELS = 16_000_000;

export function workerRasterizer(): Promise<Rasterizer> {
  return initRasterizer(() => resvgWasm);
}
