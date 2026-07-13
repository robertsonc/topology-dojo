/**
 * `GET /healthz` (worker/default-handler.ts, packet D3): unauthenticated
 * liveness. Both suites below start Miniflare with zero KV/Durable Object
 * bindings at all — proof, like `workspace-disabled.test.ts`'s disabled
 * suite, that a regression touching any binding from this route would throw
 * instead of quietly passing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { DEFAULT_HANDLER_FIXTURE } from './worker-fixtures.js';

const GITHUB_CLIENT_SECRET = 'd3-healthz-secret';

describe('GET /healthz — no GIT_SHA, WORKSPACE_ENABLED unset', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
      sourcefile: 'healthz-default-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      vars: { GITHUB_CLIENT_ID: 'test-client-id', GITHUB_CLIENT_SECRET },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('200s with ok:true, sha:null, workspaceEnabled:true, no-store', async () => {
    const res = await handle.fetch('/healthz');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expect(res.json()).resolves.toEqual({
      ok: true,
      sha: null,
      workspaceEnabled: true,
    });
  });

  it('never redirects an unauthenticated document navigation', async () => {
    const res = await handle.fetch('/healthz', {
      headers: { accept: 'text/html', 'sec-fetch-dest': 'document' },
      redirect: 'manual',
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it('405s a POST', async () => {
    const res = await handle.fetch('/healthz', { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('405s a DELETE', async () => {
    const res = await handle.fetch('/healthz', { method: 'DELETE' });
    expect(res.status).toBe(405);
  });
});

describe('GET /healthz — GIT_SHA set, WORKSPACE_ENABLED="false"', () => {
  let handle: MiniflareHandle;

  beforeAll(async () => {
    const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
      sourcefile: 'healthz-sha-fixture.ts',
    });
    handle = await startMiniflare({
      bundle,
      vars: {
        GITHUB_CLIENT_ID: 'test-client-id',
        GITHUB_CLIENT_SECRET,
        GIT_SHA: 'deadbeef123',
        WORKSPACE_ENABLED: 'false',
      },
    });
  }, 30_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it('echoes GIT_SHA and reflects workspaceEnabled:false', async () => {
    const res = await handle.fetch('/healthz');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      sha: 'deadbeef123',
      workspaceEnabled: false,
    });
  });
});
