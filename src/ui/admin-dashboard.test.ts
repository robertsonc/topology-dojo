/**
 * Characterization tests for the admin dashboard (MVP). Same approach as
 * `profile-panel.test.ts`: plain Node (no jsdom), so these exercise the pure
 * `render*Html` helpers `mountAdminDashboard` builds its DOM from — roster
 * rendering, per-user workspace lists, the disabled/forbidden/empty states,
 * timestamp formatting, and escaping of untrusted login/name/title text.
 */
import { describe, expect, it } from 'vitest';
import {
  formatWhen,
  renderAdminBodyHtml,
  renderAdminDisabledHtml,
  renderAdminForbiddenHtml,
  renderRosterHtml,
  renderSessionTrailHtml,
  renderSessionsHtml,
  renderUserWorkspacesHtml,
  type AdminPanelState,
  type SessionTrailState,
  type WorkspacesState,
} from './admin-dashboard.js';
import type { AdminSummary, RosterEntry } from '../admin/model.js';
import type { SessionSummary } from '../agent-activity/model.js';

function entry(over: Partial<RosterEntry> = {}): RosterEntry {
  return {
    uid: 'u1',
    login: 'alice',
    name: 'Alice',
    firstSeenAt: '2026-07-01T09:00:00.000Z',
    lastLoginAt: '2026-07-17T12:30:00.000Z',
    loginCount: 3,
    ...over,
  };
}

function summary(over: Partial<AdminSummary> = {}): AdminSummary {
  return {
    users: [entry()],
    recentLogins: [
      { uid: 'u1', login: 'alice', at: '2026-07-17T12:30:00.000Z' },
    ],
    totals: { users: 1, logins: 3 },
    ...over,
  };
}

function state(over: Partial<AdminPanelState> = {}): AdminPanelState {
  return {
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
    ...over,
  };
}

describe('formatWhen', () => {
  it('shows the ISO day + minute', () => {
    expect(formatWhen('2026-07-17T12:30:45.000Z')).toBe('2026-07-17 12:30');
  });
});

describe('renderRosterHtml', () => {
  it('renders totals, identity, login stats, and the Workspaces toggle', () => {
    const html = renderRosterHtml(summary(), null, {});
    expect(html).toContain('1 user · 3 logins recorded');
    expect(html).toContain('Metadata only — no diagram contents.');
    expect(html).toContain('alice (Alice)');
    expect(html).toContain('3 logins');
    expect(html).toContain('Last 2026-07-17 12:30');
    expect(html).toContain('admin-ws-toggle');
    expect(html).toContain('>Workspaces</button>');
  });

  it('singularizes a lone login and shows the empty state', () => {
    const one = renderRosterHtml(
      summary({
        users: [entry({ loginCount: 1 })],
        totals: { users: 1, logins: 1 },
      }),
      null,
      {},
    );
    expect(one).toContain('1 login recorded');
    expect(one).toContain('1 login<');
    const empty = renderRosterHtml(
      summary({ users: [], totals: { users: 0, logins: 0 } }),
      null,
      {},
    );
    expect(empty).toContain('No logins recorded yet');
  });

  it('nests the workspace list only for the expanded user', () => {
    const ws: Record<string, WorkspacesState> = {
      u1: { loading: false, error: null, items: [] },
    };
    expect(renderRosterHtml(summary(), null, ws)).not.toContain(
      'admin-ws-list',
    );
    expect(renderRosterHtml(summary(), 'u1', ws)).toContain('admin-ws-list');
    expect(renderRosterHtml(summary(), 'u1', ws)).toContain('Hide workspaces');
  });

  it('escapes untrusted login and name text', () => {
    const html = renderRosterHtml(
      summary({
        users: [entry({ login: '<img src=x>', name: '"onmouseover="y' })],
      }),
      null,
      {},
    );
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).toContain('&quot;onmouseover=&quot;y');
  });
});

describe('renderUserWorkspacesHtml', () => {
  it('renders titles + page/revision badges, escaping titles', () => {
    const html = renderUserWorkspacesHtml({
      loading: false,
      error: null,
      items: [
        {
          id: 'w1',
          title: '<b>Net</b>',
          pages: 2,
          revision: 5,
          migrated: true,
        },
        { id: 'w2', title: 'Draft', pages: 1, revision: null, migrated: false },
      ],
    });
    expect(html).toContain('&lt;b&gt;Net&lt;/b&gt;');
    expect(html).toContain('2 pages');
    expect(html).toContain('rev 5');
    expect(html).toContain('1 page');
    expect(html).toContain('legacy');
  });

  it('shows loading, error, and empty states', () => {
    expect(
      renderUserWorkspacesHtml({ loading: true, error: null, items: null }),
    ).toContain('Loading workspaces…');
    expect(
      renderUserWorkspacesHtml({ loading: false, error: 'boom', items: null }),
    ).toContain('boom');
    expect(
      renderUserWorkspacesHtml({ loading: false, error: null, items: [] }),
    ).toContain('No workspaces.');
  });
});

describe('renderAdminBodyHtml', () => {
  it('renders the disabled notice regardless of other state', () => {
    const html = renderAdminBodyHtml(
      state({ disabled: true, summary: summary() }),
    );
    expect(html).toContain('not enabled on this deployment');
    expect(html).not.toContain('admin-user');
  });

  it('renders the forbidden notice for a non-admin', () => {
    expect(renderAdminBodyHtml(state({ forbidden: true }))).toContain(
      'not authorized',
    );
  });

  it('renders loading, and the roster once loaded', () => {
    expect(renderAdminBodyHtml(state({ loading: true }))).toContain('Loading…');
    const html = renderAdminBodyHtml(state({ summary: summary() }));
    expect(html).toContain('admin-user');
    expect(html).toContain('Agent Sessions');
  });

  it('keeps the roster visible under a non-fatal error', () => {
    const html = renderAdminBodyHtml(
      state({ error: 'refresh failed', summary: summary() }),
    );
    expect(html).toContain('<div class="ws-error">refresh failed</div>');
    expect(html).toContain('admin-user');
  });
});

describe('renderSessionsHtml', () => {
  function sess(over: Partial<SessionSummary> = {}): SessionSummary {
    return {
      sessionId: 'abc123',
      ownerId: 'u1',
      ownerLogin: 'alice',
      startedAt: '2026-08-19T09:00:00.000Z',
      lastToolAt: '2026-08-19T09:05:00.000Z',
      toolCallCount: 3,
      ...over,
    };
  }

  it('renders identity, call count, and the Trail toggle', () => {
    const html = renderSessionsHtml([sess()], null, {}, null);
    expect(html).toContain('Agent Sessions');
    expect(html).toContain('alice');
    expect(html).toContain('3 calls');
    expect(html).toContain('session abc123');
    expect(html).toContain('>Trail</button>');
    expect(html).toContain('no prompts, arguments, or diagram contents');
  });

  it('singularizes a lone call and shows the empty state', () => {
    expect(
      renderSessionsHtml([sess({ toolCallCount: 1 })], null, {}, null),
    ).toContain('1 call<');
    expect(renderSessionsHtml([], null, {}, null)).toContain(
      'No agent sessions recorded yet',
    );
  });

  it('nests the trail only for the expanded session', () => {
    const trails: Record<string, SessionTrailState> = {
      abc123: { loading: false, error: null, events: [] },
    };
    expect(renderSessionsHtml([sess()], null, trails, null)).not.toContain(
      'admin-session-trail',
    );
    expect(renderSessionsHtml([sess()], 'abc123', trails, null)).toContain(
      'admin-session-trail',
    );
    expect(renderSessionsHtml([sess()], 'abc123', trails, null)).toContain(
      'Hide trail',
    );
  });

  it('escapes untrusted login, session id, and tool names', () => {
    const html = renderSessionsHtml(
      [sess({ ownerLogin: '<img src=x>', sessionId: '"onfocus="' })],
      '"onfocus="',
      {
        '"onfocus="': {
          loading: false,
          error: null,
          events: [
            {
              toolName: '<b>evil</b>',
              at: '2026-08-19T09:00:00.000Z',
              outcome: 'success',
            },
          ],
        },
      },
      null,
    );
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('<b>evil</b>');
    expect(html).toContain('&lt;b&gt;evil&lt;/b&gt;');
    expect(html).toContain('&quot;onfocus=&quot;');
  });
});

describe('renderSessionTrailHtml', () => {
  it('shows loading, error, empty, and outcome badges', () => {
    expect(
      renderSessionTrailHtml({ loading: true, error: null, events: null }),
    ).toContain('Loading trail…');
    expect(
      renderSessionTrailHtml({ loading: false, error: 'boom', events: null }),
    ).toContain('boom');
    expect(
      renderSessionTrailHtml({ loading: false, error: null, events: [] }),
    ).toContain('No tool calls recorded.');
    const html = renderSessionTrailHtml({
      loading: false,
      error: null,
      events: [
        {
          toolName: 'list_templates',
          at: '2026-08-19T09:00:00.000Z',
          outcome: 'success',
        },
        {
          toolName: 'validate_topology',
          at: '2026-08-19T09:01:00.000Z',
          outcome: 'error',
        },
      ],
    });
    expect(html).toContain('list_templates');
    expect(html).toContain('success');
    expect(html).toContain('error');
  });
});

describe('static notices', () => {
  it('disabled offers a re-check; forbidden is an error', () => {
    expect(renderAdminDisabledHtml()).toContain('id="adminRefresh"');
    expect(renderAdminForbiddenHtml()).toContain('ws-error');
  });
});
