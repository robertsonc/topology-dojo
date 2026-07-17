/**
 * The Packet P4 token budgets AS TESTS (proposal 0003 §"Token budget" — hard
 * limits, not aspirations): ≤5 rules, ≤400 estimated tokens by default, 800
 * absolute, ids + omission count on overflow (never truncated prose),
 * `notModified` on unchanged revisions, and confirmed-only/scope-matched
 * serving. All pure — `AuthoringProfile.getGuidance` is a caching shell over
 * `compileGuidance`.
 */
import { describe, expect, it } from 'vitest';
import type { AuthoringPreference } from './model.js';
import {
  ABSOLUTE_GUIDANCE_TOKENS,
  DEFAULT_GUIDANCE_TOKENS,
  MAX_GUIDANCE_RULES,
  clampGuidanceBudget,
  compileGuidance,
  estimateTokens,
  explainPreference,
  guidanceNotModified,
  preferenceSummary,
  rankPreferences,
} from './guidance.js';
import {
  GUIDANCE_PACK_RULES,
  GUIDANCE_REVISION,
  type GuidancePackRule,
} from './guidance-packs.js';

function confirmed(
  overrides: Partial<AuthoringPreference> = {},
): AuthoringPreference {
  return {
    id: 'pref_a',
    ownerId: '42',
    profileRevision: 0,
    scope: { kind: 'user' },
    trigger: {
      archetype: 'multi-region-hub-spoke',
      requiredTraits: ['layered-regional'],
      excludedTraits: ['radial-placement'],
    },
    directive: 'Prefer a layered regional hub/spoke hierarchy.',
    rationale: 'Corrected three times.',
    status: 'confirmed',
    confidence: 0.7,
    evidenceDocuments: 2,
    supportingOutcomes: 3,
    contradictingOutcomes: 0,
    sourceRevisionRefs: ['w1@r5', 'w2@r7'],
    createdAt: '2026-07-01T10:00:00.000Z',
    lastObservedAt: '2026-07-02T11:30:00.000Z',
    confirmedAt: '2026-07-03T09:00:00.000Z',
    ...overrides,
  };
}

const QUERY = { archetype: 'multi-region-hub-spoke' };

describe('estimateTokens / clampGuidanceBudget', () => {
  it('estimates deterministically at ~4 chars/token, rounded up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('defaults to 400 and clamps to the 800 absolute ceiling', () => {
    expect(clampGuidanceBudget(undefined)).toBe(DEFAULT_GUIDANCE_TOKENS);
    expect(clampGuidanceBudget(Number.NaN)).toBe(DEFAULT_GUIDANCE_TOKENS);
    expect(clampGuidanceBudget(10_000)).toBe(ABSOLUTE_GUIDANCE_TOKENS);
    expect(clampGuidanceBudget(0)).toBe(1);
    expect(clampGuidanceBudget(600)).toBe(600);
  });
});

describe('guidanceNotModified', () => {
  const current = { profileRevision: 4, guidanceRevision: GUIDANCE_REVISION };

  it('is true only when BOTH last-seen revisions match', () => {
    expect(
      guidanceNotModified(current, {
        lastProfileRevision: 4,
        lastGuidanceRevision: GUIDANCE_REVISION,
      }),
    ).toBe(true);
    expect(guidanceNotModified(current, { lastProfileRevision: 4 })).toBe(
      false,
    );
    expect(
      guidanceNotModified(current, {
        lastProfileRevision: 3,
        lastGuidanceRevision: GUIDANCE_REVISION,
      }),
    ).toBe(false);
    expect(guidanceNotModified(current, {})).toBe(false);
  });
});

describe('serving eligibility (confirmed-only, scope/trigger matched)', () => {
  it('serves ONLY confirmed rules — candidate, paused, and rejected never reach an agent', () => {
    for (const status of ['candidate', 'paused', 'rejected'] as const) {
      const { rules } = compileGuidance([confirmed({ status })], [], QUERY);
      expect(rules).toHaveLength(0);
    }
    expect(compileGuidance([confirmed()], [], QUERY).rules).toHaveLength(1);
  });

  it('matches workspace scope to the queried workspace only', () => {
    const pref = confirmed({
      scope: { kind: 'workspace', workspaceId: 'w_1' },
    });
    expect(
      compileGuidance([pref], [], { ...QUERY, workspaceId: 'w_1' }).rules,
    ).toHaveLength(1);
    expect(
      compileGuidance([pref], [], { ...QUERY, workspaceId: 'w_2' }).rules,
    ).toHaveLength(0);
    expect(compileGuidance([pref], [], QUERY).rules).toHaveLength(0);
  });

  it('matches archetype scope and trigger archetype to the task archetype', () => {
    const scoped = confirmed({
      scope: { kind: 'archetype', archetype: 'multi-region-hub-spoke' },
    });
    expect(compileGuidance([scoped], [], QUERY).rules).toHaveLength(1);
    expect(
      compileGuidance([scoped], [], { archetype: 'leaf-spine' }).rules,
    ).toHaveLength(0);
    // Trigger archetype also gates a user-scoped rule (criterion 3's coarse
    // P4 form; trait matching is Packet P5).
    expect(compileGuidance([confirmed()], [], {}).rules).toHaveLength(0);
  });

  it('applies archetype-conditioned pack rules only on a matching task', () => {
    const onMatch = compileGuidance([], GUIDANCE_PACK_RULES, QUERY);
    expect(onMatch.rules.map((r) => r.id)).toEqual([
      'gp1:layout-discipline',
      'gp1:multi-region-hub-tier',
    ]);
    const offMatch = compileGuidance([], GUIDANCE_PACK_RULES, {});
    expect(offMatch.rules.map((r) => r.id)).toEqual(['gp1:layout-discipline']);
  });

  it('never serves raw evidence: compiled rules carry only id/directive/scope', () => {
    const { rules } = compileGuidance([confirmed()], [], QUERY);
    expect(Object.keys(rules[0]!).sort()).toEqual(['directive', 'id', 'scope']);
  });
});

describe('ranking', () => {
  it('orders user rules above product defaults, most-specific scope first', () => {
    const user = confirmed({ id: 'pref_user' });
    const ws = confirmed({
      id: 'pref_ws',
      scope: { kind: 'workspace', workspaceId: 'w_1' },
    });
    const arch = confirmed({
      id: 'pref_arch',
      scope: { kind: 'archetype', archetype: 'multi-region-hub-spoke' },
    });
    const { rules } = compileGuidance([user, ws, arch], GUIDANCE_PACK_RULES, {
      ...QUERY,
      workspaceId: 'w_1',
    });
    expect(rules.map((r) => r.id)).toEqual([
      'pref_arch',
      'pref_ws',
      'pref_user',
      'gp1:layout-discipline',
      'gp1:multi-region-hub-tier',
    ]);
  });

  it('breaks specificity ties by confidence then recency then id', () => {
    const ranked = rankPreferences(
      [
        confirmed({ id: 'p_low', confidence: 0.5 }),
        confirmed({ id: 'p_hi', confidence: 0.9 }),
        confirmed({
          id: 'p_recent',
          confidence: 0.5,
          lastObservedAt: '2026-07-09T00:00:00.000Z',
        }),
      ],
      QUERY,
    );
    expect(ranked.map((p) => p.id)).toEqual(['p_hi', 'p_recent', 'p_low']);
  });
});

describe('hard budgets', () => {
  it(`caps a response at ${MAX_GUIDANCE_RULES} rules and reports the rest as ids + count`, () => {
    const prefs = Array.from({ length: 9 }, (_, i) =>
      confirmed({ id: `pref_${i}`, directive: `Rule number ${i}.` }),
    );
    const compiled = compileGuidance(prefs, [], QUERY);
    expect(compiled.rules).toHaveLength(MAX_GUIDANCE_RULES);
    expect(compiled.omitted).toEqual({
      ids: ['pref_5', 'pref_6', 'pref_7', 'pref_8'],
      count: 4,
    });
  });

  it('stays within the 400-token default budget and never truncates prose', () => {
    const long = 'Keep every region grouped. '.repeat(30); // ~200 tokens each
    const prefs = Array.from({ length: 5 }, (_, i) =>
      confirmed({ id: `pref_${i}`, directive: long }),
    );
    const compiled = compileGuidance(prefs, [], QUERY);
    expect(compiled.tokenEstimate).toBeLessThanOrEqual(DEFAULT_GUIDANCE_TOKENS);
    expect(compiled.rules.length).toBeLessThan(5);
    // Whole rules only: every included directive is byte-identical to the
    // stored one, and the overflow is ids + count, not clipped text.
    for (const rule of compiled.rules) expect(rule.directive).toBe(long);
    expect(compiled.omitted!.count).toBe(5 - compiled.rules.length);
  });

  it('honors a raised budget but never exceeds the 800-token absolute ceiling', () => {
    const long = 'Keep every region grouped. '.repeat(30);
    const prefs = Array.from({ length: 9 }, (_, i) =>
      confirmed({ id: `pref_${i}`, directive: long }),
    );
    const raised = compileGuidance(prefs, [], {
      ...QUERY,
      maxTokens: 100_000,
    });
    expect(raised.tokenEstimate).toBeLessThanOrEqual(ABSOLUTE_GUIDANCE_TOKENS);
    expect(raised.rules.length).toBeGreaterThan(
      compileGuidance(prefs, [], QUERY).rules.length,
    );
  });

  it('omits (not clips) a single rule too large for the whole budget', () => {
    const huge = confirmed({
      id: 'pref_huge',
      directive: 'x'.repeat(4 * (DEFAULT_GUIDANCE_TOKENS + 50)),
    });
    const compiled = compileGuidance([huge], [], QUERY);
    expect(compiled.rules).toHaveLength(0);
    expect(compiled.omitted).toEqual({ ids: ['pref_huge'], count: 1 });
    expect(compiled.tokenEstimate).toBe(0);
  });

  it('keeps the shipped guidance pack itself well inside the default budget', () => {
    const compiled = compileGuidance([], GUIDANCE_PACK_RULES, QUERY);
    expect(compiled.omitted).toBeUndefined();
    expect(compiled.tokenEstimate).toBeLessThan(DEFAULT_GUIDANCE_TOKENS / 2);
  });
});

describe('inspection summaries (list/explain — summaries only)', () => {
  it('summarizes without rationale or evidence refs', () => {
    const summary = preferenceSummary(confirmed());
    expect(summary).toEqual({
      id: 'pref_a',
      status: 'confirmed',
      scope: 'user',
      archetype: 'multi-region-hub-spoke',
      directive: 'Prefer a layered regional hub/spoke hierarchy.',
      confidence: 0.7,
      supportingOutcomes: 3,
      evidenceDocuments: 2,
      lastObservedAt: '2026-07-02T11:30:00.000Z',
    });
    expect('sourceRevisionRefs' in summary).toBe(false);
    expect('rationale' in summary).toBe(false);
  });

  it('explains with counts and dates only — never source refs', () => {
    const explained = explainPreference(confirmed());
    expect(explained.evidence).toEqual({
      supportingOutcomes: 3,
      evidenceDocuments: 2,
      contradictingOutcomes: 0,
      firstObservedAt: '2026-07-01T10:00:00.000Z',
      lastObservedAt: '2026-07-02T11:30:00.000Z',
      confirmedAt: '2026-07-03T09:00:00.000Z',
    });
    expect(JSON.stringify(explained)).not.toContain('w1@r5');
  });
});

describe('guidance pack integrity', () => {
  it('pins the pack revision — bump GUIDANCE_REVISION when rules change', () => {
    // Characterization: this hash of the shipped rules must change together
    // with GUIDANCE_REVISION. If this test fails, either revert the pack edit
    // or bump the revision (see guidance-packs.ts).
    expect(GUIDANCE_REVISION).toBe(1);
    expect(GUIDANCE_PACK_RULES.map((r: GuidancePackRule) => r.id)).toEqual([
      'gp1:layout-discipline',
      'gp1:multi-region-hub-tier',
    ]);
  });
});
