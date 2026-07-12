/**
 * Canonical shared topology coordinator.
 *
 * One Durable Object instance owns one topology document. All accepted browser
 * and agent writes are serialized here as revisioned semantic operations. Pages
 * are stored under separate keys so aggregate documents may safely exceed the
 * Durable Object per-value limit.
 */
import { DurableObject } from 'cloudflare:workers';
import type { WorkerEnv } from './env.js';
import type {
  Page,
  TopologyDocument as TopologyDocumentModel,
} from '../src/pages/model.js';
import { parseDoc } from '../src/pages/persist.js';
import {
  applyOperations,
  conflictingTargets,
  operationPageIds,
  summarizeOperations,
  validateOperations,
} from '../src/workspace/operations.js';
import {
  ELEMENT_KINDS,
  type ChangesResult,
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
  type WorkspaceOperation,
  type WorkspaceProposal,
  type WorkspaceSnapshot,
} from '../src/workspace/model.js';

const META_KEY = 'meta';
const PAGE_PREFIX = 'page:';
const CHANGE_PREFIX = 'change:';
const PROPOSAL_PREFIX = 'proposal:';
const REQUEST_PREFIX = 'request:';
const MAX_BATCH_BYTES = 512 * 1024;
const MAX_PAGE_BYTES = 1_800 * 1024;
const MAX_META_BYTES = 1_800 * 1024;
const MAX_OPERATIONS = 250;
const HISTORY_LIMIT = 500;
const REQUEST_LIMIT = 200;
const OPERATION_SCHEMA_REVISION = 1;
const MAX_PENDING_PROPOSALS = 20;
const MAX_PROPOSALS = 50;

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

export class TopologyDocument extends DurableObject<WorkerEnv> {
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
          proposal.status === 'pending' || proposal.status === 'conflicted',
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
    if (!title.trim()) throw new Error('proposal title is required');
    return this.ctx.storage.transaction(async (tx) => {
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
        title: title.trim().slice(0, 160),
        ...(rationale?.trim()
          ? { rationale: rationale.trim().slice(0, 2000) }
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
  ): Promise<CommitResult> {
    if (actor.kind !== 'user')
      throw new Error('only a browser user can accept proposals');
    return this.ctx.storage.transaction(async (tx) => {
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
        proposal.operations,
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
          operations: proposal.operations,
        },
        'proposal',
        id,
      );
      if (result.ok) {
        proposal.status = 'accepted';
        proposal.acceptedRevision = result.revision;
        proposal.updatedAt = nowIso();
        delete proposal.conflictingTargets;
        await tx.put(PROPOSAL_PREFIX + id, proposal);
      }
      return result;
    });
  }

  async rejectProposal(
    ownerId: string,
    actor: WorkspaceActor,
    id: string,
  ): Promise<WorkspaceProposal> {
    if (actor.kind !== 'user')
      throw new Error('only a browser user can reject proposals');
    return this.ctx.storage.transaction(async (tx) => {
      await this.requiredMeta(tx, ownerId);
      const proposal = await tx.get<WorkspaceProposal>(PROPOSAL_PREFIX + id);
      if (!proposal) throw new Error(`unknown proposal "${id}"`);
      if (proposal.status === 'accepted')
        throw new Error('an accepted proposal cannot be rejected');
      proposal.status = 'rejected';
      proposal.updatedAt = nowIso();
      await tx.put(PROPOSAL_PREFIX + id, proposal);
      return proposal;
    });
  }

  async grantPageLease(
    ownerId: string,
    actor: WorkspaceActor,
    pageId: string,
    ttlSeconds = 600,
  ): Promise<WorkspaceLease> {
    if (actor.kind !== 'user')
      throw new Error('only a browser user can grant an agent lease');
    return this.ctx.storage.transaction(async (tx) => {
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
  }

  async revokeLease(ownerId: string, actor: WorkspaceActor): Promise<boolean> {
    if (actor.kind !== 'user')
      throw new Error('only a browser user can revoke an agent lease');
    return this.ctx.storage.transaction(async (tx) => {
      const meta = await this.requiredMeta(tx, ownerId);
      const hadLease = Boolean(meta.lease);
      delete meta.lease;
      meta.updatedAt = nowIso();
      await tx.put(META_KEY, meta);
      return hadLease;
    });
  }

  private async commit(
    ownerId: string,
    actor: WorkspaceActor,
    request: CommitRequest,
    source: WorkspaceChange['source'],
    requireLease: boolean,
  ): Promise<CommitResult> {
    assertRequest(request);
    return this.ctx.storage.transaction(async (tx) => {
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
}
