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

/**
 * Issue #276: once a draft is a shared workspace, the read-only document
 * tools are served from the coordinator's current revision through the same
 * dispatcher + hooks `worker/mcp.ts` wires — and the stale legacy copy is
 * neither read nor written.
 */
describe('read-only document tools on a migrated topology (issue #276)', () => {
  interface ToolResult {
    content: { type: string; text: string }[];
    isError?: boolean;
  }

  async function tool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ result: ToolResult; retained: string[] }> {
    const res = await handle.fetch(`/tool?${query({ mode: 'agent' })}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: name, args }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { result: ToolResult; retained: string[] };
  }

  async function legacyRaw(
    id: string,
  ): Promise<{ login: string | null; uid: string | null }> {
    return (await call('legacy-raw', { id })).body as {
      login: string | null;
      uid: string | null;
    };
  }

  beforeAll(async () => {
    await seed('t3');
    // Owner hand-off (browser path), then an owner commit so the coordinator
    // is visibly ahead of the legacy snapshot.
    expect((await call('manifest', { id: 't3' })).status).toBe(200);
    const applied = await handle.fetch(`/apply?${query({ id: 't3' })}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseRevision: 0,
        operationId: 'op-title',
        operations: [
          {
            type: 'document.patch',
            patch: {
              set: {
                title: 'Shared draft',
                layers: [{ id: 'overlay', name: 'Overlay' }],
                legend: { show: true, position: 'tr' },
              },
            },
          },
        ],
      }),
    });
    expect(applied.status).toBe(200);
    expect(((await applied.json()) as { ok: boolean }).ok).toBe(true);
  });

  it('get_topology returns the coordinator document and its revision', async () => {
    const { result, retained } = await tool('get_topology', {
      topologyId: 't3',
    });
    expect(result.isError).toBeUndefined();
    const doc = JSON.parse(result.content[0]!.text) as {
      title: string;
      layers?: { id: string }[];
      legend?: { position?: string };
      workspaceRevision: number;
    };
    expect(doc.title).toBe('Shared draft');
    expect(doc.layers?.map((l) => l.id)).toEqual(['overlay']);
    expect(doc.legend?.position).toBe('tr');
    expect(doc.workspaceRevision).toBe(1);
    // Unloaded after the call — the session store keeps no copy.
    expect(retained).not.toContain('t3');
  });

  it('render_svg / validate_topology / inspect_render / export_flipbook / describe_capabilities are served too', async () => {
    const svg = (await tool('render_svg', { topologyId: 't3' })).result;
    expect(svg.isError).toBeUndefined();
    expect(svg.content[0]!.text.startsWith('<svg')).toBe(true);
    expect(svg.content[0]!.text).toContain('<!-- workspace revision 1 -->');
    expect(svg.content[0]!.text).toContain('<title>Shared draft</title>');

    for (const name of [
      'validate_topology',
      'inspect_render',
      'describe_capabilities',
    ]) {
      const { result } = await tool(name, { topologyId: 't3' });
      expect(result.isError, name).toBeUndefined();
      const body = JSON.parse(result.content[0]!.text) as {
        workspaceRevision: number;
      };
      expect(body.workspaceRevision, name).toBe(1);
    }

    const flipbook = (await tool('export_flipbook', { topologyId: 't3' }))
      .result;
    expect(flipbook.isError).toBeUndefined();
    expect(
      flipbook.content[0]!.text.startsWith(
        '<!doctype html><!-- workspace revision 1 -->',
      ),
    ).toBe(true);
  });

  it('a mutating tool is still refused and points at both paths', async () => {
    const { result } = await tool('set_document_title', {
      topologyId: 't3',
      title: 'Renamed by agent',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain(
      'topology "t3" is now a shared workspace',
    );
    expect(result.content[0]!.text).toContain('get_topology');
    expect(result.content[0]!.text).toContain('propose_workspace_changes');
  });

  it('never writes the workspace snapshot back to the legacy registry', async () => {
    const before = await legacyRaw('t3');
    expect(before.login).not.toBeNull();
    expect(JSON.parse(before.login!).title).toBe('Legacy draft');

    await tool('get_topology', { topologyId: 't3' });
    await tool('render_svg', { topologyId: 't3' });
    // A legacy mutation elsewhere in the session triggers persistAfter;
    // the migrated id must not ride along.
    const created = await tool('create_topology', { title: 'Scratch' });
    expect(created.result.isError).toBeUndefined();

    const after = await legacyRaw('t3');
    expect(after).toEqual(before);
    for (const raw of [after.login, after.uid])
      if (raw !== null) expect(JSON.parse(raw).title).toBe('Legacy draft');
  });

  it('get_workspace_document round-trips layers, legend and custom nodes', async () => {
    const { result, retained } = await tool('get_workspace_document', {
      workspaceId: 't3',
    });
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0]!.text) as {
      id: string;
      revision: number;
      document: {
        title: string;
        layers?: unknown;
        legend?: unknown;
        customNodes: unknown[];
        pages: { id: string }[];
      };
    };
    expect(body.id).toBe('t3');
    expect(body.revision).toBe(1);
    expect(body.document.title).toBe('Shared draft');
    expect(body.document.layers).toEqual([{ id: 'overlay', name: 'Overlay' }]);
    expect(body.document.legend).toEqual({ show: true, position: 'tr' });
    expect(body.document.customNodes).toEqual([]);
    expect(body.document.pages.map((p) => p.id)).toEqual(['p1']);
    expect(retained).not.toContain('t3');
  });

  it('get_workspace_document still rejects a legacy draft without migrating it', async () => {
    await seed('t4');
    const { result } = await tool('get_workspace_document', {
      workspaceId: 't4',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('legacy draft');
    expect((await call('migrated', { id: 't4', mode: 'agent' })).body).toEqual({
      migrated: false,
    });
  });
});
