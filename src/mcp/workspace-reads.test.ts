/**
 * Issue #276: read-only document tools on a shared workspace.
 *
 * Pins the allowlist against the real tool surface, keeps it disjoint from
 * the worker's legacy persist path (so a workspace snapshot loaded for one
 * call can never be written back to the per-user registry), and checks the
 * per-call load/unload routine plus the revision stamping — all without the
 * `TopologyMcp` Durable Object.
 */
import { describe, expect, it } from 'vitest';
import { TopologyStore } from './store.js';
import { createTools } from './tools.js';
import { MUTATING_MCP_TOOLS, SHARE_MCP_TOOL } from './rate-limit.js';
import {
  WORKSPACE_READ_TOOLS,
  isWorkspaceReadTool,
  migratedTopologyRefusal,
  serveWorkspaceRead,
  withWorkspaceRevision,
} from './workspace-reads.js';
import { NO_LEGACY_PERSIST_TOOLS } from '../../worker/legacy-persist.js';
import { renderDocumentToSVG } from '../server/render.js';
import { nodeCatalogLoader } from '../server/catalog.js';
import { exportFlipbookHTML } from '../render/flipbook.js';
import type { TopologyDocument } from '../pages/model.js';

function document(title = 'Shared'): TopologyDocument {
  return {
    title,
    customNodes: [],
    layers: [{ id: 'underlay', name: 'Underlay' }],
    legend: { show: true, position: 'br' },
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

describe('WORKSPACE_READ_TOOLS — the allowlist', () => {
  const toolNames = new Set(
    createTools(new TopologyStore(), {
      renderDocument: renderDocumentToSVG,
      catalog: nodeCatalogLoader(),
    }).map((t) => t.name),
  );

  it('names only tools that exist in createTools', () => {
    for (const name of WORKSPACE_READ_TOOLS)
      expect(toolNames.has(name)).toBe(true);
  });

  it('is disjoint from the legacy persist-after path', () => {
    // Every allowlisted tool must be skipped by TopologyMcp.persistAfter;
    // otherwise a snapshot loaded for the call could be persisted back into
    // the stale legacy copy of a migrated topology.
    for (const name of WORKSPACE_READ_TOOLS)
      expect(NO_LEGACY_PERSIST_TOOLS.has(name)).toBe(true);
  });

  it('contains no quota’d (mutating or publishing) tool', () => {
    for (const name of WORKSPACE_READ_TOOLS) {
      expect(MUTATING_MCP_TOOLS.has(name)).toBe(false);
      expect(name).not.toBe(SHARE_MCP_TOOL);
    }
  });

  it('isWorkspaceReadTool answers for members and non-members', () => {
    expect(isWorkspaceReadTool('get_topology')).toBe(true);
    expect(isWorkspaceReadTool('render_svg')).toBe(true);
    expect(isWorkspaceReadTool('add_node')).toBe(false);
    expect(isWorkspaceReadTool('share_topology')).toBe(false);
    expect(isWorkspaceReadTool('edit_topology')).toBe(false);
  });

  it('the refusal names the read and write paths', () => {
    const text = migratedTopologyRefusal('t1');
    expect(text).toContain('topology "t1" is now a shared workspace');
    for (const name of WORKSPACE_READ_TOOLS) expect(text).toContain(name);
    expect(text).toContain('propose_workspace_changes');
    expect(text).toContain('get_workspace_document');
  });
});

describe('serveWorkspaceRead', () => {
  it('loads the snapshot for the call and unloads it on release', async () => {
    const store = new TopologyStore();
    const calls: string[] = [];
    const context = await serveWorkspaceRead('get_topology', 't1', store, {
      snapshot: async (id) => {
        calls.push(id);
        return { revision: 7, document: document('From coordinator') };
      },
    });
    expect(calls).toEqual(['t1']);
    expect(context.workspaceRevision).toBe(7);
    expect(store.get('t1').title).toBe('From coordinator');
    expect(store.list().map((d) => d.id)).toEqual(['t1']);

    await context.release?.();
    expect(() => store.get('t1')).toThrow(/unknown topology/);
    // An unload is not a deletion: nothing is queued for the persist path.
    expect(store.drainPendingDeletes()).toEqual([]);
  });

  it('refuses a mutating tool without touching the coordinator or the store', async () => {
    const store = new TopologyStore();
    let fetched = 0;
    await expect(
      serveWorkspaceRead('add_node', 't1', store, {
        snapshot: async () => {
          fetched++;
          return { revision: 1, document: document() };
        },
      }),
    ).rejects.toThrow(/topology "t1" is now a shared workspace/);
    expect(fetched).toBe(0);
    expect(store.list()).toEqual([]);
  });

  it('says which tool and workspace failed when the snapshot cannot be read', async () => {
    const store = new TopologyStore();
    await expect(
      serveWorkspaceRead('render_svg', 'w9', store, {
        snapshot: async () => {
          throw new Error('directory entry is incomplete');
        },
      }),
    ).rejects.toThrow(
      'render_svg could not read shared workspace "w9": directory entry is incomplete',
    );
    expect(store.list()).toEqual([]);
  });
});

describe('withWorkspaceRevision', () => {
  it('stamps a JSON object without mutating the original', () => {
    const doc = document();
    const stamped = withWorkspaceRevision(doc, 3) as Record<string, unknown>;
    expect(stamped.workspaceRevision).toBe(3);
    expect(stamped.title).toBe('Shared');
    expect('workspaceRevision' in doc).toBe(false);
  });

  it('puts the revision comment inside a rendered SVG, after the opening tag', () => {
    const svg = renderDocumentToSVG(document(), 0);
    const stamped = withWorkspaceRevision(svg, 12) as string;
    expect(stamped.startsWith('<svg')).toBe(true);
    const open = /^<svg\b[^>]*>/.exec(stamped)![0];
    expect(stamped.slice(open.length)).toMatch(
      /^<!-- workspace revision 12 -->/,
    );
    expect(stamped.length).toBe(
      svg.length + '<!-- workspace revision 12 -->'.length,
    );
  });

  it('puts the revision comment after a flipbook doctype', () => {
    const html = exportFlipbookHTML(document(), (doc, i) =>
      renderDocumentToSVG(doc, i),
    );
    const stamped = withWorkspaceRevision(html, 4) as string;
    expect(
      stamped.startsWith('<!doctype html><!-- workspace revision 4 -->'),
    ).toBe(true);
  });

  it('leaves arrays and unrecognised strings alone', () => {
    expect(withWorkspaceRevision([1, 2], 1)).toEqual([1, 2]);
    expect(withWorkspaceRevision('plain text', 1)).toBe('plain text');
    expect(withWorkspaceRevision(null, 1)).toBeNull();
  });
});
