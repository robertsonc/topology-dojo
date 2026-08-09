/**
 * Owner-only admin/analytics dashboard (MVP).
 *
 * A metadata-only surface for the deployment owner: a roster of users who have
 * logged in (login times + counts) and, per user, their workspace names/counts
 * (read live from the registry). It shows NO diagram contents. Access is gated
 * server-side (`/api/admin/*` → `isAdmin`); this panel only ever renders for
 * the admin (revealed via `/api/me`'s `admin` flag), and it degrades to a clean
 * "disabled"/"not authorized" state via the client's typed errors.
 *
 * Follows `profile-panel.ts`: pure `render*Html` string builders
 * (characterization-testable without a DOM — see `admin-dashboard.test.ts`)
 * plus one `mountAdminDashboard(host)` controller that owns the panel DOM,
 * fetching, and wiring behind a narrow host seam.
 */
import {
  AdminDisabledError,
  AdminForbiddenError,
  fetchAdminSummary,
  fetchUserWorkspaces,
} from '../admin/client.js';
import type { AdminSummary, RosterEntry } from '../admin/model.js';
import type { WorkspaceListItem } from '../workspace/model.js';
import { registerOverlay } from './overlay.js';

// Local copy of main.ts's `esc()` — the codebase's established per-module
// pattern for this trivial helper (see `src/ui/profile-panel.ts`).
function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

/** Pure: the ISO day + minute of a timestamp (deterministic across locales). */
export function formatWhen(iso: string): string {
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
}

/** Pure: the disabled-deployment body (`ANALYTICS_ENABLED` off). */
export function renderAdminDisabledHtml(): string {
  return (
    `<div class="ws-note">The admin dashboard is not enabled on this deployment.</div>` +
    `<div class="ws-card"><div class="ws-note">Analytics are turned off here. Editing and workspaces work as usual.</div>` +
    `<div class="ws-actions"><button class="tbtn" id="adminRefresh">Check again</button></div></div>`
  );
}

/** Pure: the not-authorized body (non-admin session). */
export function renderAdminForbiddenHtml(): string {
  return `<div class="ws-error">You are not authorized to view the admin dashboard.</div>`;
}

/** Per-user workspace-list fetch state, keyed by uid in the panel controller. */
export interface WorkspacesState {
  loading: boolean;
  error: string | null;
  items: WorkspaceListItem[] | null;
}

/** Pure: one user's workspace list (metadata only), shown when expanded. */
export function renderUserWorkspacesHtml(state: WorkspacesState): string {
  if (state.loading) return `<div class="ws-note">Loading workspaces…</div>`;
  if (state.error) return `<div class="ws-error">${esc(state.error)}</div>`;
  const items = state.items ?? [];
  if (!items.length) return `<div class="ws-empty">No workspaces.</div>`;
  return items
    .map(
      (w) =>
        `<div class="ws-note admin-ws-row">${esc(w.title || 'Untitled')} ` +
        `<span class="ws-badge">${w.pages} page${w.pages === 1 ? '' : 's'}</span>` +
        (w.revision != null
          ? ` <span class="ws-badge">rev ${w.revision}</span>`
          : ` <span class="ws-badge">legacy</span>`) +
        `</div>`,
    )
    .join('');
}

/** Pure: one roster row — identity + login stats + a Workspaces toggle, with
 * the workspace list nested when this user is expanded. */
function renderRosterRowHtml(
  entry: RosterEntry,
  expanded: boolean,
  workspaces: WorkspacesState | undefined,
): string {
  const name =
    entry.name && entry.name !== entry.login ? ` (${entry.name})` : '';
  return (
    `<div class="ws-card admin-user" data-uid="${esc(entry.uid)}">` +
    `<div class="ws-row"><span class="ws-v admin-login">${esc(entry.login)}${esc(name)}</span>` +
    `<span class="ws-badge">${entry.loginCount} login${entry.loginCount === 1 ? '' : 's'}</span></div>` +
    `<div class="ws-note">Last ${esc(formatWhen(entry.lastLoginAt))} · first ${esc(formatWhen(entry.firstSeenAt))} · id ${esc(entry.uid)}</div>` +
    `<div class="ws-actions"><button class="tbtn admin-ws-toggle" data-uid="${esc(entry.uid)}">${expanded ? 'Hide workspaces' : 'Workspaces'}</button></div>` +
    (expanded && workspaces
      ? `<div class="ws-card admin-ws-list">${renderUserWorkspacesHtml(workspaces)}</div>`
      : '') +
    `</div>`
  );
}

/** Pure: the roster body — totals header plus one row per user (or empty). */
export function renderRosterHtml(
  summary: AdminSummary,
  expandedUid: string | null,
  workspaces: Record<string, WorkspacesState>,
): string {
  const header =
    `<div class="ws-note">${summary.totals.users} user${summary.totals.users === 1 ? '' : 's'} · ` +
    `${summary.totals.logins} login${summary.totals.logins === 1 ? '' : 's'} recorded. Metadata only — no diagram contents.</div>`;
  if (!summary.users.length)
    return (
      header +
      `<div class="ws-card"><div class="ws-empty">No logins recorded yet.</div></div>`
    );
  return (
    header +
    summary.users
      .map((u) =>
        renderRosterRowHtml(u, u.uid === expandedUid, workspaces[u.uid]),
      )
      .join('')
  );
}

/** The panel controller's render state (kept pure-renderable for tests). */
export interface AdminPanelState {
  loading: boolean;
  disabled: boolean;
  forbidden: boolean;
  error: string | null;
  summary: AdminSummary | null;
  expandedUid: string | null;
  workspaces: Record<string, WorkspacesState>;
}

/** Pure: the whole panel body for a given state. */
export function renderAdminBodyHtml(state: AdminPanelState): string {
  if (state.disabled) return renderAdminDisabledHtml();
  if (state.forbidden) return renderAdminForbiddenHtml();
  if (state.loading) return `<div class="ws-note">Loading…</div>`;
  const err = state.error
    ? `<div class="ws-error">${esc(state.error)}</div>`
    : '';
  if (!state.summary) return err;
  return (
    err + renderRosterHtml(state.summary, state.expandedUid, state.workspaces)
  );
}

/** Everything the dashboard needs from `main.ts` — the narrow seam. */
export interface AdminDashboardHost {
  /** The `#adminChip` toolbar button (hidden until the admin signs in). */
  chip: HTMLButtonElement;
}

/** The call sites `main.ts` needs. */
export interface AdminDashboardHandle {
  /** Reveals the toolbar chip once the signed-in user is confirmed admin. */
  enable(): void;
}

export function mountAdminDashboard(
  host: AdminDashboardHost,
): AdminDashboardHandle {
  let panel: HTMLElement | null = null;
  let releaseOverlay: (() => void) | null = null;
  const state: AdminPanelState = {
    loading: false,
    disabled: false,
    forbidden: false,
    error: null,
    summary: null,
    expandedUid: null,
    workspaces: {},
  };

  function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function closePanel(): void {
    panel?.remove();
    panel = null;
    host.chip.setAttribute('aria-expanded', 'false');
    releaseOverlay?.();
    releaseOverlay = null;
  }

  async function refresh(): Promise<void> {
    state.loading = true;
    state.error = null;
    state.disabled = false;
    state.forbidden = false;
    renderPanel();
    try {
      state.summary = await fetchAdminSummary();
    } catch (error) {
      state.summary = null;
      if (error instanceof AdminDisabledError) state.disabled = true;
      else if (error instanceof AdminForbiddenError) state.forbidden = true;
      else state.error = describe(error);
    }
    state.loading = false;
    renderPanel();
  }

  async function toggleWorkspaces(uid: string): Promise<void> {
    if (state.expandedUid === uid) {
      state.expandedUid = null;
      renderPanel();
      return;
    }
    state.expandedUid = uid;
    if (!state.workspaces[uid]?.items) {
      state.workspaces[uid] = { loading: true, error: null, items: null };
      renderPanel();
      try {
        const { workspaces } = await fetchUserWorkspaces(uid);
        state.workspaces[uid] = {
          loading: false,
          error: null,
          items: workspaces,
        };
      } catch (error) {
        state.workspaces[uid] = {
          loading: false,
          error: describe(error),
          items: null,
        };
      }
    }
    renderPanel();
  }

  function renderPanel(): void {
    if (!panel) return;
    const body = panel.querySelector<HTMLElement>('#adminBody');
    if (!body) return;
    body.innerHTML = renderAdminBodyHtml(state);
    body
      .querySelector('#adminRefresh')
      ?.addEventListener('click', () => void refresh());
    body
      .querySelectorAll<HTMLButtonElement>('.admin-ws-toggle')
      .forEach((button) =>
        button.addEventListener(
          'click',
          () => void toggleWorkspaces(button.dataset.uid!),
        ),
      );
  }

  function openPanel(): void {
    if (panel) {
      closePanel();
      return;
    }
    panel = document.createElement('div');
    panel.className = 'workspace-panel admin-panel scroll-slim';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Admin dashboard');
    panel.innerHTML =
      `<div class="ws-head"><h3>Admin dashboard</h3><button class="tbtn ticon" id="adminClose" title="Close" aria-label="Close">✕</button></div>` +
      `<div id="adminBody"></div>`;
    document.body.appendChild(panel);
    panel
      .querySelector('#adminClose')
      ?.addEventListener('click', () => closePanel());
    host.chip.setAttribute('aria-expanded', 'true');
    // Focus trap + Escape + focus restore (issue #209).
    releaseOverlay = registerOverlay(panel, { close: closePanel });
    void refresh();
  }

  function enable(): void {
    host.chip.hidden = false;
    host.chip.addEventListener('click', (event) => {
      event.stopPropagation();
      openPanel();
    });
  }

  return { enable };
}
