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
import { diffDocuments } from '../workspace/operations.js';
import {
  acceptWorkspaceProposal,
  commitWorkspaceOperations,
  createWorkspace,
  getWorkspace,
  getWorkspaceManifest,
  grantWorkspaceLease,
  listWorkspaces,
  listWorkspaceProposals,
  rejectWorkspaceProposal,
  revokeWorkspaceLease,
  WorkspaceDisabledError,
} from '../workspace/client.js';
import type {
  CommitRequest,
  ProposalSummary,
  WorkspaceManifest,
  WorkspaceListItem,
} from '../workspace/model.js';
import { serializeDoc } from '../pages/persist.js';
import type { TopologyDocument } from '../pages/model.js';

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
  /** The toolbar's autosave status text node. */
  savedEl: HTMLElement;
  /** The `#workspaceChip` toolbar button. */
  chip: HTMLButtonElement;
  /** The `#workspaceLabel` span inside the chip. */
  chipLabel: HTMLElement;
  /** The `#workspaceDiv` divider shown alongside the chip. */
  chipDivider: HTMLElement;
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
}

export interface WorkspaceChipState {
  on: boolean;
  conflict: boolean;
  label: string;
  title: string;
}

/** Pure: the toolbar chip's visual state for a given workspace (or none). */
export function computeWorkspaceChipState(
  workspace: ActiveWorkspace | null,
): WorkspaceChipState {
  return {
    on: Boolean(workspace),
    conflict: Boolean(workspace?.error),
    label: workspace ? `agent · r${workspace.revision}` : 'agent · local',
    title: workspace
      ? `${workspace.id} · ${workspace.status}`
      : 'Hand this local document to an agent workspace',
  };
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

/** Pure: the panel body for an active workspace (revision/sync/lease/proposals). */
export function renderActiveWorkspaceHtml(workspace: ActiveWorkspace): string {
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
            `<ul class="ws-ops">${proposal.summary.descriptions
              .slice(0, 8)
              .map((line) => `<li>${esc(line)}</li>`)
              .join('')}</ul>` +
            `<div class="ws-actions"><button class="tbtn ws-accept" data-pid="${esc(proposal.id)}">Accept</button>` +
            `<button class="tbtn ws-reject" data-pid="${esc(proposal.id)}">Reject</button></div></div>`,
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
    `<div class="ws-actions"><button class="tbtn" id="wsSync">Sync now</button>` +
    (workspace.paused
      ? `<button class="tbtn" id="wsResume">Sync local copy</button>`
      : '') +
    `<button class="tbtn" id="wsReload">Reload server</button><button class="tbtn" id="wsDetach">Close workspace</button></div></div>` +
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
    proposalHtml
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
    activeWorkspace = null;
    workspaceChoices = [];
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

  function workspaceHasLocalChanges(workspace: ActiveWorkspace): boolean {
    return diffDocuments(workspace.lastSynced, host.getDoc()).length > 0;
  }

  function updateWorkspaceChip(): void {
    const state = computeWorkspaceChipState(activeWorkspace);
    host.chip.classList.toggle('on', state.on);
    host.chip.classList.toggle('conflict', state.conflict);
    host.chipLabel.textContent = state.label;
    host.chip.title = state.title;
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
      const operations = diffDocuments(workspace.lastSynced, target);
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
        return false;
      }
      workspace.revision = result.revision;
      workspace.lastSynced = target ?? structuredClone(host.getDoc());
      workspace.pending = null;
      workspace.pendingTarget = null;
      workspace.status = result.rebased ? 'synced · rebased' : 'synced';
      workspace.error = null;
      writeWorkspaceLink();
      host.savedEl.textContent = '✓ synced';
      if (workspaceHasLocalChanges(workspace)) scheduleWorkspaceSync();
      return true;
    } catch (error) {
      workspace.status = 'offline · retry pending';
      workspace.error = error instanceof Error ? error.message : String(error);
      writeWorkspaceLink(request);
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
    updateWorkspaceChip();
  }

  async function refreshWorkspaceState(autoPull = true): Promise<void> {
    const workspace = activeWorkspace;
    if (!workspace) return;
    try {
      const [manifest, proposals] = await Promise.all([
        getWorkspaceManifest(workspace.id),
        listWorkspaceProposals(workspace.id),
      ]);
      if (activeWorkspace !== workspace) return;
      workspace.manifest = manifest;
      workspace.proposals = proposals;
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
        pending: null,
        pendingTarget: null,
        syncing: false,
        paused: false,
        status: 'handed off · suggest only',
        error: null,
      };
      writeWorkspaceLink();
      updateWorkspaceChip();
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
      pending: null,
      pendingTarget: null,
      syncing: false,
      paused: false,
      status: 'opened · suggest only',
      error: null,
    };
    adoptWorkspaceSnapshot(snapshot, 'opened · synced');
    await refreshWorkspaceState(false);
  }

  async function restoreWorkspace(): Promise<void> {
    const saved = readWorkspaceLink();
    if (!saved) return;
    try {
      const snapshot = await getWorkspace(saved.id);
      activeWorkspace = {
        id: saved.id,
        revision: snapshot.revision,
        lastSynced: structuredClone(snapshot.document),
        manifest: null,
        proposals: [],
        pending: saved.pending ?? null,
        pendingTarget: saved.pending ? structuredClone(host.getDoc()) : null,
        syncing: false,
        paused: false,
        status: 'reconnecting…',
        error: null,
      };

      if (saved.pending) {
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
      await refreshWorkspaceState(false);
    } catch (error) {
      activeWorkspace = null;
      console.error('workspace reconnect failed', error);
    }
    updateWorkspaceChip();
  }

  function closeWorkspacePanel(): void {
    workspacePanel?.remove();
    workspacePanel = null;
    host.chip.setAttribute('aria-expanded', 'false');
  }

  function renderWorkspacePanel(): void {
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

    body.innerHTML = renderActiveWorkspaceHtml(workspace);

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
        activeWorkspace = null;
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
    body.querySelectorAll<HTMLButtonElement>('.ws-accept').forEach((button) => {
      button.addEventListener('click', () => {
        const proposalId = button.dataset.pid!;
        void (async () => {
          if (workspaceHasLocalChanges(workspace) && !(await syncWorkspace()))
            return;
          const result = await acceptWorkspaceProposal(
            workspace.id,
            proposalId,
            operationId('ui_accept'),
          );
          if (!result.ok) {
            workspace.error = result.message;
            workspace.status = 'proposal conflict';
            renderWorkspacePanel();
            return;
          }
          adoptWorkspaceSnapshot(
            await getWorkspace(workspace.id),
            'proposal accepted · synced',
          );
          await refreshWorkspaceState(false);
        })().catch((error) => {
          workspace.error =
            error instanceof Error ? error.message : String(error);
          renderWorkspacePanel();
        });
      });
    });
    body.querySelectorAll<HTMLButtonElement>('.ws-reject').forEach((button) => {
      button.addEventListener('click', () => {
        void rejectWorkspaceProposal(workspace.id, button.dataset.pid!)
          .then(() => refreshWorkspaceState(false))
          .catch((error) => {
            workspace.error =
              error instanceof Error ? error.message : String(error);
            renderWorkspacePanel();
          });
      });
    });
  }

  function openWorkspacePanel(): void {
    if (workspacePanel) {
      closeWorkspacePanel();
      return;
    }
    workspacePanel = document.createElement('div');
    workspacePanel.className = 'workspace-panel';
    workspacePanel.setAttribute('role', 'dialog');
    workspacePanel.setAttribute('aria-label', 'Agent Workspace');
    workspacePanel.innerHTML =
      `<div class="ws-head"><h3>Agent Workspace</h3><button class="tbtn ticon" id="wsClose" title="Close">✕</button></div>` +
      `<div id="wsBody"></div>`;
    document.body.appendChild(workspacePanel);
    workspacePanel
      .querySelector('#wsClose')
      ?.addEventListener('click', () => closeWorkspacePanel());
    host.chip.setAttribute('aria-expanded', 'true');
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
      openWorkspacePanel();
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

  return {
    closeForDocumentReplacement: closeWorkspaceForDocumentReplacement,
    notifyDocChanged: scheduleWorkspaceSync,
    enable: enableWorkspaceUi,
    flushBeforeUnload,
  };
}
