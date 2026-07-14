/**
 * Characterization tests for the Agent Workspace panel (Packet R0).
 *
 * `main.ts` never exported its render logic and boots a real DOM as a side
 * effect of module load (`document.getElementById('app')!.innerHTML = …`),
 * so it cannot be imported under the repo's Node test environment (no
 * jsdom/happy-dom dependency is installed — see `vite.config.ts`
 * `test.environment: 'node'`). Per the architecture/refactor workflow
 * template ("characterize at the HTML-string level" when full DOM testing
 * is impractical without adding dependencies), these tests exercise the
 * pure render/state helpers `mountWorkspacePanel` builds its DOM writes
 * from: `computeWorkspaceChipState`, `renderWorkspaceDisabledHtml`,
 * `renderWorkspaceChoicesHtml`, and `renderActiveWorkspaceHtml`. Every
 * template literal in those helpers is a verbatim copy of what used to be
 * inline in `main.ts`'s `updateWorkspaceChip()` / `renderWorkspacePanel()`
 * (see git history on `src/main.ts` prior to this packet) — the same test
 * file was run against a throwaway copy of the pre-move inline logic and
 * against this module with identical results (see the packet's validation
 * notes for both outputs).
 */
import { describe, expect, it } from 'vitest';
import {
  computeWorkspaceChipState,
  renderActiveWorkspaceHtml,
  renderChangedElementOverlay,
  renderProposalPreviewErrorHtml,
  renderProposalPreviewHtml,
  renderWorkspaceChoicesHtml,
  renderWorkspaceDisabledHtml,
  type ActiveWorkspace,
  type RenderedPreviewFrame,
} from './workspace-panel.js';
import type {
  ProposalSummary,
  WorkspaceListItem,
  WorkspaceManifest,
} from '../workspace/model.js';
import type { Page, TopologyDocument } from '../pages/model.js';

const BLANK_DOC: TopologyDocument = {
  title: 'Untitled',
  pages: [],
  customNodes: [],
};

function activeWorkspace(
  overrides: Partial<ActiveWorkspace> = {},
): ActiveWorkspace {
  return {
    id: 'ws_abc123',
    revision: 7,
    lastSynced: BLANK_DOC,
    manifest: null,
    proposals: [],
    pending: null,
    pendingTarget: null,
    syncing: false,
    paused: false,
    status: 'synced',
    error: null,
    ...overrides,
  };
}

function manifest(
  overrides: Partial<WorkspaceManifest> = {},
): WorkspaceManifest {
  return {
    id: 'ws_abc123',
    title: 'Untitled',
    revision: 7,
    operationSchemaRevision: 1,
    historyFloor: 0,
    updatedAt: '2026-07-13T00:00:00.000Z',
    pages: [],
    lease: null,
    pendingProposals: 0,
    ...overrides,
  };
}

function proposal(overrides: Partial<ProposalSummary> = {}): ProposalSummary {
  return {
    id: 'prop_1',
    title: 'Add a load balancer',
    baseRevision: 7,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    createdBy: { kind: 'agent', id: 'agent-1' },
    status: 'pending',
    summary: {
      count: 2,
      byType: { 'element.add': 2 },
      affectedPageIds: ['p1'],
      affectedElementIds: ['n1', 'n2'],
      descriptions: ['add node lb-1', 'add link app-1 -> lb-1'],
    },
    ...overrides,
  };
}

describe('computeWorkspaceChipState', () => {
  // "Signed-out/hidden" characterization: the chip's static markup in
  // main.ts defaults to the same "no workspace" label/title this function
  // computes for `null` — enableWorkspaceUi() only reveals the chip, it
  // never changes this computed state until a workspace becomes active.
  it('shows the local/off state when there is no active workspace', () => {
    expect(computeWorkspaceChipState(null)).toEqual({
      on: false,
      conflict: false,
      label: 'agent · local',
      title: 'Hand this local document to an agent workspace',
    });
  });

  it('shows the revision label and workspace id/status title when active', () => {
    const state = computeWorkspaceChipState(
      activeWorkspace({ id: 'ws_xyz', revision: 3, status: 'synced' }),
    );
    expect(state).toEqual({
      on: true,
      conflict: false,
      label: 'agent · r3',
      title: 'ws_xyz · synced',
    });
  });

  it('flags conflict styling only when the workspace carries an error', () => {
    const state = computeWorkspaceChipState(
      activeWorkspace({ error: 'stale revision' }),
    );
    expect(state.on).toBe(true);
    expect(state.conflict).toBe(true);
  });
});

describe('renderWorkspaceDisabledHtml', () => {
  it('renders the disabled notice with a re-check action', () => {
    const html = renderWorkspaceDisabledHtml();
    expect(html).toContain('Workspaces are not enabled on this deployment.');
    expect(html).toContain(
      'The agent workspace surface is turned off for this deployment.',
    );
    expect(html).toContain('id="wsRefreshList"');
    expect(html).not.toContain('wsHandoff');
  });
});

describe('renderWorkspaceChoicesHtml', () => {
  it('renders the handoff card with no existing-workspaces section when empty', () => {
    const html = renderWorkspaceChoicesHtml([]);
    expect(html).toContain('Hand this document to the canonical workspace');
    expect(html).toContain('id="wsHandoff"');
    expect(html).toContain('id="wsRefreshList"');
    expect(html).not.toContain('Existing workspaces');
    expect(html).not.toContain('ws-open');
  });

  it('lists migrated and legacy workspace choices with escaped titles', () => {
    const choices: WorkspaceListItem[] = [
      {
        id: 'ws_1',
        title: 'Prod <topology>',
        pages: 3,
        revision: 12,
        migrated: true,
      },
      {
        id: 'ws_2',
        title: 'Legacy draft',
        pages: 1,
        revision: null,
        migrated: false,
      },
    ];
    const html = renderWorkspaceChoicesHtml(choices);
    expect(html).toContain('Existing workspaces');
    expect(html).toContain('Prod &lt;topology&gt;');
    expect(html).toContain('data-wid="ws_1"');
    expect(html).toContain('r12');
    expect(html).toContain('data-wid="ws_2"');
    expect(html).toContain('legacy · migrates on open');
    expect(html).toContain('3 pages');
    expect(html).toContain('1 page ·');
  });

  it('caps the rendered list at 20 entries', () => {
    const choices: WorkspaceListItem[] = Array.from({ length: 25 }, (_, i) => ({
      id: `ws_${i}`,
      title: `Workspace ${i}`,
      pages: 1,
      revision: i,
      migrated: true,
    }));
    const html = renderWorkspaceChoicesHtml(choices);
    expect((html.match(/ws-open/g) ?? []).length).toBe(20);
  });
});

describe('renderActiveWorkspaceHtml', () => {
  it('renders revision/status and omits the resume action when not paused', () => {
    const html = renderActiveWorkspaceHtml(
      activeWorkspace({ id: 'ws_abc123', revision: 5, status: 'synced' }),
    );
    expect(html).toContain('ws_abc123');
    expect(html).toContain('r5');
    expect(html).toContain('ws-v">synced</span>');
    expect(html).not.toContain('id="wsResume"');
    expect(html).not.toContain('ws-error');
  });

  it('shows the sync-local-copy action and no error block when paused without error', () => {
    const html = renderActiveWorkspaceHtml(activeWorkspace({ paused: true }));
    expect(html).toContain('id="wsResume"');
    expect(html).toContain('Sync local copy');
  });

  it('surfaces the conflict error message when the workspace has one', () => {
    const html = renderActiveWorkspaceHtml(
      activeWorkspace({
        paused: true,
        error: 'Revision conflict: rebase required',
      }),
    );
    expect(html).toContain('ws-error');
    expect(html).toContain('Revision conflict: rebase required');
  });

  it('shows "no lease" and the grant action when there is no live lease', () => {
    const html = renderActiveWorkspaceHtml(
      activeWorkspace({ manifest: manifest() }),
    );
    expect(html).toContain('No lease. Agent changes must be proposals.');
    expect(html).toContain('id="wsLease"');
    expect(html).not.toContain('id="wsRevoke"');
  });

  it('shows the live-lease notice and the revoke action when a lease has not expired', () => {
    const html = renderActiveWorkspaceHtml(
      activeWorkspace({
        manifest: manifest({
          lease: {
            id: 'lease_1',
            scope: { kind: 'page', pageId: 'p1' },
            grantedBy: { kind: 'user', id: 'u1' },
            grantedAt: '2026-07-13T00:00:00.000Z',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        }),
      }),
    );
    expect(html).toContain('Direct agent edits allowed only on page p1');
    expect(html).toContain('id="wsRevoke"');
    expect(html).not.toContain('id="wsLease"');
  });

  it('treats an expired lease as no lease', () => {
    const html = renderActiveWorkspaceHtml(
      activeWorkspace({
        manifest: manifest({
          lease: {
            id: 'lease_1',
            scope: { kind: 'page', pageId: 'p1' },
            grantedBy: { kind: 'user', id: 'u1' },
            grantedAt: '2026-07-13T00:00:00.000Z',
            expiresAt: new Date(Date.now() - 1_000).toISOString(),
          },
        }),
      }),
    );
    expect(html).toContain('No lease. Agent changes must be proposals.');
    expect(html).toContain('id="wsLease"');
  });

  it('renders the empty state when there are no proposals', () => {
    const html = renderActiveWorkspaceHtml(activeWorkspace({ proposals: [] }));
    expect(html).toContain('No pending agent proposals.');
    expect(html).toContain('Proposals (0)');
  });

  it('renders a pending proposal card with rationale, ops, and accept/reject actions', () => {
    const html = renderActiveWorkspaceHtml(
      activeWorkspace({
        proposals: [
          proposal({
            id: 'prop_pending',
            rationale: 'Improves redundancy',
            status: 'pending',
          }),
        ],
      }),
    );
    expect(html).toContain('data-proposal="prop_pending"');
    expect(html).toContain('Add a load balancer');
    expect(html).toContain('Improves redundancy');
    expect(html).toContain('2 operations');
    expect(html).toContain('base r7');
    expect(html).toContain('· pending</div>');
    expect(html).toContain('add node lb-1');
    expect(html).toContain('data-pid="prop_pending"');
    expect(html).toContain('ws-accept');
    expect(html).toContain('ws-reject');
    expect(html).toContain('Proposals (1)');
  });

  it('renders a conflicted proposal card without a rationale block', () => {
    const html = renderActiveWorkspaceHtml(
      activeWorkspace({
        proposals: [
          proposal({
            id: 'prop_conflicted',
            status: 'conflicted',
            rationale: undefined,
          }),
        ],
      }),
    );
    expect(html).toContain('data-proposal="prop_conflicted"');
    expect(html).toContain('· conflicted</div>');
  });

  it('renders a selectable checkbox per operation (checked) plus accept-selected', () => {
    const html = renderActiveWorkspaceHtml(
      activeWorkspace({
        proposals: [
          proposal({
            summary: {
              count: 12,
              byType: { 'element.add': 12 },
              affectedPageIds: ['p1'],
              affectedElementIds: [],
              descriptions: Array.from({ length: 12 }, (_, i) => `op ${i}`),
            },
          }),
        ],
      }),
    );
    expect((html.match(/class="ws-op-check"/g) ?? []).length).toBe(12);
    expect(html).toContain('data-op-index="0"');
    expect(html).toContain('data-op-index="11"');
    expect(html).toContain('ws-accept-selected');
    expect(html).toContain('Accept all');
  });

  it('notes operations beyond the listed first 100', () => {
    const html = renderActiveWorkspaceHtml(
      activeWorkspace({
        proposals: [
          proposal({
            summary: {
              count: 150,
              byType: { 'element.add': 150 },
              affectedPageIds: ['p1'],
              affectedElementIds: [],
              descriptions: Array.from({ length: 100 }, (_, i) => `op ${i}`),
            },
          }),
        ],
      }),
    );
    expect((html.match(/class="ws-op-check"/g) ?? []).length).toBe(100);
    expect(html).toContain('and 50 more');
  });

  it('escapes untrusted text in status/error/proposal fields', () => {
    const html = renderActiveWorkspaceHtml(
      activeWorkspace({
        status: '<script>alert(1)</script>',
        proposals: [proposal({ title: '<b>bold</b> title' })],
      }),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt; title');
  });

  it('renders a collapsed Preview toggle and container for each proposal (Packet R1)', () => {
    const html = renderActiveWorkspaceHtml(
      activeWorkspace({
        proposals: [proposal({ id: 'prop_pending' })],
      }),
    );
    expect(html).toContain('ws-preview-toggle');
    expect(html).toContain('data-pid="prop_pending"');
    expect(html).toMatch(
      /<div class="ws-preview" data-pid="prop_pending" hidden><\/div>/,
    );
  });
});

describe('renderChangedElementOverlay', () => {
  function page(): Page {
    return {
      id: 'p1',
      name: 'Frame 1',
      viewBox: '0 0 1050 700',
      nodes: [{ id: 'n1', type: 'ec', x: 100, y: 200, label: 'A' }],
      links: [{ id: 'l1', type: 'line', from: 'n1', to: 'n1' }],
      anchors: [],
      zones: [],
      flowPaths: [],
      policyMarkers: [],
    };
  }

  it('draws a highlight rect for a changed node id, offset by the node AABB + padding', () => {
    const svg = renderChangedElementOverlay(page(), ['n1']);
    expect(svg).toContain('<g class="ws-preview-highlight">');
    expect(svg).toContain('class="ws-preview-highlight-rect"');
    // ec half-extent is 28x18 (api/geometry.ts) plus 6px padding each side.
    expect(svg).toContain('x="66"');
    expect(svg).toContain('y="176"');
    expect(svg).toContain('width="68"');
    expect(svg).toContain('height="48"');
  });

  it('draws nothing for a changed id that is not a node (e.g. a link)', () => {
    expect(renderChangedElementOverlay(page(), ['l1'])).toBe('');
  });

  it('draws nothing for an empty change list', () => {
    expect(renderChangedElementOverlay(page(), [])).toBe('');
  });

  it('only draws rects for ids that resolve to a node, skipping unknown ids', () => {
    const svg = renderChangedElementOverlay(page(), ['n1', 'ghost']);
    expect((svg.match(/<rect/g) ?? []).length).toBe(1);
  });
});

describe('renderProposalPreviewHtml', () => {
  it('falls back to a summary-only note when no page was affected (document.patch-only)', () => {
    const html = renderProposalPreviewHtml([], 0);
    expect(html).toContain('No page-level preview for this proposal');
    expect(html).toContain('operation list above');
  });

  it('renders before/after frames with page names for each shown page', () => {
    const frames: RenderedPreviewFrame[] = [
      {
        pageId: 'p1',
        pageName: 'Frame <1>',
        beforeSvg: '<svg data-mock="before"></svg>',
        afterSvg: '<svg data-mock="after"></svg>',
      },
    ];
    const html = renderProposalPreviewHtml(frames, 1);
    expect(html).toContain('Frame &lt;1&gt;');
    expect(html).toContain('Before');
    expect(html).toContain('After');
    expect(html).toContain('data-mock="before"');
    expect(html).toContain('data-mock="after"');
    expect(html).not.toContain('more page');
  });

  it('shows "New page" when before is null and "Page removed" when after is null', () => {
    const frames: RenderedPreviewFrame[] = [
      {
        pageId: 'p1',
        pageName: 'Added',
        beforeSvg: null,
        afterSvg: '<svg></svg>',
      },
      {
        pageId: 'p2',
        pageName: 'Removed',
        beforeSvg: '<svg></svg>',
        afterSvg: null,
      },
    ];
    const html = renderProposalPreviewHtml(frames, 2);
    expect(html).toContain('New page');
    expect(html).toContain('Page removed');
  });

  it('notes the remainder when totalAffected exceeds the shown (capped) pages', () => {
    const frames: RenderedPreviewFrame[] = [
      { pageId: 'p1', pageName: 'A', beforeSvg: null, afterSvg: null },
      { pageId: 'p2', pageName: 'B', beforeSvg: null, afterSvg: null },
      { pageId: 'p3', pageName: 'C', beforeSvg: null, afterSvg: null },
    ];
    const html = renderProposalPreviewHtml(frames, 5);
    expect(html).toContain('+2 more pages affected');
  });

  it('uses singular phrasing for exactly one remaining page', () => {
    const frames: RenderedPreviewFrame[] = [
      { pageId: 'p1', pageName: 'A', beforeSvg: null, afterSvg: null },
    ];
    const html = renderProposalPreviewHtml(frames, 2);
    expect(html).toContain('+1 more page affected');
  });
});

describe('renderProposalPreviewErrorHtml', () => {
  it('surfaces an escaped error message without blocking accept/reject', () => {
    const html = renderProposalPreviewErrorHtml('<script>x</script> failed');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; failed');
    expect(html).toContain('Preview unavailable');
  });
});
