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
 * plus one `mountAdminDashboard()` controller that owns the panel DOM,
 * fetching, and wiring, and that the shell opens through `toggle()`.
 */
import {
  AdminDisabledError,
  AdminForbiddenError,
  fetchAdminSession,
  fetchAdminSessions,
  fetchAdminSummary,
  fetchUserWorkspaces,
} from '../admin/client.js';
import type { AdminSummary, RosterEntry } from '../admin/model.js';
import type { SessionSummary, ToolCallEvent } from '../agent-activity/model.js';
import type { WorkspaceListItem } from '../workspace/model.js';
import { registerOverlay } from './overlay.js';
import { icon } from './icons.js';

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
    `<div class="hint">The admin dashboard is not enabled on this deployment.</div>` +
    `<div class="card"><div class="hint">Analytics are turned off here. Editing and workspaces work as usual.</div>` +
    `<div class="ws-actions"><button class="btn btn-sm" id="adminRefresh">Check again</button></div></div>`
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
  if (state.loading) return `<div class="hint">Loading workspaces…</div>`;
  if (state.error) return `<div class="ws-error">${esc(state.error)}</div>`;
  const items = state.items ?? [];
  if (!items.length) return `<div class="hint">No workspaces.</div>`;
  return items
    .map(
      (w) =>
        `<div class="hint admin-ws-row">${esc(w.title || 'Untitled')} ` +
        `<span class="badge">${w.pages} page${w.pages === 1 ? '' : 's'}</span>` +
        (w.revision != null
          ? ` <span class="badge">rev ${w.revision}</span>`
          : ` <span class="badge">legacy</span>`) +
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
    `<div class="card admin-user" data-uid="${esc(entry.uid)}">` +
    `<div class="ws-row"><span class="ws-v admin-login"><span class="data">${esc(entry.login)}</span>${esc(name)}</span>` +
    `<span class="badge">${entry.loginCount} login${entry.loginCount === 1 ? '' : 's'}</span></div>` +
    `<div class="hint">Last <span class="data">${esc(formatWhen(entry.lastLoginAt))}</span> · first <span class="data">${esc(formatWhen(entry.firstSeenAt))}</span> · id <span class="data">${esc(entry.uid)}</span></div>` +
    `<div class="ws-actions"><button class="btn btn-sm admin-ws-toggle" data-uid="${esc(entry.uid)}">${expanded ? 'Hide workspaces' : 'Workspaces'}</button></div>` +
    (expanded && workspaces
      ? `<div class="card admin-ws-list">${renderUserWorkspacesHtml(workspaces)}</div>`
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
    `<div class="hint">${summary.totals.users} user${summary.totals.users === 1 ? '' : 's'} · ` +
    `${summary.totals.logins} login${summary.totals.logins === 1 ? '' : 's'} recorded. Metadata only — no diagram contents.</div>`;
  if (!summary.users.length)
    return (
      header +
      `<div class="card"><div class="hint">No logins recorded yet.</div></div>`
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

/** Per-session trail fetch state, keyed by sessionId in the panel controller. */
export interface SessionTrailState {
  loading: boolean;
  error: string | null;
  events: ToolCallEvent[] | null;
}

/** Pure: one session's tool-call trail, shown when expanded. */
export function renderSessionTrailHtml(state: SessionTrailState): string {
  if (state.loading) return `<div class="hint">Loading trail…</div>`;
  if (state.error) return `<div class="ws-error">${esc(state.error)}</div>`;
  const events = state.events ?? [];
  if (!events.length) return `<div class="hint">No tool calls recorded.</div>`;
  return events
    .map(
      (event) =>
        `<div class="hint admin-trail-row">` +
        `<span class="badge">${esc(event.outcome)}</span> ` +
        `<span class="admin-trail-what"><span class="data">${esc(event.toolName)}</span> · ` +
        `<span class="data admin-trail-when">${esc(formatWhen(event.at))}</span></span>` +
        `</div>`,
    )
    .join('');
}

/** Pure: one agent-session row with an optional expanded trail. */
export function renderSessionRowHtml(
  session: SessionSummary,
  expanded: boolean,
  trail: SessionTrailState | undefined,
): string {
  const who = session.ownerLogin
    ? `<span class="data">${esc(session.ownerLogin)}</span>`
    : `id <span class="data">${esc(session.ownerId)}</span>`;
  const when = session.lastToolAt ?? session.startedAt;
  return (
    `<div class="card admin-session" data-sid="${esc(session.sessionId)}">` +
    `<div class="ws-row"><span class="ws-v admin-login">${who}</span>` +
    `<span class="badge">${session.toolCallCount} call${session.toolCallCount === 1 ? '' : 's'}</span></div>` +
    `<div class="hint">Last <span class="data">${esc(formatWhen(when))}</span> · started <span class="data">${esc(formatWhen(session.startedAt))}</span></div>` +
    `<div class="hint">session <span class="data">${esc(session.sessionId)}</span></div>` +
    `<div class="ws-actions"><button class="btn btn-sm admin-session-toggle" data-sid="${esc(session.sessionId)}">${expanded ? 'Hide trail' : 'Trail'}</button></div>` +
    (expanded && trail
      ? `<div class="card admin-session-trail">${renderSessionTrailHtml(trail)}</div>`
      : '') +
    `</div>`
  );
}

/** Pure: the Agent Sessions section. */
export function renderSessionsHtml(
  sessions: SessionSummary[] | null,
  expandedSessionId: string | null,
  trails: Record<string, SessionTrailState>,
  sessionsError: string | null,
): string {
  const header = `<h4 class="section-label">Agent Sessions</h4>`;
  if (sessionsError)
    return header + `<div class="ws-error">${esc(sessionsError)}</div>`;
  if (!sessions) return header + `<div class="hint">Loading sessions…</div>`;
  const note =
    `<div class="hint">Recent MCP sessions. Tool names and coarse success/error only — ` +
    `no prompts, arguments, or diagram contents.</div>`;
  if (!sessions.length)
    return (
      header +
      note +
      `<div class="card"><div class="hint">No agent sessions recorded yet.</div></div>`
    );
  return (
    header +
    note +
    sessions
      .map((s) =>
        renderSessionRowHtml(
          s,
          s.sessionId === expandedSessionId,
          trails[s.sessionId],
        ),
      )
      .join('')
  );
}

export interface AdminPanelState {
  loading: boolean;
  disabled: boolean;
  forbidden: boolean;
  error: string | null;
  summary: AdminSummary | null;
  expandedUid: string | null;
  workspaces: Record<string, WorkspacesState>;
  sessions: SessionSummary[] | null;
  sessionsError: string | null;
  expandedSessionId: string | null;
  sessionTrails: Record<string, SessionTrailState>;
}

/** Pure: the whole panel body for a given state. */
export function renderAdminBodyHtml(state: AdminPanelState): string {
  if (state.disabled) return renderAdminDisabledHtml();
  if (state.forbidden) return renderAdminForbiddenHtml();
  if (state.loading) return `<div class="hint">Loading…</div>`;
  const err = state.error
    ? `<div class="ws-error">${esc(state.error)}</div>`
    : '';
  if (!state.summary) return err;
  return (
    err +
    renderRosterHtml(state.summary, state.expandedUid, state.workspaces) +
    renderSessionsHtml(
      state.sessions,
      state.expandedSessionId,
      state.sessionTrails,
      state.sessionsError,
    )
  );
}

/** The call sites `main.ts` needs. The shell opens the dashboard from the
 * account menu (Admin, the owner only). */
export interface AdminDashboardHandle {
  /** Opens the dashboard, or closes it when it is open. */
  toggle(): void;
}

export function mountAdminDashboard(): AdminDashboardHandle {
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
    sessions: null,
    sessionsError: null,
    expandedSessionId: null,
    sessionTrails: {},
  };

  function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function closePanel(): void {
    panel?.remove();
    panel = null;
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
    state.sessions = null;
    state.sessionsError = null;
    if (state.summary && !state.disabled && !state.forbidden) {
      try {
        const { sessions } = await fetchAdminSessions();
        state.sessions = sessions;
      } catch (error) {
        if (error instanceof AdminDisabledError) state.disabled = true;
        else if (error instanceof AdminForbiddenError) state.forbidden = true;
        else state.sessionsError = describe(error);
      }
    }
    state.loading = false;
    renderPanel();
  }

  async function toggleSession(sessionId: string): Promise<void> {
    if (state.expandedSessionId === sessionId) {
      state.expandedSessionId = null;
      renderPanel();
      return;
    }
    state.expandedSessionId = sessionId;
    if (!state.sessionTrails[sessionId]?.events) {
      state.sessionTrails[sessionId] = {
        loading: true,
        error: null,
        events: null,
      };
      renderPanel();
      try {
        const detail = await fetchAdminSession(sessionId);
        state.sessionTrails[sessionId] = {
          loading: false,
          error: null,
          events: detail.events,
        };
      } catch (error) {
        state.sessionTrails[sessionId] = {
          loading: false,
          error: describe(error),
          events: null,
        };
      }
    }
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
    body
      .querySelectorAll<HTMLButtonElement>('.admin-session-toggle')
      .forEach((button) =>
        button.addEventListener(
          'click',
          () => void toggleSession(button.dataset.sid!),
        ),
      );
  }

  function openPanel(): void {
    if (panel) {
      closePanel();
      return;
    }
    panel = document.createElement('div');
    panel.className = 'workspace-panel admin-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Admin dashboard');
    panel.innerHTML =
      `<div class="panel-head"><h3 class="panel-title">Admin dashboard</h3><button class="icon-btn" id="adminClose" title="Close" aria-label="Close">${icon('x')}</button></div>` +
      `<div id="adminBody" class="ws-body scroll-slim"></div>`;
    document.body.appendChild(panel);
    panel
      .querySelector('#adminClose')
      ?.addEventListener('click', () => closePanel());
    // Focus trap + Escape + focus restore (issue #209).
    releaseOverlay = registerOverlay(panel, { close: closePanel });
    void refresh();
  }

  return { toggle: openPanel };
}
