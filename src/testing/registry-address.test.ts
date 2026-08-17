/**
 * Worker-level cover for MCP private-draft registry addressing (issue #226):
 * new registries are `user-id:<uid>`, login is display-only, and existing
 * `user:<login>` drafts are copied lazily so a rename cannot orphan them.
 * Pure helpers are unit-tested in `src/mcp/registry-address.test.ts`; this
 * suite drives the same functions against real `TopologyRegistry` DOs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { REGISTRY_ADDRESS_FIXTURE } from './worker-fixtures.js';

let handle: MiniflareHandle;

const DRAFT = {
  title: 'Legacy draft',
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

beforeAll(async () => {
  const bundle = await buildWorkerBundle(REGISTRY_ADDRESS_FIXTURE, {
    sourcefile: 'registry-address-fixture.ts',
  });
  handle = await startMiniflare({
    bundle,
    durableObjects: {
      TOPOLOGY_REGISTRY: { className: 'TopologyRegistry', useSQLite: true },
    },
  });
}, 30_000);

afterAll(async () => {
  await handle?.dispose();
});

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

async function call(
  path: string,
  params: Record<string, string> = {},
  init?: { method?: string; body?: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await handle.fetch(`/${path}?${query(params)}`, init);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

describe('MCP registry addressing (Durable Object names)', () => {
  it('names the current registry user-id:<uid> and the legacy source user:<login>', async () => {
    const res = await call('names', { uid: '17257145', login: 'alice' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      current: 'user-id:17257145',
      legacy: 'user:alice',
      ownerId: '17257145',
    });
  });

  it('fails closed when opening a registry without a uid', async () => {
    const res = await call('names-no-uid', { login: 'alice' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no authenticated user \(props\.id\)/);
  });
});

describe('lazy user: → user-id: draft migration', () => {
  it('copies login-keyed drafts onto the uid-keyed registry and keeps the source', async () => {
    const seed = await call(
      'seed-legacy',
      { uid: '1', login: 'alice', id: 't-old' },
      { method: 'POST', body: JSON.stringify(DRAFT) },
    );
    expect(seed.status).toBe(200);
    expect(seed.body.name).toBe('user:alice');

    const opened = await call('open', { uid: '1', login: 'alice' });
    expect(opened.status).toBe(200);
    expect(opened.body.ids).toEqual(['t-old']);
    expect(opened.body.current).toEqual(['t-old']);
    expect(opened.body.legacy).toEqual(['t-old']);
  });

  it('does not overwrite a draft already stored under the uid key', async () => {
    await call(
      'seed-current',
      { uid: '2', login: 'bob', id: 't-both' },
      {
        method: 'POST',
        body: JSON.stringify({ ...DRAFT, title: 'canonical' }),
      },
    );
    await call(
      'seed-legacy',
      { uid: '2', login: 'bob', id: 't-both' },
      { method: 'POST', body: JSON.stringify({ ...DRAFT, title: 'stale' }) },
    );

    const opened = await call('open', { uid: '2', login: 'bob' });
    expect(opened.status).toBe(200);
    expect(opened.body.ids).toEqual(['t-both']);

    const listed = await call('list', { uid: '2', login: 'bob' });
    expect(listed.status).toBe(200);
    const workspaces = listed.body.workspaces as Array<{
      id: string;
      title: string;
    }>;
    expect(workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 't-both', title: 'canonical' }),
      ]),
    );
  });

  it('imports login-keyed drafts when the workspace directory is listed', async () => {
    await call(
      'seed-legacy',
      { uid: '4', login: 'drew', id: 't-list' },
      { method: 'POST', body: JSON.stringify(DRAFT) },
    );
    const listed = await call('list', { uid: '4', login: 'drew' });
    expect(listed.status).toBe(200);
    expect(listed.body.current).toEqual(['t-list']);
    expect(listed.body.legacy).toEqual(['t-list']);
    const workspaces = listed.body.workspaces as Array<{ id: string }>;
    expect(workspaces.map((item) => item.id)).toContain('t-list');
  });

  it('keeps drafts reachable after a login rename once they have been imported', async () => {
    await call(
      'seed-legacy',
      { uid: '3', login: 'carol', id: 't-rename' },
      { method: 'POST', body: JSON.stringify(DRAFT) },
    );
    const before = await call('open', { uid: '3', login: 'carol' });
    expect(before.body.ids).toEqual(['t-rename']);

    const after = await call('open', { uid: '3', login: 'carol-renamed' });
    expect(after.status).toBe(200);
    expect(after.body.ids).toEqual(['t-rename']);
    expect(after.body.current).toEqual(['t-rename']);
    expect(after.body.legacy).toEqual([]);

    const listed = await call('list', { uid: '3', login: 'carol-renamed' });
    expect(listed.status).toBe(200);
    const workspaces = listed.body.workspaces as Array<{ id: string }>;
    expect(workspaces.map((item) => item.id)).toContain('t-rename');
  });
});
