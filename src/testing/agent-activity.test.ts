/**
 * Initiative A — Miniflare: MCP-style tool dispatch still succeeds with
 * unchanged output when activity recording throws internally, and the trail
 * is recorded when recording works. Mirrors the `recordLogin` waitUntil /
 * try/catch discipline (`worker/auth.ts`) without constructing the real
 * `TopologyMcp` McpAgent (same constraint as `mcp-workspace-gate.test.ts`).
 *
 * Worker-level harness (Miniflare, CI only — fails to start locally with
 * `File is not defined`, same as the other suites in this directory).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';

const ACTIVITY_FIXTURE = String.raw`
import { DurableObject } from 'cloudflare:workers';
import { TopologyStore } from './src/mcp/store.ts';
import { createTools } from './src/mcp/tools.ts';
import { appendTrail } from './src/agent-activity/trail.ts';
import { AnalyticsLog } from './worker/analytics.ts';

export { AnalyticsLog };

export class ActivityProbe extends DurableObject {
  async record(event) {
    if (event.toolName === '__throw__') throw new Error('record boom');
    const trail = (await this.ctx.storage.get('activity:trail')) ?? [];
    await this.ctx.storage.put('activity:trail', appendTrail(trail, event));
  }
  async trail() {
    return (await this.ctx.storage.get('activity:trail')) ?? [];
  }
}

const renderDocument = () => '<svg></svg>';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/tool') {
      const store = new TopologyStore();
      const tools = createTools(store, { renderDocument });
      const tool = tools.find((t) => t.name === 'list_templates');
      const result = await tool.handler({});
      const fail = url.searchParams.get('fail');
      const stub = env.ACTIVITY.get(env.ACTIVITY.idFromName('s1'));
      try {
        const event = {
          toolName: fail ? '__throw__' : 'list_templates',
          at: '2026-08-19T09:00:00.000Z',
          outcome: 'success',
        };
        if (fail === 'await') {
          await stub.record(event);
        } else {
          ctx.waitUntil(stub.record(event));
        }
      } catch (err) {
        console.error('agent activity record failed', err);
      }
      return Response.json(result);
    }
    if (url.pathname === '/trail') {
      const stub = env.ACTIVITY.get(env.ACTIVITY.idFromName('s1'));
      return Response.json(await stub.trail());
    }
    return new Response('not found', { status: 404 });
  },
};
`;

let handle: MiniflareHandle;

beforeAll(async () => {
  const bundle = await buildWorkerBundle(ACTIVITY_FIXTURE, {
    sourcefile: 'agent-activity-fixture.ts',
  });
  handle = await startMiniflare({
    bundle,
    durableObjects: {
      ACTIVITY: { className: 'ActivityProbe', useSQLite: true },
      ANALYTICS: { className: 'AnalyticsLog', useSQLite: true },
    },
    vars: { ANALYTICS_ENABLED: 'true' },
  });
}, 30_000);

afterAll(async () => {
  await handle?.dispose();
});

describe('activity recording never breaks the primary tool path', () => {
  it('returns unchanged list_templates output when recording throws (awaited)', async () => {
    const ok = await handle.fetch('/tool');
    expect(ok.status).toBe(200);
    const baseline = await ok.json();
    expect(Array.isArray(baseline)).toBe(true);
    expect((baseline as { id: string }[]).length).toBeGreaterThanOrEqual(5);

    const failed = await handle.fetch('/tool?fail=await');
    expect(failed.status).toBe(200);
    await expect(failed.json()).resolves.toEqual(baseline);
  }, 30_000);

  it('returns unchanged output when recording rejects under waitUntil', async () => {
    const ok = await handle.fetch('/tool');
    const baseline = await ok.json();
    const failed = await handle.fetch('/tool?fail=waitUntil');
    expect(failed.status).toBe(200);
    await expect(failed.json()).resolves.toEqual(baseline);
  }, 30_000);

  it('records the trail when recording succeeds', async () => {
    await handle.fetch('/tool');
    const trailRes = await handle.fetch('/trail');
    expect(trailRes.status).toBe(200);
    const trail = (await trailRes.json()) as Array<{ toolName: string }>;
    expect(trail.some((e) => e.toolName === 'list_templates')).toBe(true);
  }, 30_000);
});
