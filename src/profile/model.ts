/**
 * Shared authoring-profile record shapes (Packet P2 / proposal 0003-A).
 *
 * These types are imported by BOTH the `worker/` code (the `AuthoringProfile`
 * Durable Object and the coordinator's emission hook) and the local pure tests,
 * so they live here in `src/` rather than under `worker/`. The module is types
 * plus one plain-data outcome shape — no runtime behavior, no DOM, no I/O — so
 * it is client-safe and workerd-safe alike.
 *
 * `AuthoringPreference` mirrors the "Preference record" in proposal 0003
 * (~L160). Learning (Packet P2) only ever writes `status: 'candidate'`;
 * `confirmed` and `rejected` are browser-owner decisions made through the
 * Packet P4 confirmation flow, and only `confirmed` rules are ever compiled
 * into agent guidance (`src/profile/guidance.ts`).
 *
 * @see docs/proposals/0003-adaptive-agent-authoring-profiles.md
 */

/** Where a preference applies. Observe-only P2 always emits `{ kind: 'user' }`
 * so repeated corrections across a user's documents deduplicate together; the
 * other scopes exist for later packets (workspace conventions, archetype). */
export type PreferenceScope =
  | { kind: 'user' }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'archetype'; archetype: string };

/** The structural condition under which a preference is relevant. Built from a
 * P1 correction's before/after trait diff, never from prose. */
export interface PreferenceTrigger {
  /** Topology archetype the rule applies to (omitted for `unknown`). */
  archetype?: string;
  /** Traits the settled correction introduced — the rule's positive condition. */
  requiredTraits: string[];
  /** Traits the correction removed — the rule's negative condition. */
  excludedTraits?: string[];
}

export type PreferenceStatus =
  | 'candidate'
  | 'confirmed'
  | 'paused'
  | 'rejected';

/**
 * A single learned authoring preference — the proposal's "Preference record".
 * In Packet P2 these are always `candidate`s populated from repeated attributed
 * corrections; the evidence refs are bounded and compacted so the store never
 * becomes a second document history.
 */
export interface AuthoringPreference {
  id: string;
  ownerId: string;
  profileRevision: number;
  scope: PreferenceScope;
  trigger: PreferenceTrigger;
  /** Concise instruction supplied to the agent — stored but NOT delivered in P2. */
  directive: string;
  /** User-visible reason; not always sent to the model. */
  rationale: string;
  status: PreferenceStatus;
  /** Calibrated confidence; never treated as permission. 0 while a candidate. */
  confidence: number;
  /** Distinct source documents that contributed evidence. */
  evidenceDocuments: number;
  /** Independent supporting outcomes (one editing burst = one outcome). */
  supportingOutcomes: number;
  /** Outcomes that contradicted the rule (tracked from P5; 0 in P2). */
  contradictingOutcomes: number;
  /** Bounded, compacted opaque refs — never embedded documents/operations. */
  sourceRevisionRefs: string[];
  createdAt: string;
  lastObservedAt: string;
  lastAppliedAt?: string;
  /**
   * When the browser owner confirmed this rule (Packet P4). Present on every
   * record that has ever been confirmed — a paused rule with `confirmedAt`
   * resumes back to `confirmed`, not `candidate`, so pausing never silently
   * demotes an owner-blessed rule. Absent on P2/P3-era records.
   */
  confirmedAt?: string;
}

/**
 * The compact, structured outcome the coordinator sends to the profile DO after
 * a user correction survives a checkpoint. It carries ONLY P1 semantic features
 * (categorical traits + archetype) and bounded opaque refs — never raw
 * documents or operations (proposal discipline #1 / guardrail #4).
 */
export interface AuthoringOutcome {
  /** Archetype of the settled (post-correction) topology. */
  archetype: string;
  /** Traits the user's settled correction added (after − before). */
  addedTraits: string[];
  /** Traits the user's settled correction removed (before − after). */
  removedTraits: string[];
  /** Scope hint decided by the coordinator (observe-only: `{ kind: 'user' }`). */
  scope: PreferenceScope;
  /**
   * Bounded opaque reference to the source revision, of the form
   * `"<documentRef>@r<revision>"`. Identifies the burst so a re-delivered
   * outcome cannot double-count, and (via its `<documentRef>` prefix) lets the
   * store count distinct evidence documents without storing any document.
   */
  sourceRevisionRef: string;
  /** Stable evidence-document identity (the workspace id) for distinct counts. */
  documentRef: string;
  /** Short categorical correction summary (e.g. "radial → layered regional
   * hub/spoke hierarchy") — becomes the candidate directive/rationale. */
  summary: string;
  /** Optional structural pass-through rationale (never parsed as a rule). */
  rationale?: string;
}

/** The read shape returned by `AuthoringProfile.getProfile`. */
export interface AuthoringProfileView {
  ownerId: string;
  profileRevision: number;
  preferences: AuthoringPreference[];
}
