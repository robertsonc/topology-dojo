/**
 * Characterization tests for the Authoring Preferences panel (Packet P3,
 * observe-only). Same approach as `workspace-panel.test.ts`: the repo's test
 * environment is plain Node (no jsdom/happy-dom), so these exercise the pure
 * `render*Html`/format helpers `mountProfilePanel` builds its DOM writes from,
 * over fixture profiles — list rendering (directive/scope/status/evidence),
 * the 2+ observation callout, empty + disabled states, escaping of untrusted
 * directive/rationale text, and the pause/forget affordances.
 */
import { describe, expect, it } from 'vitest';
import {
  formatEvidenceSummary,
  preferenceScopeLabel,
  renderPreferencesHtml,
  renderProfileBodyHtml,
  renderProfileDisabledHtml,
  type ProfilePanelState,
} from './profile-panel.js';
import type { AuthoringPreference } from '../profile/model.js';

function preference(
  overrides: Partial<AuthoringPreference> = {},
): AuthoringPreference {
  return {
    id: 'pref_abc123',
    ownerId: '42',
    profileRevision: 0,
    scope: { kind: 'user' },
    trigger: {
      archetype: 'multi-region-hub-spoke',
      requiredTraits: ['layered-regional', 'spokes-below-hub'],
      excludedTraits: ['radial-placement'],
    },
    directive: 'radial → layered regional hub/spoke hierarchy',
    rationale: 'Spokes were repeatedly moved below their hub.',
    status: 'candidate',
    confidence: 0,
    evidenceDocuments: 1,
    supportingOutcomes: 1,
    contradictingOutcomes: 0,
    sourceRevisionRefs: ['w1@r5'],
    createdAt: '2026-07-01T10:00:00.000Z',
    lastObservedAt: '2026-07-02T11:30:00.000Z',
    ...overrides,
  };
}

function state(overrides: Partial<ProfilePanelState> = {}): ProfilePanelState {
  return {
    loading: false,
    disabled: false,
    error: null,
    preferences: [],
    ...overrides,
  };
}

describe('preferenceScopeLabel', () => {
  it('labels each scope kind', () => {
    expect(preferenceScopeLabel({ kind: 'user' })).toBe('all my diagrams');
    expect(
      preferenceScopeLabel({ kind: 'workspace', workspaceId: 'w_1' }),
    ).toBe('workspace w_1');
    expect(
      preferenceScopeLabel({ kind: 'archetype', archetype: 'hub-spoke' }),
    ).toBe('hub-spoke diagrams');
  });
});

describe('formatEvidenceSummary', () => {
  it('shows counts and the ISO day of the last observation', () => {
    expect(formatEvidenceSummary(preference())).toBe(
      '1 outcome · 1 document · last observed 2026-07-02',
    );
  });

  it('pluralizes both counts', () => {
    expect(
      formatEvidenceSummary(
        preference({ supportingOutcomes: 3, evidenceDocuments: 2 }),
      ),
    ).toBe('3 outcomes · 2 documents · last observed 2026-07-02');
  });
});

describe('renderPreferencesHtml', () => {
  it('renders the observe-only explainer and the empty state with no candidates', () => {
    const html = renderPreferencesHtml([]);
    expect(html).toContain('Observe-only: nothing here changes agent behavior');
    expect(html).toContain('No learned candidates yet');
  });

  it('renders directive, rationale, scope, status badge, and evidence for a candidate', () => {
    const html = renderPreferencesHtml([preference()]);
    expect(html).toContain('radial → layered regional hub/spoke hierarchy');
    expect(html).toContain('Spokes were repeatedly moved below their hub.');
    expect(html).toContain('Scope: all my diagrams');
    expect(html).toContain(
      '<span class="ws-badge pref-status-candidate">candidate</span>',
    );
    expect(html).toContain('1 outcome · 1 document · last observed 2026-07-02');
    expect(html).toContain('data-pref="pref_abc123"');
  });

  it('omits the rationale line when it merely repeats the directive', () => {
    const html = renderPreferencesHtml([
      preference({ directive: 'same text', rationale: 'same text' }),
    ]);
    expect(html).not.toContain('pref-rationale');
  });

  it('shows no observation callout for a single-outcome candidate (evidence only)', () => {
    expect(renderPreferencesHtml([preference()])).not.toContain(
      'pref-observed',
    );
  });

  it('shows the non-blocking observed callout at 2+ supporting outcomes', () => {
    const html = renderPreferencesHtml([
      preference({ supportingOutcomes: 2, evidenceDocuments: 2 }),
    ]);
    expect(html).toContain('pref-observed');
    expect(html).toContain('Observed 2×');
  });

  it('offers Pause + Forget on an active candidate, Resume on a paused one', () => {
    const active = renderPreferencesHtml([preference()]);
    expect(active).toContain(
      '<button class="tbtn pref-pause" data-pref-id="pref_abc123">Pause</button>',
    );
    expect(active).toContain(
      '<button class="tbtn pref-forget" data-pref-id="pref_abc123">Forget</button>',
    );
    expect(active).not.toContain('pref-resume');

    const paused = renderPreferencesHtml([preference({ status: 'paused' })]);
    expect(paused).toContain(
      '<button class="tbtn pref-resume" data-pref-id="pref_abc123">Resume</button>',
    );
    expect(paused).toContain('pref-status-paused');
    expect(paused).not.toContain('pref-pause"');
  });

  it('renders workspace-scoped candidates with their workspace id', () => {
    const html = renderPreferencesHtml([
      preference({ scope: { kind: 'workspace', workspaceId: 'w_9' } }),
    ]);
    expect(html).toContain('Scope: workspace w_9');
  });

  it('escapes untrusted directive, rationale, and id text', () => {
    const html = renderPreferencesHtml([
      preference({
        id: 'pref_"onmouseover="x',
        directive: '<img src=x onerror=alert(1)> & "quotes"',
        rationale: '<script>alert(2)</script>',
        supportingOutcomes: 2,
      }),
    ]);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain(
      '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;',
    );
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
    expect(html).toContain('data-pref-id="pref_&quot;onmouseover=&quot;x"');
  });
});

describe('renderProfileDisabledHtml', () => {
  it('explains the deployment gate and offers a re-check', () => {
    const html = renderProfileDisabledHtml();
    expect(html).toContain(
      'Authoring preferences are not enabled on this deployment.',
    );
    expect(html).toContain('id="prefRefresh"');
  });
});

describe('renderProfileBodyHtml', () => {
  it('renders the disabled notice regardless of other state', () => {
    const html = renderProfileBodyHtml(
      state({ disabled: true, error: 'boom', preferences: [preference()] }),
    );
    expect(html).toContain('not enabled on this deployment');
    expect(html).not.toContain('pref-card');
  });

  it('renders the loading note while fetching', () => {
    expect(renderProfileBodyHtml(state({ loading: true }))).toContain(
      'Loading preferences…',
    );
  });

  it('keeps the list visible under a non-fatal action error', () => {
    const html = renderProfileBodyHtml(
      state({ error: 'pause failed', preferences: [preference()] }),
    );
    expect(html).toContain('<div class="ws-error">pause failed</div>');
    expect(html).toContain('pref-card');
  });

  it('escapes untrusted error text', () => {
    expect(renderProfileBodyHtml(state({ error: '<b>err</b>' }))).toContain(
      '&lt;b&gt;err&lt;/b&gt;',
    );
  });
});
