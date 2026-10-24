/**
 * hw-catalog Phase 1 inside workerd: the Worker's catalog loader reads the
 * published bundles from `public/catalog/` through a real ASSETS binding
 * and resolves seed interfaces — the path the hosted MCP tools will use.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Log, LogLevel, Miniflare } from 'miniflare';
import { buildWorkerBundle, type WorkerBundle } from './worker-harness.js';

const ENTRY = `
import { workerCatalogLoader } from './worker/catalog.ts';

export default {
  async fetch(request, env) {
    const loader = workerCatalogLoader(env.ASSETS);
    const url = new URL(request.url);
    try {
      const cat = await loader.get(url.searchParams.get('v') ?? undefined);
      const r = cat.resolveInterface('edgeconnect-ec-10104', 'lan1');
      return Response.json({
        version: cat.version,
        latest: await loader.latestVersion(),
        models: cat.models.size,
        lan1: r && { physicalId: r.physicalId, role: r.role },
      });
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 });
    }
  },
};
`;

describe('worker catalog loader (ASSETS)', () => {
  let mf: Miniflare;
  let bundle: WorkerBundle;

  beforeAll(async () => {
    bundle = await buildWorkerBundle(ENTRY, { sourcefile: 'catalog-entry.ts' });
    mf = new Miniflare({
      scriptPath: bundle.path,
      modules: true,
      compatibilityDate: '2026-06-07',
      assets: {
        directory: 'public',
        binding: 'ASSETS',
        routerConfig: {
          has_user_worker: true,
          invoke_user_worker_ahead_of_assets: true,
        },
      },
      log: new Log(LogLevel.ERROR),
    });
    await mf.ready;
  }, 60_000);

  afterAll(async () => {
    await mf?.dispose();
    await bundle?.dispose();
  });

  it('loads the latest bundle and resolves an interface', async () => {
    const res = await mf.dispatchFetch('http://worker.test/');
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.version).toBe(body.latest);
    expect(body).toMatchObject({
      models: 5,
      lan1: { role: 'lan' },
    });
  });

  it('refuses a version that was never published', async () => {
    const res = await mf.dispatchFetch('http://worker.test/?v=000000000000');
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /catalog version 000000000000 unavailable/,
    );
  });
});
