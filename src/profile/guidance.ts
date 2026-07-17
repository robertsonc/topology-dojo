/**
 * Pure compiled-guidance builder (Packet P4 / proposal 0003-B): which rules
 * apply to a task, how they rank, and — above all — the HARD token budget.
 * Everything here is deterministic and side-effect-free so the budget/overflow
 * behavior has real local unit coverage (`guidance.test.ts`); the
 * `AuthoringProfile` DO's `getGuidance` is a thin caching shell over
 * {@link compileGuidance}, exactly as the DO's learning path shells
 * `learner.ts`.
 *
 * Budget discipline (proposal §"Token budget" — limits, not aspirations):
 *
 * - at most {@link MAX_GUIDANCE_RULES} rules per response;
 * - serialized instruction budget {@link DEFAULT_GUIDANCE_TOKENS} by default,
 *   {@link ABSOLUTE_GUIDANCE_TOKENS} absolute ceiling (explicit inspection);
 * - a rule either fits WHOLE or is reported by id in `omitted` — truncated
 *   prose could change an instruction's meaning, so it never happens;
 * - only owner-CONFIRMED preferences are served (candidates/paused/rejected
 *   never reach an agent), plus the versioned product pack.
 *
 * @see docs/proposals/0003-adaptive-agent-authoring-profiles.md
 */
import type { AuthoringPreference } from './model.js';
import { scopeKey } from './learner.js';
import type { GuidancePackRule } from './guidance-packs.js';

/* ── budgets (hard, never best-effort) ────────────────────────────────── */

/** Max rules in one compiled response; the rest are ids in `omitted`. */
export const MAX_GUIDANCE_RULES = 5;
/** Default serialized-instruction budget (estimated tokens). */
export const DEFAULT_GUIDANCE_TOKENS = 400;
/** Ceiling a caller can raise the budget to for explicit profile inspection —
 * `maxTokens` above this clamps DOWN; there is no way past it. */
export const ABSOLUTE_GUIDANCE_TOKENS = 800;

/**
 * Deterministic token estimate: ceil(length / 4) — the standard ~4 chars/token
 * heuristic, biased high for short strings so budget checks fail safe. This is
 * an estimator with a fixed definition, not a tokenizer; tests pin budget
 * behavior against it.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Clamp a requested budget into (0, {@link ABSOLUTE_GUIDANCE_TOKENS}];
 * absent/invalid requests get the default. */
export function clampGuidanceBudget(maxTokens?: number): number {
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens))
    return DEFAULT_GUIDANCE_TOKENS;
  return Math.max(1, Math.min(ABSOLUTE_GUIDANCE_TOKENS, Math.floor(maxTokens)));
}

/* ── shapes ───────────────────────────────────────────────────────────── */

/** What the agent asked guidance for. */
export interface GuidanceQuery {
  /** Task archetype (`src/profile/features.ts` vocabulary), when known. */
  archetype?: string;
  /** Workspace the agent is working in, for workspace-scoped conventions. */
  workspaceId?: string;
  /** Raise the budget (clamped to the absolute ceiling) for inspection. */
  maxTokens?: number;
}

/** One compiled directive. Deliberately three small fields — no evidence
 * counts, no rationale, no refs — so compiled output is a pure function of
 * (profileRevision, guidanceRevision, workspace, archetype) and stays tiny. */
export interface CompiledGuidanceRule {
  id: string;
  directive: string;
  /** Provenance: `user`, `workspace:<id>`, `archetype:<a>`, or `product`. */
  scope: string;
}

export interface CompiledGuidance {
  /** Applicable rules, highest-precedence first, each within budget. */
  rules: CompiledGuidanceRule[];
  /** Rules that matched but exceeded the rule-count or token budget: their
   * ids and how many — never truncated prose (proposal §"Token budget"). */
  omitted?: { ids: string[]; count: number };
  /** Estimated tokens of the included rules' serialized form. */
  tokenEstimate: number;
}

/** `getGuidance`'s wire shape: revisions always; body unless unchanged. */
export type GuidanceResult =
  | { notModified: true; profileRevision: number; guidanceRevision: number }
  | ({
      profileRevision: number;
      guidanceRevision: number;
    } & CompiledGuidance);

/** True when the caller's last-seen revisions BOTH match — the `notModified`
 * short-circuit (proposal acceptance criterion 6). */
export function guidanceNotModified(
  current: { profileRevision: number; guidanceRevision: number },
  last: { lastProfileRevision?: number; lastGuidanceRevision?: number },
): boolean {
  return (
    last.lastProfileRevision === current.profileRevision &&
    last.lastGuidanceRevision === current.guidanceRevision
  );
}

/* ── applicability + ranking ──────────────────────────────────────────── */

/** A confirmed preference applies when its scope and trigger both match the
 * task. Trigger-TRAIT matching (acceptance criterion 3) is Packet P5; here an
 * archetype-conditioned rule simply requires the matching task archetype. */
function preferenceApplies(
  pref: AuthoringPreference,
  query: GuidanceQuery,
): boolean {
  if (pref.status !== 'confirmed') return false;
  if (
    pref.scope.kind === 'workspace' &&
    pref.scope.workspaceId !== query.workspaceId
  )
    return false;
  if (
    pref.scope.kind === 'archetype' &&
    pref.scope.archetype !== query.archetype
  )
    return false;
  const triggerArchetype = pref.trigger.archetype;
  if (triggerArchetype && triggerArchetype !== query.archetype) return false;
  return true;
}

/** Scope-specificity rank for ordering (higher = more specific = earlier);
 * product defaults always rank below every user preference. */
function specificity(pref: AuthoringPreference): number {
  switch (pref.scope.kind) {
    case 'archetype':
      return 3;
    case 'workspace':
      return 2;
    default:
      return 1;
  }
}

/** Confirmed, applicable preferences ordered by the proposal's ranking: task
 * (archetype) match, scope specificity, confidence, recency — id as the
 * stable final tie-break. */
export function rankPreferences(
  prefs: readonly AuthoringPreference[],
  query: GuidanceQuery,
): AuthoringPreference[] {
  return prefs
    .filter((pref) => preferenceApplies(pref, query))
    .sort(
      (a, b) =>
        Number(b.trigger.archetype === query.archetype) -
          Number(a.trigger.archetype === query.archetype) ||
        specificity(b) - specificity(a) ||
        b.confidence - a.confidence ||
        b.lastObservedAt.localeCompare(a.lastObservedAt) ||
        a.id.localeCompare(b.id),
    );
}

/* ── compilation ──────────────────────────────────────────────────────── */

function packApplies(rule: GuidancePackRule, query: GuidanceQuery): boolean {
  return !rule.archetype || rule.archetype === query.archetype;
}

function ruleTokens(rule: CompiledGuidanceRule): number {
  return estimateTokens(JSON.stringify(rule));
}

/**
 * Compile the bounded guidance response for one task: ranked user preferences
 * first (they override product defaults), then applicable pack rules, taking
 * each whole rule while BOTH budgets hold. Overflow yields ids + a count.
 */
export function compileGuidance(
  prefs: readonly AuthoringPreference[],
  pack: readonly GuidancePackRule[],
  query: GuidanceQuery,
): CompiledGuidance {
  const budget = clampGuidanceBudget(query.maxTokens);
  const applicable: CompiledGuidanceRule[] = [
    ...rankPreferences(prefs, query).map((pref) => ({
      id: pref.id,
      directive: pref.directive,
      scope: scopeKey(pref.scope),
    })),
    ...pack
      .filter((rule) => packApplies(rule, query))
      .map((rule) => ({
        id: rule.id,
        directive: rule.directive,
        scope: 'product',
      })),
  ];

  const rules: CompiledGuidanceRule[] = [];
  const omittedIds: string[] = [];
  let tokenEstimate = 0;
  for (const rule of applicable) {
    const cost = ruleTokens(rule);
    if (rules.length < MAX_GUIDANCE_RULES && tokenEstimate + cost <= budget) {
      rules.push(rule);
      tokenEstimate += cost;
    } else {
      omittedIds.push(rule.id);
    }
  }
  return {
    rules,
    ...(omittedIds.length
      ? { omitted: { ids: omittedIds, count: omittedIds.length } }
      : {}),
    tokenEstimate,
  };
}

/* ── inspection shapes (MCP `list` / `explain`, summaries only) ───────── */

/** Compact per-rule summary for `list_authoring_preferences` — management
 * support only, no rationale/refs (proposal: "summaries only"). */
export interface PreferenceSummary {
  id: string;
  status: AuthoringPreference['status'];
  scope: string;
  archetype?: string;
  directive: string;
  confidence: number;
  supportingOutcomes: number;
  evidenceDocuments: number;
  lastObservedAt: string;
}

export function preferenceSummary(
  pref: AuthoringPreference,
): PreferenceSummary {
  return {
    id: pref.id,
    status: pref.status,
    scope: scopeKey(pref.scope),
    ...(pref.trigger.archetype ? { archetype: pref.trigger.archetype } : {}),
    directive: pref.directive,
    confidence: pref.confidence,
    supportingOutcomes: pref.supportingOutcomes,
    evidenceDocuments: pref.evidenceDocuments,
    lastObservedAt: pref.lastObservedAt,
  };
}

/** Full single-rule explanation for `explain_authoring_preference`: scope,
 * trigger, rationale, confidence, and an evidence SUMMARY — counts and dates
 * only, never refs or document content. */
export interface PreferenceExplanation {
  id: string;
  status: AuthoringPreference['status'];
  scope: string;
  trigger: AuthoringPreference['trigger'];
  directive: string;
  rationale: string;
  confidence: number;
  evidence: {
    supportingOutcomes: number;
    evidenceDocuments: number;
    contradictingOutcomes: number;
    firstObservedAt: string;
    lastObservedAt: string;
    confirmedAt?: string;
  };
}

export function explainPreference(
  pref: AuthoringPreference,
): PreferenceExplanation {
  return {
    id: pref.id,
    status: pref.status,
    scope: scopeKey(pref.scope),
    trigger: pref.trigger,
    directive: pref.directive,
    rationale: pref.rationale,
    confidence: pref.confidence,
    evidence: {
      supportingOutcomes: pref.supportingOutcomes,
      evidenceDocuments: pref.evidenceDocuments,
      contradictingOutcomes: pref.contradictingOutcomes,
      firstObservedAt: pref.createdAt,
      lastObservedAt: pref.lastObservedAt,
      ...(pref.confirmedAt ? { confirmedAt: pref.confirmedAt } : {}),
    },
  };
}
