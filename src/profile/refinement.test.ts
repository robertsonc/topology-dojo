/**
 * Deterministic contradiction/decay coverage for Packet P5 (proposal 0003-C)
 * — including 0003 acceptance criteria 3 and 4 as NAMED tests. Everything is
 * pure: time is a fixed ISO string, and `AuthoringProfile.recordOutcome` is a
 * storage shell over exactly these functions.
 */
import { describe, expect, it } from 'vitest';
import type { AuthoringOutcome, AuthoringPreference } from './model.js';
import {
  MAX_EXCEPTION_WORKSPACES,
  REVIEW_CONTRADICTIONS,
  STALE_AFTER_DAYS,
  applyContradiction,
  calibratedConfidence,
  contradictionOf,
  contradictionUpdates,
  staleForReview,
} from './refinement.js';
import { compileGuidance } from './guidance.js';

const NOW = '2026-07-17T12:00:00.000Z';

function confirmedRule(
  overrides: Partial<AuthoringPreference> = {},
): AuthoringPreference {
  return {
    id: 'pref_rule',
    ownerId: '42',
    profileRevision: 0,
    scope: { kind: 'user' },
    trigger: {
      archetype: 'multi-region-hub-spoke',
      requiredTraits: ['layered-regional', 'spokes-below-hub'],
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

/** An outcome that REVERSES the rule above: radial placement re-introduced. */
function reversal(over: Partial<AuthoringOutcome> = {}): AuthoringOutcome {
  return {
    archetype: 'multi-region-hub-spoke',
    addedTraits: ['radial-placement'],
    removedTraits: ['layered-regional'],
    scope: { kind: 'user' },
    sourceRevisionRef: 'w9@r3',
    documentRef: 'w9',
    summary: 'layered regional → radial hub placement',
    ...over,
  };
}

describe('contradictionOf', () => {
  it('detects a reversal: re-added excluded traits + removed required traits', () => {
    expect(contradictionOf(confirmedRule(), reversal()).sort()).toEqual([
      'layered-regional',
      'radial-placement',
    ]);
  });

  it('an aligned or unrelated correction is not a contradiction', () => {
    const aligned = reversal({
      addedTraits: ['layered-regional'],
      removedTraits: ['radial-placement'],
    });
    expect(contradictionOf(confirmedRule(), aligned)).toEqual([]);
    const unrelatedTraits = reversal({
      addedTraits: ['dense-mesh'],
      removedTraits: ['sparse-links'],
    });
    expect(contradictionOf(confirmedRule(), unrelatedTraits)).toEqual([]);
  });

  it('is archetype-gated: the same reversal on another archetype is different work', () => {
    expect(
      contradictionOf(confirmedRule(), reversal({ archetype: 'leaf-spine' })),
    ).toEqual([]);
  });
});

describe('calibratedConfidence', () => {
  it('scales the confirmation base by the supporting share of evidence', () => {
    expect(calibratedConfidence(3, 0)).toBe(0.7);
    // 0.7 * 3/4 = 0.525 → 0.52 (binary 52.4999… rounds down — deterministic).
    expect(calibratedConfidence(3, 1)).toBe(0.52);
    expect(calibratedConfidence(3, 3)).toBe(0.35); // 0.7 * 1/2
    expect(calibratedConfidence(1, 0)).toBe(0.5);
  });
});

describe('applyContradiction', () => {
  it('counts, records the exception workspace, recalibrates, and stamps observation', () => {
    const next = applyContradiction(confirmedRule(), reversal(), NOW);
    expect(next.contradictingOutcomes).toBe(1);
    expect(next.exceptionWorkspaceIds).toEqual(['w9']);
    expect(next.contradictionRevisionRefs).toEqual(['w9@r3']);
    expect(next.confidence).toBe(0.52);
    expect(next.lastObservedAt).toBe(NOW);
    expect(next.needsReview).toBeUndefined(); // below the review threshold
  });

  it('coalesces a burst: a repeated contradiction source ref changes nothing', () => {
    const once = applyContradiction(confirmedRule(), reversal(), NOW);
    expect(applyContradiction(once, reversal(), NOW)).toBe(once);
  });

  it(`flags review at ${REVIEW_CONTRADICTIONS} contradictions`, () => {
    const once = applyContradiction(confirmedRule(), reversal(), NOW);
    const twice = applyContradiction(
      once,
      reversal({ sourceRevisionRef: 'w9@r8' }),
      NOW,
    );
    expect(twice.contradictingOutcomes).toBe(2);
    expect(twice.needsReview).toBe(true);
  });

  it('bounds the exception list, keeping the newest workspaces', () => {
    let rule = confirmedRule();
    for (let i = 0; i < MAX_EXCEPTION_WORKSPACES + 3; i++) {
      rule = applyContradiction(
        rule,
        reversal({ sourceRevisionRef: `ws${i}@r1`, documentRef: `ws${i}` }),
        NOW,
      );
    }
    expect(rule.exceptionWorkspaceIds).toHaveLength(MAX_EXCEPTION_WORKSPACES);
    expect(rule.exceptionWorkspaceIds!.at(-1)).toBe(
      `ws${MAX_EXCEPTION_WORKSPACES + 2}`,
    );
  });

  it('does not recalibrate candidate confidence (candidates stay 0)', () => {
    const candidate = confirmedRule({
      status: 'candidate',
      confidence: 0,
    });
    delete (candidate as Partial<AuthoringPreference>).confirmedAt;
    const next = applyContradiction(candidate, reversal(), NOW);
    expect(next.confidence).toBe(0);
    expect(next.contradictingOutcomes).toBe(1);
  });
});

describe('contradictionUpdates (the recordOutcome refinement pass)', () => {
  it('updates every reversed rule except the matched index and rejected tombstones', () => {
    const rules = [
      confirmedRule({ id: 'pref_a' }),
      confirmedRule({ id: 'pref_rejected', status: 'rejected' }),
      confirmedRule({
        id: 'pref_other',
        trigger: { archetype: 'leaf-spine', requiredTraits: ['t'] },
      }),
    ];
    const updates = contradictionUpdates(rules, reversal(), NOW);
    expect([...updates.keys()]).toEqual([0]);
    expect(updates.get(0)!.contradictingOutcomes).toBe(1);

    // With the same rule marked as the outcome's own match, nothing updates.
    expect(contradictionUpdates(rules, reversal(), NOW, 0).size).toBe(0);
  });
});

describe('staleForReview (decay toward review)', () => {
  const rule = confirmedRule({ lastObservedAt: '2026-05-01T00:00:00.000Z' });

  it(`flags rules unobserved for over ${STALE_AFTER_DAYS} days — deterministically in 'now'`, () => {
    expect(staleForReview(rule, NOW)).toBe(true);
    expect(staleForReview(rule, '2026-05-02T00:00:00.000Z')).toBe(false);
  });

  it('never flags rejected tombstones or rules already under review', () => {
    expect(staleForReview({ ...rule, status: 'rejected' }, NOW)).toBe(false);
    expect(staleForReview({ ...rule, needsReview: true }, NOW)).toBe(false);
  });
});

/* ── 0003 acceptance criteria as named tests ──────────────────────────── */

describe('proposal 0003 acceptance criteria', () => {
  it('criterion 3: a confirmed regional hub/spoke preference applies only when its multi-region, hub-only-interconnect context matches', () => {
    // `multi-region-hub-spoke` is the P1 archetype DEFINED as ≥2 regions with
    // inter-region links confined to the hub tier (src/profile/features.ts),
    // so the trigger archetype IS the criterion's trait conjunction.
    const rule = confirmedRule();
    const applies = (archetype?: string) =>
      compileGuidance([rule], [], archetype ? { archetype } : {}).rules.some(
        (r) => r.id === rule.id,
      );
    expect(applies('multi-region-hub-spoke')).toBe(true);
    expect(applies('hub-and-spoke')).toBe(false); // single region: no match
    expect(applies('leaf-spine')).toBe(false);
    expect(applies(undefined)).toBe(false); // unknown context: never applied
  });

  it('criterion 4: a current-task override records a scoped exception and never corrupts the rule', () => {
    const rule = confirmedRule();
    // The user overrides the rule in workspace w9 (a task requirement wins).
    const next = applyContradiction(rule, reversal(), NOW);

    // The rule itself is NOT corrupted: directive, trigger, scope, status
    // are byte-identical; only evidence/confidence/exception state moved.
    expect(next.directive).toBe(rule.directive);
    expect(next.trigger).toEqual(rule.trigger);
    expect(next.scope).toEqual(rule.scope);
    expect(next.status).toBe('confirmed');

    // The exception is SCOPED: w9 no longer receives the rule…
    const inOverridden = compileGuidance([next], [], {
      archetype: 'multi-region-hub-spoke',
      workspaceId: 'w9',
    });
    expect(inOverridden.rules.some((r) => r.id === rule.id)).toBe(false);

    // …while every other workspace still does.
    const elsewhere = compileGuidance([next], [], {
      archetype: 'multi-region-hub-spoke',
      workspaceId: 'w1',
    });
    expect(elsewhere.rules.some((r) => r.id === rule.id)).toBe(true);
  });
});
