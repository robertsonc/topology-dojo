/**
 * Per-owner authoring-profile store (Packet P2 / proposal 0003-A).
 *
 * One Durable Object instance per authenticated owner, addressed by the stable
 * numeric uid (`env.AUTHORING_PROFILE.get(idFromName(ownerId))`) — the same
 * identity scheme the coordinator uses, which is what guarantees cross-owner
 * isolation: one owner's outcomes only ever reach that owner's DO.
 *
 * It holds bounded, OBSERVE-ONLY preference *candidates* learned asynchronously
 * from attributed correction outcomes. It changes no agent output: there is no
 * retrieval/guidance method here, and every record stays within
 * `status: 'candidate' | 'paused'` — the owner's Packet P3 panel can pause,
 * resume, or forget a candidate, but confirmation/promotion is Packet P4.
 *
 * Hibernation-safe: the only state is `ctx.storage`. Nothing is cached in
 * memory, so the DO may be evicted between calls and reconstruct everything
 * from storage — the candidate set is (re)read on every operation.
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
  preferenceRuleIdentity,
  ruleIdentity,
  strengthenCandidate,
  weakestCandidateIndex,
} from '../src/profile/learner.js';

const META_KEY = 'meta';
const CANDIDATE_PREFIX = 'candidate:';
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
   * Bumped whenever what a (future P4) guidance retrieval could serve changes:
   * every owner manage action — pause/resume (`setPreferenceStatus`) and
   * forget (`deletePreference`). Passive learning (`recordOutcome`) does NOT
   * bump it in observe-only P2/P3. P4's compiled-guidance cache keys on it.
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
   * Record one attributed correction outcome (called via `ctx.waitUntil` from
   * the coordinator, so it is already off the editing path). Deduplicates by
   * (semantic rule, scope): an outcome whose rule identity matches an existing
   * candidate strengthens it (bumps supporting outcomes, appends a compacted
   * source ref, recounts distinct evidence documents) instead of creating a
   * near-duplicate. A repeated source ref is a no-op (burst coalescing). New
   * rules over the per-owner cap evict the weakest candidate first.
   */
  async recordOutcome(
    ownerId: string,
    outcome: AuthoringOutcome,
  ): Promise<void> {
    const normalized = normalizeOutcome(outcome);
    if (!normalized) return;
    const now = nowIso();
    const ruleId = ruleIdentity(normalized);
    await this.ctx.storage.transaction(async (tx) => {
      const meta = await this.ensureMeta(tx, ownerId);
      const candidates = await tx.list<AuthoringPreference>({
        prefix: CANDIDATE_PREFIX,
      });

      // Dedupe: find an existing candidate with the same (rule, scope) identity.
      for (const [key, existing] of candidates) {
        if (preferenceRuleIdentity(existing) !== ruleId) continue;
        const next = strengthenCandidate(existing, normalized, now);
        if (next !== existing) {
          await tx.put(key, next);
          meta.updatedAt = now;
          await tx.put(META_KEY, meta);
        }
        return;
      }

      // New rule. Enforce the hard per-owner cap before inserting: evict the
      // weakest candidate rather than growing without bound.
      if (candidates.size >= MAX_CANDIDATES_PER_OWNER) {
        const entries = [...candidates.entries()];
        const victim =
          entries[weakestCandidateIndex(entries.map(([, p]) => p))];
        if (victim) await tx.delete(victim[0]);
      }
      const id = `pref_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
      const record = newCandidate(id, ownerId, normalized, now);
      await tx.put(CANDIDATE_PREFIX + id, record);
      meta.updatedAt = now;
      await tx.put(META_KEY, meta);
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
   * Owner manage action (Packet P3 panel): pause or resume one candidate.
   * ONLY the candidate↔paused transition is allowed here — `confirmed` and
   * `rejected` are Packet P4's authority domain, so a record in (or a request
   * for) any other status throws rather than silently widening this surface.
   * Setting the status a record already has is a no-op (no revision bump).
   */
  async setPreferenceStatus(
    ownerId: string,
    preferenceId: string,
    status: 'candidate' | 'paused',
  ): Promise<AuthoringPreference> {
    // Runtime re-check: this argument crosses the RPC trust boundary.
    if (status !== 'candidate' && status !== 'paused')
      throw new Error(
        'only the candidate/paused transition is allowed here (Packet P4 owns confirm/reject)',
      );
    return this.ctx.storage.transaction(async (tx) => {
      const existing = await this.loadOwned(tx, ownerId, preferenceId);
      if (existing.status !== 'candidate' && existing.status !== 'paused')
        throw new Error(
          'only the candidate/paused transition is allowed here (Packet P4 owns confirm/reject)',
        );
      if (existing.status === status) return existing;
      const next: AuthoringPreference = { ...existing, status };
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
