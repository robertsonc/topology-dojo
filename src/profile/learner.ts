/**
 * Pure learner correctness for the authoring profile (Packet P2 / proposal
 * 0003-A): rule identity, candidate build/strengthen (dedupe), evidence-ref
 * compaction, and over-cap eviction. Everything here is deterministic and
 * side-effect-free so the learning logic has real LOCAL unit coverage
 * (`learner.test.ts`) independent of the workerd-only DO harness. The
 * `AuthoringProfile` DO is a thin, hibernation-safe storage shell over these
 * functions.
 *
 * @see docs/proposals/0003-adaptive-agent-authoring-profiles.md
 *      ("Create or strengthen a candidate", "Guardrails against bad lessons").
 */
import type {
  AuthoringOutcome,
  AuthoringPreference,
  PreferenceScope,
} from './model.js';

/* ── bounds (hard, never best-effort) ─────────────────────────────────── */

/** Max distinct candidates retained per owner. Over this, the weakest is
 * evicted before a new candidate is stored — never unbounded growth. */
export const MAX_CANDIDATES_PER_OWNER = 200;
/** Max evidence refs retained per candidate; the oldest are compacted away. */
export const MAX_SOURCE_REFS_PER_CANDIDATE = 20;
/** Max distinct trait tokens kept on either side of a trigger. */
export const MAX_TRAITS = 32;

/* ── canonicalization ─────────────────────────────────────────────────── */

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => typeof v === 'string' && v))].sort();
}

/** Canonical string for a scope — the scope component of the dedupe key. */
export function scopeKey(scope: PreferenceScope): string {
  switch (scope?.kind) {
    case 'workspace':
      return `workspace:${scope.workspaceId}`;
    case 'archetype':
      return `archetype:${scope.archetype}`;
    case 'user':
      return 'user';
    default:
      return 'user';
  }
}

/** Fields that determine a candidate's identity. */
export interface RuleIdentityInput {
  archetype: string;
  addedTraits: readonly string[];
  removedTraits: readonly string[];
  scope: PreferenceScope;
}

/**
 * The dedupe key: (semantic rule, scope). A "semantic rule" is the STRUCTURED
 * correction — archetype + the sorted set of added/removed traits — NOT the
 * prose summary (guardrail: labels/text can never define a rule). Two
 * corrections with the same structural shape and scope collapse onto one
 * candidate no matter how their summaries read.
 */
export function ruleIdentity(input: RuleIdentityInput): string {
  const added = uniqueSorted(input.addedTraits);
  const removed = uniqueSorted(input.removedTraits);
  return [
    `arch:${input.archetype || 'unknown'}`,
    `add:${added.join(',')}`,
    `rem:${removed.join(',')}`,
    `scope:${scopeKey(input.scope)}`,
  ].join('|');
}

/** Recompute the identity of a stored candidate — used to find an existing
 * candidate to strengthen. Must agree with {@link ruleIdentity} for the outcome
 * that produced it, which holds because {@link newCandidate} sets the trigger
 * directly from the outcome's added/removed traits and archetype. */
export function preferenceRuleIdentity(pref: AuthoringPreference): string {
  return ruleIdentity({
    archetype: pref.trigger.archetype ?? 'unknown',
    addedTraits: pref.trigger.requiredTraits,
    removedTraits: pref.trigger.excludedTraits ?? [],
    scope: pref.scope,
  });
}

/** {@link ruleIdentity} without the scope component. Confirmation (Packet P4)
 * can re-scope a rule away from the learner's `{ kind: 'user' }` emission, so
 * an owner-decided record must keep owning its structural correction under any
 * scope — this is the key that finds it. */
export function unscopedRuleIdentity(
  input: Omit<RuleIdentityInput, 'scope'>,
): string {
  return ruleIdentity({ ...input, scope: { kind: 'user' } });
}

function preferenceUnscopedIdentity(pref: AuthoringPreference): string {
  return unscopedRuleIdentity({
    archetype: pref.trigger.archetype ?? 'unknown',
    addedTraits: pref.trigger.requiredTraits,
    removedTraits: pref.trigger.excludedTraits ?? [],
  });
}

/** What `recordOutcome` should do with an inbound outcome, given the stored
 * records (P4). Decided here, pure, so the owner-authority consequences are
 * locally testable:
 *
 * - exact (rule, scope) identity match — the P2 dedupe key — wins first;
 * - otherwise an owner-DECIDED record (confirmed/rejected) with the same
 *   unscoped rule identity still owns the correction, even after the owner
 *   re-scoped it away from the learner's `user` emission scope — never spawn
 *   a shadow user-scoped candidate beside it;
 * - a matching `rejected` record means the owner said "do not learn this":
 *   the outcome is dropped entirely, never strengthened or re-created.
 */
export type OutcomeDisposition =
  | { action: 'create' }
  | { action: 'skip' }
  | { action: 'strengthen'; index: number };

export function outcomeDisposition(
  existing: readonly AuthoringPreference[],
  outcome: AuthoringOutcome,
): OutcomeDisposition {
  const scoped = ruleIdentity(outcome);
  let index = existing.findIndex((p) => preferenceRuleIdentity(p) === scoped);
  if (index === -1) {
    const unscoped = unscopedRuleIdentity(outcome);
    index = existing.findIndex(
      (p) =>
        (p.status === 'confirmed' || p.status === 'rejected') &&
        preferenceUnscopedIdentity(p) === unscoped,
    );
  }
  if (index === -1) return { action: 'create' };
  return existing[index]!.status === 'rejected'
    ? { action: 'skip' }
    : { action: 'strengthen', index };
}

/* ── evidence refs ────────────────────────────────────────────────────── */

/** The `<documentRef>` prefix of a `"<documentRef>@r<revision>"` source ref. */
export function documentRefOf(ref: string): string {
  const at = ref.lastIndexOf('@');
  return at > 0 ? ref.slice(0, at) : ref;
}

/** Distinct evidence documents represented by a set of source refs. */
export function distinctDocuments(refs: readonly string[]): number {
  return new Set(refs.map(documentRefOf)).size;
}

/** De-duplicate and cap source refs, keeping the most recent — bounded, never
 * a growing history. Order is preserved (appended newest-last). */
export function compactSourceRefs(refs: readonly string[]): string[] {
  const unique = [...new Set(refs)];
  return unique.length > MAX_SOURCE_REFS_PER_CANDIDATE
    ? unique.slice(unique.length - MAX_SOURCE_REFS_PER_CANDIDATE)
    : unique;
}

/* ── build / strengthen ───────────────────────────────────────────────── */

/** A fresh `candidate` preference from a first-seen outcome. */
export function newCandidate(
  id: string,
  ownerId: string,
  outcome: AuthoringOutcome,
  now: string,
): AuthoringPreference {
  const required = uniqueSorted(outcome.addedTraits).slice(0, MAX_TRAITS);
  const excluded = uniqueSorted(outcome.removedTraits).slice(0, MAX_TRAITS);
  const archetype = outcome.archetype || 'unknown';
  return {
    id,
    ownerId,
    profileRevision: 0,
    scope: outcome.scope,
    trigger: {
      ...(archetype !== 'unknown' ? { archetype } : {}),
      requiredTraits: required,
      ...(excluded.length ? { excludedTraits: excluded } : {}),
    },
    directive: outcome.summary,
    rationale: outcome.rationale ?? outcome.summary,
    status: 'candidate',
    confidence: 0,
    evidenceDocuments: 1,
    supportingOutcomes: 1,
    contradictingOutcomes: 0,
    sourceRevisionRefs: [outcome.sourceRevisionRef],
    createdAt: now,
    lastObservedAt: now,
  };
}

/**
 * Strengthen an existing candidate with another outcome (dedupe path). Returns
 * a NEW record, or the SAME reference unchanged when the outcome's source ref
 * is already recorded — that is the burst-coalescing / idempotency guard: an
 * outcome carrying a source ref we've already counted must not bump anything.
 * Status is never changed here: no auto-promotion, and a confirmed rule that
 * keeps accruing evidence stays confirmed.
 */
export function strengthenCandidate(
  existing: AuthoringPreference,
  outcome: AuthoringOutcome,
  now: string,
): AuthoringPreference {
  if (existing.sourceRevisionRefs.includes(outcome.sourceRevisionRef))
    return existing; // already counted this burst — no double-count
  const sourceRevisionRefs = compactSourceRefs([
    ...existing.sourceRevisionRefs,
    outcome.sourceRevisionRef,
  ]);
  return {
    ...existing,
    supportingOutcomes: existing.supportingOutcomes + 1,
    evidenceDocuments: distinctDocuments(sourceRevisionRefs),
    sourceRevisionRefs,
    lastObservedAt: now,
  };
}

/* ── eviction ─────────────────────────────────────────────────────────── */

/**
 * Index of the weakest record to evict when over the per-owner cap: fewest
 * supporting outcomes, then fewest evidence documents, then oldest last-observed
 * (stably tie-broken by id). `confirmed` rules are NEVER eviction victims — the
 * owner explicitly blessed them (P4), so when every stored record is confirmed
 * this returns -1 and the caller drops the NEW candidate instead.
 */
export function weakestCandidateIndex(
  candidates: readonly AuthoringPreference[],
): number {
  let worst = -1;
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i]!.status === 'confirmed') continue;
    if (worst === -1) {
      worst = i;
      continue;
    }
    const a = candidates[i]!;
    const b = candidates[worst]!;
    if (a.supportingOutcomes !== b.supportingOutcomes) {
      if (a.supportingOutcomes < b.supportingOutcomes) worst = i;
      continue;
    }
    if (a.evidenceDocuments !== b.evidenceDocuments) {
      if (a.evidenceDocuments < b.evidenceDocuments) worst = i;
      continue;
    }
    if (a.lastObservedAt !== b.lastObservedAt) {
      if (a.lastObservedAt < b.lastObservedAt) worst = i;
      continue;
    }
    if (a.id < b.id) worst = i;
  }
  return worst;
}
