/**
 * Characterization tests for the Authoring Preferences panel (Packets P3+P4).
 * Same approach as `workspace-panel.test.ts`: the repo's test environment is
 * plain Node (no jsdom/happy-dom), so these exercise the pure
 * `render*Html`/format helpers `mountProfilePanel` builds its DOM writes from,
 * over fixture profiles — list rendering (directive/scope/status/evidence),
 * the observation/ask callouts, the P4 confirm flow (scope chooser, confirmed
 * and rejected cards), empty + disabled states, escaping of untrusted
 * directive/rationale text, and the per-status action affordances.
 */
import { describe, expect, it } from 'vitest';
import {
  formatEvidenceSummary,
  preferenceScopeLabel,
  renderPreferencesHtml,
  renderProfileBodyHtml,
  renderProfileDisabledHtml,
  renderScopeChooserHtml,
  shouldAskToConfirm,
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
    confirmingId: null,
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
  it('renders the confirm-gated explainer and the empty state with no candidates', () => {
    const html = renderPreferencesHtml([]);
    expect(html).toContain('Only rules you confirm are supplied to agents');
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

  it('asks the causal confirm question at 3 outcomes across 2 documents', () => {
    const below = preference({ supportingOutcomes: 3, evidenceDocuments: 1 });
    expect(shouldAskToConfirm(below)).toBe(false);
    const at = preference({ supportingOutcomes: 3, evidenceDocuments: 2 });
    expect(shouldAskToConfirm(at)).toBe(true);
    const html = renderPreferencesHtml([at]);
    expect(html).toContain('pref-ask');
    expect(html).toContain('3 times across 2 documents');
    expect(html).not.toContain('pref-observed');
  });

  it('offers the confirm affordance on candidates only', () => {
    expect(renderPreferencesHtml([preference()])).toContain(
      'pref-confirm-open',
    );
    for (const status of ['confirmed', 'paused', 'rejected'] as const) {
      expect(renderPreferencesHtml([preference({ status })])).not.toContain(
        'pref-confirm-open',
      );
    }
  });

  it('opens the scope chooser only for the confirming card', () => {
    const prefs = [preference(), preference({ id: 'pref_other' })];
    expect(renderPreferencesHtml(prefs, null)).not.toContain(
      'pref-scope-chooser',
    );
    const html = renderPreferencesHtml(prefs, 'pref_abc123');
    expect(html).toContain('pref-scope-chooser" data-pref="pref_abc123"');
    expect(html).not.toContain('pref-scope-chooser" data-pref="pref_other"');
  });

  it('scope chooser offers user + archetype + single-evidence-workspace scopes, reject, and cancel', () => {
    const html = renderScopeChooserHtml(preference());
    expect(html).toContain('data-scope-kind="user"');
    expect(html).toContain(
      'data-scope-kind="archetype" data-scope-archetype="multi-region-hub-spoke"',
    );
    expect(html).toContain(
      'data-scope-kind="workspace" data-scope-workspace="w1"',
    );
    expect(html).toContain('pref-reject');
    expect(html).toContain('pref-confirm-cancel');
  });

  it('omits archetype/workspace scope options without a detected archetype or with multi-workspace evidence', () => {
    const html = renderScopeChooserHtml(
      preference({
        trigger: { requiredTraits: ['t'] },
        sourceRevisionRefs: ['w1@r5', 'w2@r3'],
      }),
    );
    expect(html).not.toContain('data-scope-kind="archetype"');
    expect(html).not.toContain('data-scope-kind="workspace"');
    expect(html).toContain('data-scope-kind="user"');
  });

  it('renders a confirmed rule with its note and no ask callout', () => {
    const html = renderPreferencesHtml([
      preference({
        status: 'confirmed',
        confidence: 0.7,
        confirmedAt: '2026-07-15T09:00:00.000Z',
        supportingOutcomes: 3,
        evidenceDocuments: 2,
      }),
    ]);
    expect(html).toContain('pref-status-confirmed');
    expect(html).toContain('Confirmed 2026-07-15');
    expect(html).toContain('supplied to agents when it applies');
    expect(html).not.toContain('pref-ask');
    expect(html).toContain('pref-pause');
  });

  it('renders a rejected rule with Forget as its only action', () => {
    const html = renderPreferencesHtml([preference({ status: 'rejected' })]);
    expect(html).toContain('pref-rejected-note');
    expect(html).toContain('will not be learned again');
    expect(html).toContain('pref-forget');
    expect(html).not.toContain('pref-pause');
    expect(html).not.toContain('pref-resume');
    expect(html).not.toContain('pref-confirm-open');
  });

  it('escapes untrusted archetype/workspace text in the scope chooser', () => {
    const html = renderScopeChooserHtml(
      preference({
        trigger: {
          archetype: '"onmouseover="x',
          requiredTraits: ['t'],
        },
        sourceRevisionRefs: ['<b>ws</b>@r1'],
      }),
    );
    expect(html).toContain('data-scope-archetype="&quot;onmouseover=&quot;x"');
    expect(html).toContain('data-scope-workspace="&lt;b&gt;ws&lt;/b&gt;"');
    expect(html).not.toContain('<b>ws</b>');
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
