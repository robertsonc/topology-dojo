/**
 * The one-way legacy→workspace hand-off must stay an owner decision: the
 * agent-facing MCP surface (`WorkspaceService` with
 * `migrateLegacyOnAccess: false`, as `worker/mcp.ts` constructs it) rejects a
 * legacy topology id with guidance and leaves the draft untouched, while the
 * owner-facing browser surface (the default) still lazily migrates on first
 * access. Regression cover for the "read-only get_workspace_* call silently
 * migrated my draft" footgun.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWorkerBundle,
  startMiniflare,
  type MiniflareHandle,
} from './worker-harness.js';
import { WORKSPACE_MIGRATION_FIXTURE } from './worker-fixtures.js';

let handle: MiniflareHandle;

const LEGACY_DOCUMENT = {
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
  const bundle = await buildWorkerBundle(WORKSPACE_MIGRATION_FIXTURE, {
    sourcefile: 'workspace-migration-fixture.ts',
  });
  handle = await startMiniflare({
    bundle,
    durableObjects: {
      TOPOLOGY_DOCUMENT: { className: 'TopologyDocument', useSQLite: true },
      TOPOLOGY_REGISTRY: { className: 'TopologyRegistry', useSQLite: true },
    },
  });
}, 30_000);

afterAll(async () => {
  await handle?.dispose();
});

function query(params: Record<string, string>): string {
  return new URLSearchParams({
    uid: '1',
    login: 'alice',
    ...params,
  }).toString();
}

async function seed(id: string): Promise<void> {
  const res = await handle.fetch(`/seed?${query({ id })}`, {
    method: 'POST',
    body: JSON.stringify(LEGACY_DOCUMENT),
  });
  expect(res.status).toBe(200);
}

async function call(
  path: string,
  params: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await handle.fetch(`/${path}?${query(params)}`);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

describe('legacy drafts on the agent (MCP) workspace surface', () => {
  it('rejects a workspace read on a legacy draft without migrating it', async () => {
    await seed('t1');

    const manifest = await call('manifest', { id: 't1', mode: 'agent' });
    expect(manifest.status).toBe(400);
    expect(manifest.body.error).toContain('legacy draft');
    expect(manifest.body.error).toContain('left untouched');

    const elements = await call('elements', {
      id: 't1',
      mode: 'agent',
      pageId: 'p1',
    });
    expect(elements.status).toBe(400);
    expect(elements.body.error).toContain('legacy draft');

    // The rejection is side-effect free: no workspace directory marker means
    // the direct (legacy) authoring tools keep working on this topology.
    const migrated = await call('migrated', { id: 't1', mode: 'agent' });
    expect(migrated.body).toEqual({ migrated: false });
  });

  it('still reports a genuinely unknown id as unknown', async () => {
    const res = await call('manifest', { id: 'missing', mode: 'agent' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('unknown workspace "missing"');
  });

  it('owner access migrates once; the agent surface then reads the workspace normally', async () => {
    await seed('t2');

    const owner = await call('manifest', { id: 't2' });
    expect(owner.status).toBe(200);
    expect(owner.body.id).toBe('t2');
    expect(owner.body.revision).toBe(0);

    const migrated = await call('migrated', { id: 't2', mode: 'agent' });
    expect(migrated.body).toEqual({ migrated: true });

    const agent = await call('manifest', { id: 't2', mode: 'agent' });
    expect(agent.status).toBe(200);
    expect(agent.body.id).toBe('t2');
  });
});
