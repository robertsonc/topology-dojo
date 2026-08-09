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
  computeChipAnnouncement,
  computeWorkspaceChipState,
  computeWorkspacePanelState,
  renderActiveWorkspaceHtml,
  renderChangedElementOverlay,
  renderCheckpointsHtml,
  renderOfflineStatusHtml,
  renderTimelineHtml,
  renderPresenceHtml,
  renderProposalPreviewErrorHtml,
  renderProposalPreviewHtml,
  renderWorkspaceChoicesHtml,
  renderWorkspaceDisabledHtml,
  type ActiveWorkspace,
  type ChangeSummary,
  type RenderedPreviewFrame,
  type WorkspacePanelState,
} from './workspace-panel.js';
import { computeProposalPreview } from '../workspace/preview.js';
import type {
  ChangesResult,
  CheckpointSummary,
  CommitRequest,
  ProposalSummary,
  WorkspaceListItem,
  WorkspaceManifest,
  WorkspaceOperation,
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
    checkpoints: [],
    timeline: null,
    presence: [],
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

  // Issue #212: the chip surfaces attention states as explicit text.
  it('labels pending proposals with an explicit count', () => {
    expect(
      computeWorkspaceChipState(
        activeWorkspace({ manifest: manifest({ pendingProposals: 2 }) }),
      ).label,
    ).toBe('agent · 2 proposals');
    expect(
      computeWorkspaceChipState(
        activeWorkspace({ manifest: manifest({ pendingProposals: 1 }) }),
      ).label,
    ).toBe('agent · 1 proposal');
  });

  it('labels a conflict as text, taking precedence over pending proposals', () => {
    const state = computeWorkspaceChipState(
      activeWorkspace({
        error: 'Revision conflict: rebase required',
        manifest: manifest({ pendingProposals: 2 }),
      }),
    );
    expect(state.label).toBe('agent · conflict');
    expect(state.conflict).toBe(true);
  });

  it('labels offline with queued operations, but stays quiet offline with none', () => {
    const pending: CommitRequest = {
      baseRevision: 7,
      operationId: 'ui_x',
      operations: [
        { type: 'page.patch', pageId: 'p1', patch: { set: { name: 'x' } } },
        { type: 'page.patch', pageId: 'p1', patch: { set: { name: 'y' } } },
        { type: 'page.patch', pageId: 'p1', patch: { set: { name: 'z' } } },
      ],
    };
    expect(
      computeWorkspaceChipState(activeWorkspace({ pending }), false).label,
    ).toBe('agent · offline · 3 pending');
    expect(computeWorkspaceChipState(activeWorkspace(), false).label).toBe(
      'agent · r7',
    );
  });

  it('keeps the plain revision label when quiet', () => {
    expect(
      computeWorkspaceChipState(
        activeWorkspace({ manifest: manifest({ pendingProposals: 0 }) }),
        true,
      ).label,
    ).toBe('agent · r7');
  });
});

describe('computeChipAnnouncement (issue #212)', () => {
  const state = (
    over: Partial<WorkspacePanelState> = {},
  ): WorkspacePanelState => ({
    active: true,
    revision: 7,
    pendingProposals: 0,
    conflict: false,
    offline: false,
    pendingOps: 0,
    error: null,
    ...over,
  });

  it('announces nothing for an unchanged quiet state (poll refresh)', () => {
    expect(computeChipAnnouncement(state(), state())).toBeNull();
    expect(computeChipAnnouncement(null, state())).toBeNull();
  });

  it('announces nothing when only the revision advances', () => {
    expect(
      computeChipAnnouncement(state({ revision: 7 }), state({ revision: 9 })),
    ).toBeNull();
  });

  it('announces a proposal-count transition, including the first snapshot', () => {
    expect(
      computeChipAnnouncement(state(), state({ pendingProposals: 2 })),
    ).toBe('2 agent proposals awaiting review.');
    expect(computeChipAnnouncement(null, state({ pendingProposals: 1 }))).toBe(
      '1 agent proposal awaiting review.',
    );
  });

  it('announces a further proposal arriving but not an unchanged count', () => {
    expect(
      computeChipAnnouncement(
        state({ pendingProposals: 1 }),
        state({ pendingProposals: 2 }),
      ),
    ).toBe('2 agent proposals awaiting review.');
    expect(
      computeChipAnnouncement(
        state({ pendingProposals: 2 }),
        state({ pendingProposals: 2, revision: 9 }),
      ),
    ).toBeNull();
  });

  it('announces entering conflict once, with priority over proposals', () => {
    expect(
      computeChipAnnouncement(
        state(),
        state({ conflict: true, error: 'x', pendingProposals: 2 }),
      ),
    ).toBe('Agent workspace conflict — attention needed.');
    expect(
      computeChipAnnouncement(
        state({ conflict: true, error: 'x' }),
        state({ conflict: true, error: 'x', pendingOps: 1 }),
      ),
    ).toBeNull();
  });

  it('announces going offline with queued ops, and not on later op-count churn', () => {
    expect(
      computeChipAnnouncement(state(), state({ offline: true, pendingOps: 2 })),
    ).toBe('Workspace offline — 2 changes pending sync.');
    expect(
      computeChipAnnouncement(
        state({ offline: true, pendingOps: 2 }),
        state({ offline: true, pendingOps: 5 }),
      ),
    ).toBeNull();
  });

  it('announces nothing when returning to quiet', () => {
    expect(
      computeChipAnnouncement(state({ conflict: true, error: 'x' }), state()),
    ).toBeNull();
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

  it('renders each operation description as a locate-in-preview button (issue #213)', () => {
    const html = renderActiveWorkspaceHtml(
      activeWorkspace({ proposals: [proposal({ id: 'prop_pending' })] }),
    );
    expect((html.match(/class="ws-op-jump"/g) ?? []).length).toBe(2);
    expect(html).toContain(
      '<button type="button" class="ws-op-jump" data-pid="prop_pending" data-op-index="0"',
    );
    expect(html).toContain('add node lb-1</button>');
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

describe('renderCheckpointsHtml', () => {
  const checkpoint = (
    over: Partial<CheckpointSummary> = {},
  ): CheckpointSummary => ({
    id: 'cp_1',
    name: 'Before refactor',
    createdBy: { kind: 'agent', id: 'a1' },
    createdAt: '2026-01-01T00:00:00.000Z',
    revision: 5,
    pageCount: 2,
    ...over,
  });

  it('shows a create row and an empty state with no checkpoints', () => {
    const html = renderCheckpointsHtml(activeWorkspace({ checkpoints: [] }));
    expect(html).toContain('Checkpoints (0/12)');
    expect(html).toContain('id="wsCheckpointCreate"');
    expect(html).toContain('No checkpoints yet.');
  });

  it('lists checkpoints with restore/fork/delete actions', () => {
    const html = renderCheckpointsHtml(
      activeWorkspace({
        checkpoints: [
          checkpoint(),
          checkpoint({ id: 'cp_2', name: 'v2', pageCount: 1 }),
        ],
      }),
    );
    expect(html).toContain('Checkpoints (2/12)');
    expect(html).toContain('data-cid="cp_1"');
    expect(html).toContain('data-cid="cp_2"');
    expect(html).toContain('ws-cp-restore');
    expect(html).toContain('ws-cp-fork');
    expect(html).toContain('ws-cp-delete');
    expect(html).toContain('r5 · 2 pages · agent');
    expect(html).toContain('1 page ·'); // singular
  });

  it('disables creation at the cap of 12', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      checkpoint({ id: `cp_${i}` }),
    );
    const html = renderCheckpointsHtml(activeWorkspace({ checkpoints: many }));
    expect(html).toContain('Checkpoints (12/12)');
    expect(html).toContain('disabled');
    expect(html).toContain('Checkpoint limit reached');
  });

  it('escapes untrusted checkpoint names', () => {
    const html = renderCheckpointsHtml(
      activeWorkspace({ checkpoints: [checkpoint({ name: '<img src=x>' })] }),
    );
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
  });
});

describe('renderTimelineHtml', () => {
  const change = (over: Partial<ChangeSummary> = {}): ChangeSummary => ({
    revision: 1,
    baseRevision: 0,
    operationId: 'op1',
    actor: { kind: 'user', id: 'u1' },
    source: 'ui',
    createdAt: '2026-01-01T00:00:00.000Z',
    summary: {
      count: 1,
      byType: {},
      affectedPageIds: [],
      affectedElementIds: [],
      descriptions: ['Update x'],
    },
    ...over,
  });
  const timeline = (
    changes: ChangeSummary[],
    over: Partial<ChangesResult> = {},
  ): ChangesResult => ({
    revision: changes.length ? Math.max(...changes.map((c) => c.revision)) : 0,
    historyFloor: 0,
    checkpointRequired: false,
    changes,
    nextRevision: null,
    ...over,
  });

  it('shows an empty state with no change log', () => {
    expect(renderTimelineHtml(activeWorkspace({ timeline: null }))).toContain(
      'No revisions yet.',
    );
    expect(
      renderTimelineHtml(activeWorkspace({ timeline: timeline([]) })),
    ).toContain('No revisions yet.');
  });

  it('renders revisions newest-first with actor, op count, and a source badge', () => {
    const html = renderTimelineHtml(
      activeWorkspace({
        timeline: timeline([
          change({ revision: 1 }),
          change({
            revision: 2,
            actor: { kind: 'agent', id: 'a1', label: 'Claude' },
            summary: {
              count: 3,
              byType: {},
              affectedPageIds: [],
              affectedElementIds: [],
              descriptions: ['Add node'],
            },
          }),
        ]),
      }),
    );
    expect(html).toContain('Timeline (r2)');
    // Newest (r2) appears before r1.
    expect(html.indexOf('r2')).toBeLessThan(html.indexOf('r1'));
    expect(html).toContain('Claude');
    expect(html).toContain('3 ops');
    expect(html).toContain('1 op ·');
  });

  it('marks accepted proposals and restore revisions', () => {
    const html = renderTimelineHtml(
      activeWorkspace({
        timeline: timeline([
          change({ revision: 1, source: 'proposal', proposalId: 'prop_1' }),
          change({ revision: 2, source: 'restore' }),
        ]),
      }),
    );
    expect(html).toContain('✓ accepted proposal');
    expect(html).toContain('ws-src-restore');
    expect(html).toContain('ws-src-proposal');
  });

  it('attaches checkpoint markers at their revision and notes the history floor', () => {
    const html = renderTimelineHtml(
      activeWorkspace({
        checkpoints: [
          {
            id: 'cp1',
            name: 'Baseline',
            createdBy: { kind: 'user', id: 'u1' },
            createdAt: '2026-01-01T00:00:00.000Z',
            revision: 2,
            pageCount: 1,
          },
        ],
        timeline: timeline([change({ revision: 2 })], { historyFloor: 5 }),
      }),
    );
    expect(html).toContain('◈ checkpoint “Baseline”');
    expect(html).toContain('Older revisions compacted (floor r5)');
  });

  it('escapes untrusted actor labels and descriptions', () => {
    const html = renderTimelineHtml(
      activeWorkspace({
        timeline: timeline([
          change({
            actor: { kind: 'agent', id: 'a', label: '<b>x</b>' },
            summary: {
              count: 1,
              byType: {},
              affectedPageIds: [],
              affectedElementIds: [],
              descriptions: ['<img src=y>'],
            },
          }),
        ]),
      }),
    );
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('<img src=y>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('renderChangedElementOverlay', () => {
  /** Two ec nodes, a link, an anchor, a zone, a flow path, and a marker —
   * every visible element kind with hand-checkable coordinates. */
  function page(): Page {
    return {
      id: 'p1',
      name: 'Frame 1',
      viewBox: '0 0 1050 700',
      nodes: [
        { id: 'n1', type: 'ec', x: 100, y: 200, label: 'A' },
        { id: 'n2', type: 'ec', x: 300, y: 200, label: 'B' },
      ],
      links: [{ id: 'l1', type: 'line', from: 'n1', to: 'n2' }],
      anchors: [{ id: 'a1', x: 500, y: 300 }],
      zones: [{ id: 'z1', nodes: ['n1', 'n2'], label: 'Z' }],
      flowPaths: [{ id: 'f1', waypoints: ['n1', 'a1'], label: 'F' }],
      policyMarkers: [{ id: 'pm1', nodeId: 'n1', type: 'inspect' }],
    };
  }
  const modified = (elementId: string, kind: string) =>
    [{ elementId, kind, change: 'modified' }] as Parameters<
      typeof renderChangedElementOverlay
    >[1];

  it('draws a highlight rect for a changed node, offset by the node AABB + padding', () => {
    const svg = renderChangedElementOverlay(
      page(),
      modified('n1', 'nodes'),
      'after',
    );
    expect(svg).toContain('<g class="ws-preview-highlight">');
    expect(svg).toContain('ws-hl-node');
    expect(svg).toContain('data-el="n1"');
    // ec half-extent is 28x18 (api/geometry.ts) plus 6px padding each side.
    expect(svg).toContain('x="66"');
    expect(svg).toContain('y="176"');
    expect(svg).toContain('width="68"');
    expect(svg).toContain('height="48"');
  });

  it('draws a halo polyline through the endpoint node centers for a changed link', () => {
    const svg = renderChangedElementOverlay(
      page(),
      modified('l1', 'links'),
      'after',
    );
    expect(svg).toContain('<polyline points="100,200 300,200"');
    expect(svg).toContain('ws-hl-link');
    expect(svg).toContain('data-el="l1"');
  });

  it('threads a changed link halo through its coordinate waypoints', () => {
    const p = page();
    p.links[0]!.waypoints = [{ x: 200, y: 260 }];
    const svg = renderChangedElementOverlay(
      p,
      modified('l1', 'links'),
      'after',
    );
    expect(svg).toContain('points="100,200 200,260 300,200"');
  });

  it('draws a halo polyline through waypoint node/anchor centers for a changed flow path', () => {
    const svg = renderChangedElementOverlay(
      page(),
      modified('f1', 'flowPaths'),
      'after',
    );
    expect(svg).toContain('<polyline points="100,200 500,300"');
    expect(svg).toContain('ws-hl-flow');
    expect(svg).toContain('data-el="f1"');
  });

  it("draws a padded outline rect around a changed zone's computed region", () => {
    const svg = renderChangedElementOverlay(
      page(),
      modified('z1', 'zones'),
      'after',
    );
    // Engine zone rect: member centers ± 40x30, padding 40 → (20,130)–(380,270);
    // the highlight adds 5px around that.
    expect(svg).toContain('ws-hl-zone');
    expect(svg).toContain('x="15"');
    expect(svg).toContain('y="125"');
    expect(svg).toContain('width="370"');
    expect(svg).toContain('height="150"');
    expect(svg).toContain('data-el="z1"');
  });

  it('draws a ring at a changed anchor', () => {
    const svg = renderChangedElementOverlay(
      page(),
      modified('a1', 'anchors'),
      'after',
    );
    expect(svg).toContain('<circle cx="500" cy="300" r="10"');
    expect(svg).toContain('ws-hl-anchor');
    expect(svg).toContain('data-el="a1"');
  });

  it("draws a ring at a changed policy marker's badge position (node AABB + NE offset)", () => {
    const svg = renderChangedElementOverlay(
      page(),
      modified('pm1', 'policyMarkers'),
      'after',
    );
    // n1 (ec, 28x18 half-extents) at (100,200), NE margin 14 → (142, 168).
    expect(svg).toContain('<circle cx="142" cy="168" r="13"');
    expect(svg).toContain('ws-hl-marker');
    expect(svg).toContain('data-el="pm1"');
  });

  it('varies class (color + dash pattern) by change type', () => {
    const p = page();
    const changes = [
      { elementId: 'n1', kind: 'nodes', change: 'added' },
      { elementId: 'n2', kind: 'nodes', change: 'modified' },
    ] as Parameters<typeof renderChangedElementOverlay>[1];
    const svg = renderChangedElementOverlay(p, changes, 'after');
    expect(svg).toContain('ws-hl-add');
    expect(svg).toContain('ws-hl-mod');
  });

  it('shows removals only on the before frame and additions only on the after frame', () => {
    const p = page();
    const changes = [
      { elementId: 'n1', kind: 'nodes', change: 'removed' },
      { elementId: 'n2', kind: 'nodes', change: 'added' },
    ] as Parameters<typeof renderChangedElementOverlay>[1];
    const before = renderChangedElementOverlay(p, changes, 'before');
    expect(before).toContain('data-el="n1"');
    expect(before).toContain('ws-hl-remove');
    expect(before).not.toContain('data-el="n2"');
    const after = renderChangedElementOverlay(p, changes, 'after');
    expect(after).toContain('data-el="n2"');
    expect(after).toContain('ws-hl-add');
    expect(after).not.toContain('data-el="n1"');
  });

  it('shows modifications on both frames', () => {
    const p = page();
    for (const frame of ['before', 'after'] as const) {
      const svg = renderChangedElementOverlay(
        p,
        modified('n1', 'nodes'),
        frame,
      );
      expect(svg).toContain('data-el="n1"');
      expect(svg).toContain('ws-hl-mod');
    }
  });

  it('draws nothing for an empty change list', () => {
    expect(renderChangedElementOverlay(page(), [], 'after')).toBe('');
  });

  it('skips changes whose geometry cannot be resolved (unknown ids, dangling refs)', () => {
    const svg = renderChangedElementOverlay(
      page(),
      [
        { elementId: 'n1', kind: 'nodes', change: 'modified' },
        { elementId: 'ghost', kind: 'nodes', change: 'modified' },
      ] as Parameters<typeof renderChangedElementOverlay>[1],
      'after',
    );
    expect((svg.match(/<rect/g) ?? []).length).toBe(1);
  });
});

describe('proposal preview highlights per element kind (issue #213)', () => {
  /** The end-to-end pure path: operations → computeProposalPreview →
   * renderChangedElementOverlay, per single-kind proposal. */
  function sourcePage(): Page {
    return {
      id: 'p1',
      name: 'Frame 1',
      viewBox: '0 0 1050 700',
      nodes: [
        { id: 'n1', type: 'ec', x: 100, y: 200, label: 'A' },
        { id: 'n2', type: 'ec', x: 300, y: 200, label: 'B' },
      ],
      links: [{ id: 'l1', type: 'line', from: 'n1', to: 'n2' }],
      anchors: [{ id: 'a1', x: 500, y: 300 }],
      zones: [{ id: 'z1', nodes: ['n1', 'n2'], label: 'Z' }],
      flowPaths: [{ id: 'f1', waypoints: ['n1', 'a1'], label: 'F' }],
      policyMarkers: [{ id: 'pm1', nodeId: 'n1', type: 'inspect' }],
    };
  }
  function overlaysFor(operations: WorkspaceOperation[]): {
    before: string;
    after: string;
  } {
    const [entry] = computeProposalPreview([sourcePage()], operations);
    return {
      before: entry!.before
        ? renderChangedElementOverlay(entry!.before, entry!.changes, 'before')
        : '',
      after: entry!.after
        ? renderChangedElementOverlay(entry!.after, entry!.changes, 'after')
        : '',
    };
  }

  it('link-only proposal: halo polyline on both frames for a patched link', () => {
    const { before, after } = overlaysFor([
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'links',
        elementId: 'l1',
        patch: { set: { color: '#fc6161' } },
      },
    ]);
    for (const svg of [before, after]) {
      expect(svg).toContain('<polyline points="100,200 300,200"');
      expect(svg).toContain('ws-hl-link');
      expect(svg).toContain('ws-hl-mod');
    }
  });

  it('zone-only proposal: removed zone outlines on the before frame only', () => {
    const { before, after } = overlaysFor([
      { type: 'element.remove', pageId: 'p1', kind: 'zones', elementId: 'z1' },
    ]);
    expect(before).toContain('ws-hl-zone');
    expect(before).toContain('ws-hl-remove');
    expect(before).toContain('x="15"');
    expect(after).toBe('');
  });

  it('anchor-only proposal: added anchor rings on the after frame only', () => {
    const { before, after } = overlaysFor([
      {
        type: 'element.add',
        pageId: 'p1',
        kind: 'anchors',
        element: { id: 'a2', x: 640, y: 420 },
      },
    ]);
    expect(before).toBe('');
    expect(after).toContain('<circle cx="640" cy="420" r="10"');
    expect(after).toContain('ws-hl-anchor');
    expect(after).toContain('ws-hl-add');
  });

  it('flow-path-only proposal: halo through waypoint centers on both frames', () => {
    const { before, after } = overlaysFor([
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'flowPaths',
        elementId: 'f1',
        patch: { set: { label: 'F2' } },
      },
    ]);
    for (const svg of [before, after]) {
      expect(svg).toContain('<polyline points="100,200 500,300"');
      expect(svg).toContain('ws-hl-flow');
    }
  });

  it('policy-marker-only proposal: badge ring at the marker position on both frames', () => {
    const { before, after } = overlaysFor([
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'policyMarkers',
        elementId: 'pm1',
        patch: { set: { label: 'IDP' } },
      },
    ]);
    for (const svg of [before, after]) {
      expect(svg).toContain('<circle cx="142" cy="168" r="13"');
      expect(svg).toContain('ws-hl-marker');
    }
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

describe('renderPresenceHtml (Packet S1)', () => {
  it('renders nothing when no one is present (socket down or empty roster)', () => {
    expect(renderPresenceHtml([])).toBe('');
  });

  it('renders a labeled chip per editor with page and count', () => {
    const html = renderPresenceHtml([
      { kind: 'user', label: 'alice', pageId: 'p1' },
      { kind: 'agent', label: 'assistant' },
    ]);
    expect(html).toContain('Present (2)');
    expect(html).toContain('ws-presence-user');
    expect(html).toContain('alice');
    expect(html).toContain('p1');
    expect(html).toContain('ws-presence-agent');
    expect(html).toContain('assistant');
  });

  it('falls back to the actor kind when no label is present and escapes content', () => {
    const html = renderPresenceHtml([{ kind: 'user', pageId: '<b>p</b>' }]);
    expect(html).toContain('>user<');
    expect(html).not.toContain('<b>p</b>');
    expect(html).toContain('&lt;b&gt;p&lt;/b&gt;');
  });

  it('surfaces in the active workspace panel body', () => {
    const html = renderActiveWorkspaceHtml(
      activeWorkspace({
        presence: [{ kind: 'user', label: 'alice', pageId: 'p1' }],
      }),
    );
    expect(html).toContain('Present (1)');
    expect(html).toContain('alice');
  });
});

describe('renderOfflineStatusHtml (Packet S3)', () => {
  const pendingBatch = (count: number): CommitRequest => ({
    baseRevision: 7,
    operationId: 'ui_offline',
    operations: Array.from({ length: count }, () => ({
      type: 'page.patch' as const,
      pageId: 'p1',
      patch: { set: { name: 'x' } },
    })),
  });

  it('renders nothing when online with nothing pending (the quiet case)', () => {
    expect(renderOfflineStatusHtml(activeWorkspace(), true)).toBe('');
  });

  it('shows the pending count when online with an unacked batch', () => {
    const html = renderOfflineStatusHtml(
      activeWorkspace({ pending: pendingBatch(3) }),
      true,
    );
    expect(html).toContain('data-online="true"');
    expect(html).toContain('3 pending');
  });

  it('shows "offline · N pending" when offline with a queued batch', () => {
    const html = renderOfflineStatusHtml(
      activeWorkspace({ pending: pendingBatch(2) }),
      false,
    );
    expect(html).toContain('data-online="false"');
    expect(html).toContain('offline · 2 pending');
  });

  it('shows "offline · cached" when offline with nothing pending', () => {
    const html = renderOfflineStatusHtml(activeWorkspace(), false);
    expect(html).toContain('data-online="false"');
    expect(html).toContain('offline · cached');
  });

  it('surfaces in the active workspace panel body when offline', () => {
    const html = renderActiveWorkspaceHtml(activeWorkspace(), false);
    expect(html).toContain('ws-offline');
    expect(html).toContain('offline · cached');
  });

  it('stays quiet in the panel body when online and synced', () => {
    const html = renderActiveWorkspaceHtml(activeWorkspace(), true);
    expect(html).not.toContain('ws-offline');
  });
});

describe('computeWorkspacePanelState (issue #212 groundwork)', () => {
  it('reports the inactive baseline with no workspace', () => {
    expect(computeWorkspacePanelState(null, true)).toEqual({
      active: false,
      revision: null,
      pendingProposals: 0,
      conflict: false,
      offline: false,
      pendingOps: 0,
      error: null,
    });
  });

  it('prefers the manifest pending-proposal count over the fetched list', () => {
    const state = computeWorkspacePanelState(
      activeWorkspace({
        manifest: manifest({ pendingProposals: 3 }),
        proposals: [proposal()],
      }),
      true,
    );
    expect(state.active).toBe(true);
    expect(state.revision).toBe(7);
    expect(state.pendingProposals).toBe(3);
  });

  it('falls back to counting pending proposals when no manifest is loaded yet', () => {
    const state = computeWorkspacePanelState(
      activeWorkspace({
        manifest: null,
        proposals: [
          proposal({ id: 'a', status: 'pending' }),
          proposal({ id: 'b', status: 'rejected' }),
        ],
      }),
      true,
    );
    expect(state.pendingProposals).toBe(1);
  });

  it('reports conflict + error, offline, and queued pending ops', () => {
    const state = computeWorkspacePanelState(
      activeWorkspace({
        error: 'Revision conflict: rebase required',
        pending: {
          baseRevision: 7,
          operationId: 'ui_x',
          operations: [
            { type: 'page.patch', pageId: 'p1', patch: { set: { name: 'x' } } },
            { type: 'page.patch', pageId: 'p1', patch: { set: { name: 'y' } } },
          ],
        },
      }),
      false,
    );
    expect(state.conflict).toBe(true);
    expect(state.error).toBe('Revision conflict: rebase required');
    expect(state.offline).toBe(true);
    expect(state.pendingOps).toBe(2);
  });
});
