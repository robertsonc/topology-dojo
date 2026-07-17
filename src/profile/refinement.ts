/**
 * Pure outcome refinement (Packet P5 / proposal 0003-C): contradiction
 * detection, confidence recalibration, workspace-scoped exceptions, and
 * stale-toward-review decay. Everything here is deterministic — time is an
 * injected ISO string, never read from a clock — so the refinement rules have
 * real LOCAL unit coverage (`refinement.test.ts`, including proposal 0003
 * acceptance criteria 3–4 as named tests). The `AuthoringProfile` DO's
 * `recordOutcome` is a thin storage shell over these functions, exactly as it
 * shells `learner.ts` for the supporting side.
 *
 * The core semantics (proposal §"Measure and correct" / guardrail #6 /
 * acceptance criterion 4):
 *
 * - a user correction that REVERSES a rule's trait direction is a
 *   contradiction of that rule — it lowers calibrated confidence and records
 *   a scoped exception for the workspace it came from;
 * - an exception NARROWS where the rule serves; it never mutates the rule's
 *   directive or trigger (no global winner, no corruption);
 * - repeated contradictions (or long disuse) push the rule toward owner
 *   REVIEW — never silent disabling or deletion.
 */
import type { AuthoringOutcome, AuthoringPreference } from './model.js';
import { compactSourceRefs } from './learner.js';

/* ── bounds & thresholds (hard, documented) ───────────────────────────── */

/** Max workspaces retained on a rule's exception list (newest kept). */
export const MAX_EXCEPTION_WORKSPACES = 8;
/** Contradictions needed before a rule is flagged for review — one override
 * is an exception, a pattern of them is a question for the owner. */
export const REVIEW_CONTRADICTIONS = 2;
/** Days without a new observation before a rule decays toward review. */
export const STALE_AFTER_DAYS = 45;

/* ── contradiction detection ──────────────────────────────────────────── */

/**
 * The traits by which `outcome` REVERSES `pref`'s correction direction:
 * traits the outcome re-added that the rule excludes, plus traits the outcome
 * removed that the rule requires. Non-empty ⇒ the outcome contradicts the
 * rule. Archetype-gated: a correction on an unrelated archetype is different
 * work, not an override of this rule.
 */
export function contradictionOf(
  pref: AuthoringPreference,
  outcome: AuthoringOutcome,
): string[] {
  const ruleArchetype = pref.trigger.archetype ?? 'unknown';
  if (ruleArchetype !== (outcome.archetype || 'unknown')) return [];
  const excluded = new Set(pref.trigger.excludedTraits ?? []);
  const required = new Set(pref.trigger.requiredTraits);
  return [
    ...outcome.addedTraits.filter((trait) => excluded.has(trait)),
    ...outcome.removedTraits.filter((trait) => required.has(trait)),
  ];
}

/* ── confidence ───────────────────────────────────────────────────────── */

/**
 * Calibrated confidence for a CONFIRMED rule: the Packet P4 confirmation
 * base — floor 0.5 for the explicit owner decision, +0.1 per additional
 * independent supporting outcome, capped at 0.9 — scaled down by the share of
 * supporting evidence among all evidence. Deterministic, rounded to 2 places;
 * never treated as permission (the proposal), only as ranking signal.
 */
export function calibratedConfidence(
  supportingOutcomes: number,
  contradictingOutcomes: number,
): number {
  const supporting = Math.max(1, supportingOutcomes);
  const base = Math.min(0.9, 0.5 + 0.1 * (supporting - 1));
  const share = supporting / (supporting + Math.max(0, contradictingOutcomes));
  return Math.round(base * share * 100) / 100;
}

/* ── applying a contradiction ─────────────────────────────────────────── */

/**
 * Apply one contradicting outcome to a stored rule. Returns a NEW record, or
 * the SAME reference unchanged when the outcome's source ref was already
 * counted (burst coalescing — mirrors `strengthenCandidate`). What changes:
 * `contradictingOutcomes`, the bounded contradiction refs, the bounded
 * per-workspace exception list, recalibrated `confidence` (confirmed rules
 * only), and `needsReview` once contradictions reach the threshold. What
 * NEVER changes: `status`, `scope`, `directive`, `rationale`, `trigger` —
 * an exception narrows, it does not corrupt (acceptance criterion 4).
 */
export function applyContradiction(
  existing: AuthoringPreference,
  outcome: AuthoringOutcome,
  now: string,
): AuthoringPreference {
  const counted = existing.contradictionRevisionRefs ?? [];
  if (counted.includes(outcome.sourceRevisionRef)) return existing;
  const contradictionRevisionRefs = compactSourceRefs([
    ...counted,
    outcome.sourceRevisionRef,
  ]);
  const contradictingOutcomes = existing.contradictingOutcomes + 1;
  const exceptions = existing.exceptionWorkspaceIds ?? [];
  const exceptionWorkspaceIds = [
    ...new Set([...exceptions, outcome.documentRef]),
  ].slice(-MAX_EXCEPTION_WORKSPACES);
  return {
    ...existing,
    contradictingOutcomes,
    contradictionRevisionRefs,
    exceptionWorkspaceIds,
    ...(existing.status === 'confirmed'
      ? {
          confidence: calibratedConfidence(
            existing.supportingOutcomes,
            contradictingOutcomes,
          ),
        }
      : {}),
    ...(contradictingOutcomes >= REVIEW_CONTRADICTIONS
      ? { needsReview: true }
      : {}),
    lastObservedAt: now,
  };
}

/**
 * The refinement pass `recordOutcome` runs after the supporting-side
 * disposition: every stored rule the outcome contradicts, EXCEPT the record
 * the outcome itself matched (`skipIndex`) and `rejected` tombstones (the
 * owner already ended those). Returns the updated records by index — empty
 * when nothing changed.
 */
export function contradictionUpdates(
  existing: readonly AuthoringPreference[],
  outcome: AuthoringOutcome,
  now: string,
  skipIndex = -1,
): Map<number, AuthoringPreference> {
  const updates = new Map<number, AuthoringPreference>();
  existing.forEach((pref, index) => {
    if (index === skipIndex || pref.status === 'rejected') return;
    if (!contradictionOf(pref, outcome).length) return;
    const next = applyContradiction(pref, outcome, now);
    if (next !== pref) updates.set(index, next);
  });
  return updates;
}

/* ── decay toward review ──────────────────────────────────────────────── */

/**
 * True when a rule has gone unobserved long enough to decay toward review
 * (proposal: "Stale, unused preferences decay toward review but are not
 * silently deleted"). Pure in `now`; the panel computes it at render time so
 * nothing is written to storage merely by the passage of time. Rejected
 * tombstones and already-flagged rules are excluded (nothing new to say).
 */
export function staleForReview(
  pref: AuthoringPreference,
  now: string,
): boolean {
  if (pref.status === 'rejected' || pref.needsReview) return false;
  const ageMs = Date.parse(now) - Date.parse(pref.lastObservedAt);
  return (
    Number.isFinite(ageMs) && ageMs > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000
  );
}
