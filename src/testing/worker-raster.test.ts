/**
 * Server-side raster export inside workerd: the Worker loads resvg's wasm as
 * a compiled module (`worker/raster.ts`), renders through the bundled engine
 * (`worker/render.ts`) and returns a print-stamped PNG and a PDF — the path
 * `export_topology` takes on the hosted MCP endpoint.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { readFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const ENTRY = `
import { renderDocument } from './worker/render.ts';
import { workerRasterizer, WORKER_MAX_PIXELS } from './worker/raster.ts';
import { exportPng, exportPdf } from './src/export/print.ts';
import { pngDpi } from './src/export/png.ts';
import { sampleDocument } from './src/pages/model.ts';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const doc = sampleDocument();
    const r = await workerRasterizer();
    const opts = { maxPixels: WORKER_MAX_PIXELS };
    if (url.pathname === '/png') {
      const out = exportPng(doc, 0, renderDocument, r, opts);
      return Response.json({ bytes: out.png.length, width: out.width, height: out.height, dpi: pngDpi(out.png), sig: Array.from(out.png.slice(1, 4)) });
    }
    const out = exportPdf(doc, 'all', renderDocument, r, { ...opts, paper: 'a4', dpi: 100 });
    return Response.json({ bytes: out.pdf.length, head: new TextDecoder().decode(out.pdf.slice(0, 8)), pages: out.pages });
  },
};
`;

describe('raster export in workerd', () => {
  let mf: Miniflare;
  let bundlePath: string;

  beforeAll(async () => {
    bundlePath = resolve(`.worker-raster-${process.pid}-${Date.now()}.mjs`);
    await build({
      stdin: {
        contents: ENTRY,
        loader: 'ts',
        resolveDir: process.cwd(),
        sourcefile: 'raster-entry.ts',
      },
      bundle: true,
      format: 'esm',
      platform: 'browser',
      outfile: bundlePath,
      logLevel: 'silent',
      plugins: [
        {
          // Leave the wasm import for workerd to load as a compiled module,
          // as Wrangler's default CompiledWasm rule does.
          name: 'wasm-module',
          setup(b) {
            b.onResolve({ filter: /\.wasm$/ }, () => ({
              path: './resvg.wasm',
              external: true,
            }));
          },
        },
      ],
    });
    const wasm = await readFile(
      createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm'),
    );
    mf = new Miniflare({
      modules: [
        {
          type: 'ESModule',
          path: resolve('worker.mjs'),
          contents: await readFile(bundlePath, 'utf8'),
        },
        { type: 'CompiledWasm', path: resolve('resvg.wasm'), contents: wasm },
      ],
      compatibilityDate: '2026-06-07',
      log: new Log(LogLevel.ERROR),
    });
    await mf.ready;
  }, 60_000);

  afterAll(async () => {
    await mf?.dispose();
    if (bundlePath) await unlink(bundlePath).catch(() => undefined);
  });

  it('renders a PNG with the print DPI stamped', async () => {
    const res = await mf.dispatchFetch('http://worker.test/png');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      width: 2100,
      height: 1400,
      dpi: 192,
      sig: [80, 78, 71],
    });
    expect(body.bytes as number).toBeGreaterThan(10_000);
  }, 30_000);

  it('builds a PDF', async () => {
    const res = await mf.dispatchFetch('http://worker.test/pdf');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ head: '%PDF-1.4', pages: 1 });
  }, 30_000);
});
