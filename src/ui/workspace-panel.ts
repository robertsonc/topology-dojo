/**
 * Agent Workspace panel (Packet R0 — extracted from `src/main.ts` verbatim,
 * behavior-preserving).
 *
 * The browser already has both the last-synced and edited snapshots, so this
 * compatibility adapter computes semantic operations locally. Only that small
 * batch crosses the network. Manifest/proposal polling is browser JSON traffic
 * and is never injected into an agent's model context.
 *
 * `mountWorkspacePanel(host)` owns all module state that used to live at
 * `main.ts` top level (`activeWorkspace`, `workspaceAuthenticated`,
 * `workspacePanel`, `workspaceChoices`, `workspaceDisabled`,
 * `workspaceSaveTimer`) plus the toolbar chip wiring, the panel DOM, lease
 * grant/revoke, proposal accept/reject, and the manifest polling timer. It
 * returns a narrow handle for the handful of call sites `main.ts` still needs
 * (document-replacement confirmation, the autosave→sync hook, sign-in
 * activation, and the beforeunload recovery write).
 */
import { applyOperations, diffDocuments } from '../workspace/operations.js';
import {
  acceptWorkspaceProposal,
  commitWorkspaceOperations,
  createWorkspaceCheckpoint,
  createWorkspace,
  deleteWorkspaceCheckpoint,
  forkWorkspaceCheckpoint,
  getWorkspace,
  getWorkspaceChanges,
  getWorkspaceManifest,
  getWorkspaceProposal,
  grantWorkspaceLease,
  listWorkspaceCheckpoints,
  listWorkspaces,
  listWorkspaceProposals,
  openWorkspaceSocket,
  rejectWorkspaceProposal,
  restoreWorkspaceCheckpoint,
  revokeWorkspaceLease,
  WorkspaceDisabledError,
  type WorkspaceSocketHandle,
} from '../workspace/client.js';
import {
  cacheWorkspace,
  clearCachedWorkspace,
  readCachedWorkspace,
} from '../workspace/offline.js';
import {
  computeProposalPreview,
  operationElementIds,
  type ElementChange,
} from '../workspace/preview.js';
import type {
  ChangesResult,
  CheckpointSummary,
  CommitRequest,
  ProposalSummary,
  WorkspaceManifest,
  WorkspaceListItem,
  WorkspaceNotice,
  WorkspaceOperation,
  WorkspacePresence,
} from '../workspace/model.js';
import { serializeDoc } from '../pages/persist.js';
import { registerOverlay } from './overlay.js';
import type { Page, TopologyDocument } from '../pages/model.js';
import type { ZoneConfig } from '../vendor/topology-ds.js';
import { pageToSVG } from '../editor/export.js';
import { nodeBounds, type BoundsRect } from '../api/geometry.js';

/** One revision's stored summary (the timeline reads exactly this — no ops). */
export type ChangeSummary = ChangesResult['changes'][number];

// Local copy of main.ts's `esc()` — the codebase's established pattern for
// this trivial helper (see `src/nodes/render.ts`, `src/nodes/designer.ts`)
// is a small per-module copy rather than a shared import, which also keeps
// this module free of a circular import back into `main.ts`.
function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

const WORKSPACE_LINK_KEY = 'topology-dojo:workspace-link';
/** How many recent revisions the timeline requests (server caps summaries at 50). */
const TIMELINE_LIMIT = 30;
interface StoredWorkspaceLink {
  id: string;
  revision: number;
  syncedFingerprint: string;
  pending?: CommitRequest;
}
export interface ActiveWorkspace {
  id: string;
  revision: number;
  lastSynced: TopologyDocument;
  manifest: WorkspaceManifest | null;
  proposals: ProposalSummary[];
  checkpoints: CheckpointSummary[];
  /** Recent change log (summaries) + history floor for the revision timeline. */
  timeline: ChangesResult | null;
  /** Live presence roster from the push socket (Packet S1). Empty when the
   * socket is down — presence is an accelerant, never part of correctness. */
  presence: WorkspacePresence[];
  pending: CommitRequest | null;
  pendingTarget: TopologyDocument | null;
  syncing: boolean;
  paused: boolean;
  status: string;
  error: string | null;
}

/** Everything the panel needs from `main.ts`'s app shell — the narrow seam. */
export interface WorkspacePanelHost {
  /** The live, mutable document instance (never reassigned by main.ts). */
  getDoc(): TopologyDocument;
  /** Replace the whole document (open / new / adopt a workspace snapshot). */
  loadDoc(next: TopologyDocument, sync?: boolean): void;
  /** The page id the browser is currently viewing (for lease grants). */
  getCurrentPageId(): string;
  /**
   * Drain the semantic operations the editor emitted for gestures since the last
   * call (Packet S2). The commit funnel prefers these intent-faithful ops when
   * they reproduce the current document, and falls back to a snapshot diff
   * otherwise. Returns [] when the editor emitted nothing.
   */
  takePendingOperations(): WorkspaceOperation[];
  /** The toolbar's autosave status text node. */
  savedEl: HTMLElement;
  /** The `#workspaceChip` toolbar button. */
  chip: HTMLButtonElement;
  /** The `#workspaceLabel` span inside the chip. */
  chipLabel: HTMLElement;
  /** The `#workspaceDiv` divider shown alongside the chip. */
  chipDivider: HTMLElement;
}

/**
 * Snapshot of workspace state the app shell may surface outside the panel
 * (issue #212 — the toolbar chip's badge/conflict/offline indicators).
 * Computed by `computeWorkspacePanelState`, delivered via `onStateChange`.
 */
export interface WorkspacePanelState {
  /** Whether a workspace is active at all. */
  active: boolean;
  /** Canonical revision, or null with no active workspace. */
  revision: number | null;
  /** Pending agent proposals awaiting review. */
  pendingProposals: number;
  /** A sync/accept conflict (or any workspace error) needs attention. */
  conflict: boolean;
  /** The browser is offline (indicator only — sync retries regardless). */
  offline: boolean;
  /** Unacknowledged operations queued for replay. */
  pendingOps: number;
  /** The current error message, when `conflict` is true. */
  error: string | null;
}

/** The call sites `main.ts` still needs into workspace behavior. */
export interface WorkspacePanelHandle {
  /** Confirms/tears down an active workspace before New/Open replace `doc`. */
  closeForDocumentReplacement(): boolean;
  /** The autosave hook — schedules a debounced sync of local edits. */
  notifyDocChanged(): void;
  /** Reveals the toolbar chip and reconnects once sign-in is confirmed. */
  enable(): void;
  /** Best-effort recovery write on `beforeunload`. */
  flushBeforeUnload(): void;
  /** The browser navigated to a different page — report it as presence. */
  notifyPageChanged(): void;
  /**
   * Subscribe to workspace-state changes (issue #212). The listener fires
   * immediately with the current state, then on every change (deduped).
   * Returns an unsubscribe function.
   */
  onStateChange(listener: (state: WorkspacePanelState) => void): () => void;
  /** Open the panel scrolled to the given pending proposal (or the first
   * one), briefly calling attention to its card. */
  openToProposal(id?: string): void;
  /** Open the panel scrolled to the current conflict/error notice. */
  openToConflict(): void;
}

export interface WorkspaceChipState {
  on: boolean;
  conflict: boolean;
  label: string;
  title: string;
}

/** Pure: the toolbar chip's visual state for a given workspace (or none).
 * The label surfaces what needs attention as explicit text (issue #212), the
 * dot color only reinforces it: conflict wins, then pending proposals, then
 * offline-with-queued-ops; quiet workspaces keep the plain `agent · rN`. */
export function computeWorkspaceChipState(
  workspace: ActiveWorkspace | null,
  online = true,
): WorkspaceChipState {
  const title = workspace
    ? `${workspace.id} · ${workspace.status}`
    : 'Hand this local document to an agent workspace';
  const on = Boolean(workspace);
  const conflict = Boolean(workspace?.error);
  let label = 'agent · local';
  if (workspace) {
    const state = computeWorkspacePanelState(workspace, online);
    if (state.conflict) label = 'agent · conflict';
    else if (state.pendingProposals > 0)
      label = `agent · ${state.pendingProposals} proposal${state.pendingProposals === 1 ? '' : 's'}`;
    else if (state.offline && state.pendingOps > 0)
      label = `agent · offline · ${state.pendingOps} pending`;
    else label = `agent · r${workspace.revision}`;
  }
  return { on, conflict, label, title };
}

/** Pure: the shell-facing state snapshot for a given workspace (or none).
 * `pendingProposals` prefers the server manifest's count (authoritative) and
 * falls back to the fetched proposal list. */
export function computeWorkspacePanelState(
  workspace: ActiveWorkspace | null,
  online: boolean,
): WorkspacePanelState {
  return {
    active: Boolean(workspace),
    revision: workspace?.revision ?? null,
    pendingProposals: workspace
      ? (workspace.manifest?.pendingProposals ??
        workspace.proposals.filter((p) => p.status === 'pending').length)
      : 0,
    conflict: Boolean(workspace?.error),
    offline: !online,
    pendingOps: workspace?.pending?.operations.length ?? 0,
    error: workspace?.error ?? null,
  };
}

/**
 * Pure: what (if anything) the polite live region should announce for a state
 * change (issue #212). Announces TRANSITIONS only — a poll refresh that leaves
 * the state unchanged (or merely bumps `revision`/`pendingOps`) says nothing:
 * - a conflict appearing;
 * - the pending-proposal count changing to a new non-zero value (a fresh
 *   proposal, or the first sight of existing ones when `prev` is null);
 * - going offline with operations queued.
 * Returns null when nothing needs announcing.
 */
export function computeChipAnnouncement(
  prev: WorkspacePanelState | null,
  next: WorkspacePanelState,
): string | null {
  if (next.conflict && !prev?.conflict)
    return 'Agent workspace conflict — attention needed.';
  if (
    next.pendingProposals > 0 &&
    next.pendingProposals !== (prev?.pendingProposals ?? 0)
  )
    return `${next.pendingProposals} agent proposal${next.pendingProposals === 1 ? '' : 's'} awaiting review.`;
  if (next.offline && next.pendingOps > 0 && !prev?.offline)
    return `Workspace offline — ${next.pendingOps} change${next.pendingOps === 1 ? '' : 's'} pending sync.`;
  return null;
}

/** Pure: the panel body when workspaces are disabled on this deployment. */
export function renderWorkspaceDisabledHtml(): string {
  return (
    `<div class="ws-note">Workspaces are not enabled on this deployment.</div>` +
    `<div class="ws-card"><div class="ws-note">The agent workspace surface is turned off for this deployment. Local editing and autosave still work as usual.</div>` +
    `<div class="ws-actions"><button class="tbtn" id="wsRefreshList">Check again</button></div></div>`
  );
}

/** Pure: the panel body when there's no active workspace (handoff/open list). */
export function renderWorkspaceChoicesHtml(
  choices: WorkspaceListItem[],
): string {
  const choicesHtml = choices.length
    ? `<div class="ws-section">Existing workspaces</div>` +
      choices
        .slice(0, 20)
        .map(
          (item) =>
            `<div class="ws-card"><div class="ws-row"><span class="ws-v">${esc(item.title)}</span>` +
            `<button class="tbtn ws-open" data-wid="${esc(item.id)}">open</button></div>` +
            `<div class="ws-note">${esc(item.id)} · ${item.pages} page${item.pages === 1 ? '' : 's'} · ${item.migrated ? `r${item.revision ?? 0}` : 'legacy · migrates on open'}</div></div>`,
        )
        .join('')
    : '';
  return (
    `<div class="ws-note">Hand this document to the canonical workspace so the browser and your agent share revisions—not copies.</div>` +
    `<div class="ws-card"><div class="ws-row"><span class="ws-k">Default</span><span class="ws-v ws-policy">Suggest only</span></div>` +
    `<div class="ws-note">Agent edits arrive as reviewable proposals. Browser synchronization does not consume model tokens.</div>` +
    `<div class="ws-actions"><button class="tbtn" id="wsHandoff">Hand off current document</button><button class="tbtn" id="wsRefreshList">Refresh list</button></div></div>` +
    choicesHtml
  );
}

/** Pure: the named-checkpoint section — a create row plus the list, each with
 * restore / fork / delete (all browser-owner actions). */
export function renderCheckpointsHtml(workspace: ActiveWorkspace): string {
  const atCap = workspace.checkpoints.length >= 12;
  const list = workspace.checkpoints.length
    ? workspace.checkpoints
        .map(
          (checkpoint) =>
            `<div class="ws-checkpoint" data-cid="${esc(checkpoint.id)}">` +
            `<div class="ws-checkpoint-head"><span class="ws-v">${esc(checkpoint.name)}</span>` +
            `<span class="ws-note">r${checkpoint.revision} · ${checkpoint.pageCount} page${checkpoint.pageCount === 1 ? '' : 's'} · ${esc(checkpoint.createdBy.kind)}</span></div>` +
            `<div class="ws-actions">` +
            `<button class="tbtn ws-cp-restore" data-cid="${esc(checkpoint.id)}">Restore</button>` +
            `<button class="tbtn ws-cp-fork" data-cid="${esc(checkpoint.id)}">Fork</button>` +
            `<button class="tbtn ws-cp-delete" data-cid="${esc(checkpoint.id)}">Delete</button>` +
            `</div></div>`,
        )
        .join('')
    : `<div class="ws-empty">No checkpoints yet.</div>`;
  return (
    `<div class="ws-section">Checkpoints (${workspace.checkpoints.length}/12)</div>` +
    `<div class="ws-card"><div class="ws-row">` +
    `<input id="wsCheckpointName" class="ws-input" type="text" maxlength="120" placeholder="Name this checkpoint…"${atCap ? ' disabled' : ''}>` +
    `<button class="tbtn" id="wsCheckpointCreate"${atCap ? ' disabled' : ''}>Save</button></div>` +
    (atCap
      ? `<div class="ws-note">Checkpoint limit reached — delete one to save another.</div>`
      : '') +
    list +
    `</div>`
  );
}

/** Human label per change source for the timeline badge. */
const TIMELINE_SOURCE_LABEL: Record<string, string> = {
  ui: 'edit',
  'agent-lease': 'agent',
  proposal: 'proposal',
  restore: 'restore',
  migration: 'migration',
};

/** Pure: the revision timeline — newest first, with actor, summary, a source
 * badge, proposal-acceptance and checkpoint markers, and the history floor. */
export function renderTimelineHtml(workspace: ActiveWorkspace): string {
  const log = workspace.timeline;
  if (!log || log.changes.length === 0) {
    return (
      `<div class="ws-section">Timeline</div>` +
      `<div class="ws-card"><div class="ws-empty">No revisions yet.</div></div>`
    );
  }
  const checkpointsAt = new Map<number, string[]>();
  for (const checkpoint of workspace.checkpoints) {
    const at = checkpointsAt.get(checkpoint.revision) ?? [];
    at.push(checkpoint.name);
    checkpointsAt.set(checkpoint.revision, at);
  }
  const rows = [...log.changes]
    .sort((a, b) => b.revision - a.revision)
    .map((change) => {
      const actor = change.actor.label || change.actor.kind;
      const source = TIMELINE_SOURCE_LABEL[change.source] ?? change.source;
      const marks = checkpointsAt.get(change.revision) ?? [];
      const first = change.summary.descriptions[0];
      return (
        `<div class="ws-rev">` +
        `<div class="ws-rev-head"><span class="ws-rev-n">r${change.revision}</span>` +
        `<span class="ws-badge ws-src-${esc(change.source)}">${esc(source)}</span>` +
        `<span class="ws-note">${esc(actor)}</span></div>` +
        `<div class="ws-note">${change.summary.count} op${change.summary.count === 1 ? '' : 's'}${first ? ` · ${esc(first)}` : ''}</div>` +
        (change.proposalId
          ? `<div class="ws-note">✓ accepted proposal</div>`
          : '') +
        marks
          .map(
            (name) => `<div class="ws-note">◈ checkpoint “${esc(name)}”</div>`,
          )
          .join('') +
        `</div>`
      );
    })
    .join('');
  const floor =
    log.historyFloor > 0
      ? `<div class="ws-note ws-rev-floor">Older revisions compacted (floor r${log.historyFloor}).</div>`
      : '';
  return (
    `<div class="ws-section">Timeline (r${log.revision})</div>` +
    `<div class="ws-card">${rows}${floor}</div>`
  );
}

/** Pure: the presence roster (Packet S1) — a small chip per connected editor,
 * labeled with who they are and, when known, which page they're viewing. Empty
 * output when nobody is reported present (socket down or nobody connected), so
 * the section simply vanishes rather than claiming a stale roster. */
export function renderPresenceHtml(presence: WorkspacePresence[]): string {
  if (!presence.length) return '';
  const chips = presence
    .map((entry) => {
      const who = esc(entry.label || entry.kind);
      const where = entry.pageId
        ? `<span class="ws-presence-page">${esc(entry.pageId)}</span>`
        : '';
      return (
        `<span class="ws-presence-chip ws-presence-${esc(entry.kind)}">` +
        `${who}${where}</span>`
      );
    })
    .join('');
  return (
    `<div class="ws-section">Present (${presence.length})</div>` +
    `<div class="ws-card ws-presence">${chips}</div>`
  );
}

/** Pure: the offline / pending-replay indicator (Packet S3). Shows the browser's
 * connectivity and how many unacknowledged operations are queued for replay. It
 * renders nothing when online with nothing pending — the common, quiet case —
 * so the panel only speaks up when there is something to say. `online` is the
 * live `navigator.onLine` signal (defaulted for the pure render tests). */
export function renderOfflineStatusHtml(
  workspace: ActiveWorkspace,
  online: boolean,
): string {
  const pendingOps = workspace.pending?.operations.length ?? 0;
  if (online && pendingOps === 0) return '';
  const label = !online
    ? pendingOps > 0
      ? `offline · ${pendingOps} pending`
      : 'offline · cached'
    : `${pendingOps} pending`;
  return (
    `<div class="ws-offline" data-online="${online ? 'true' : 'false'}">` +
    `<span class="ws-offline-dot" aria-hidden="true"></span>${esc(label)}</div>`
  );
}

/** Pure: the panel body for an active workspace (revision/sync/lease/proposals). */
export function renderActiveWorkspaceHtml(
  workspace: ActiveWorkspace,
  online = true,
): string {
  const lease = workspace.manifest?.lease;
  const leaseLive = lease && Date.parse(lease.expiresAt) > Date.now();
  const proposalHtml = workspace.proposals.length
    ? workspace.proposals
        .map(
          (proposal) =>
            `<div class="ws-card" data-proposal="${esc(proposal.id)}">` +
            `<div class="ws-proposal-title">${esc(proposal.title)}</div>` +
            `<div class="ws-proposal-meta">${proposal.summary.count} operation${proposal.summary.count === 1 ? '' : 's'} · base r${proposal.baseRevision} · ${esc(proposal.status)}</div>` +
            (proposal.rationale
              ? `<div class="ws-note">${esc(proposal.rationale)}</div>`
              : '') +
            // The description is a button (interactive content inside the
            // label, so clicking it never toggles the checkbox): it opens the
            // preview and flashes the operation's changed geometry.
            `<ul class="ws-ops">${proposal.summary.descriptions
              .map(
                (line, i) =>
                  `<li><label class="ws-op"><input type="checkbox" class="ws-op-check" data-pid="${esc(proposal.id)}" data-op-index="${i}" checked> ` +
                  `<button type="button" class="ws-op-jump" data-pid="${esc(proposal.id)}" data-op-index="${i}" title="Locate this change in the preview">${esc(line)}</button></label></li>`,
              )
              .join('')}${
              proposal.summary.count > proposal.summary.descriptions.length
                ? `<li class="ws-note">…and ${proposal.summary.count - proposal.summary.descriptions.length} more (use “Accept all”)</li>`
                : ''
            }</ul>` +
            `<div class="ws-actions"><button class="tbtn ws-accept" data-pid="${esc(proposal.id)}">Accept all</button>` +
            `<button class="tbtn ws-accept-selected" data-pid="${esc(proposal.id)}">Accept selected</button>` +
            `<button class="tbtn ws-reject" data-pid="${esc(proposal.id)}">Reject</button>` +
            `<button class="tbtn ws-preview-toggle" data-pid="${esc(proposal.id)}">Preview</button></div>` +
            `<div class="ws-preview" data-pid="${esc(proposal.id)}" hidden></div></div>`,
        )
        .join('')
    : `<div class="ws-empty">No pending agent proposals.</div>`;

  return (
    `<div class="ws-card">` +
    `<div class="ws-row"><span class="ws-k">Workspace</span><span class="ws-v">${esc(workspace.id)}</span><button class="tbtn" id="wsCopy">copy</button></div>` +
    `<div class="ws-row"><span class="ws-k">Revision</span><span class="ws-v">r${workspace.revision}</span></div>` +
    `<div class="ws-row"><span class="ws-k">Policy</span><span class="ws-v ws-policy">Suggest only</span></div>` +
    `<div class="ws-row"><span class="ws-k">Status</span><span class="ws-v">${esc(workspace.status)}</span></div>` +
    (workspace.error
      ? `<div class="ws-error">${esc(workspace.error)}</div>`
      : '') +
    renderOfflineStatusHtml(workspace, online) +
    `<div class="ws-actions"><button class="tbtn" id="wsSync">Sync now</button>` +
    (workspace.paused
      ? `<button class="tbtn" id="wsResume">Sync local copy</button>`
      : '') +
    `<button class="tbtn" id="wsReload">Reload server</button><button class="tbtn" id="wsDetach">Close workspace</button></div></div>` +
    renderPresenceHtml(workspace.presence) +
    `<div class="ws-section">Agent control</div>` +
    `<div class="ws-card"><div class="ws-note">${
      leaseLive
        ? `Direct agent edits allowed only on page ${esc(lease.scope.pageId)} until ${esc(new Date(lease.expiresAt).toLocaleTimeString())}.`
        : 'No lease. Agent changes must be proposals.'
    }</div><div class="ws-actions">` +
    (leaseLive
      ? `<button class="tbtn" id="wsRevoke">Revoke now</button>`
      : `<button class="tbtn" id="wsLease">Grant current page · 10 min</button>`) +
    `</div></div>` +
    `<div class="ws-section">Proposals (${workspace.proposals.length})</div>` +
    proposalHtml +
    renderCheckpointsHtml(workspace) +
    renderTimelineHtml(workspace)
  );
}

/** One rendered before/after frame pair — SVG already produced by the engine
 * (or null: "before" is null for a page the proposal adds, "after" is null
 * for a page it removes). Kept separate from the engine call itself so the
 * HTML layout below is testable without a loaded browser engine. */
export interface RenderedPreviewFrame {
  pageId: string;
  pageName: string;
  beforeSvg: string | null;
  afterSvg: string | null;
}

/** CSS class per change type. Colors AND dash patterns differ (solid = add,
 * dotted = remove, dashed = modify) so the distinction never rides on color
 * alone — see the `.ws-hl-*` rules in index.html. */
const HL_CHANGE_CLASS: Record<ElementChange['change'], string> = {
  added: 'ws-hl-add',
  removed: 'ws-hl-remove',
  modified: 'ws-hl-mod',
};

/** The doc-space center of a link/flow-path endpoint: a node or an anchor. */
function elementPoint(page: Page, id: string): { x: number; y: number } | null {
  const node = page.nodes.find((n) => n.id === id);
  if (node) return { x: node.x, y: node.y };
  const anchor = page.anchors.find((a) => a.id === id);
  return anchor ? { x: anchor.x, y: anchor.y } : null;
}

/** Member node ids of a zone including nested child zones, mirroring the
 * engine's `_getZoneNodesRecursive`; `seen` guards a parentZone cycle. */
function zoneMemberIds(
  page: Page,
  zone: ZoneConfig,
  seen = new Set<string>(),
): string[] {
  if (seen.has(zone.id)) return [];
  seen.add(zone.id);
  const ids = [...zone.nodes];
  for (const child of page.zones)
    if (child.parentZone === zone.id)
      ids.push(...zoneMemberIds(page, child, seen));
  return ids;
}

/** The zone's drawn rectangle, mirroring the engine's `_renderZoneRect` math
 * (member node centers ± 40×30, expanded by `padding` (default 40)). Null
 * when no member resolves — the engine draws nothing then, so neither do we. */
function zoneRect(page: Page, zone: ZoneConfig): BoundsRect | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const id of zoneMemberIds(page, zone)) {
    const pos = elementPoint(page, id);
    if (!pos) continue;
    minX = Math.min(minX, pos.x - 40);
    minY = Math.min(minY, pos.y - 30);
    maxX = Math.max(maxX, pos.x + 40);
    maxY = Math.max(maxY, pos.y + 30);
  }
  if (!isFinite(minX)) return null;
  const pad = zone.padding || 40;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

/** SVG `points` attribute for a polyline through resolved doc-space points. */
function polylinePoints(points: Array<{ x: number; y: number }>): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

/**
 * Pure: the highlight markup for one changed element on `page`, or '' when
 * its geometry can't be resolved (dangling endpoint, empty zone, unknown id).
 * Per-kind geometry, all doc-space:
 * - nodes: padded AABB rect (`api/geometry.ts`), the original behavior;
 * - links: a stroked halo polyline from→waypoints→to through node/anchor
 *   centers (not the engine's exact routed curve — close enough to point at);
 * - flowPaths: the same halo through the waypoint node/anchor centers;
 * - zones: a padded outline around the engine's computed zone rect;
 * - anchors: a ring at the anchor's coordinates;
 * - policyMarkers: a ring at the badge position (node AABB + align offset,
 *   mirroring the engine's `_markerPos` margin of 14, stacking ignored).
 */
function changeHighlightMarkup(page: Page, change: ElementChange): string {
  const attrs = (shape: string): string =>
    `class="ws-hl ws-hl-${shape} ${HL_CHANGE_CLASS[change.change]}" data-el="${esc(change.elementId)}"`;
  const id = change.elementId;
  switch (change.kind) {
    case 'nodes': {
      const node = page.nodes.find((n) => n.id === id);
      if (!node) return '';
      const pad = 6;
      const b = nodeBounds(node);
      return (
        `<rect x="${b.x - pad}" y="${b.y - pad}" width="${b.w + pad * 2}" ` +
        `height="${b.h + pad * 2}" rx="6" ${attrs('node')}/>`
      );
    }
    case 'links': {
      const link = page.links.find((l) => l.id === id);
      if (!link) return '';
      const from = elementPoint(page, link.from);
      const to = elementPoint(page, link.to);
      const points = [from, ...(link.waypoints ?? []), to].filter(
        (p): p is { x: number; y: number } => Boolean(p),
      );
      if (points.length < 2) return '';
      return `<polyline points="${polylinePoints(points)}" ${attrs('link')}/>`;
    }
    case 'flowPaths': {
      const path = page.flowPaths.find((f) => f.id === id);
      if (!path) return '';
      const points = path.waypoints
        .map((ref) => elementPoint(page, ref))
        .filter((p): p is { x: number; y: number } => Boolean(p));
      if (points.length < 2) return '';
      return `<polyline points="${polylinePoints(points)}" ${attrs('flow')}/>`;
    }
    case 'zones': {
      const zone = page.zones.find((z) => z.id === id);
      const rect = zone ? zoneRect(page, zone) : null;
      if (!rect) return '';
      const pad = 5;
      return (
        `<rect x="${rect.x - pad}" y="${rect.y - pad}" width="${rect.w + pad * 2}" ` +
        `height="${rect.h + pad * 2}" rx="10" ${attrs('zone')}/>`
      );
    }
    case 'anchors': {
      const anchor = page.anchors.find((a) => a.id === id);
      if (!anchor) return '';
      return `<circle cx="${anchor.x}" cy="${anchor.y}" r="10" ${attrs('anchor')}/>`;
    }
    case 'policyMarkers': {
      const marker = page.policyMarkers.find((m) => m.id === id);
      const node = marker
        ? page.nodes.find((n) => n.id === marker.nodeId)
        : null;
      if (!marker || !node) return '';
      const b = nodeBounds(node);
      const margin = 14; // the engine's badge offset from the node AABB
      const a = marker.align ?? 'NE';
      const cx = a.includes('E')
        ? node.x + b.w / 2 + margin
        : a.includes('W')
          ? node.x - b.w / 2 - margin
          : node.x;
      const cy = a.includes('N')
        ? node.y - b.h / 2 - margin
        : a.includes('S')
          ? node.y + b.h / 2 + margin
          : node.y;
      return `<circle cx="${cx}" cy="${cy}" r="13" ${attrs('marker')}/>`;
    }
  }
}

/**
 * Pure: highlight `<g>` for the changed elements on `page`, appended as a
 * sibling of the engine's own SVG markup (never edits it in place). `frame`
 * picks which changes belong on this side: removals highlight on "before",
 * additions on "after", modifications on both. Every element kind gets
 * geometry (see `changeHighlightMarkup`); each shape carries a
 * `data-el="<id>"` hook for the operation-list click-to-flash wiring.
 */
export function renderChangedElementOverlay(
  page: Page,
  changes: ElementChange[],
  frame: 'before' | 'after',
): string {
  const shapes = changes
    .filter((change) =>
      frame === 'before'
        ? change.change !== 'added'
        : change.change !== 'removed',
    )
    .map((change) => changeHighlightMarkup(page, change))
    .join('');
  return shapes ? `<g class="ws-preview-highlight">${shapes}</g>` : '';
}

/** Pure: the preview body for one proposal from already-rendered SVG frames
 * (capped upstream to `frames.length`; `totalAffected` may exceed it). */
export function renderProposalPreviewHtml(
  frames: RenderedPreviewFrame[],
  totalAffected: number,
): string {
  if (!frames.length)
    return (
      `<div class="ws-note">No page-level preview for this proposal — ` +
      `it only changes document-level settings (see the operation list above).</div>`
    );
  const more = totalAffected - frames.length;
  return (
    `<div class="ws-preview-pages scroll-slim">` +
    frames
      .map(
        (frame) =>
          `<div class="ws-preview-page">` +
          `<div class="ws-preview-page-name">${esc(frame.pageName)}</div>` +
          `<div class="ws-preview-frames">` +
          `<div class="ws-preview-frame"><div class="ws-preview-frame-label">Before</div>` +
          (frame.beforeSvg ??
            `<div class="ws-note ws-preview-empty">New page</div>`) +
          `</div>` +
          `<div class="ws-preview-frame"><div class="ws-preview-frame-label">After</div>` +
          (frame.afterSvg ??
            `<div class="ws-note ws-preview-empty">Page removed</div>`) +
          `</div></div></div>`,
      )
      .join('') +
    `</div>` +
    (more > 0
      ? `<div class="ws-note ws-preview-more">+${more} more page${more === 1 ? '' : 's'} affected</div>`
      : '')
  );
}

/** Pure: the preview body when preview computation/rendering failed —
 * the accept/reject actions above stay intact either way. */
export function renderProposalPreviewErrorHtml(message: string): string {
  return (
    `<div class="ws-note">Preview unavailable (${esc(message)}) — ` +
    `see the operation list above.</div>`
  );
}

export function mountWorkspacePanel(
  host: WorkspacePanelHost,
): WorkspacePanelHandle {
  let activeWorkspace: ActiveWorkspace | null = null;
  let workspaceAuthenticated = false;
  let workspacePanel: HTMLElement | null = null;
  let workspaceChoices: WorkspaceListItem[] = [];
  // Set from the empty-state `listWorkspaces()` call in refreshWorkspaceChoices;
  // swaps the panel's hand-off/open card for a plain disabled notice instead of
  // offering actions that would just 503 (see WorkspaceDisabledError).
  let workspaceDisabled = false;
  let workspaceSaveTimer: ReturnType<typeof setTimeout> | undefined;
  // The push socket (Packet S1) — a pure accelerant over the 8s poll below.
  // Null whenever it is closed/down; the poll loop keeps running regardless.
  let workspaceSocket: WorkspaceSocketHandle | null = null;

  // Rendered before/after proposal preview (Packet R1) state. Kept apart
  // from `ActiveWorkspace` because it's a lazy, per-proposal-id UI cache —
  // reset whenever the active workspace changes, never part of sync/commit.
  type ProposalPreviewState =
    | { status: 'loading' }
    | {
        status: 'ready';
        frames: RenderedPreviewFrame[];
        totalAffected: number;
        /** Per proposal-operation index: the element ids it touches, for the
         * operation-list click → flash-in-preview wiring. */
        opElements: string[][];
      }
    | { status: 'error'; message: string };
  const previewOpen = new Set<string>();
  const previewState = new Map<string, ProposalPreviewState>();

  function resetProposalPreviews(): void {
    previewOpen.clear();
    previewState.clear();
  }

  function closeWorkspaceSocket(): void {
    workspaceSocket?.close();
    workspaceSocket = null;
  }

  /** The browser's connectivity signal — defaults to online when `navigator`
   * doesn't expose `onLine` (drives the offline/pending indicator only; sync
   * correctness never depends on it). */
  function isOnline(): boolean {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  /**
   * Mirror the current workspace's confirmed snapshot + unacked batch into the
   * IndexedDB cache (Packet S3). Fire-and-forget: `cacheWorkspace` never rejects
   * and degrades to a no-op when IndexedDB is unavailable, so a cache failure can
   * never block editing or sync. Paired with every `writeWorkspaceLink` call —
   * the localStorage link stays the lightweight pointer/index, the IDB cache
   * holds the heavy document + pending so state survives a fully offline reload.
   */
  function cacheActiveWorkspace(pending: CommitRequest | null = null): void {
    const workspace = activeWorkspace;
    if (!workspace) return;
    void cacheWorkspace(workspace.id, {
      revision: workspace.revision,
      document: workspace.lastSynced,
      pending,
    });
  }

  /**
   * (Re)open the push socket for the active workspace. A notice just triggers an
   * immediate cheap `refreshWorkspaceState` (same path the poll uses) and paints
   * the presence roster; if the socket goes down the poll loop already covers
   * correctness, so we only clear the roster and let polling continue. This is
   * what makes "a lost message degrades to polling" true by construction.
   */
  function connectWorkspaceSocket(): void {
    closeWorkspaceSocket();
    const workspace = activeWorkspace;
    if (!workspace || !workspaceAuthenticated) return;
    workspaceSocket = openWorkspaceSocket(workspace.id, {
      pageId: host.getCurrentPageId(),
      onNotice: (notice: WorkspaceNotice) => {
        // Ignore a notice that arrives after the workspace changed underneath.
        if (activeWorkspace !== workspace) return;
        workspace.presence = notice.presence;
        // The notice carries no content — re-hydrate through the poll path.
        void refreshWorkspaceState(true);
      },
      onDown: () => {
        if (activeWorkspace !== workspace) return;
        workspaceSocket = null;
        workspace.presence = [];
        renderWorkspacePanel();
        // Polling (the 8s loop) remains the baseline — nothing else to do.
      },
    });
  }

  function findPreviewContainer(proposalId: string): HTMLElement | null {
    const containers =
      workspacePanel?.querySelectorAll<HTMLElement>('.ws-preview');
    if (!containers) return null;
    for (const el of containers) if (el.dataset.pid === proposalId) return el;
    return null;
  }

  /** Paint the cached preview state for one proposal into its container
   * without touching the rest of the panel (keeps other proposals/scroll
   * position stable across a poll-driven full re-render). */
  function paintProposalPreview(proposalId: string): void {
    const container = findPreviewContainer(proposalId);
    if (!container) return;
    const state = previewState.get(proposalId);
    if (!state) {
      container.innerHTML = '';
      return;
    }
    if (state.status === 'loading')
      container.innerHTML = `<div class="ws-note">Rendering preview…</div>`;
    else if (state.status === 'error')
      container.innerHTML = renderProposalPreviewErrorHtml(state.message);
    else
      container.innerHTML = renderProposalPreviewHtml(
        state.frames,
        state.totalAffected,
      );
  }

  /**
   * Lazily fetch proposal detail (operations) + the current canonical
   * snapshot, compute the pure preview, and render each affected page (capped
   * at 3) through the same browser SVG engine path the editor/export use
   * (`pageToSVG`, `{ calm: true }` for a static frame), with geometry-aware
   * change-highlight overlays on both frames (removals on "before", additions
   * on "after", modifications on both). Never mutates the live document —
   * `computeProposalPreview` and the snapshot are both clones/fresh fetches.
   * Any failure (network, invalid operations, engine render) degrades to the
   * existing semantic summary already shown above the toggle; it never
   * touches accept/reject.
   */
  async function loadProposalPreview(proposalId: string): Promise<void> {
    const workspace = activeWorkspace;
    if (!workspace) return;
    previewState.set(proposalId, { status: 'loading' });
    paintProposalPreview(proposalId);
    try {
      const [detail, snapshot] = await Promise.all([
        getWorkspaceProposal(workspace.id, proposalId),
        getWorkspace(workspace.id),
      ]);
      const pages = computeProposalPreview(
        snapshot.document.pages,
        detail.operations,
      );
      const shown = pages.slice(0, 3);
      const frames: RenderedPreviewFrame[] = shown.map((page) => ({
        pageId: page.pageId,
        pageName: page.pageName,
        beforeSvg: page.before
          ? pageToSVG(
              page.before,
              { calm: true },
              renderChangedElementOverlay(page.before, page.changes, 'before'),
            )
          : null,
        afterSvg: page.after
          ? pageToSVG(
              page.after,
              { calm: true },
              renderChangedElementOverlay(page.after, page.changes, 'after'),
            )
          : null,
      }));
      if (activeWorkspace !== workspace) return; // workspace changed under the fetch
      previewState.set(proposalId, {
        status: 'ready',
        frames,
        totalAffected: pages.length,
        opElements: detail.operations.map(operationElementIds),
      });
    } catch (error) {
      previewState.set(proposalId, {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    paintProposalPreview(proposalId);
  }

  function toggleProposalPreview(proposalId: string): void {
    const container = findPreviewContainer(proposalId);
    if (previewOpen.has(proposalId)) {
      previewOpen.delete(proposalId);
      if (container) container.hidden = true;
      return;
    }
    previewOpen.add(proposalId);
    if (container) container.hidden = false;
    if (previewState.has(proposalId)) paintProposalPreview(proposalId);
    else void loadProposalPreview(proposalId);
  }

  /** Scroll the first highlight shape for `opIndex`'s elements into view and
   * pulse a stronger outline on all of them (both frames), so a click on an
   * operation description points straight at the geometry it changes. */
  function flashOperationGeometry(proposalId: string, opIndex: number): void {
    const state = previewState.get(proposalId);
    const container = findPreviewContainer(proposalId);
    if (!container || state?.status !== 'ready') return;
    const ids = state.opElements[opIndex] ?? [];
    const targets: Element[] = [];
    for (const id of ids)
      container
        .querySelectorAll(`[data-el="${CSS.escape(id)}"]`)
        .forEach((el) => targets.push(el));
    if (!targets.length) return;
    targets[0]!.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    for (const el of targets) el.classList.remove('ws-hl-focus');
    // Re-add on the next frame so a repeat click restarts the CSS animation.
    requestAnimationFrame(() => {
      for (const el of targets) el.classList.add('ws-hl-focus');
    });
    setTimeout(() => {
      for (const el of targets) el.classList.remove('ws-hl-focus');
    }, 1800);
  }

  /** Operation-description click: make sure the proposal's preview is open
   * and rendered (loading it on first use), then flash that operation's
   * changed geometry. A load already in flight repaints on completion; the
   * flash is then a no-op rather than a duplicate fetch. */
  async function focusOperationGeometry(
    proposalId: string,
    opIndex: number,
  ): Promise<void> {
    if (!previewOpen.has(proposalId)) {
      previewOpen.add(proposalId);
      const container = findPreviewContainer(proposalId);
      if (container) container.hidden = false;
      if (previewState.has(proposalId)) paintProposalPreview(proposalId);
    }
    if (!previewState.has(proposalId)) await loadProposalPreview(proposalId);
    flashOperationGeometry(proposalId, opIndex);
  }

  function closeWorkspaceForDocumentReplacement(): boolean {
    const workspace = activeWorkspace;
    if (!workspace) return true;
    const unsynced = workspaceHasLocalChanges(workspace) || workspace.pending;
    if (
      !confirm(
        `Close shared workspace ${workspace.id} and start a separate local document? The canonical workspace remains at revision ${workspace.revision}.${unsynced ? ' Unsynced browser edits will be discarded.' : ''}`,
      )
    )
      return false;
    clearTimeout(workspaceSaveTimer);
    closeWorkspaceSocket();
    void clearCachedWorkspace(workspace.id);
    activeWorkspace = null;
    workspaceChoices = [];
    resetProposalPreviews();
    localStorage.removeItem(WORKSPACE_LINK_KEY);
    updateWorkspaceChip();
    renderWorkspacePanel();
    return true;
  }

  function workspaceFingerprint(value: TopologyDocument): string {
    const source = serializeDoc(value);
    let hash = 0x811c9dc5;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return `${source.length}:${(hash >>> 0).toString(36)}`;
  }

  function readWorkspaceLink(): StoredWorkspaceLink | null {
    try {
      const raw = localStorage.getItem(WORKSPACE_LINK_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredWorkspaceLink>;
      return typeof parsed.id === 'string' &&
        typeof parsed.revision === 'number' &&
        typeof parsed.syncedFingerprint === 'string'
        ? (parsed as StoredWorkspaceLink)
        : null;
    } catch {
      return null;
    }
  }

  function writeWorkspaceLink(pending?: CommitRequest): void {
    const workspace = activeWorkspace;
    if (!workspace) return;
    const value: StoredWorkspaceLink = {
      id: workspace.id,
      revision: workspace.revision,
      syncedFingerprint: workspaceFingerprint(workspace.lastSynced),
      ...(pending ? { pending } : {}),
    };
    try {
      localStorage.setItem(WORKSPACE_LINK_KEY, JSON.stringify(value));
    } catch {
      workspace.error =
        'Could not save workspace recovery state in this browser. Export JSON before closing.';
    }
  }

  function operationId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  /**
   * Choose the operations to commit for the local changes between `lastSynced`
   * and `target` (Packet S2 — the runtime referee).
   *
   * The editor emits intent-faithful ops per gesture; the snapshot diff
   * reconstructs ops from the two document states. We prefer the emitted ops,
   * but only after proving they reproduce the exact same document the diff
   * would — otherwise (an un-instrumented gesture, undo/redo, a page switch, or
   * any emission bug) we fall back to the diff. Because the fallback is today's
   * behavior and the emitted path is committed only when byte-identical to it,
   * the resulting document is never corrupted; fidelity only improves as gesture
   * coverage grows.
   */
  function chooseCommitOperations(
    lastSynced: TopologyDocument,
    target: TopologyDocument,
  ): WorkspaceOperation[] {
    const diffOps = diffDocuments(lastSynced, target);
    const emitted = host.takePendingOperations();
    // Nothing changed on net, or the editor emitted nothing → today's behavior.
    if (!diffOps.length || !emitted.length) return diffOps;
    try {
      const viaEmitted = applyOperations(lastSynced, emitted);
      const viaDiff = applyOperations(lastSynced, diffOps);
      if (JSON.stringify(viaEmitted) === JSON.stringify(viaDiff))
        return emitted;
      warnRefereeDivergence(emitted, diffOps);
    } catch (error) {
      warnRefereeDivergence(emitted, diffOps, error);
    }
    return diffOps;
  }

  /** Dev-only: surface a gap between emitted intent and the snapshot diff so it
   * is discoverable. Enabled via `localStorage['tds-op-referee']`. */
  function warnRefereeDivergence(
    emitted: WorkspaceOperation[],
    diffOps: WorkspaceOperation[],
    error?: unknown,
  ): void {
    let on = false;
    try {
      on = Boolean(localStorage.getItem('tds-op-referee'));
    } catch {
      on = false;
    }
    if (!on) return;
    console.warn(
      '[tds-op-referee] emitted operations did not reproduce the snapshot diff; falling back to diff.',
      { emitted, diffOps, ...(error ? { error } : {}) },
    );
  }

  function workspaceHasLocalChanges(workspace: ActiveWorkspace): boolean {
    return diffDocuments(workspace.lastSynced, host.getDoc()).length > 0;
  }

  // Shell-facing state listeners (issue #212). Emission is deduped on the
  // serialized snapshot, so hooking the two render chokepoints below is safe
  // no matter how often they run — announcements/toasts fire on transitions
  // only, never on a poll refresh with unchanged state.
  const stateListeners = new Set<(state: WorkspacePanelState) => void>();
  let lastEmittedState = '';
  let prevState: WorkspacePanelState | null = null;

  /** Polite live region for chip-state announcements (issue #212). Created
   * lazily so the test-friendly mount path stays DOM-light until needed. */
  let liveRegion: HTMLElement | null = null;
  function announce(text: string): void {
    if (!liveRegion) {
      liveRegion = document.createElement('div');
      liveRegion.className = 'visually-hidden';
      liveRegion.setAttribute('aria-live', 'polite');
      document.body.appendChild(liveRegion);
    }
    // Clear first so an identical message later still re-announces.
    liveRegion.textContent = '';
    liveRegion.textContent = text;
  }

  /** Transient click-through toast near the chip when a NEW proposal arrives
   * while the panel is closed (issue #212). */
  let proposalToast: HTMLElement | null = null;
  let proposalToastTimer: ReturnType<typeof setTimeout> | undefined;
  function dismissProposalToast(): void {
    clearTimeout(proposalToastTimer);
    proposalToast?.remove();
    proposalToast = null;
  }
  function showProposalToast(count: number): void {
    dismissProposalToast();
    const toast = document.createElement('button');
    toast.type = 'button';
    toast.className = 'ws-toast';
    toast.textContent = `${count} agent proposal${count === 1 ? '' : 's'} awaiting review — click to open`;
    const r = host.chip.getBoundingClientRect();
    toast.style.top = `${Math.round(r.bottom + 8)}px`;
    toast.style.right = `${Math.round(Math.max(8, window.innerWidth - r.right))}px`;
    toast.addEventListener('click', () => {
      dismissProposalToast();
      openToProposal();
    });
    document.body.appendChild(toast);
    proposalToast = toast;
    proposalToastTimer = setTimeout(dismissProposalToast, 8000);
  }

  function emitPanelState(): void {
    const state = computeWorkspacePanelState(activeWorkspace, isOnline());
    const key = JSON.stringify(state);
    if (key === lastEmittedState) return;
    lastEmittedState = key;
    const announcement = computeChipAnnouncement(prevState, state);
    if (announcement) announce(announcement);
    // Toast only for an increase while the panel is closed; the initial
    // restore is covered by the chip text + announcement.
    if (
      prevState &&
      !workspacePanel &&
      state.pendingProposals > prevState.pendingProposals
    )
      showProposalToast(state.pendingProposals);
    if (state.pendingProposals === 0) dismissProposalToast();
    prevState = state;
    for (const listener of stateListeners) listener(state);
  }

  function updateWorkspaceChip(): void {
    const state = computeWorkspaceChipState(activeWorkspace, isOnline());
    host.chip.classList.toggle('on', state.on);
    host.chip.classList.toggle('conflict', state.conflict);
    host.chipLabel.textContent = state.label;
    host.chip.title = state.title;
    emitPanelState();
  }

  function scheduleWorkspaceSync(): void {
    const workspace = activeWorkspace;
    if (!workspace || workspace.paused || !workspaceAuthenticated) return;
    clearTimeout(workspaceSaveTimer);
    workspaceSaveTimer = setTimeout(() => void syncWorkspace(), 300);
  }

  async function syncWorkspace(force = false): Promise<boolean> {
    const workspace = activeWorkspace;
    if (!workspace || workspace.paused) return false;
    if (workspace.syncing) return false;

    let request = workspace.pending;
    let target = workspace.pendingTarget;
    if (force) clearTimeout(workspaceSaveTimer);
    if (!request) {
      target = structuredClone(host.getDoc());
      const operations = chooseCommitOperations(workspace.lastSynced, target);
      if (!operations.length) {
        workspace.status = 'synced';
        workspace.error = null;
        updateWorkspaceChip();
        renderWorkspacePanel();
        return true;
      }
      request = {
        baseRevision: workspace.revision,
        operationId: operationId('ui'),
        operations,
      };
      workspace.pending = request;
      workspace.pendingTarget = target;
    }

    workspace.syncing = true;
    workspace.status = `syncing ${request.operations.length} change${request.operations.length === 1 ? '' : 's'}…`;
    workspace.error = null;
    writeWorkspaceLink(request);
    // Persist the unacked batch alongside the confirmed snapshot so a crash
    // mid-flight preserves it for idempotent replay (its operationId dedupes).
    cacheActiveWorkspace(request);
    updateWorkspaceChip();
    renderWorkspacePanel();
    try {
      const result = await commitWorkspaceOperations(workspace.id, request);
      if (!result.ok) {
        workspace.status = 'needs review';
        workspace.error = result.message;
        workspace.revision = result.revision;
        workspace.paused = true;
        writeWorkspaceLink(request);
        cacheActiveWorkspace(request);
        return false;
      }
      workspace.revision = result.revision;
      workspace.lastSynced = target ?? structuredClone(host.getDoc());
      workspace.pending = null;
      workspace.pendingTarget = null;
      workspace.status = result.rebased ? 'synced · rebased' : 'synced';
      workspace.error = null;
      writeWorkspaceLink();
      cacheActiveWorkspace();
      host.savedEl.textContent = '✓ synced';
      if (workspaceHasLocalChanges(workspace)) scheduleWorkspaceSync();
      return true;
    } catch (error) {
      workspace.status = 'offline · retry pending';
      workspace.error = error instanceof Error ? error.message : String(error);
      writeWorkspaceLink(request);
      cacheActiveWorkspace(request);
      clearTimeout(workspaceSaveTimer);
      workspaceSaveTimer = setTimeout(() => void syncWorkspace(), 5000);
      return false;
    } finally {
      workspace.syncing = false;
      updateWorkspaceChip();
      renderWorkspacePanel();
    }
  }

  function adoptWorkspaceSnapshot(
    snapshot: Awaited<ReturnType<typeof getWorkspace>>,
    status = 'synced',
  ): void {
    const workspace = activeWorkspace;
    if (!workspace) return;
    workspace.revision = snapshot.revision;
    workspace.lastSynced = structuredClone(snapshot.document);
    workspace.pending = null;
    workspace.pendingTarget = null;
    workspace.paused = false;
    workspace.status = status;
    workspace.error = null;
    host.loadDoc(snapshot.document, false);
    writeWorkspaceLink();
    cacheActiveWorkspace();
    updateWorkspaceChip();
  }

  async function refreshWorkspaceState(autoPull = true): Promise<void> {
    const workspace = activeWorkspace;
    if (!workspace) return;
    try {
      const [manifest, proposals, checkpoints] = await Promise.all([
        getWorkspaceManifest(workspace.id),
        listWorkspaceProposals(workspace.id),
        listWorkspaceCheckpoints(workspace.id),
      ]);
      if (activeWorkspace !== workspace) return;
      workspace.manifest = manifest;
      workspace.proposals = proposals;
      workspace.checkpoints = checkpoints;
      // Recent revisions for the timeline (compact summaries only). Fetched
      // relative to the just-learned head so the newest changes always show.
      try {
        workspace.timeline = await getWorkspaceChanges(
          workspace.id,
          Math.max(0, manifest.revision - TIMELINE_LIMIT),
          TIMELINE_LIMIT,
        );
      } catch {
        // A timeline fetch failure is non-fatal — leave the last-known log.
      }
      if (autoPull && manifest.revision > workspace.revision) {
        if (!workspaceHasLocalChanges(workspace) && !workspace.pending) {
          adoptWorkspaceSnapshot(
            await getWorkspace(workspace.id),
            'synced · agent update received',
          );
        } else if (!workspace.paused) {
          await syncWorkspace(); // coordinator rebases disjoint work or reports conflict
        }
      }
    } catch (error) {
      workspace.error = error instanceof Error ? error.message : String(error);
    }
    updateWorkspaceChip();
    renderWorkspacePanel();
  }

  async function handOffCurrentDocument(): Promise<void> {
    if (!workspaceAuthenticated) return;
    const chip = host.chip;
    chip.disabled = true;
    try {
      const snapshot = await createWorkspace(structuredClone(host.getDoc()));
      activeWorkspace = {
        id: snapshot.id,
        revision: snapshot.revision,
        lastSynced: structuredClone(snapshot.document),
        manifest: null,
        proposals: [],
        checkpoints: [],
        timeline: null,
        presence: [],
        pending: null,
        pendingTarget: null,
        syncing: false,
        paused: false,
        status: 'handed off · suggest only',
        error: null,
      };
      writeWorkspaceLink();
      cacheActiveWorkspace();
      updateWorkspaceChip();
      connectWorkspaceSocket();
      await refreshWorkspaceState(false);
    } catch (error) {
      alert(
        error instanceof Error ? error.message : 'Workspace handoff failed.',
      );
    } finally {
      chip.disabled = false;
      renderWorkspacePanel();
    }
  }

  async function refreshWorkspaceChoices(): Promise<void> {
    if (!workspaceAuthenticated || activeWorkspace) return;
    try {
      workspaceChoices = await listWorkspaces();
      workspaceDisabled = false;
    } catch (error) {
      workspaceChoices = [];
      workspaceDisabled = error instanceof WorkspaceDisabledError;
    }
    renderWorkspacePanel();
  }

  async function openExistingWorkspace(id: string): Promise<void> {
    if (
      !confirm(
        'Open this canonical workspace? Your current local document remains in browser autosave but will leave the canvas.',
      )
    )
      return;
    const snapshot = await getWorkspace(id);
    activeWorkspace = {
      id,
      revision: snapshot.revision,
      lastSynced: structuredClone(snapshot.document),
      manifest: null,
      proposals: [],
      checkpoints: [],
      timeline: null,
      presence: [],
      pending: null,
      pendingTarget: null,
      syncing: false,
      paused: false,
      status: 'opened · suggest only',
      error: null,
    };
    adoptWorkspaceSnapshot(snapshot, 'opened · synced');
    connectWorkspaceSocket();
    await refreshWorkspaceState(false);
  }

  async function restoreWorkspace(): Promise<void> {
    const saved = readWorkspaceLink();
    if (!saved) return;

    // Packet S3: reconstruct the workspace from the IndexedDB cache *first*, so
    // the chip/panel and the confirmed baseline (lastSynced + revision) come up
    // even fully offline — no server round-trip required. The editor's live
    // document is already restored by `main.ts`'s own autosave and may hold
    // unsynced edits, so we never clobber it here; the cache supplies only the
    // workspace baseline and any unacknowledged batch to replay. The cache is
    // authoritative for the heavy pending batch; the localStorage link remains
    // the lightweight pointer (which id to reopen) and a pending fallback.
    const cached = await readCachedWorkspace(saved.id);
    if (cached) {
      const pending = cached.pending ?? saved.pending ?? null;
      activeWorkspace = {
        id: saved.id,
        revision: cached.revision,
        lastSynced: structuredClone(cached.document),
        manifest: null,
        proposals: [],
        checkpoints: [],
        timeline: null,
        presence: [],
        pending,
        pendingTarget: pending ? structuredClone(host.getDoc()) : null,
        syncing: false,
        paused: false,
        status: isOnline() ? 'reconnecting…' : 'offline · cached',
        error: null,
      };
      updateWorkspaceChip();
      renderWorkspacePanel();
    }

    try {
      const snapshot = await getWorkspace(saved.id);
      // No cache (feature absent / first run on this browser) — reconstruct from
      // the server exactly as before, preserving the original recovery behavior.
      if (!activeWorkspace) {
        activeWorkspace = {
          id: saved.id,
          revision: snapshot.revision,
          lastSynced: structuredClone(snapshot.document),
          manifest: null,
          proposals: [],
          checkpoints: [],
          timeline: null,
          presence: [],
          pending: saved.pending ?? null,
          pendingTarget: saved.pending ? structuredClone(host.getDoc()) : null,
          syncing: false,
          paused: false,
          status: 'reconnecting…',
          error: null,
        };
      }

      // Replay the unacknowledged batch (idempotent — its operationId dedupes at
      // the coordinator). A stale cached baseRevision rebases or reports a
      // conflict through the existing commit path; no new conflict path here.
      if (activeWorkspace.pending) {
        const ok = await syncWorkspace();
        if (ok)
          adoptWorkspaceSnapshot(
            await getWorkspace(saved.id),
            'recovered · synced',
          );
      } else if (
        workspaceFingerprint(host.getDoc()) === saved.syncedFingerprint
      ) {
        adoptWorkspaceSnapshot(snapshot);
      } else {
        activeWorkspace.paused = true;
        activeWorkspace.status = 'local recovery paused';
        activeWorkspace.error =
          'This browser has local edits newer than its last confirmed workspace sync. Choose “sync local copy” or “reload server” below.';
      }
      connectWorkspaceSocket();
      await refreshWorkspaceState(false);
    } catch (error) {
      // Offline (server unreachable). When we have a cached workspace, keep it
      // live and wait for reconnect (the online listener + retry timer replay
      // any pending batch); otherwise fall back to today's give-up behavior.
      if (activeWorkspace && cached) {
        activeWorkspace.status = 'offline · cached';
        renderWorkspacePanel();
      } else {
        activeWorkspace = null;
        console.error('workspace reconnect failed', error);
      }
    }
    updateWorkspaceChip();
  }

  let releasePanelOverlay: (() => void) | null = null;

  function closeWorkspacePanel(): void {
    workspacePanel?.remove();
    workspacePanel = null;
    host.chip.setAttribute('aria-expanded', 'false');
    releasePanelOverlay?.();
    releasePanelOverlay = null;
  }

  function renderWorkspacePanel(): void {
    emitPanelState(); // proposal/pending changes reach here even when the chip text doesn't change
    if (!workspacePanel) return;
    const workspace = activeWorkspace;
    const body = workspacePanel.querySelector<HTMLElement>('#wsBody');
    if (!body) return;
    if (!workspace) {
      if (workspaceDisabled) {
        body.innerHTML = renderWorkspaceDisabledHtml();
        body
          .querySelector('#wsRefreshList')
          ?.addEventListener('click', () => void refreshWorkspaceChoices());
        return;
      }
      body.innerHTML = renderWorkspaceChoicesHtml(workspaceChoices);
      body
        .querySelector('#wsHandoff')
        ?.addEventListener('click', () => void handOffCurrentDocument());
      body
        .querySelector('#wsRefreshList')
        ?.addEventListener('click', () => void refreshWorkspaceChoices());
      body.querySelectorAll<HTMLButtonElement>('.ws-open').forEach((button) => {
        button.addEventListener('click', () => {
          void openExistingWorkspace(button.dataset.wid!).catch((error) =>
            alert(
              error instanceof Error
                ? error.message
                : 'Could not open workspace.',
            ),
          );
        });
      });
      return;
    }

    body.innerHTML = renderActiveWorkspaceHtml(workspace, isOnline());

    body.querySelector('#wsCopy')?.addEventListener('click', () => {
      void navigator.clipboard.writeText(workspace.id).catch(() => undefined);
    });
    body.querySelector('#wsSync')?.addEventListener('click', () => {
      workspace.paused = false;
      void syncWorkspace(true).then(() => refreshWorkspaceState(false));
    });
    body.querySelector('#wsResume')?.addEventListener('click', () => {
      workspace.paused = false;
      workspace.error = null;
      workspace.pending = null;
      workspace.pendingTarget = null;
      void syncWorkspace(true).then(() => refreshWorkspaceState(false));
    });
    body.querySelector('#wsReload')?.addEventListener('click', () => {
      if (
        workspaceHasLocalChanges(workspace) &&
        !confirm(
          'Discard this browser’s unsynced edits and reload the canonical workspace?',
        )
      )
        return;
      void getWorkspace(workspace.id).then((snapshot) => {
        adoptWorkspaceSnapshot(snapshot, 'reloaded · synced');
        void refreshWorkspaceState(false);
      });
    });
    body.querySelector('#wsDetach')?.addEventListener('click', () => {
      void (async () => {
        if (workspaceHasLocalChanges(workspace) && !(await syncWorkspace()))
          return;
        closeWorkspaceSocket();
        void clearCachedWorkspace(workspace.id);
        activeWorkspace = null;
        resetProposalPreviews();
        localStorage.removeItem(WORKSPACE_LINK_KEY);
        workspaceChoices = [];
        updateWorkspaceChip();
        renderWorkspacePanel();
        await refreshWorkspaceChoices();
      })();
    });
    body.querySelector('#wsLease')?.addEventListener('click', () => {
      void (async () => {
        if (!(await syncWorkspace())) return;
        await grantWorkspaceLease(workspace.id, host.getCurrentPageId(), 600);
        await refreshWorkspaceState(false);
      })().catch((error) => {
        workspace.error =
          error instanceof Error ? error.message : String(error);
        renderWorkspacePanel();
      });
    });
    body.querySelector('#wsRevoke')?.addEventListener('click', () => {
      void revokeWorkspaceLease(workspace.id)
        .then(() => refreshWorkspaceState(false))
        .catch((error) => {
          workspace.error =
            error instanceof Error ? error.message : String(error);
          renderWorkspacePanel();
        });
    });
    const runAccept = (
      proposalId: string,
      selectedOperationIndices?: number[],
    ): void => {
      void (async () => {
        if (workspaceHasLocalChanges(workspace) && !(await syncWorkspace()))
          return;
        const result = await acceptWorkspaceProposal(
          workspace.id,
          proposalId,
          operationId('ui_accept'),
          selectedOperationIndices,
        );
        if (!result.ok) {
          workspace.error = result.message;
          workspace.status =
            result.code === 'incoherent-subset'
              ? 'incomplete selection'
              : 'proposal conflict';
          renderWorkspacePanel();
          return;
        }
        previewOpen.delete(proposalId);
        previewState.delete(proposalId);
        adoptWorkspaceSnapshot(
          await getWorkspace(workspace.id),
          selectedOperationIndices
            ? 'proposal partially accepted · synced'
            : 'proposal accepted · synced',
        );
        await refreshWorkspaceState(false);
      })().catch((error) => {
        workspace.error =
          error instanceof Error ? error.message : String(error);
        renderWorkspacePanel();
      });
    };

    body.querySelectorAll<HTMLButtonElement>('.ws-accept').forEach((button) => {
      button.addEventListener('click', () => runAccept(button.dataset.pid!));
    });
    body
      .querySelectorAll<HTMLButtonElement>('.ws-accept-selected')
      .forEach((button) => {
        button.addEventListener('click', () => {
          const proposalId = button.dataset.pid!;
          const checks = body.querySelectorAll<HTMLInputElement>(
            `.ws-op-check[data-pid="${CSS.escape(proposalId)}"]`,
          );
          const selected = [...checks]
            .filter((check) => check.checked)
            .map((check) => Number(check.dataset.opIndex));
          if (selected.length === 0) {
            workspace.error = 'Select at least one operation to accept.';
            renderWorkspacePanel();
            return;
          }
          // Everything ticked → a full accept (also folds in any operations
          // beyond the listed first 100). A strict subset sends the indices.
          runAccept(
            proposalId,
            selected.length === checks.length ? undefined : selected,
          );
        });
      });
    body.querySelectorAll<HTMLButtonElement>('.ws-reject').forEach((button) => {
      button.addEventListener('click', () => {
        const proposalId = button.dataset.pid!;
        void rejectWorkspaceProposal(workspace.id, proposalId)
          .then(() => {
            previewOpen.delete(proposalId);
            previewState.delete(proposalId);
            return refreshWorkspaceState(false);
          })
          .catch((error) => {
            workspace.error =
              error instanceof Error ? error.message : String(error);
            renderWorkspacePanel();
          });
      });
    });
    body
      .querySelectorAll<HTMLButtonElement>('.ws-preview-toggle')
      .forEach((button) => {
        button.addEventListener('click', () =>
          toggleProposalPreview(button.dataset.pid!),
        );
      });
    body
      .querySelectorAll<HTMLButtonElement>('.ws-op-jump')
      .forEach((button) => {
        button.addEventListener('click', () => {
          void focusOperationGeometry(
            button.dataset.pid!,
            Number(button.dataset.opIndex),
          );
        });
      });
    // A poll-driven re-render replaces the whole body; repaint any preview
    // the owner had left open instead of silently collapsing it.
    body.querySelectorAll<HTMLElement>('.ws-preview').forEach((container) => {
      const proposalId = container.dataset.pid!;
      if (previewOpen.has(proposalId)) {
        container.hidden = false;
        paintProposalPreview(proposalId);
      }
    });

    const checkpointFailure = (error: unknown): void => {
      workspace.error = error instanceof Error ? error.message : String(error);
      renderWorkspacePanel();
    };
    body.querySelector('#wsCheckpointCreate')?.addEventListener('click', () => {
      const name = body
        .querySelector<HTMLInputElement>('#wsCheckpointName')
        ?.value.trim();
      if (!name) {
        workspace.error = 'Name the checkpoint before saving.';
        renderWorkspacePanel();
        return;
      }
      void (async () => {
        await createWorkspaceCheckpoint(workspace.id, name);
        await refreshWorkspaceState(false);
      })().catch(checkpointFailure);
    });
    body
      .querySelectorAll<HTMLButtonElement>('.ws-cp-restore')
      .forEach((button) => {
        button.addEventListener('click', () => {
          const checkpointId = button.dataset.cid!;
          if (
            !confirm(
              'Restore this checkpoint as a new forward revision? Any local edits sync first; history is not rewritten.',
            )
          )
            return;
          void (async () => {
            if (workspaceHasLocalChanges(workspace) && !(await syncWorkspace()))
              return;
            const result = await restoreWorkspaceCheckpoint(
              workspace.id,
              checkpointId,
              operationId('ui_restore'),
            );
            if (!result.ok) {
              workspace.error = result.message;
              workspace.status = 'restore conflict';
              renderWorkspacePanel();
              return;
            }
            adoptWorkspaceSnapshot(
              await getWorkspace(workspace.id),
              'checkpoint restored · synced',
            );
            await refreshWorkspaceState(false);
          })().catch(checkpointFailure);
        });
      });
    body
      .querySelectorAll<HTMLButtonElement>('.ws-cp-fork')
      .forEach((button) => {
        button.addEventListener('click', () => {
          const checkpointId = button.dataset.cid!;
          void (async () => {
            const fork = await forkWorkspaceCheckpoint(
              workspace.id,
              checkpointId,
            );
            workspace.error = null;
            workspace.status = `forked into ${fork.workspaceId}`;
            renderWorkspacePanel();
          })().catch(checkpointFailure);
        });
      });
    body
      .querySelectorAll<HTMLButtonElement>('.ws-cp-delete')
      .forEach((button) => {
        button.addEventListener('click', () => {
          const checkpointId = button.dataset.cid!;
          if (!confirm('Delete this checkpoint? This cannot be undone.'))
            return;
          void (async () => {
            await deleteWorkspaceCheckpoint(workspace.id, checkpointId);
            await refreshWorkspaceState(false);
          })().catch(checkpointFailure);
        });
      });
  }

  function openWorkspacePanel(): void {
    if (workspacePanel) {
      closeWorkspacePanel();
      return;
    }
    workspacePanel = document.createElement('div');
    workspacePanel.className = 'workspace-panel scroll-slim';
    workspacePanel.setAttribute('role', 'dialog');
    workspacePanel.setAttribute('aria-label', 'Agent Workspace');
    workspacePanel.innerHTML =
      `<div class="ws-head"><h3>Agent Workspace</h3><button class="tbtn ticon" id="wsClose" title="Close" aria-label="Close">✕</button></div>` +
      `<div id="wsBody"></div>`;
    document.body.appendChild(workspacePanel);
    workspacePanel
      .querySelector('#wsClose')
      ?.addEventListener('click', () => closeWorkspacePanel());
    host.chip.setAttribute('aria-expanded', 'true');
    // Focus trap + Escape + focus restore (issue #209).
    releasePanelOverlay = registerOverlay(workspacePanel, {
      close: closeWorkspacePanel,
    });
    dismissProposalToast(); // the panel itself now shows the proposals
    renderWorkspacePanel();
    if (activeWorkspace) void refreshWorkspaceState(true);
    else void refreshWorkspaceChoices();
  }

  function enableWorkspaceUi(): void {
    workspaceAuthenticated = true;
    host.chip.hidden = false;
    host.chipDivider.hidden = false;
    host.chip.addEventListener('click', (event) => {
      event.stopPropagation();
      // Attention-first click routing (issue #212): a conflict lands on the
      // conflict notice, pending proposals on the first proposal card;
      // otherwise the existing open/close toggle.
      const state = computeWorkspacePanelState(activeWorkspace, isOnline());
      if (state.conflict) openToConflict();
      else if (state.pendingProposals > 0) openToProposal();
      else openWorkspacePanel();
    });
    updateWorkspaceChip();
    void restoreWorkspace();
  }

  function flushBeforeUnload(): void {
    const workspace = activeWorkspace;
    if (!workspace) return;
    if (workspace.pending) writeWorkspaceLink(workspace.pending);
    else {
      const operations = diffDocuments(workspace.lastSynced, host.getDoc());
      writeWorkspaceLink(
        operations.length
          ? {
              baseRevision: workspace.revision,
              operationId: operationId('ui_recovery'),
              operations,
            }
          : undefined,
      );
    }
  }

  setInterval(() => {
    if (activeWorkspace && !activeWorkspace.syncing)
      void refreshWorkspaceState(true);
  }, 8000);

  // Packet S3: the browser's online/offline transitions drive the indicator and
  // accelerate replay. Coming back online, flush any pending batch (idempotent
  // replay) and re-hydrate; the 8s poll and the 5s retry timer already cover
  // correctness, so these listeners are a pure accelerant, never a dependency.
  if (
    typeof window !== 'undefined' &&
    typeof window.addEventListener === 'function'
  ) {
    window.addEventListener('online', () => {
      const workspace = activeWorkspace;
      if (!workspace) return;
      void (async () => {
        if (!workspaceSocket) connectWorkspaceSocket();
        if (workspace.pending && !workspace.paused) await syncWorkspace();
        await refreshWorkspaceState(true);
      })();
    });
    window.addEventListener('offline', () => {
      if (!activeWorkspace) return;
      activeWorkspace.status = 'offline · cached';
      updateWorkspaceChip();
      renderWorkspacePanel();
    });
  }

  function notifyPageChanged(): void {
    if (activeWorkspace) workspaceSocket?.sendPresence(host.getCurrentPageId());
  }

  /** Scroll the panel to the first element `find` yields and flash it.
   * Retries briefly: opening the panel kicks off an async refresh, so the
   * target card may not be in the DOM yet. Best-effort — gives up quietly. */
  function scrollPanelTo(find: () => HTMLElement | null, attempts = 6): void {
    const el = find();
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      el.classList.add('ws-attention');
      setTimeout(() => el.classList.remove('ws-attention'), 1800);
      return;
    }
    if (attempts > 0) setTimeout(() => scrollPanelTo(find, attempts - 1), 350);
  }

  function openToProposal(id?: string): void {
    if (!workspacePanel) openWorkspacePanel();
    scrollPanelTo(() => {
      const cards = workspacePanel?.querySelectorAll<HTMLElement>(
        '.ws-card[data-proposal]',
      );
      if (!cards?.length) return null;
      if (!id) return cards[0] ?? null;
      for (const card of cards) if (card.dataset.proposal === id) return card;
      return null;
    });
  }

  function openToConflict(): void {
    if (!workspacePanel) openWorkspacePanel();
    scrollPanelTo(
      () => workspacePanel?.querySelector<HTMLElement>('.ws-error') ?? null,
    );
  }

  return {
    closeForDocumentReplacement: closeWorkspaceForDocumentReplacement,
    notifyDocChanged: scheduleWorkspaceSync,
    enable: enableWorkspaceUi,
    flushBeforeUnload,
    notifyPageChanged,
    onStateChange(listener) {
      stateListeners.add(listener);
      listener(computeWorkspacePanelState(activeWorkspace, isOnline()));
      return () => {
        stateListeners.delete(listener);
      };
    },
    openToProposal,
    openToConflict,
  };
}
