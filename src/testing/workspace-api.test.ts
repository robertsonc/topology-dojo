import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { DEFAULT_HANDLER_FIXTURE } from './worker-fixtures.js';
import { signSession } from '../server/session.js';

const GITHUB_CLIENT_SECRET = 'w1-workspace-test-secret';

let handle: MiniflareHandle;

function minimalDocument(title: string) {
  return {
    title,
    customNodes: [],
    pages: [
      {
        id: 'p1',
        name: 'Frame 1',
        viewBox: '0 0 1050 700',
        nodes: [],
        links: [],
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
      },
    ],
  };
}

async function sessionCookie(uid: string, login: string): Promise<string> {
  const token = await signSession({ uid, login }, GITHUB_CLIENT_SECRET);
  return `tdg_session=${token}`;
}

beforeAll(async () => {
  const bundle = await buildWorkerBundle(DEFAULT_HANDLER_FIXTURE, {
    sourcefile: 'workspace-api-fixture.ts',
  });
  handle = await startMiniflare({
    bundle,
    kvNamespaces: ['TOPOLOGY_KV', 'OAUTH_KV'],
    durableObjects: {
      TOPOLOGY_DOCUMENT: { className: 'TopologyDocument', useSQLite: true },
      TOPOLOGY_REGISTRY: { className: 'TopologyRegistry', useSQLite: true },
    },
    vars: {
      GITHUB_CLIENT_ID: 'test-client-id',
      GITHUB_CLIENT_SECRET,
    },
  });
}, 30_000);

afterAll(async () => {
  await handle?.dispose();
});

describe('GET /api/workspaces', () => {
  it('401s unauthenticated', async () => {
    const res = await handle.fetch('/api/workspaces');
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: 'authentication required',
    });
  });
});

describe('workspace ownership isolation', () => {
  it("owner B cannot read owner A's workspace", async () => {
    const ownerA = await sessionCookie('alice-1', 'alice');
    const ownerB = await sessionCookie('bob-2', 'bob');

    const created = await handle.fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerA },
      body: JSON.stringify({ document: minimalDocument('Alice only') }),
    });
    expect(created.status).toBe(201);
    const snapshot = (await created.json()) as { id: string };
    expect(snapshot.id).toMatch(/^w_/);

    // The owner can read her own workspace straight back.
    const own = await handle.fetch(`/api/workspaces/${snapshot.id}`, {
      headers: { cookie: ownerA },
    });
    expect(own.status).toBe(200);

    // A different signed-in owner gets no such workspace — never a leak of
    // Alice's document, never a silent empty result.
    const cross = await handle.fetch(`/api/workspaces/${snapshot.id}`, {
      headers: { cookie: ownerB },
    });
    expect(cross.status).toBe(404);
    const crossBody = (await cross.json()) as { error: string };
    expect(crossBody.error).toContain('unknown workspace');

    // ...and it doesn't show up in owner B's list either.
    const listB = await handle.fetch('/api/workspaces', {
      headers: { cookie: ownerB },
    });
    const listed = (await listB.json()) as Array<{ id: string }>;
    expect(listed.some((w) => w.id === snapshot.id)).toBe(false);
  });
});
