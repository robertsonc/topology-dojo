/**
 * Per-owner authoring-profile store (Packet P2 / proposal 0003-A).
 *
 * One Durable Object instance per authenticated owner, addressed by the stable
 * numeric uid (`env.AUTHORING_PROFILE.get(idFromName(ownerId))`) — the same
 * identity scheme the coordinator uses, which is what guarantees cross-owner
 * isolation: one owner's outcomes only ever reach that owner's DO.
 *
 * It holds bounded preference records learned asynchronously from attributed
 * correction outcomes. Learning only ever writes `candidate`s; the browser
 * owner promotes them through `confirmPreference` / `rejectPreference`
 * (Packet P4 / 0003-B) — those are the ONLY confirm paths, and they are
 * reachable exclusively via the owner-cookie `/api/profile` routes, never via
 * MCP. Agent retrieval is `getGuidance`: a bounded compile of CONFIRMED rules
 * plus the versioned product pack (`src/profile/guidance.ts`).
 *
 * Hibernation-safe: the only STATE is `ctx.storage`; the record set is
 * (re)read on every operation. The one in-memory member is the compiled
 * guidance cache — pure derived data keyed by
 * `(profileRevision, guidanceRevision, workspace, archetype, budget)`, so an
 * eviction merely costs one recompute.
 *
 * @see docs/proposals/0003-adaptive-agent-authoring-profiles.md
 */
import { DurableObject } from 'cloudflare:workers';
import type { WorkerEnv } from './env.js';
import type {
  AuthoringOutcome,
  AuthoringPreference,
  AuthoringProfileView,
  PreferenceScope,
} from '../src/profile/model.js';
import {
  MAX_CANDIDATES_PER_OWNER,
  MAX_TRAITS,
  documentRefOf,
  newCandidate,
  outcomeDisposition,
  strengthenCandidate,
  weakestCandidateIndex,
} from '../src/profile/learner.js';
import {
  clampGuidanceBudget,
  compileGuidance,
  guidanceNotModified,
  type CompiledGuidance,
  type GuidanceQuery,
  type GuidanceResult,
} from '../src/profile/guidance.js';
import {
  GUIDANCE_PACK_RULES,
  GUIDANCE_REVISION,
} from '../src/profile/guidance-packs.js';
import {
  calibratedConfidence,
  contradictionUpdates,
} from '../src/profile/refinement.js';

const META_KEY = 'meta';
const CANDIDATE_PREFIX = 'candidate:';
/** Max in-memory compiled-guidance entries (distinct workspace/archetype/
 * budget combinations per revision pair). Insertion-order eviction — plenty
 * for one owner's realistic concurrent tasks. */
const GUIDANCE_CACHE_MAX = 64;
const MAX_REF_LEN = 200;
const MAX_DOC_REF_LEN = 120;
const MAX_SUMMARY_LEN = 300;
const MAX_RATIONALE_LEN = 500;

/** Minimal per-owner metadata. The candidate set is the source of truth and is
 * listed from storage on demand, so nothing here is derived state that could go
 * stale across hibernation. */
interface ProfileMeta {
  format: 1;
  ownerId: string;
  /**
   * Bumped whenever what `getGuidance` could serve changes: every owner
   * manage action — pause/resume (`setPreferenceStatus`), forget
   * (`deletePreference`), confirm (`confirmPreference`), reject
   * (`rejectPreference`) — plus the ONE learning path that alters compiled
   * output: a contradiction (Packet P5), whose scoped exception can remove a
   * rule from a workspace's guidance. Plain strengthening still does not
   * bump it (it never alters a rule's compiled id/directive/scope form).
   * The compiled-guidance cache and callers' `notModified` checks key on it.
   */
  profileRevision: number;
  createdAt: string;
  updatedAt: string;
}

interface ProfileStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<unknown>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function assertOwner(meta: ProfileMeta, ownerId: string): void {
  if (meta.ownerId !== ownerId)
    throw new Error('authoring profile access denied');
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
}

function normalizeScope(value: unknown): PreferenceScope {
  const scope = value as {
    kind?: unknown;
    workspaceId?: unknown;
    archetype?: unknown;
  };
  if (scope?.kind === 'workspace' && typeof scope.workspaceId === 'string')
    return {
      kind: 'workspace',
      workspaceId: scope.workspaceId.slice(0, MAX_DOC_REF_LEN),
    };
  if (scope?.kind === 'archetype' && typeof scope.archetype === 'string')
    return { kind: 'archetype', archetype: scope.archetype.slice(0, 60) };
  return { kind: 'user' };
}

/**
 * STRICT scope parse for the owner's confirm action. Unlike `normalizeScope`
 * (which quietly defaults a malformed learning-path scope to `user`), a
 * malformed CONFIRM scope throws: silently confirming at a wider scope than
 * the owner chose would be an authority bug, not a tolerable coercion.
 */
function parseConfirmScope(value: unknown): PreferenceScope {
  const scope = value as {
    kind?: unknown;
    workspaceId?: unknown;
    archetype?: unknown;
  } | null;
  if (scope?.kind === 'user') return { kind: 'user' };
  if (
    scope?.kind === 'workspace' &&
    typeof scope.workspaceId === 'string' &&
    scope.workspaceId.length > 0
  )
    return {
      kind: 'workspace',
      workspaceId: scope.workspaceId.slice(0, MAX_DOC_REF_LEN),
    };
  if (
    scope?.kind === 'archetype' &&
    typeof scope.archetype === 'string' &&
    scope.archetype.length > 0
  )
    return { kind: 'archetype', archetype: scope.archetype.slice(0, 60) };
  throw new Error('invalid preference scope');
}

/**
 * Coerce and bound an inbound outcome at the DO trust boundary. Returns `null`
 * when there is no semantic lesson (no traits added or removed) — a cosmetic
 * move is evidence at most, never a candidate (proposal: "one-off edit is
 * evidence, not a lesson"). The coordinator gates emission too; this is the
 * belt-and-suspenders guard so the store can never be poisoned by a malformed
 * or empty outcome.
 */
function normalizeOutcome(raw: AuthoringOutcome): AuthoringOutcome | null {
  if (!raw || typeof raw !== 'object') return null;
  const addedTraits = [...new Set(stringList(raw.addedTraits))].slice(
    0,
    MAX_TRAITS,
  );
  const removedTraits = [...new Set(stringList(raw.removedTraits))].slice(
    0,
    MAX_TRAITS,
  );
  if (!addedTraits.length && !removedTraits.length) return null;
  const sourceRevisionRef =
    str(raw.sourceRevisionRef, MAX_REF_LEN) || 'unknown@r0';
  const documentRef =
    str(raw.documentRef, MAX_DOC_REF_LEN) || documentRefOf(sourceRevisionRef);
  return {
    archetype: str(raw.archetype, 60) || 'unknown',
    addedTraits,
    removedTraits,
    scope: normalizeScope(raw.scope),
    sourceRevisionRef,
    documentRef,
    summary: str(raw.summary, MAX_SUMMARY_LEN),
    ...(raw.rationale !== undefined
      ? { rationale: str(raw.rationale, MAX_RATIONALE_LEN) }
      : {}),
  };
}

export class AuthoringProfile extends DurableObject<WorkerEnv> {
  /**
   * Compiled-guidance cache keyed
   * `(profileRevision, guidanceRevision, workspace, archetype, budget)`.
   * Pure DERIVED data — never authoritative state — so it is intentionally
   * in-memory only: hibernation/eviction clears it and the next `getGuidance`
   * recomputes from storage. Every key embeds `profileRevision`, so a manage
   * action (which bumps the revision) can never be served a stale compile.
   */
  private guidanceCache = new Map<string, CompiledGuidance>();

  /**
   * Record one attributed correction outcome (called via `ctx.waitUntil` from
   * the coordinator, so it is already off the editing path). Deduplicates by
   * (semantic rule, scope): an outcome whose rule identity matches an existing
   * record strengthens it (bumps supporting outcomes, appends a compacted
   * source ref, recounts distinct evidence documents) instead of creating a
   * near-duplicate; a re-scoped confirmed rule still owns its structural
   * correction, and a matching `rejected` record drops the outcome outright
   * ("do not learn this" — see `outcomeDisposition`). A repeated source ref
   * is a no-op (burst coalescing). New rules over the per-owner cap evict the
   * weakest non-confirmed record first. Packet P5: the outcome is also run
   * against every OTHER stored rule as a possible contradiction
   * (`contradictionUpdates`) — reversed rules gain a scoped exception,
   * recalibrated confidence, and eventually a review flag.
   */
  async recordOutcome(
    ownerId: string,
    outcome: AuthoringOutcome,
  ): Promise<void> {
    const normalized = normalizeOutcome(outcome);
    if (!normalized) return;
    const now = nowIso();
    await this.ctx.storage.transaction(async (tx) => {
      const meta = await this.ensureMeta(tx, ownerId);
      const candidates = await tx.list<AuthoringPreference>({
        prefix: CANDIDATE_PREFIX,
      });
      const entries = [...candidates.entries()];
      const records = entries.map(([, p]) => p);
      let changed = false;
      let guidanceChanged = false;

      // Dedupe/authority decision (pure — see learner.ts): strengthen the
      // owning record, drop the outcome when the owner rejected the rule, or
      // fall through to create a fresh candidate.
      const disposition = outcomeDisposition(records, normalized);
      let strengthenedIndex = -1;
      if (disposition.action === 'strengthen') {
        strengthenedIndex = disposition.index;
        const [key, existing] = entries[disposition.index]!;
        const next = strengthenCandidate(existing, normalized, now);
        if (next !== existing) {
          await tx.put(key, next);
          changed = true;
        }
      }

      // Refinement pass (Packet P5, pure — see refinement.ts): every OTHER
      // stored rule this outcome reverses gains a contradiction — lowered
      // calibrated confidence, a scoped exception for the workspace the
      // override came from, and (at the threshold) a review flag. Exceptions
      // change what `getGuidance` serves, so this is the one learning path
      // that bumps `profileRevision`.
      const updates = contradictionUpdates(
        records,
        normalized,
        now,
        strengthenedIndex,
      );
      for (const [index, next] of updates) {
        await tx.put(entries[index]![0], next);
        changed = true;
        guidanceChanged = true;
      }

      // New rule (unless the outcome was owned by an existing/rejected one).
      // Enforce the hard per-owner cap before inserting: evict the weakest
      // non-confirmed record rather than growing without bound. When every
      // slot holds an owner-confirmed rule there is no victim (-1) — the NEW
      // candidate is dropped instead of an owner decision.
      if (disposition.action === 'create') {
        let capOk = true;
        if (candidates.size >= MAX_CANDIDATES_PER_OWNER) {
          const victimIndex = weakestCandidateIndex(records);
          if (victimIndex === -1) capOk = false;
          else await tx.delete(entries[victimIndex]![0]);
        }
        if (capOk) {
          const id = `pref_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
          const record = newCandidate(id, ownerId, normalized, now);
          await tx.put(CANDIDATE_PREFIX + id, record);
          changed = true;
        }
      }

      if (guidanceChanged) meta.profileRevision += 1;
      if (changed || guidanceChanged) {
        meta.updatedAt = now;
        await tx.put(META_KEY, meta);
      }
    });
  }

  /** All stored candidates, strongest first. For tests and the future P3 panel. */
  async listPreferences(ownerId: string): Promise<AuthoringPreference[]> {
    await this.assertKnownOwner(ownerId);
    const candidates = await this.ctx.storage.list<AuthoringPreference>({
      prefix: CANDIDATE_PREFIX,
    });
    return [...candidates.values()].sort(
      (a, b) =>
        b.supportingOutcomes - a.supportingOutcomes ||
        b.evidenceDocuments - a.evidenceDocuments ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  }

  /** The owner's profile view (revision + candidates). */
  async getProfile(ownerId: string): Promise<AuthoringProfileView> {
    const meta = await this.ctx.storage.get<ProfileMeta>(META_KEY);
    if (meta) assertOwner(meta, ownerId);
    return {
      ownerId,
      profileRevision: meta?.profileRevision ?? 0,
      preferences: await this.listPreferences(ownerId),
    };
  }

  /**
   * Bounded agent retrieval (Packet P4 / 0003-B): confirmed rules + the
   * versioned product pack, compiled under the hard token budgets in
   * `src/profile/guidance.ts`. Matching `lastProfileRevision` AND
   * `lastGuidanceRevision` short-circuits to `notModified` with no
   * instruction body (acceptance criterion 6). Read-only: nothing here can
   * change a stored record.
   */
  async getGuidance(
    ownerId: string,
    query: GuidanceQuery & {
      lastProfileRevision?: number;
      lastGuidanceRevision?: number;
    },
  ): Promise<GuidanceResult> {
    const meta = await this.ctx.storage.get<ProfileMeta>(META_KEY);
    if (meta) assertOwner(meta, ownerId);
    const revisions = {
      profileRevision: meta?.profileRevision ?? 0,
      guidanceRevision: GUIDANCE_REVISION,
    };
    if (guidanceNotModified(revisions, query))
      return { notModified: true, ...revisions };

    // Re-bound the RPC-crossing inputs, then serve from the derived cache.
    const bounded: GuidanceQuery = {
      ...(typeof query.archetype === 'string' && query.archetype
        ? { archetype: query.archetype.slice(0, 60) }
        : {}),
      ...(typeof query.workspaceId === 'string' && query.workspaceId
        ? { workspaceId: query.workspaceId.slice(0, MAX_DOC_REF_LEN) }
        : {}),
      maxTokens: clampGuidanceBudget(query.maxTokens),
    };
    const key = [
      revisions.profileRevision,
      revisions.guidanceRevision,
      bounded.workspaceId ?? '',
      bounded.archetype ?? '',
      bounded.maxTokens,
    ].join('|');
    let compiled = this.guidanceCache.get(key);
    if (!compiled) {
      compiled = compileGuidance(
        await this.listPreferences(ownerId),
        GUIDANCE_PACK_RULES,
        bounded,
      );
      if (this.guidanceCache.size >= GUIDANCE_CACHE_MAX)
        this.guidanceCache.delete(
          this.guidanceCache.keys().next().value as string,
        );
      this.guidanceCache.set(key, compiled);
    }
    return { ...revisions, ...compiled };
  }

  /**
   * Owner manage action (panel): pause or resume one rule. Pause suspends a
   * `candidate` or `confirmed` record; resume (`status: 'candidate'`) brings a
   * paused record back to what it was — `confirmed` when it carries
   * `confirmedAt`, else `candidate` — so pausing never silently demotes an
   * owner-blessed rule. A `rejected` record cannot be paused/resumed (unreject
   * does not exist; the owner can only forget it). Setting the state a record
   * already has is a no-op (no revision bump).
   */
  async setPreferenceStatus(
    ownerId: string,
    preferenceId: string,
    status: 'candidate' | 'paused',
  ): Promise<AuthoringPreference> {
    // Runtime re-check: this argument crosses the RPC trust boundary.
    if (status !== 'candidate' && status !== 'paused')
      throw new Error(
        'only pause/resume is allowed here (confirm/reject have their own owner-only methods)',
      );
    return this.ctx.storage.transaction(async (tx) => {
      const existing = await this.loadOwned(tx, ownerId, preferenceId);
      if (existing.status === 'rejected')
        throw new Error('a rejected preference can only be forgotten');
      const resolved: AuthoringPreference['status'] =
        status === 'paused'
          ? 'paused'
          : existing.confirmedAt
            ? 'confirmed'
            : 'candidate';
      if (existing.status === resolved) return existing;
      const next: AuthoringPreference = { ...existing, status: resolved };
      await tx.put(CANDIDATE_PREFIX + preferenceId, next);
      await this.bumpRevision(tx);
      return next;
    });
  }

  /**
   * Owner CONFIRM (Packet P4 / 0003-B): promote a rule to `confirmed` at the
   * scope the owner chose. This is the ONLY path to `confirmed`, and it is
   * reachable exclusively through the owner-cookie `/api/profile` routes —
   * no MCP tool calls it, by construction (proposal guardrail #5: agents may
   * nominate or explain; the user controls confirmation and scope).
   * Re-confirming an already-confirmed rule re-scopes it. Idempotent when
   * nothing changes (no revision bump).
   */
  async confirmPreference(
    ownerId: string,
    preferenceId: string,
    scope: PreferenceScope,
  ): Promise<AuthoringPreference> {
    const parsed = parseConfirmScope(scope);
    return this.ctx.storage.transaction(async (tx) => {
      const existing = await this.loadOwned(tx, ownerId, preferenceId);
      if (existing.status === 'rejected')
        throw new Error('a rejected preference can only be forgotten');
      if (
        existing.status === 'confirmed' &&
        !existing.needsReview &&
        JSON.stringify(existing.scope) === JSON.stringify(parsed)
      )
        return existing;
      // An explicit (re-)confirm IS the owner's review: the review flag
      // clears. Recorded exceptions are kept — they are facts about where
      // the owner overrode the rule, not part of the flag.
      const next: AuthoringPreference = {
        ...existing,
        status: 'confirmed',
        scope: parsed,
        // P5's calibrated form: the confirmation base scaled by the
        // supporting share of ALL evidence, so a re-confirm after
        // contradictions does not silently restore full confidence.
        confidence: calibratedConfidence(
          existing.supportingOutcomes,
          existing.contradictingOutcomes,
        ),
        confirmedAt: existing.confirmedAt ?? nowIso(),
      };
      delete next.needsReview;
      await tx.put(CANDIDATE_PREFIX + preferenceId, next);
      await this.bumpRevision(tx);
      return next;
    });
  }

  /**
   * Owner REJECT ("No, do not learn this"): the record is kept as a tombstone
   * so the learner never re-creates the same rule (`outcomeDisposition`
   * drops matching outcomes), but it is never served, and its confirmed-ness
   * (if any) is revoked. Terminal apart from `deletePreference`.
   */
  async rejectPreference(
    ownerId: string,
    preferenceId: string,
  ): Promise<AuthoringPreference> {
    return this.ctx.storage.transaction(async (tx) => {
      const existing = await this.loadOwned(tx, ownerId, preferenceId);
      if (existing.status === 'rejected') return existing;
      const next: AuthoringPreference = {
        ...existing,
        status: 'rejected',
        confidence: 0,
      };
      delete next.confirmedAt;
      delete next.needsReview;
      await tx.put(CANDIDATE_PREFIX + preferenceId, next);
      await this.bumpRevision(tx);
      return next;
    });
  }

  /**
   * Owner manage action (Packet P3 panel): forget a learned candidate — the
   * proposal's "No, do not learn this" is the owner's right, so this deletes
   * the record outright (any status; owner authority is absolute here).
   */
  async deletePreference(ownerId: string, preferenceId: string): Promise<void> {
    await this.ctx.storage.transaction(async (tx) => {
      await this.loadOwned(tx, ownerId, preferenceId);
      await tx.delete(CANDIDATE_PREFIX + preferenceId);
      await this.bumpRevision(tx);
    });
  }

  /** Owner-asserted read of one stored preference; throws when it (or the
   * whole profile) does not exist. Shared by the manage actions above. */
  private async loadOwned(
    tx: ProfileStorage,
    ownerId: string,
    preferenceId: string,
  ): Promise<AuthoringPreference> {
    const meta = await tx.get<ProfileMeta>(META_KEY);
    if (!meta) throw new Error('unknown preference');
    assertOwner(meta, ownerId);
    const existing = await tx.get<AuthoringPreference>(
      CANDIDATE_PREFIX + preferenceId,
    );
    if (!existing) throw new Error('unknown preference');
    return existing;
  }

  /** Bump `profileRevision` (P4's guidance cache keys on it) + `updatedAt`.
   * Only called after `loadOwned` proved the meta exists and the owner holds. */
  private async bumpRevision(tx: ProfileStorage): Promise<void> {
    const meta = (await tx.get<ProfileMeta>(META_KEY))!;
    meta.profileRevision += 1;
    meta.updatedAt = nowIso();
    await tx.put(META_KEY, meta);
  }

  private async assertKnownOwner(ownerId: string): Promise<void> {
    const meta = await this.ctx.storage.get<ProfileMeta>(META_KEY);
    if (meta) assertOwner(meta, ownerId);
  }

  private async ensureMeta(
    tx: ProfileStorage,
    ownerId: string,
  ): Promise<ProfileMeta> {
    const meta = await tx.get<ProfileMeta>(META_KEY);
    if (meta) {
      assertOwner(meta, ownerId);
      return meta;
    }
    const created: ProfileMeta = {
      format: 1,
      ownerId,
      profileRevision: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await tx.put(META_KEY, created);
    return created;
  }
}
