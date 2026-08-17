/**
 * TopologyRegistry.consumeQuota — the per-user sliding window lives on the
 * existing registry Durable Object (no new class / migration). This drives
 * the real DO through the worker-harness, matching document-do.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { SHARE_LIMIT } from '../mcp/rate-limit.js';

const harness = String.raw`
import { TopologyRegistry } from './worker/registry.ts';
export { TopologyRegistry };
export default {
  async fetch(request, env) {
    try {
      const input = await request.json();
      const stub = env.REG.get(env.REG.idFromName('user:' + String(input.login)));
      const result = await stub.consumeQuota(input.bucket, Number(input.now));
      return Response.json(result);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    }
  },
};
`;

let handle: MiniflareHandle;

async function consume(
  login: string,
  bucket: 'mutating' | 'share',
  now: number,
) {
  const res = await handle.fetch('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login, bucket, now }),
  });
  const body = (await res.json()) as {
    allowed?: boolean;
    remaining?: number;
    retryAfterMs?: number;
    limit?: number;
    error?: string;
  };
  if (!res.ok) throw new Error(`${res.status}: ${body.error ?? 'unknown'}`);
  return body;
}

beforeAll(async () => {
  const bundle = await buildWorkerBundle(harness, {
    sourcefile: 'registry-rate-limit-fixture.ts',
  });
  handle = await startMiniflare({
    bundle,
    durableObjects: {
      REG: { className: 'TopologyRegistry', useSQLite: true },
    },
  });
}, 30_000);

afterAll(async () => {
  await handle?.dispose();
});

describe('TopologyRegistry.consumeQuota', () => {
  it('allows share_topology up to the per-user cap, then denies', async () => {
    const login = 'octocat-share';
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < SHARE_LIMIT.limit; i++) {
      const result = await consume(login, 'share', t0 + i);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(SHARE_LIMIT.limit - i - 1);
    }
    const denied = await consume(login, 'share', t0 + SHARE_LIMIT.limit);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.limit).toBe(SHARE_LIMIT.limit);
  });

  it('isolates quotas per user and per bucket', async () => {
    const t0 = 1_700_000_100_000;
    const other = await consume('other-user', 'share', t0);
    expect(other.allowed).toBe(true);
    const mutating = await consume('octocat-share', 'mutating', t0);
    expect(mutating.allowed).toBe(true);
    expect(mutating.remaining).toBeGreaterThan(0);
  });
});
