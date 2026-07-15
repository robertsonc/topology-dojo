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
 * Status stays `candidate` (no auto-promotion in observe-only P2).
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
 * Index of the weakest candidate to evict when over the per-owner cap: fewest
 * supporting outcomes, then fewest evidence documents, then oldest last-observed
 * (stably tie-broken by id). Never touches confirmed rules in P2 because every
 * stored record is a candidate.
 */
export function weakestCandidateIndex(
  candidates: readonly AuthoringPreference[],
): number {
  let worst = 0;
  for (let i = 1; i < candidates.length; i++) {
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
