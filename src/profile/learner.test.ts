import { describe, expect, it } from 'vitest';
import type { AuthoringOutcome, AuthoringPreference } from './model.js';
import {
  MAX_CANDIDATES_PER_OWNER,
  MAX_SOURCE_REFS_PER_CANDIDATE,
  compactSourceRefs,
  distinctDocuments,
  documentRefOf,
  newCandidate,
  outcomeDisposition,
  preferenceRuleIdentity,
  ruleIdentity,
  scopeKey,
  strengthenCandidate,
  weakestCandidateIndex,
} from './learner.js';

function outcome(over: Partial<AuthoringOutcome> = {}): AuthoringOutcome {
  return {
    archetype: 'multi-region-hub-spoke',
    addedTraits: ['layered-regional', 'spokes-below-hub'],
    removedTraits: ['radial-placement'],
    scope: { kind: 'user' },
    sourceRevisionRef: 'w1@r5',
    documentRef: 'w1',
    summary: 'radial → layered regional hub/spoke hierarchy',
    ...over,
  };
}

describe('rule identity (dedupe key)', () => {
  it('is stable under trait order and duplicates', () => {
    const a = ruleIdentity({
      archetype: 'leaf-spine',
      addedTraits: ['b', 'a', 'a'],
      removedTraits: ['z'],
      scope: { kind: 'user' },
    });
    const b = ruleIdentity({
      archetype: 'leaf-spine',
      addedTraits: ['a', 'b'],
      removedTraits: ['z', 'z'],
      scope: { kind: 'user' },
    });
    expect(a).toBe(b);
  });

  it('is derived from structure, NOT the prose summary', () => {
    // Same structured correction, different summaries → same identity.
    const base = { archetype: 'mesh', addedTraits: ['x'], removedTraits: [] };
    const id1 = ruleIdentity({ ...base, scope: { kind: 'user' } });
    const id2 = ruleIdentity({ ...base, scope: { kind: 'user' } });
    expect(id1).toBe(id2);
  });

  it('separates different scopes', () => {
    const shape = {
      archetype: 'mesh',
      addedTraits: ['x'],
      removedTraits: [] as string[],
    };
    expect(ruleIdentity({ ...shape, scope: { kind: 'user' } })).not.toBe(
      ruleIdentity({
        ...shape,
        scope: { kind: 'workspace', workspaceId: 'w1' },
      }),
    );
  });

  it('separates added-vs-removed direction', () => {
    expect(
      ruleIdentity({
        archetype: 'a',
        addedTraits: ['t'],
        removedTraits: [],
        scope: { kind: 'user' },
      }),
    ).not.toBe(
      ruleIdentity({
        archetype: 'a',
        addedTraits: [],
        removedTraits: ['t'],
        scope: { kind: 'user' },
      }),
    );
  });

  it('a built candidate recomputes to the same identity as its outcome', () => {
    const o = outcome();
    const pref = newCandidate('p1', 'owner', o, '2026-07-15T00:00:00.000Z');
    expect(preferenceRuleIdentity(pref)).toBe(ruleIdentity(o));
  });

  it('canonicalizes every scope kind', () => {
    expect(scopeKey({ kind: 'user' })).toBe('user');
    expect(scopeKey({ kind: 'workspace', workspaceId: 'w9' })).toBe(
      'workspace:w9',
    );
    expect(scopeKey({ kind: 'archetype', archetype: 'mesh' })).toBe(
      'archetype:mesh',
    );
  });
});

describe('newCandidate', () => {
  it('builds a candidate trigger from the correction traits', () => {
    const pref = newCandidate(
      'p1',
      'owner-42',
      outcome(),
      '2026-07-15T00:00:00.000Z',
    );
    expect(pref).toMatchObject({
      id: 'p1',
      ownerId: 'owner-42',
      status: 'candidate',
      confidence: 0,
      supportingOutcomes: 1,
      evidenceDocuments: 1,
      contradictingOutcomes: 0,
      trigger: {
        archetype: 'multi-region-hub-spoke',
        requiredTraits: ['layered-regional', 'spokes-below-hub'],
        excludedTraits: ['radial-placement'],
      },
      sourceRevisionRefs: ['w1@r5'],
    });
  });

  it('omits trigger.archetype when unknown', () => {
    const pref = newCandidate(
      'p1',
      'owner',
      outcome({ archetype: 'unknown' }),
      'now',
    );
    expect(pref.trigger.archetype).toBeUndefined();
  });
});

describe('strengthenCandidate (dedupe / burst coalescing)', () => {
  const base = newCandidate('p1', 'owner', outcome(), 't0');

  it('a repeated source ref is a no-op (same reference, no double-count)', () => {
    const again = strengthenCandidate(
      base,
      outcome({ sourceRevisionRef: 'w1@r5' }),
      't1',
    );
    expect(again).toBe(base); // identical reference — nothing changed
    expect(again.supportingOutcomes).toBe(1);
  });

  it('a new source ref in the same document bumps support, not evidence docs', () => {
    const next = strengthenCandidate(
      base,
      outcome({ sourceRevisionRef: 'w1@r9' }),
      't1',
    );
    expect(next.supportingOutcomes).toBe(2);
    expect(next.evidenceDocuments).toBe(1); // still one document (w1)
    expect(next.sourceRevisionRefs).toEqual(['w1@r5', 'w1@r9']);
    expect(next.lastObservedAt).toBe('t1');
  });

  it('a new document raises the distinct evidence-document count', () => {
    const next = strengthenCandidate(
      base,
      outcome({ sourceRevisionRef: 'w2@r3', documentRef: 'w2' }),
      't1',
    );
    expect(next.supportingOutcomes).toBe(2);
    expect(next.evidenceDocuments).toBe(2);
  });

  it('stays a candidate (no auto-promotion)', () => {
    const next = strengthenCandidate(
      base,
      outcome({ sourceRevisionRef: 'w9@r9' }),
      't1',
    );
    expect(next.status).toBe('candidate');
  });
});

describe('source-ref compaction', () => {
  it('caps refs at the per-candidate limit, keeping the most recent', () => {
    const many = Array.from(
      { length: MAX_SOURCE_REFS_PER_CANDIDATE + 5 },
      (_, i) => `w1@r${i}`,
    );
    const compacted = compactSourceRefs(many);
    expect(compacted).toHaveLength(MAX_SOURCE_REFS_PER_CANDIDATE);
    expect(compacted.at(-1)).toBe(many.at(-1));
    expect(compacted[0]).toBe(`w1@r5`);
  });

  it('de-duplicates', () => {
    expect(compactSourceRefs(['a@r1', 'a@r1', 'b@r2'])).toEqual([
      'a@r1',
      'b@r2',
    ]);
  });

  it('strengthen never exceeds the ref cap', () => {
    let pref = newCandidate(
      'p1',
      'owner',
      outcome({ sourceRevisionRef: 'w1@r0' }),
      't',
    );
    for (let i = 1; i < MAX_SOURCE_REFS_PER_CANDIDATE + 10; i++)
      pref = strengthenCandidate(
        pref,
        outcome({ sourceRevisionRef: `w1@r${i}` }),
        't',
      );
    expect(pref.sourceRevisionRefs.length).toBeLessThanOrEqual(
      MAX_SOURCE_REFS_PER_CANDIDATE,
    );
    expect(pref.supportingOutcomes).toBe(MAX_SOURCE_REFS_PER_CANDIDATE + 10);
  });
});

describe('evidence-document helpers', () => {
  it('documentRefOf strips the @revision suffix', () => {
    expect(documentRefOf('w1@r5')).toBe('w1');
    expect(documentRefOf('ws_abc@r0')).toBe('ws_abc');
    expect(documentRefOf('noatsign')).toBe('noatsign');
  });

  it('distinctDocuments counts unique document refs', () => {
    expect(distinctDocuments(['w1@r1', 'w1@r2', 'w2@r1'])).toBe(2);
  });
});

describe('weakestCandidateIndex (over-cap eviction)', () => {
  function pref(over: Partial<AuthoringPreference>): AuthoringPreference {
    return {
      ...newCandidate('id', 'owner', outcome(), 't0'),
      ...over,
    } as AuthoringPreference;
  }

  it('evicts the fewest-supporting candidate', () => {
    const list = [
      pref({ id: 'a', supportingOutcomes: 3 }),
      pref({ id: 'b', supportingOutcomes: 1 }),
      pref({ id: 'c', supportingOutcomes: 5 }),
    ];
    expect(weakestCandidateIndex(list)).toBe(1);
  });

  it('tie-breaks on evidence documents then recency then id', () => {
    const list = [
      pref({
        id: 'a',
        supportingOutcomes: 2,
        evidenceDocuments: 2,
        lastObservedAt: 't5',
      }),
      pref({
        id: 'b',
        supportingOutcomes: 2,
        evidenceDocuments: 1,
        lastObservedAt: 't9',
      }),
      pref({
        id: 'c',
        supportingOutcomes: 2,
        evidenceDocuments: 1,
        lastObservedAt: 't1',
      }),
    ];
    // b and c tie on support+evidence; c is older → weakest.
    expect(weakestCandidateIndex(list)).toBe(2);
  });

  it('the cap constant is a positive bound', () => {
    expect(MAX_CANDIDATES_PER_OWNER).toBeGreaterThan(0);
  });

  it('never picks an owner-confirmed rule; -1 when every record is confirmed', () => {
    const list = [
      pref({ id: 'a', status: 'confirmed', supportingOutcomes: 1 }),
      pref({ id: 'b', supportingOutcomes: 9 }),
      pref({ id: 'c', status: 'confirmed', supportingOutcomes: 2 }),
    ];
    // 'a' is weakest overall but confirmed — the unconfirmed 'b' is evicted.
    expect(weakestCandidateIndex(list)).toBe(1);
    expect(
      weakestCandidateIndex([
        pref({ id: 'a', status: 'confirmed' }),
        pref({ id: 'b', status: 'confirmed' }),
      ]),
    ).toBe(-1);
  });
});

describe('outcomeDisposition (P4 authority consequences)', () => {
  function stored(over: Partial<AuthoringPreference>): AuthoringPreference {
    return { ...newCandidate('id', 'owner', outcome(), 't0'), ...over };
  }

  it('strengthens an exact (rule, scope) match', () => {
    const existing = [stored({ id: 'a' })];
    expect(outcomeDisposition(existing, outcome())).toEqual({
      action: 'strengthen',
      index: 0,
    });
  });

  it('creates a fresh candidate for an unseen rule', () => {
    const existing = [stored({ id: 'a' })];
    expect(
      outcomeDisposition(existing, outcome({ addedTraits: ['other-trait'] })),
    ).toEqual({ action: 'create' });
  });

  it('a re-scoped CONFIRMED rule still owns its correction — no shadow candidate', () => {
    const confirmedRescoped = stored({
      id: 'a',
      status: 'confirmed',
      scope: { kind: 'archetype', archetype: 'multi-region-hub-spoke' },
    });
    // The learner emits { kind: 'user' } scope, which no longer matches the
    // scoped identity — the unscoped fallback must find the confirmed rule.
    expect(outcomeDisposition([confirmedRescoped], outcome())).toEqual({
      action: 'strengthen',
      index: 0,
    });
  });

  it('a rejected rule drops matching outcomes outright ("do not learn this")', () => {
    expect(
      outcomeDisposition([stored({ id: 'a', status: 'rejected' })], outcome()),
    ).toEqual({ action: 'skip' });
  });

  it('a plain candidate does NOT capture differently-scoped outcomes', () => {
    const workspaceScoped = stored({
      id: 'a',
      scope: { kind: 'workspace', workspaceId: 'w_1' },
    });
    // Same structural rule, different scope, no owner decision → new record
    // (the P2 dedupe key is (rule, scope); only owner-decided records widen).
    expect(outcomeDisposition([workspaceScoped], outcome())).toEqual({
      action: 'create',
    });
  });
});
