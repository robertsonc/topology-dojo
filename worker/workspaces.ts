/** Shared owner workspace facade used by browser routes and remote MCP tools. */
import type { SessionUser } from '../src/server/session.js';
import { parseDoc } from '../src/pages/persist.js';
import type { TopologyDocument } from '../src/pages/model.js';
import { blankPage } from '../src/pages/model.js';
import type {
  ChangesResult,
  CheckpointSummary,
  CommitRequest,
  CommitResult,
  ElementKind,
  ElementPageResult,
  ForkResult,
  ProposalResult,
  ProposalSummary,
  WorkspaceActor,
  WorkspaceDirectoryRecord,
  WorkspaceLease,
  WorkspaceListItem,
  WorkspaceManifest,
  WorkspaceProposal,
  WorkspaceSnapshot,
} from '../src/workspace/model.js';
import type { WorkerEnv } from './env.js';
import type { TopologyRegistry } from './registry.js';

export interface WorkspaceUser {
  uid: string;
  login: string;
  name?: string;
}

/** Explicit RPC facade avoids Cloudflare's conservative Stubable<> inference
 * reducing rich document-model return types to `never`. */
interface DocumentRpc {
  isInitialized(ownerId: string): Promise<boolean>;
  initialize(
    ownerId: string,
    id: string,
    input: TopologyDocument,
  ): Promise<WorkspaceSnapshot>;
  getSnapshot(ownerId: string): Promise<WorkspaceSnapshot>;
  getManifest(ownerId: string): Promise<WorkspaceManifest>;
  getChanges(
    ownerId: string,
    sinceRevision: number,
    limit?: number,
    includeOperations?: boolean,
  ): Promise<ChangesResult>;
  getElements(
    ownerId: string,
    pageId: string,
    ids?: string[],
    kinds?: ElementKind[],
    cursor?: number,
    limit?: number,
  ): Promise<ElementPageResult>;
  applyUserOperations(
    ownerId: string,
    actor: WorkspaceActor,
    request: CommitRequest,
  ): Promise<CommitResult>;
  applyAgentOperations(
    ownerId: string,
    actor: WorkspaceActor,
    request: CommitRequest,
  ): Promise<CommitResult>;
  propose(
    ownerId: string,
    actor: WorkspaceActor,
    request: CommitRequest,
    title: string,
    rationale?: string,
  ): Promise<ProposalResult>;
  listProposals(
    ownerId: string,
    includeResolved?: boolean,
  ): Promise<ProposalSummary[]>;
  getProposal(ownerId: string, id: string): Promise<WorkspaceProposal>;
  acceptProposal(
    ownerId: string,
    actor: WorkspaceActor,
    id: string,
    operationId: string,
    selectedOperationIndices?: number[],
  ): Promise<CommitResult>;
  rejectProposal(
    ownerId: string,
    actor: WorkspaceActor,
    id: string,
  ): Promise<WorkspaceProposal>;
  grantPageLease(
    ownerId: string,
    actor: WorkspaceActor,
    pageId: string,
    ttlSeconds?: number,
  ): Promise<WorkspaceLease>;
  revokeLease(ownerId: string, actor: WorkspaceActor): Promise<boolean>;
  createCheckpoint(
    ownerId: string,
    actor: WorkspaceActor,
    name: string,
  ): Promise<CheckpointSummary>;
  listCheckpoints(ownerId: string): Promise<CheckpointSummary[]>;
  deleteCheckpoint(
    ownerId: string,
    actor: WorkspaceActor,
    id: string,
  ): Promise<void>;
  restoreCheckpoint(
    ownerId: string,
    actor: WorkspaceActor,
    id: string,
    operationId: string,
  ): Promise<CommitResult>;
  getCheckpointDocument(ownerId: string, id: string): Promise<TopologyDocument>;
}

function asWorkspaceUser(user: SessionUser): WorkspaceUser {
  return { uid: user.uid, login: user.login, name: user.name };
}

export class WorkspaceService {
  private readonly user: WorkspaceUser;

  constructor(
    private readonly env: WorkerEnv,
    user: WorkspaceUser | SessionUser,
  ) {
    this.user = asWorkspaceUser(user);
  }

  async list(): Promise<WorkspaceListItem[]> {
    const [current, legacy] = await Promise.all([
      this.directory().listWorkspaceSources(),
      this.legacyRegistry().listWorkspaceSources(),
    ]);
    const byId = new Map(current.map((item) => [item.id, item]));
    for (const item of legacy) if (!byId.has(item.id)) byId.set(item.id, item);
    return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
  }

  async create(input: unknown): Promise<WorkspaceSnapshot> {
    const document = parseDoc(input);
    if (!document) throw new Error('invalid topology document');
    const id = `w_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
    const snapshot = await this.document(id).initialize(
      this.user.uid,
      id,
      document,
    );
    await this.updateDirectory(id, snapshot.revision, snapshot.document, false);
    return snapshot;
  }

  /** Start a canonical shared document without routing through a legacy draft. */
  createEmpty(title?: string): Promise<WorkspaceSnapshot> {
    return this.create({
      title: title?.trim() || 'Untitled',
      customNodes: [],
      pages: [blankPage('Frame 1')],
    });
  }

  async snapshot(id: string): Promise<WorkspaceSnapshot> {
    const document = await this.ensure(id);
    return document.getSnapshot(this.user.uid);
  }

  async manifest(id: string): Promise<WorkspaceManifest> {
    const document = await this.ensure(id);
    return document.getManifest(this.user.uid);
  }

  async changes(
    id: string,
    sinceRevision: number,
    limit?: number,
    includeOperations?: boolean,
  ): Promise<ChangesResult> {
    const document = await this.ensure(id);
    return document.getChanges(
      this.user.uid,
      sinceRevision,
      limit,
      includeOperations,
    );
  }

  async elements(
    id: string,
    pageId: string,
    ids?: string[],
    kinds?: ElementKind[],
    cursor?: number,
    limit?: number,
  ): Promise<ElementPageResult> {
    const document = await this.ensure(id);
    return document.getElements(
      this.user.uid,
      pageId,
      ids,
      kinds,
      cursor,
      limit,
    );
  }

  async applyUser(id: string, request: CommitRequest): Promise<CommitResult> {
    const document = await this.ensure(id);
    const result = await document.applyUserOperations(
      this.user.uid,
      this.actor('user'),
      request,
    );
    if (result.ok) await this.tryRefreshDirectory(id, document);
    return result;
  }

  async applyAgent(id: string, request: CommitRequest): Promise<CommitResult> {
    const document = await this.ensure(id);
    const result = await document.applyAgentOperations(
      this.user.uid,
      this.actor('agent'),
      request,
    );
    if (result.ok) await this.tryRefreshDirectory(id, document);
    return result;
  }

  async propose(
    id: string,
    request: CommitRequest,
    title: string,
    rationale?: string,
  ): Promise<ProposalResult> {
    const document = await this.ensure(id);
    return document.propose(
      this.user.uid,
      this.actor('agent'),
      request,
      title,
      rationale,
    );
  }

  async proposals(
    id: string,
    includeResolved = true,
  ): Promise<ProposalSummary[]> {
    const document = await this.ensure(id);
    return document.listProposals(this.user.uid, includeResolved);
  }

  async proposal(id: string, proposalId: string): Promise<WorkspaceProposal> {
    const document = await this.ensure(id);
    return document.getProposal(this.user.uid, proposalId);
  }

  async accept(
    id: string,
    proposalId: string,
    operationId: string,
    selectedOperationIndices?: number[],
  ): Promise<CommitResult> {
    const document = await this.ensure(id);
    const result = await document.acceptProposal(
      this.user.uid,
      this.actor('user'),
      proposalId,
      operationId,
      selectedOperationIndices,
    );
    if (result.ok) await this.tryRefreshDirectory(id, document);
    return result;
  }

  async reject(id: string, proposalId: string): Promise<WorkspaceProposal> {
    const document = await this.ensure(id);
    return document.rejectProposal(
      this.user.uid,
      this.actor('user'),
      proposalId,
    );
  }

  async grantLease(
    id: string,
    pageId: string,
    ttlSeconds?: number,
  ): Promise<WorkspaceLease> {
    const document = await this.ensure(id);
    return document.grantPageLease(
      this.user.uid,
      this.actor('user'),
      pageId,
      ttlSeconds,
    );
  }

  async revokeLease(id: string): Promise<boolean> {
    const document = await this.ensure(id);
    return document.revokeLease(this.user.uid, this.actor('user'));
  }

  async createCheckpoint(
    id: string,
    name: string,
    actorKind: 'user' | 'agent' = 'user',
  ): Promise<CheckpointSummary> {
    const document = await this.ensure(id);
    return document.createCheckpoint(
      this.user.uid,
      this.actor(actorKind),
      name,
    );
  }

  async listCheckpoints(id: string): Promise<CheckpointSummary[]> {
    const document = await this.ensure(id);
    return document.listCheckpoints(this.user.uid);
  }

  async deleteCheckpoint(id: string, checkpointId: string): Promise<void> {
    const document = await this.ensure(id);
    return document.deleteCheckpoint(
      this.user.uid,
      this.actor('user'),
      checkpointId,
    );
  }

  async restoreCheckpoint(
    id: string,
    checkpointId: string,
    operationId: string,
  ): Promise<CommitResult> {
    const document = await this.ensure(id);
    const result = await document.restoreCheckpoint(
      this.user.uid,
      this.actor('user'),
      checkpointId,
      operationId,
    );
    if (result.ok) await this.tryRefreshDirectory(id, document);
    return result;
  }

  /** Fork a checkpoint into a brand-new workspace via the normal create flow. */
  async forkCheckpoint(id: string, checkpointId: string): Promise<ForkResult> {
    const source = await this.ensure(id);
    const document = await source.getCheckpointDocument(
      this.user.uid,
      checkpointId,
    );
    const snapshot = await this.create(document);
    return { workspaceId: snapshot.id, snapshot };
  }

  async isMigrated(id: string): Promise<boolean> {
    return this.directory().hasWorkspace(id);
  }

  async migratedIds(): Promise<string[]> {
    return this.directory().workspaceIds();
  }

  /**
   * Return the coordinator, lazily migrating a legacy registry snapshot first.
   * The legacy value is deliberately retained; the marker is written only after
   * the coordinator's atomic initialization succeeds.
   */
  private async ensure(id: string): Promise<DocumentRpc> {
    const registry = this.directory();
    const document = this.document(id);
    const record = await registry.workspaceRecord(id);
    if (record) {
      if (!(await document.isInitialized(this.user.uid)))
        throw new Error(`workspace "${id}" directory entry is incomplete`);
      return document;
    }

    const legacy = await this.legacyRegistry().legacyDocument(id);
    if (!legacy) throw new Error(`unknown workspace "${id}"`);
    const parsed = parseDoc(legacy);
    if (!parsed)
      throw new Error(
        `legacy topology "${id}" cannot be migrated because it is invalid`,
      );
    const snapshot = await document.initialize(this.user.uid, id, parsed);
    await this.updateDirectory(id, snapshot.revision, snapshot.document, true);
    return document;
  }

  private document(id: string): DocumentRpc {
    const ns = this.env.TOPOLOGY_DOCUMENT;
    return ns.get(
      ns.idFromName(`document:${this.user.uid}:${id}`),
    ) as unknown as DocumentRpc;
  }

  private directory(): DurableObjectStub<TopologyRegistry> {
    const ns = this.env.TOPOLOGY_REGISTRY;
    // Numeric GitHub identity is stable across login renames for all new state.
    return ns.get(ns.idFromName(`user-id:${this.user.uid}`));
  }

  /** Existing v2 registry, addressed by the mutable login, used read-only here. */
  private legacyRegistry(): DurableObjectStub<TopologyRegistry> {
    const ns = this.env.TOPOLOGY_REGISTRY;
    return ns.get(ns.idFromName(`user:${this.user.login}`));
  }

  private actor(kind: 'user' | 'agent'): WorkspaceActor {
    return {
      kind,
      id: this.user.uid,
      label: this.user.login,
    };
  }

  private async refreshDirectory(
    id: string,
    document: DocumentRpc,
  ): Promise<void> {
    const snapshot = await document.getSnapshot(this.user.uid);
    const existing = await this.directory().workspaceRecord(id);
    await this.updateDirectory(
      id,
      snapshot.revision,
      snapshot.document,
      existing?.migratedFromLegacy ?? false,
    );
  }

  /** Directory metadata is a discoverability cache, not the commit record. A
   * refresh failure must never turn a durable canonical commit into false
   * failure; the next successful write/list repair can refresh it. */
  private async tryRefreshDirectory(
    id: string,
    document: DocumentRpc,
  ): Promise<void> {
    try {
      await this.refreshDirectory(id, document);
    } catch (error) {
      console.error(`workspace directory refresh failed for ${id}`, error);
    }
  }

  private async updateDirectory(
    id: string,
    revision: number,
    document: TopologyDocument,
    migratedFromLegacy: boolean,
  ): Promise<void> {
    const record: WorkspaceDirectoryRecord = {
      id,
      title: document.title,
      pages: document.pages.length,
      revision,
      updatedAt: now(),
      migratedFromLegacy,
    };
    await this.directory().markWorkspace(record);
  }
}

function now(): string {
  return new Date().toISOString();
}
