/**
 * The smoke script against an eventually-consistent edge (release run #4):
 * right after `wrangler deploy`, consecutive requests can be answered by
 * isolates running different versions. `--wait-live` must therefore see the
 * expected sha several polls in a row, and the healthz check must retry a sha
 * mismatch inside the settle window instead of failing on one stale answer.
 *
 * No network: `globalThis.fetch` is replaced by a scripted responder that
 * answers /healthz from a queue of shas (the last entry repeats). Every
 * other path is irrelevant here (a 404 keeps the non-healthz checks honest).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { runSmoke, waitForLiveOrigin } from '../../scripts/smoke.mjs';

const NEW = 'a'.repeat(40);
const OLD = 'b'.repeat(40);

function scriptedEdge(shas: string[]): { calls: () => number } {
  let calls = 0;
  const responder: typeof fetch = (input) => {
    const url = new URL(
      typeof input === 'string' ? input : (input as Request | URL).toString(),
    );
    if (url.pathname !== '/healthz')
      return Promise.resolve(new Response('not found', { status: 404 }));
    const sha = shas[Math.min(calls, shas.length - 1)];
    calls += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, sha }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  globalThis.fetch = responder;
  return { calls: () => calls };
}

describe('smoke script on an eventually-consistent edge', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('wait-live needs the sha on consecutive polls, and a stale answer resets the streak', async () => {
    // new, old, new, new, new → live only after the third consecutive new.
    const edge = scriptedEdge([NEW, OLD, NEW, NEW, NEW]);
    const live = await waitForLiveOrigin('https://edge.test', 10, NEW, {
      consecutive: 3,
      confirmIntervalMs: 1,
      retryIntervalMs: 1,
    });
    expect(live).toBe(true);
    expect(edge.calls()).toBe(5);
  });

  it('wait-live gives up at the deadline when the edge never settles', async () => {
    scriptedEdge([NEW, OLD]); // the last entry repeats, so it stays OLD
    const live = await waitForLiveOrigin('https://edge.test', 0.05, NEW, {
      consecutive: 3,
      confirmIntervalMs: 1,
      retryIntervalMs: 1,
    });
    expect(live).toBe(false);
  });

  it('healthz retries a sha mismatch inside the settle window and passes once the edge agrees', async () => {
    const edge = scriptedEdge([OLD, OLD, NEW]);
    const results = await runSmoke('https://edge.test', {
      sha: NEW,
      shaSettleSeconds: 5,
    });
    const healthz = results.find((r) => r.name === 'healthz');
    expect(healthz?.status).toBe('pass');
    expect(edge.calls()).toBe(3);
  });

  it('healthz fails immediately on a sha mismatch without a settle window (plain verification run)', async () => {
    const edge = scriptedEdge([OLD, NEW]);
    const results = await runSmoke('https://edge.test', { sha: NEW });
    const healthz = results.find((r) => r.name === 'healthz');
    expect(healthz?.status).toBe('fail');
    expect(healthz?.detail).toContain(`expected sha "${NEW}"`);
    expect(edge.calls()).toBe(1);
  });

  it('healthz still fails after the settle window when the edge never serves the sha', async () => {
    scriptedEdge([OLD]);
    const results = await runSmoke('https://edge.test', {
      sha: NEW,
      shaSettleSeconds: 0.001,
    });
    const healthz = results.find((r) => r.name === 'healthz');
    expect(healthz?.status).toBe('fail');
  });
});
