/**
 * Canonical shared topology coordinator.
 *
 * One Durable Object instance owns one topology document. All accepted browser
 * and agent writes are serialized here as revisioned semantic operations. Pages
 * are stored under separate keys so aggregate documents may safely exceed the
 * Durable Object per-value limit.
 */
import { DurableObject } from 'cloudflare:workers';
import { profilesEnabled, type WorkerEnv } from './env.js';
import type {
  Page,
  TopologyDocument as TopologyDocumentModel,
} from '../src/pages/model.js';
import { parseDoc } from '../src/pages/persist.js';
import { TEXT_LIMITS, normalizeText } from '../src/api/text.js';
import {
  applyOperations,
  conflictingTargets,
  diffDocuments,
  operationPageIds,
  operationTargets,
  subsetDependencyErrors,
  summarizeOperations,
  validateOperations,
} from '../src/workspace/operations.js';
import { extractFeatures } from '../src/profile/features.js';
import type { AuthoringOutcome } from '../src/profile/model.js';
import {
  ELEMENT_KINDS,
  type ChangesResult,
  type CheckpointSummary,
  type CommitRequest,
  type CommitResult,
  type ElementKind,
  type ElementPageResult,
  type ProposalResult,
  type ProposalSummary,
  type WorkspaceActor,
  type WorkspaceChange,
  type WorkspaceLease,
  type WorkspaceManifest,
  type WorkspaceNotice,
  type WorkspaceOperation,
  type WorkspacePresence,
  type WorkspaceProposal,
  type WorkspaceSnapshot,
} from '../src/workspace/model.js';

const META_KEY = 'meta';
const PAGE_PREFIX = 'page:';
const CHANGE_PREFIX = 'change:';
const PROPOSAL_PREFIX = 'proposal:';
const CHECKPOINT_PREFIX = 'checkpoint:';
const REQUEST_PREFIX = 'request:';
/** Authoring-profile learner (Packet P2): the bounded agent-authorship window. */
const AGENT_WINDOW_PREFIX = 'agentwin:';
const MAX_BATCH_BYTES = 512 * 1024;
const MAX_PAGE_BYTES = 1_800 * 1024;
const MAX_META_BYTES = 1_800 * 1024;
const MAX_OPERATIONS = 250;
const HISTORY_LIMIT = 500;
const REQUEST_LIMIT = 200;
const OPERATION_SCHEMA_REVISION = 1;
const MAX_PENDING_PROPOSALS = 20;
const MAX_PROPOSALS = 50;
const MAX_CHECKPOINTS = 12;
/** Hard bounds on the authoring-profile learner's coordinator-side window: at
 * most this many agent-authorship entries are retained (oldest evicted), and
 * the agent operations captured per entry are dropped past these limits so the
 * window never grows without bound (Packet P2). */
const MAX_AGENT_WINDOW = 8;
const MAX_AGENT_WINDOW_OPS = 100;
const MAX_AGENT_WINDOW_OPS_BYTES = 128 * 1024;
const MAX_AGENT_CORRECTION_TARGETS = 200;

interface StoredMeta {
  format: 1;
  id: string;
  ownerId: string;
  revision: number;
  historyFloor: number;
  createdAt: string;
  updatedAt: string;
  pageIds: string[];
  head: Omit<TopologyDocumentModel, 'pages'>;
  lease?: WorkspaceLease;
  requestKeys: string[];
  /** Named checkpoint ids (Packet R3). Absent on pre-R3 records ⇒ treat as []. */
  checkpointIds?: string[];
}

/** A stored named checkpoint: its metadata plus the document head. The page
 * copies live under `checkpoint:<id>:page:<pageId>` keys. */
interface StoredCheckpoint {
  id: string;
  name: string;
  createdBy: WorkspaceActor;
  createdAt: string;
  revision: number;
  pageIds: string[];
  head: Omit<TopologyDocumentModel, 'pages'>;
}

/**
 * One bounded entry of the authoring-profile learner's agent-authorship window
 * (Packet P2). Recorded when an agent authors content (a leased agent commit or
 * an accepted proposal): it remembers WHICH field-granular targets the agent
 * authored at revision R, keeps a compact copy of the agent operations (for the
 * P1 target-overlap analysis), and snapshots the agent-authored document as the
 * baseline the later user correction is diffed against. `corrected` /
 * `correctionTargets` are set when a subsequent user revision overlaps those
 * targets. All of it is plain storage — hibernation-safe — and the whole
 * structure only ever exists when `PROFILES_ENABLED` is on.
 */
interface AgentWindowRecord {
  revision: number;
  targets: string[];
  operations: WorkspaceOperation[];
  baseline: TopologyDocumentModel;
  corrected: boolean;
  correctionTargets: string[];
  createdAt: string;
}

/** Narrow RPC view of the per-owner authoring-profile DO (Packet P2). Kept
 * explicit so the coordinator's cross-DO call typechecks without depending on
 * Cloudflare's conservative Stubable<> inference. */
interface AuthoringProfileRpc {
  recordOutcome(ownerId: string, outcome: AuthoringOutcome): Promise<void>;
}

/**
 * The only per-connection state (Packet S1). It lives exclusively in the
 * socket's serialized attachment so the Durable Object can hibernate/evict
 * between messages and reconstruct presence purely from `getWebSockets()`.
 */
interface SocketAttachment {
  actor: { kind: WorkspaceActor['kind']; label?: string };
  /** The page this editor last reported viewing (absent until it reports one). */
  pageId?: string;
}

interface WorkspaceStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<unknown>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function assertOwner(meta: StoredMeta, ownerId: string): void {
  if (meta.ownerId !== ownerId) throw new Error('workspace access denied');
}

function assertRequest(request: CommitRequest): void {
  if (!Number.isInteger(request.baseRevision) || request.baseRevision < 0)
    throw new Error('baseRevision must be a non-negative integer');
  if (!request.operationId || request.operationId.length > 128)
    throw new Error('operationId must be 1..128 characters');
  if (!request.operations.length)
    throw new Error('at least one workspace operation is required');
  if (request.operations.length > MAX_OPERATIONS)
    throw new Error(`operation batch exceeds ${MAX_OPERATIONS} operations`);
  if (bytes(request.operations) > MAX_BATCH_BYTES)
    throw new Error('operation batch exceeds the 512 KiB limit');
  validateOperations(request.operations);
}

function activeLease(meta: StoredMeta): WorkspaceLease | null {
  if (!meta.lease) return null;
  return Date.parse(meta.lease.expiresAt) > Date.now() ? meta.lease : null;
}

function pageScoped(operation: WorkspaceOperation, pageId: string): boolean {
  if (
    operation.type === 'document.patch' ||
    operation.type === 'page.add' ||
    operation.type === 'page.remove' ||
    operation.type === 'page.reorder'
  )
    return false;
  return operationPageIds(operation).every((id) => id === pageId);
}

function proposalSummary(proposal: WorkspaceProposal): ProposalSummary {
  const { operations: _operations, ...summary } = proposal;
  return summary;
}

function checkpointSummary(record: StoredCheckpoint): CheckpointSummary {
  return {
    id: record.id,
    name: record.name,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    revision: record.revision,
    pageCount: record.pageIds.length,
  };
}

export class TopologyDocument extends DurableObject<WorkerEnv> {
  /**
   * WebSocket upgrade entry (Packet S1). The browser route authenticates the
   * owner before forwarding here and injects the actor identity as query
   * params; this method only accepts the socket (via the hibernation API) and
   * stashes the actor + requested page in the socket's attachment. No other
   * state is kept — presence is reconstructed from `getWebSockets()`.
   */
  override async fetch(request: Request): Promise<Response> {
    if ((request.headers.get('Upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('expected a websocket upgrade', { status: 426 });
    }
    const url = new URL(request.url);
    const kindParam = url.searchParams.get('actorKind');
    const kind: WorkspaceActor['kind'] =
      kindParam === 'agent' || kindParam === 'system' ? kindParam : 'user';
    const label = url.searchParams.get('actorLabel') ?? undefined;
    const pageId = url.searchParams.get('pageId') ?? undefined;
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const attachment: SocketAttachment = {
      actor: { kind, ...(label ? { label } : {}) },
      ...(pageId ? { pageId } : {}),
    };
    server.serializeAttachment(attachment);
    // Send the joining socket the current state immediately, and tell any
    // already-connected editors that presence changed.
    await this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Hibernation handler: the only client message is a presence update. */
  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        typeof message === 'string'
          ? message
          : new TextDecoder().decode(message),
      );
    } catch {
      return; // ignore malformed frames — the socket stays a pure accelerant
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { type?: unknown }).type !== 'presence'
    )
      return;
    const pageId = (parsed as { pageId?: unknown }).pageId;
    const current = ws.deserializeAttachment() as SocketAttachment | null;
    const next: SocketAttachment = {
      actor: current?.actor ?? { kind: 'user' },
      ...(typeof pageId === 'string' && pageId ? { pageId } : {}),
    };
    ws.serializeAttachment(next);
    await this.broadcast();
  }

  /** Hibernation handler: a socket closed — recompute presence without it. */
  override async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      // already closing/closed
    }
    await this.broadcast(ws);
  }

  /** Hibernation handler: a socket errored — treat it like a close. */
  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.broadcast(ws);
  }

  /**
   * Push a compact notice to every open socket. Reads live state cheaply (meta
   * revision + lease, a proposal-prefix scan for the count, and presence from
   * socket attachments) — never document content. Must only be called *after*
   * any storage transaction has committed, so a rolled-back mutation never
   * notifies. `exclude` drops a socket that is closing/erroring from both the
   * recipient set and the presence roster.
   */
  private async broadcast(exclude?: WebSocket): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;
    const meta = await this.ctx.storage.get<StoredMeta>(META_KEY);
    if (!meta) return;
    const proposals = await this.ctx.storage.list<WorkspaceProposal>({
      prefix: PROPOSAL_PREFIX,
    });
    const proposalCount = [...proposals.values()].filter(
      (proposal) =>
        proposal.status === 'pending' ||
        proposal.status === 'partially-accepted' ||
        proposal.status === 'conflicted',
    ).length;
    const notice: WorkspaceNotice = {
      type: 'notice',
      revision: meta.revision,
      proposalCount,
      lease: activeLease(meta),
      presence: this.presenceFrom(sockets, exclude),
    };
    const payload = JSON.stringify(notice);
    for (const ws of sockets) {
      if (ws === exclude) continue;
      try {
        ws.send(payload);
      } catch {
        try {
          ws.close();
        } catch {
          // best-effort drop of a dead socket
        }
      }
    }
  }

  private presenceFrom(
    sockets: WebSocket[],
    exclude?: WebSocket,
  ): WorkspacePresence[] {
    const presence: WorkspacePresence[] = [];
    for (const ws of sockets) {
      if (ws === exclude) continue;
      const attachment = ws.deserializeAttachment() as SocketAttachment | null;
      if (!attachment) continue;
      presence.push({
        kind: attachment.actor.kind,
        ...(attachment.actor.label ? { label: attachment.actor.label } : {}),
        ...(attachment.pageId ? { pageId: attachment.pageId } : {}),
      });
    }
    return presence;
  }

  /** True only when this coordinator has been initialized for this owner. */
  async isInitialized(ownerId: string): Promise<boolean> {
    const meta = await this.ctx.storage.get<StoredMeta>(META_KEY);
    if (!meta) return false;
    assertOwner(meta, ownerId);
    return true;
  }

  /** Idempotent, transactionally complete initialization (new or lazy-migrated). */
  async initialize(
    ownerId: string,
    id: string,
    input: TopologyDocumentModel,
  ): Promise<WorkspaceSnapshot> {
    const parsed = parseDoc(input);
    if (!parsed) throw new Error('invalid topology document');
    this.assertDocumentSizes(parsed);
    return this.ctx.storage.transaction(async (tx) => {
      const existing = await tx.get<StoredMeta>(META_KEY);
      if (existing) {
        assertOwner(existing, ownerId);
        return this.snapshotFrom(tx, existing);
      }
      const timestamp = nowIso();
      const { pages, ...head } = parsed;
      const meta: StoredMeta = {
        format: 1,
        id,
        ownerId,
        revision: 0,
        historyFloor: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        pageIds: pages.map((page) => page.id),
        head,
        requestKeys: [],
      };
      await tx.put(META_KEY, meta);
      for (const page of pages) await tx.put(PAGE_PREFIX + page.id, page);
      return { id, revision: 0, document: parsed, lease: null };
    });
  }

  async getSnapshot(ownerId: string): Promise<WorkspaceSnapshot> {
    const meta = await this.requiredMeta(this.ctx.storage, ownerId);
    return this.snapshotFrom(this.ctx.storage, meta);
  }

  async getManifest(ownerId: string): Promise<WorkspaceManifest> {
    const meta = await this.requiredMeta(this.ctx.storage, ownerId);
    const document = await this.loadDocument(this.ctx.storage, meta);
    const proposals = await this.ctx.storage.list<WorkspaceProposal>({
      prefix: PROPOSAL_PREFIX,
    });
    return {
      id: meta.id,
      title: document.title,
      revision: meta.revision,
      operationSchemaRevision: OPERATION_SCHEMA_REVISION,
      historyFloor: meta.historyFloor,
      updatedAt: meta.updatedAt,
      pages: document.pages.map((page) => ({
        id: page.id,
        name: page.name,
        nodes: page.nodes.length,
        links: page.links.length,
        anchors: page.anchors.length,
        zones: page.zones.length,
        flowPaths: page.flowPaths.length,
        policyMarkers: page.policyMarkers.length,
      })),
      lease: activeLease(meta),
      pendingProposals: [...proposals.values()].filter(
        (proposal) =>
          proposal.status === 'pending' ||
          proposal.status === 'partially-accepted' ||
          proposal.status === 'conflicted',
      ).length,
    };
  }

  async getChanges(
    ownerId: string,
    sinceRevision: number,
    limit = 20,
    includeOperations = false,
  ): Promise<ChangesResult> {
    const meta = await this.requiredMeta(this.ctx.storage, ownerId);
    const boundedLimit = Math.max(
      1,
      Math.min(includeOperations ? 10 : 50, limit),
    );
    if (sinceRevision < meta.historyFloor) {
      return {
        revision: meta.revision,
        historyFloor: meta.historyFloor,
        checkpointRequired: true,
        changes: [],
        nextRevision: null,
      };
    }
    const end = Math.min(meta.revision, sinceRevision + boundedLimit);
    const changes: ChangesResult['changes'] = [];
    let lastRevision = sinceRevision;
    let responseBytes = 0;
    for (let revision = sinceRevision + 1; revision <= end; revision++) {
      const change = await this.ctx.storage.get<WorkspaceChange>(
        this.changeKey(revision),
      );
      if (!change) continue;
      if (includeOperations) {
        const changeBytes = bytes(change);
        if (changes.length && responseBytes + changeBytes > MAX_BATCH_BYTES)
          break;
        changes.push(change);
        responseBytes += changeBytes;
      } else {
        const { operations: _operations, ...summary } = change;
        changes.push(summary);
      }
      lastRevision = revision;
    }
    return {
      revision: meta.revision,
      historyFloor: meta.historyFloor,
      checkpointRequired: false,
      changes,
      nextRevision: lastRevision < meta.revision ? lastRevision : null,
    };
  }

  async getElements(
    ownerId: string,
    pageId: string,
    ids: string[] | undefined,
    kinds: ElementKind[] | undefined,
    cursor = 0,
    limit = 50,
  ): Promise<ElementPageResult> {
    const meta = await this.requiredMeta(this.ctx.storage, ownerId);
    if (!meta.pageIds.includes(pageId))
      throw new Error(`unknown page "${pageId}"`);
    const page = await this.ctx.storage.get<Page>(PAGE_PREFIX + pageId);
    if (!page) throw new Error(`workspace page "${pageId}" is unavailable`);
    const idSet = ids?.length ? new Set(ids.slice(0, 100)) : null;
    const kindSet = new Set(kinds?.length ? kinds : ELEMENT_KINDS);
    const all: ElementPageResult['elements'] = [];
    for (const kind of ELEMENT_KINDS) {
      if (!kindSet.has(kind)) continue;
      for (const element of page[kind] as unknown as Record<
        string,
        unknown
      >[]) {
        if (!idSet || idSet.has(String(element.id)))
          all.push({ kind, element });
      }
    }
    const start = Math.max(0, cursor);
    const boundedLimit = Math.max(1, Math.min(100, limit));
    const selected = all.slice(start, start + boundedLimit);
    const next = start + selected.length;
    return {
      workspaceId: meta.id,
      revision: meta.revision,
      page: { id: page.id, name: page.name, viewBox: page.viewBox },
      elements: selected,
      nextCursor: next < all.length ? next : null,
    };
  }

  async applyUserOperations(
    ownerId: string,
    actor: WorkspaceActor,
    request: CommitRequest,
  ): Promise<CommitResult> {
    if (actor.kind !== 'user')
      throw new Error('UI commits require a user actor');
    return this.commit(ownerId, actor, request, 'ui', false);
  }

  async applyAgentOperations(
    ownerId: string,
    actor: WorkspaceActor,
    request: CommitRequest,
  ): Promise<CommitResult> {
    if (actor.kind !== 'agent')
      throw new Error('leased commits require an agent actor');
    return this.commit(ownerId, actor, request, 'agent-lease', true);
  }

  async propose(
    ownerId: string,
    actor: WorkspaceActor,
    request: CommitRequest,
    title: string,
    rationale?: string,
  ): Promise<ProposalResult> {
    if (actor.kind !== 'agent')
      throw new Error('proposals require an agent actor');
    assertRequest(request);
    const titleNorm = normalizeText(title);
    if (!titleNorm) throw new Error('proposal title is required');
    const rationaleNorm =
      rationale === undefined
        ? ''
        : normalizeText(rationale, { multiline: true });
    const result = await this.ctx.storage.transaction(async (tx) => {
      const meta = await this.requiredMeta(tx, ownerId);
      const duplicate = await tx.get<ProposalResult>(
        REQUEST_PREFIX + request.operationId,
      );
      if (duplicate) return duplicate;
      if (request.baseRevision > meta.revision)
        throw new Error(
          `base revision ${request.baseRevision} is ahead of current revision ${meta.revision}`,
        );
      if (request.baseRevision < meta.historyFloor) {
        const result: ProposalResult = {
          ok: false,
          code: 'checkpoint-required',
          revision: meta.revision,
          message: `revision ${request.baseRevision} predates history floor ${meta.historyFloor}`,
        };
        await this.rememberRequest(tx, meta, request.operationId, result);
        return result;
      }
      const conflicts = await this.conflictsSince(
        tx,
        request.baseRevision,
        meta.revision,
        request.operations,
      );
      const document = await this.loadDocument(tx, meta);
      if (!conflicts.length) applyOperations(document, request.operations);
      await this.makeProposalRoom(tx);
      const timestamp = nowIso();
      const proposal: WorkspaceProposal = {
        id: `pr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        title: titleNorm.slice(0, TEXT_LIMITS.title),
        ...(rationaleNorm
          ? { rationale: rationaleNorm.slice(0, TEXT_LIMITS.rationale) }
          : {}),
        baseRevision: request.baseRevision,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: actor,
        status: conflicts.length ? 'conflicted' : 'pending',
        operations: structuredClone(request.operations),
        summary: summarizeOperations(request.operations),
        ...(conflicts.length ? { conflictingTargets: conflicts } : {}),
      };
      await tx.put(PROPOSAL_PREFIX + proposal.id, proposal);
      const result: ProposalResult = { ok: true, proposal };
      await this.rememberRequest(tx, meta, request.operationId, result);
      return result;
    });
    // A new proposal (or its resolution) changes the pending count editors show.
    await this.broadcast();
    return result;
  }

  async listProposals(
    ownerId: string,
    includeResolved = true,
  ): Promise<ProposalSummary[]> {
    await this.requiredMeta(this.ctx.storage, ownerId);
    const records = await this.ctx.storage.list<WorkspaceProposal>({
      prefix: PROPOSAL_PREFIX,
    });
    return [...records.values()]
      .filter(
        (proposal) =>
          includeResolved ||
          proposal.status === 'pending' ||
          proposal.status === 'partially-accepted' ||
          proposal.status === 'conflicted',
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100)
      .map(proposalSummary);
  }

  async getProposal(ownerId: string, id: string): Promise<WorkspaceProposal> {
    await this.requiredMeta(this.ctx.storage, ownerId);
    const proposal = await this.ctx.storage.get<WorkspaceProposal>(
      PROPOSAL_PREFIX + id,
    );
    if (!proposal) throw new Error(`unknown proposal "${id}"`);
    return proposal;
  }

  async acceptProposal(
    ownerId: string,
    actor: WorkspaceActor,
    id: string,
    operationId: string,
    /** Accept only these operation indices (a coherent subset). Omit to accept
     * the whole proposal. Duplicates and order are normalized. */
    selectedOperationIndices?: number[],
  ): Promise<CommitResult> {
    if (actor.kind !== 'user')
      throw new Error('only a browser user can accept proposals');
    // Captured for the authoring-profile learner (Packet P2): an accepted
    // proposal's operations are AGENT-authored content, even though a user
    // triggered the accept. Recorded after the transaction commits.
    let acceptedForWindow: {
      ops: WorkspaceOperation[];
      revision: number;
    } | null = null;
    const outcome: CommitResult = await this.ctx.storage.transaction(
      async (tx) => {
        const meta = await this.requiredMeta(tx, ownerId);
        const requestKey = REQUEST_PREFIX + operationId;
        const duplicate = await tx.get<CommitResult>(requestKey);
        if (duplicate) return duplicate;
        const proposal = await tx.get<WorkspaceProposal>(PROPOSAL_PREFIX + id);
        if (!proposal) throw new Error(`unknown proposal "${id}"`);
        if (proposal.status === 'accepted')
          return {
            ok: true,
            revision: proposal.acceptedRevision ?? meta.revision,
            rebased: proposal.baseRevision < meta.revision,
            summary: proposal.summary,
          };
        if (proposal.status === 'rejected')
          throw new Error('a rejected proposal cannot be accepted');

        // Resolve which operations this accept applies: a coherent subset when
        // indices are given, otherwise the whole (remaining) proposal.
        const total = proposal.operations.length;
        let opsToApply = proposal.operations;
        let residual: WorkspaceOperation[] = [];
        if (selectedOperationIndices !== undefined) {
          const indices = [...new Set(selectedOperationIndices)].sort(
            (a, b) => a - b,
          );
          if (indices.some((i) => !Number.isInteger(i) || i < 0 || i >= total))
            throw new Error('selected operation index out of range');
          if (indices.length === 0)
            throw new Error('no operations selected for acceptance');
          if (indices.length < total) {
            const depErrors = subsetDependencyErrors(
              proposal.operations,
              indices,
            );
            if (depErrors.length) {
              const missing = [...new Set(depErrors.map((e) => e.missingId))];
              const result: CommitResult = {
                ok: false,
                code: 'incoherent-subset',
                revision: meta.revision,
                message: `selected operations reference ${missing
                  .map((m) => `"${m}"`)
                  .join(', ')}, which only unselected operations create`,
                missingDependencies: missing,
              };
              await this.rememberRequest(tx, meta, operationId, result);
              return result;
            }
            const chosen = new Set(indices);
            opsToApply = proposal.operations.filter((_, i) => chosen.has(i));
            residual = proposal.operations.filter((_, i) => !chosen.has(i));
          }
        }

        if (proposal.baseRevision < meta.historyFloor) {
          const result: CommitResult = {
            ok: false,
            code: 'checkpoint-required',
            revision: meta.revision,
            message: 'proposal base revision is older than retained history',
          };
          await this.rememberRequest(tx, meta, operationId, result);
          return result;
        }
        const conflicts = await this.conflictsSince(
          tx,
          proposal.baseRevision,
          meta.revision,
          opsToApply,
        );
        if (conflicts.length) {
          proposal.status = 'conflicted';
          proposal.conflictingTargets = conflicts;
          proposal.updatedAt = nowIso();
          await tx.put(PROPOSAL_PREFIX + id, proposal);
          const result: CommitResult = {
            ok: false,
            code: 'conflict',
            revision: meta.revision,
            message:
              'proposal overlaps changes committed after its base revision',
            conflictingTargets: conflicts,
          };
          await this.rememberRequest(tx, meta, operationId, result);
          return result;
        }
        const result = await this.commitWithin(
          tx,
          meta,
          actor,
          {
            baseRevision: proposal.baseRevision,
            operationId,
            operations: opsToApply,
          },
          'proposal',
          id,
        );
        if (result.ok) {
          acceptedForWindow = { ops: opsToApply, revision: result.revision };
          proposal.updatedAt = nowIso();
          delete proposal.conflictingTargets;
          if (residual.length) {
            // Partial acceptance: keep the remainder reviewable, rebased onto the
            // revision the accepted subset just produced (the residual ops were
            // authored to run after the accepted ones), so its next accept/view
            // re-validates against the new canonical state.
            proposal.operations = residual;
            proposal.summary = summarizeOperations(residual);
            proposal.baseRevision = result.revision;
            proposal.status = 'partially-accepted';
            proposal.acceptedRevision = result.revision;
          } else {
            proposal.status = 'accepted';
            proposal.acceptedRevision = result.revision;
          }
          await tx.put(PROPOSAL_PREFIX + id, proposal);
        }
        return result;
      },
    );
    // Revision and/or proposal status may have changed — notify open editors.
    await this.broadcast();
    // Authoring-profile learner (Packet P2): record the agent-authored accept
    // as a window entry, gated + best-effort so it never affects the response.
    if (acceptedForWindow && profilesEnabled(this.env)) {
      const captured: { ops: WorkspaceOperation[]; revision: number } =
        acceptedForWindow;
      await this.recordAgentWindow(captured.ops, captured.revision);
    }
    return outcome;
  }

  async rejectProposal(
    ownerId: string,
    actor: WorkspaceActor,
    id: string,
  ): Promise<WorkspaceProposal> {
    if (actor.kind !== 'user')
      throw new Error('only a browser user can reject proposals');
    const proposal = await this.ctx.storage.transaction(async (tx) => {
      await this.requiredMeta(tx, ownerId);
      const record = await tx.get<WorkspaceProposal>(PROPOSAL_PREFIX + id);
      if (!record) throw new Error(`unknown proposal "${id}"`);
      if (record.status === 'accepted')
        throw new Error('an accepted proposal cannot be rejected');
      record.status = 'rejected';
      record.updatedAt = nowIso();
      await tx.put(PROPOSAL_PREFIX + id, record);
      return record;
    });
    // The pending proposal count dropped — notify open editors.
    await this.broadcast();
    return proposal;
  }

  /** Snapshot the current document as a named checkpoint. Agents may checkpoint
   * (e.g. before a risky batch); restore/fork remain browser-owner actions. */
  async createCheckpoint(
    ownerId: string,
    actor: WorkspaceActor,
    name: string,
  ): Promise<CheckpointSummary> {
    if (actor.kind === 'system')
      throw new Error('system actors cannot create checkpoints');
    const trimmed = normalizeText(String(name ?? ''));
    if (!trimmed) throw new Error('checkpoint name is required');
    if (trimmed.length > TEXT_LIMITS.checkpointName)
      throw new Error(
        `checkpoint name exceeds ${TEXT_LIMITS.checkpointName} characters`,
      );
    const summary = await this.ctx.storage.transaction(async (tx) => {
      const meta = await this.requiredMeta(tx, ownerId);
      const ids = meta.checkpointIds ?? [];
      // Hard cap: never silently evict a named checkpoint — the owner deletes one.
      if (ids.length >= MAX_CHECKPOINTS)
        throw new Error(
          `checkpoint limit (${MAX_CHECKPOINTS}) reached — delete one before creating another`,
        );
      const document = await this.loadDocument(tx, meta);
      // Copies are of an already-valid document, but assert before any write so
      // an oversize state fails visibly rather than mid-mutation.
      this.assertDocumentSizes(document);
      const { pages, ...head } = document;
      const id = crypto.randomUUID();
      const record: StoredCheckpoint = {
        id,
        name: trimmed,
        createdBy: actor,
        createdAt: nowIso(),
        revision: meta.revision,
        pageIds: pages.map((page) => page.id),
        head,
      };
      for (const page of pages)
        await tx.put(this.checkpointPageKey(id, page.id), page);
      await tx.put(CHECKPOINT_PREFIX + id, record);
      meta.checkpointIds = [...ids, id];
      await tx.put(META_KEY, meta);
      return checkpointSummary(record);
    });
    // Authoring-profile learner (Packet P2): a checkpoint is the persistence
    // guardrail — user corrections that survived to here are emitted as one
    // compact structured outcome each, off the response path via waitUntil.
    // Gated: when PROFILES_ENABLED is unset this is a no-op and the checkpoint
    // response is unchanged.
    this.scheduleAuthoringOutcomes();
    return summary;
  }

  async listCheckpoints(ownerId: string): Promise<CheckpointSummary[]> {
    const meta = await this.requiredMeta(this.ctx.storage, ownerId);
    const summaries: CheckpointSummary[] = [];
    for (const id of meta.checkpointIds ?? []) {
      const record = await this.ctx.storage.get<StoredCheckpoint>(
        CHECKPOINT_PREFIX + id,
      );
      if (record) summaries.push(checkpointSummary(record));
    }
    return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async deleteCheckpoint(
    ownerId: string,
    actor: WorkspaceActor,
    id: string,
  ): Promise<void> {
    if (actor.kind !== 'user')
      throw new Error('only a browser user can delete checkpoints');
    return this.ctx.storage.transaction(async (tx) => {
      const meta = await this.requiredMeta(tx, ownerId);
      const record = await tx.get<StoredCheckpoint>(CHECKPOINT_PREFIX + id);
      if (!record) throw new Error(`unknown checkpoint "${id}"`);
      for (const pageId of record.pageIds)
        await tx.delete(this.checkpointPageKey(id, pageId));
      await tx.delete(CHECKPOINT_PREFIX + id);
      meta.checkpointIds = (meta.checkpointIds ?? []).filter(
        (candidate) => candidate !== id,
      );
      await tx.put(META_KEY, meta);
    });
  }

  /** Restore a checkpoint forward-only: the checkpoint document is diffed against
   * the current state and applied as one new attributed revision. History is
   * never rewritten. Idempotent per operationId. */
  async restoreCheckpoint(
    ownerId: string,
    actor: WorkspaceActor,
    id: string,
    operationId: string,
  ): Promise<CommitResult> {
    if (actor.kind !== 'user')
      throw new Error('only a browser user can restore checkpoints');
    const restored = await this.ctx.storage.transaction(async (tx) => {
      const meta = await this.requiredMeta(tx, ownerId);
      const duplicate = await tx.get<CommitResult>(
        REQUEST_PREFIX + operationId,
      );
      if (duplicate) return duplicate;
      const target = await this.loadCheckpointDocument(tx, id);
      this.assertDocumentSizes(target);
      const current = await this.loadDocument(tx, meta);
      const operations = diffDocuments(current, target);
      if (!operations.length) {
        const result: CommitResult = {
          ok: true,
          revision: meta.revision,
          rebased: false,
          summary: summarizeOperations([]),
        };
        await this.rememberRequest(tx, meta, operationId, result);
        return result;
      }
      // Applied as one revision, bypassing the client batch-size cap (this is a
      // trusted, server-computed whole-document replace, not a client batch).
      const revision = meta.revision + 1;
      const timestamp = nowIso();
      const change: WorkspaceChange = {
        revision,
        baseRevision: meta.revision,
        operationId,
        actor,
        source: 'restore',
        createdAt: timestamp,
        summary: summarizeOperations(operations),
        operations: structuredClone(operations),
      };
      await this.saveDocument(tx, meta, current, target, revision, timestamp);
      await tx.put(this.changeKey(revision), change);
      await this.compactHistory(tx, meta, revision);
      const result: CommitResult = {
        ok: true,
        revision,
        rebased: false,
        summary: change.summary,
      };
      await this.rememberRequest(tx, meta, operationId, result);
      return result;
    });
    // A successful restore may have produced a new revision — notify editors.
    if (restored.ok) await this.broadcast();
    return restored;
  }

  /** The checkpoint's full document — used by the fork path to seed a new
   * workspace via the normal initialize flow. */
  async getCheckpointDocument(
    ownerId: string,
    id: string,
  ): Promise<TopologyDocumentModel> {
    await this.requiredMeta(this.ctx.storage, ownerId);
    return this.loadCheckpointDocument(this.ctx.storage, id);
  }

  async grantPageLease(
    ownerId: string,
    actor: WorkspaceActor,
    pageId: string,
    ttlSeconds = 600,
  ): Promise<WorkspaceLease> {
    if (actor.kind !== 'user')
      throw new Error('only a browser user can grant an agent lease');
    const leaseResult = await this.ctx.storage.transaction(async (tx) => {
      const meta = await this.requiredMeta(tx, ownerId);
      if (!meta.pageIds.includes(pageId))
        throw new Error(`unknown page "${pageId}"`);
      const ttl = Math.max(60, Math.min(900, Math.round(ttlSeconds)));
      const granted = new Date();
      const lease: WorkspaceLease = {
        id: `lease_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        scope: { kind: 'page', pageId },
        grantedBy: actor,
        grantedAt: granted.toISOString(),
        expiresAt: new Date(granted.getTime() + ttl * 1000).toISOString(),
      };
      meta.lease = lease;
      meta.updatedAt = nowIso();
      await tx.put(META_KEY, meta);
      return lease;
    });
    // The lease field changed — notify open editors so suggest-only vs.
    // leased state updates without waiting for the next poll.
    await this.broadcast();
    return leaseResult;
  }

  async revokeLease(ownerId: string, actor: WorkspaceActor): Promise<boolean> {
    if (actor.kind !== 'user')
      throw new Error('only a browser user can revoke an agent lease');
    const hadLease = await this.ctx.storage.transaction(async (tx) => {
      const meta = await this.requiredMeta(tx, ownerId);
      const existed = Boolean(meta.lease);
      delete meta.lease;
      meta.updatedAt = nowIso();
      await tx.put(META_KEY, meta);
      return existed;
    });
    await this.broadcast();
    return hadLease;
  }

  private async commit(
    ownerId: string,
    actor: WorkspaceActor,
    request: CommitRequest,
    source: WorkspaceChange['source'],
    requireLease: boolean,
  ): Promise<CommitResult> {
    assertRequest(request);
    const result = await this.ctx.storage.transaction(async (tx) => {
      const meta = await this.requiredMeta(tx, ownerId);
      const duplicate = await tx.get<CommitResult>(
        REQUEST_PREFIX + request.operationId,
      );
      if (duplicate) return duplicate;
      if (requireLease) {
        const lease = activeLease(meta);
        if (!lease) {
          const expired = Boolean(meta.lease);
          const result: CommitResult = {
            ok: false,
            code: expired ? 'lease-expired' : 'lease-required',
            revision: meta.revision,
            message: expired
              ? 'the UI-granted agent lease has expired'
              : 'suggest-only mode is active; submit a proposal or request a UI-granted lease',
          };
          await this.rememberRequest(tx, meta, request.operationId, result);
          return result;
        }
        if (
          !request.operations.every((operation) =>
            pageScoped(operation, lease.scope.pageId),
          )
        ) {
          const result: CommitResult = {
            ok: false,
            code: 'out-of-scope',
            revision: meta.revision,
            message: `agent lease is limited to page "${lease.scope.pageId}"`,
          };
          await this.rememberRequest(tx, meta, request.operationId, result);
          return result;
        }
      }
      return this.commitWithin(tx, meta, actor, request, source);
    });
    // Broadcast only after the transaction commits, and only when a revision
    // was actually created — a conflict/lease rejection changes no state.
    if (result.ok) await this.broadcast();
    // Authoring-profile learner (Packet P2), strictly gated + best-effort. A
    // leased agent commit is agent authorship; a UI commit may be the user's
    // correction of earlier agent authorship. When PROFILES_ENABLED is unset
    // this branch is never entered, so the response is unchanged.
    if (result.ok && profilesEnabled(this.env)) {
      if (source === 'agent-lease')
        await this.recordAgentWindow(request.operations, result.revision);
      else if (source === 'ui')
        await this.markAgentCorrection(request.operations);
    }
    return result;
  }

  private async commitWithin(
    tx: WorkspaceStorage,
    meta: StoredMeta,
    actor: WorkspaceActor,
    request: CommitRequest,
    source: WorkspaceChange['source'],
    proposalId?: string,
  ): Promise<CommitResult> {
    assertRequest(request);
    if (request.baseRevision > meta.revision)
      throw new Error(
        `base revision ${request.baseRevision} is ahead of current revision ${meta.revision}`,
      );
    if (request.baseRevision < meta.historyFloor) {
      const result: CommitResult = {
        ok: false,
        code: 'checkpoint-required',
        revision: meta.revision,
        message: `revision ${request.baseRevision} predates history floor ${meta.historyFloor}`,
      };
      await this.rememberRequest(tx, meta, request.operationId, result);
      return result;
    }
    const conflicts = await this.conflictsSince(
      tx,
      request.baseRevision,
      meta.revision,
      request.operations,
    );
    if (conflicts.length) {
      const result: CommitResult = {
        ok: false,
        code: 'conflict',
        revision: meta.revision,
        message:
          'operations overlap changes committed after their base revision',
        conflictingTargets: conflicts,
      };
      await this.rememberRequest(tx, meta, request.operationId, result);
      return result;
    }
    const current = await this.loadDocument(tx, meta);
    const next = applyOperations(current, request.operations);
    this.assertDocumentSizes(next);
    const revision = meta.revision + 1;
    const timestamp = nowIso();
    const change: WorkspaceChange = {
      revision,
      baseRevision: request.baseRevision,
      operationId: request.operationId,
      actor,
      source,
      createdAt: timestamp,
      summary: summarizeOperations(request.operations),
      operations: structuredClone(request.operations),
      ...(proposalId ? { proposalId } : {}),
    };
    await this.saveDocument(tx, meta, current, next, revision, timestamp);
    await tx.put(this.changeKey(revision), change);
    await this.compactHistory(tx, meta, revision);
    const result: CommitResult = {
      ok: true,
      revision,
      rebased: request.baseRevision < revision - 1,
      summary: change.summary,
    };
    await this.rememberRequest(tx, meta, request.operationId, result);
    return result;
  }

  private async requiredMeta(
    storage: WorkspaceStorage,
    ownerId: string,
  ): Promise<StoredMeta> {
    const meta = await storage.get<StoredMeta>(META_KEY);
    if (!meta) throw new Error('workspace is not initialized');
    assertOwner(meta, ownerId);
    return meta;
  }

  private async snapshotFrom(
    storage: WorkspaceStorage,
    meta: StoredMeta,
  ): Promise<WorkspaceSnapshot> {
    return {
      id: meta.id,
      revision: meta.revision,
      document: await this.loadDocument(storage, meta),
      lease: activeLease(meta),
    };
  }

  private async loadDocument(
    storage: WorkspaceStorage,
    meta: StoredMeta,
  ): Promise<TopologyDocumentModel> {
    const pages: Page[] = [];
    for (const id of meta.pageIds) {
      const page = await storage.get<Page>(PAGE_PREFIX + id);
      if (!page) throw new Error(`workspace page "${id}" is unavailable`);
      pages.push(page);
    }
    const parsed = parseDoc({ ...meta.head, pages });
    if (!parsed) throw new Error('stored workspace document is invalid');
    return parsed;
  }

  private checkpointPageKey(id: string, pageId: string): string {
    return `${CHECKPOINT_PREFIX}${id}:page:${pageId}`;
  }

  private async loadCheckpointDocument(
    storage: WorkspaceStorage,
    id: string,
  ): Promise<TopologyDocumentModel> {
    const record = await storage.get<StoredCheckpoint>(CHECKPOINT_PREFIX + id);
    if (!record) throw new Error(`unknown checkpoint "${id}"`);
    const pages: Page[] = [];
    for (const pageId of record.pageIds) {
      const page = await storage.get<Page>(this.checkpointPageKey(id, pageId));
      if (!page) throw new Error(`checkpoint page "${pageId}" is unavailable`);
      pages.push(page);
    }
    const parsed = parseDoc({ ...record.head, pages });
    if (!parsed) throw new Error('stored checkpoint document is invalid');
    return parsed;
  }

  private async saveDocument(
    storage: WorkspaceStorage,
    meta: StoredMeta,
    current: TopologyDocumentModel,
    next: TopologyDocumentModel,
    revision: number,
    timestamp: string,
  ): Promise<void> {
    const nextIds = new Set(next.pages.map((page) => page.id));
    for (const page of current.pages)
      if (!nextIds.has(page.id)) await storage.delete(PAGE_PREFIX + page.id);
    const currentById = new Map(current.pages.map((page) => [page.id, page]));
    for (const page of next.pages) {
      if (JSON.stringify(currentById.get(page.id)) !== JSON.stringify(page))
        await storage.put(PAGE_PREFIX + page.id, page);
    }
    const { pages, ...head } = next;
    meta.head = head;
    meta.pageIds = pages.map((page) => page.id);
    meta.revision = revision;
    meta.updatedAt = timestamp;
    await storage.put(META_KEY, meta);
  }

  private assertPageSizes(pages: Page[]): void {
    for (const page of pages)
      if (bytes(page) > MAX_PAGE_BYTES)
        throw new Error(
          `page "${page.id}" exceeds the 1.8 MiB workspace page limit`,
        );
  }

  private assertDocumentSizes(document: TopologyDocumentModel): void {
    this.assertPageSizes(document.pages);
    const { pages: _pages, ...head } = document;
    if (bytes(head) > MAX_META_BYTES)
      throw new Error('document metadata exceeds the 1.8 MiB workspace limit');
  }

  private async conflictsSince(
    storage: WorkspaceStorage,
    baseRevision: number,
    currentRevision: number,
    incoming: WorkspaceOperation[],
  ): Promise<string[]> {
    const committed: WorkspaceOperation[] = [];
    for (
      let revision = baseRevision + 1;
      revision <= currentRevision;
      revision++
    ) {
      const change = await storage.get<WorkspaceChange>(
        this.changeKey(revision),
      );
      if (change) committed.push(...change.operations);
    }
    return conflictingTargets(incoming, committed);
  }

  private async makeProposalRoom(storage: WorkspaceStorage): Promise<void> {
    const records = await storage.list<WorkspaceProposal>({
      prefix: PROPOSAL_PREFIX,
    });
    const proposals = [...records.entries()];
    const unresolved = proposals.filter(
      ([, proposal]) =>
        proposal.status === 'pending' || proposal.status === 'conflicted',
    );
    if (unresolved.length >= MAX_PENDING_PROPOSALS)
      throw new Error(
        `workspace already has ${MAX_PENDING_PROPOSALS} unresolved proposals`,
      );
    if (proposals.length < MAX_PROPOSALS) return;
    const resolved = proposals
      .filter(
        ([, proposal]) =>
          proposal.status === 'accepted' || proposal.status === 'rejected',
      )
      .sort((a, b) => a[1].updatedAt.localeCompare(b[1].updatedAt));
    while (records.size >= MAX_PROPOSALS && resolved.length) {
      const oldest = resolved.shift();
      if (!oldest) break;
      await storage.delete(oldest[0]);
      records.delete(oldest[0]);
    }
    if (records.size >= MAX_PROPOSALS)
      throw new Error(`workspace proposal limit (${MAX_PROPOSALS}) reached`);
  }

  private async compactHistory(
    storage: WorkspaceStorage,
    meta: StoredMeta,
    revision: number,
  ): Promise<void> {
    const newFloor = Math.max(0, revision - HISTORY_LIMIT);
    if (newFloor <= meta.historyFloor) return;
    for (let old = meta.historyFloor + 1; old <= newFloor; old++)
      await storage.delete(this.changeKey(old));
    meta.historyFloor = newFloor;
    await storage.put(META_KEY, meta);
  }

  private async rememberRequest(
    storage: WorkspaceStorage,
    meta: StoredMeta,
    operationId: string,
    result: unknown,
  ): Promise<void> {
    const key = REQUEST_PREFIX + operationId;
    await storage.put(key, result);
    meta.requestKeys = [
      ...meta.requestKeys.filter((candidate) => candidate !== key),
      key,
    ];
    while (meta.requestKeys.length > REQUEST_LIMIT) {
      const old = meta.requestKeys.shift();
      if (old) await storage.delete(old);
    }
    await storage.put(META_KEY, meta);
  }

  private changeKey(revision: number): string {
    return CHANGE_PREFIX + String(revision).padStart(12, '0');
  }

  /* ── authoring-profile learner (Packet P2, observe-only) ──────────────
   *
   * Everything below is BEST-EFFORT and only runs when PROFILES_ENABLED is on.
   * It records agent authorship, marks user corrections that overlap it, and —
   * gated on the persistence checkpoint — emits one compact structured outcome
   * per corrected window to the owner's AuthoringProfile DO. It never blocks or
   * alters a commit/accept/checkpoint response, never sends raw documents or
   * operations off-DO, and swallows every failure. */

  private agentWindowKey(revision: number): string {
    return AGENT_WINDOW_PREFIX + String(revision).padStart(12, '0');
  }

  /**
   * Record agent authorship at `revision`: the targets it touched, a compacted
   * copy of the agent operations, and the agent-authored document as the
   * baseline a later user correction is diffed against. Bounded — the oldest
   * entry is evicted past `MAX_AGENT_WINDOW`. Best-effort: any failure is
   * swallowed so authorship-bookkeeping never affects the commit that already
   * succeeded.
   */
  private async recordAgentWindow(
    operations: WorkspaceOperation[],
    revision: number,
  ): Promise<void> {
    try {
      const meta = await this.ctx.storage.get<StoredMeta>(META_KEY);
      if (!meta) return;
      const baseline = await this.loadDocument(this.ctx.storage, meta);
      const targets = [...new Set(operations.flatMap(operationTargets))];
      // Compact the captured ops: keep them for target-overlap analysis, but
      // drop them past the bounds (targets alone still detect overlap).
      const compactOps =
        operations.length <= MAX_AGENT_WINDOW_OPS &&
        bytes(operations) <= MAX_AGENT_WINDOW_OPS_BYTES
          ? structuredClone(operations)
          : [];
      const record: AgentWindowRecord = {
        revision,
        targets,
        operations: compactOps,
        baseline,
        corrected: false,
        correctionTargets: [],
        createdAt: nowIso(),
      };
      const existing = await this.ctx.storage.list<AgentWindowRecord>({
        prefix: AGENT_WINDOW_PREFIX,
      });
      const keys = [...existing.keys()].sort();
      // Keys are zero-padded by revision, so the lexicographically smallest is
      // the oldest — evict oldest-first to make room for the new entry.
      while (keys.length >= MAX_AGENT_WINDOW) {
        const oldest = keys.shift();
        if (oldest) await this.ctx.storage.delete(oldest);
      }
      await this.ctx.storage.put(this.agentWindowKey(revision), record);
    } catch {
      // best-effort — learning must never affect editing
    }
  }

  /**
   * Mark any agent-authorship window whose targets a user commit overlapped as
   * corrected, accumulating the overlapping targets (bounded). One editing
   * burst of several user commits therefore folds into a single corrected
   * window → a single emitted outcome at the next checkpoint. Best-effort.
   */
  private async markAgentCorrection(
    operations: WorkspaceOperation[],
  ): Promise<void> {
    try {
      const entries = await this.ctx.storage.list<AgentWindowRecord>({
        prefix: AGENT_WINDOW_PREFIX,
      });
      if (!entries.size) return;
      const userTargets = operations.flatMap(operationTargets);
      for (const [key, entry] of entries) {
        // Overlap against the captured agent ops when present, else fall back
        // to a direct target-set comparison (ops may have been compacted out).
        const overlap = entry.operations.length
          ? conflictingTargets(operations, entry.operations)
          : userTargets.filter((t) => entry.targets.includes(t));
        if (!overlap.length) continue;
        const nextTargets = [
          ...new Set([...entry.correctionTargets, ...overlap]),
        ].slice(0, MAX_AGENT_CORRECTION_TARGETS);
        const updated: AgentWindowRecord = {
          ...entry,
          corrected: true,
          correctionTargets: nextTargets,
        };
        await this.ctx.storage.put(key, updated);
      }
    } catch {
      // best-effort
    }
  }

  /** Gate + schedule outcome emission off the checkpoint response path. */
  private scheduleAuthoringOutcomes(): void {
    if (!profilesEnabled(this.env)) return;
    this.ctx.waitUntil(this.emitAuthoringOutcomes());
  }

  /**
   * For every corrected agent-authorship window, compute the settled difference
   * from the agent baseline to the current document, run P1 feature extraction,
   * and — if the correction carried a real semantic change and survived to this
   * checkpoint — send ONE compact outcome to the owner's profile DO. Each
   * window is consumed (deleted) whether or not it emitted, so a burst yields
   * exactly one outcome and nothing is re-counted at a later checkpoint. The
   * whole method is wrapped so a failure anywhere is swallowed.
   */
  private async emitAuthoringOutcomes(): Promise<void> {
    try {
      const meta = await this.ctx.storage.get<StoredMeta>(META_KEY);
      if (!meta) return;
      const entries = await this.ctx.storage.list<AgentWindowRecord>({
        prefix: AGENT_WINDOW_PREFIX,
      });
      const corrected = [...entries.entries()].filter(([, e]) => e.corrected);
      if (!corrected.length) return;
      const current = await this.loadDocument(this.ctx.storage, meta);
      for (const [key, entry] of corrected) {
        try {
          // The settled difference (proposal: "only the settled difference is
          // evaluated"). An empty diff means the correction was reverted before
          // the checkpoint — it did not survive, so nothing is learned.
          const settled = diffDocuments(entry.baseline, current);
          if (!settled.length) continue;
          const features = extractFeatures(settled, {
            document: current,
            agentDocument: entry.baseline,
            agentOperations: entry.operations,
          });
          const { addedTraits, removedTraits } = features.correction;
          // A purely cosmetic settled change (no trait added or removed) is
          // evidence at most, never a candidate — skip it.
          if (!addedTraits.length && !removedTraits.length) continue;
          const outcome: AuthoringOutcome = {
            archetype: features.archetype,
            addedTraits,
            removedTraits,
            scope: { kind: 'user' },
            sourceRevisionRef: `${meta.id}@r${entry.revision}`,
            documentRef: meta.id,
            summary: features.correction.summary,
          };
          const ns = this.env.AUTHORING_PROFILE;
          const stub = ns.get(
            ns.idFromName(meta.ownerId),
          ) as unknown as AuthoringProfileRpc;
          await stub.recordOutcome(meta.ownerId, outcome);
        } catch {
          // best-effort per entry
        } finally {
          // Consume the window either way: one burst → at most one outcome, and
          // never a retry storm at the next checkpoint.
          await this.ctx.storage.delete(key);
        }
      }
    } catch {
      // best-effort — learning must never affect editing
    }
  }
}
