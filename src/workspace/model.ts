import type { Page, TopologyDocument } from '../pages/model.js';

export const ELEMENT_KINDS = [
  'nodes',
  'links',
  'anchors',
  'zones',
  'flowPaths',
  'policyMarkers',
] as const;

export type ElementKind = (typeof ELEMENT_KINDS)[number];

export interface FieldPatch {
  /** Top-level fields to set or replace. */
  set?: Record<string, unknown>;
  /** Top-level optional fields to remove. */
  unset?: string[];
}

export type WorkspaceOperation =
  | { type: 'document.patch'; patch: FieldPatch }
  | {
      type: 'page.add';
      page: Page;
      /** Insert after this stable page id; null means first, omitted means last. */
      afterPageId?: string | null;
    }
  | { type: 'page.patch'; pageId: string; patch: FieldPatch }
  | { type: 'page.remove'; pageId: string }
  | { type: 'page.reorder'; pageIds: string[] }
  | {
      type: 'element.add';
      pageId: string;
      kind: ElementKind;
      element: Record<string, unknown>;
      /** Insert after this stable element id; null means first, omitted means last. */
      afterElementId?: string | null;
    }
  | {
      type: 'element.patch';
      pageId: string;
      kind: ElementKind;
      elementId: string;
      patch: FieldPatch;
    }
  | {
      type: 'element.remove';
      pageId: string;
      kind: ElementKind;
      elementId: string;
    }
  | {
      type: 'element.reorder';
      pageId: string;
      kind: ElementKind;
      elementIds: string[];
    };

export interface WorkspaceActor {
  kind: 'user' | 'agent' | 'system';
  id: string;
  label?: string;
  /**
   * MCP session Durable Object id, when this actor was the remote agent in
   * that session. Additive optional field — omitted by browser/UI callers.
   */
  sessionId?: string;
  /**
   * Honest, non-causal signal: `get_authoring_guidance` succeeded earlier in
   * the same MCP session before this actor authored the revision/proposal.
   * Never a claim that guidance caused the edit. Omitted when unknown.
   */
  guidanceConsultedBefore?: boolean;
}

export interface OperationSummary {
  count: number;
  byType: Record<string, number>;
  affectedPageIds: string[];
  affectedElementIds: string[];
  descriptions: string[];
}

export interface WorkspaceChange {
  revision: number;
  baseRevision: number;
  operationId: string;
  actor: WorkspaceActor;
  source: 'ui' | 'agent-lease' | 'proposal' | 'migration' | 'restore';
  createdAt: string;
  summary: OperationSummary;
  operations: WorkspaceOperation[];
  proposalId?: string;
  /**
   * MCP session id when this revision can be tied to one. Copied from the
   * agent actor (leased commit) or the accepted proposal's `createdBy`.
   * Additive; omitted when unknown. No schema version bump.
   */
  sessionId?: string;
  /**
   * Honest, non-causal: guidance was consulted in this session before the
   * agent authored the change. Omitted rather than stored as false.
   */
  guidanceConsultedBefore?: boolean;
}

export interface WorkspaceLease {
  id: string;
  scope: { kind: 'page'; pageId: string };
  grantedBy: WorkspaceActor;
  grantedAt: string;
  expiresAt: string;
}

export type ProposalStatus =
  | 'pending'
  | 'accepted'
  | 'partially-accepted'
  | 'rejected'
  | 'conflicted';

export interface WorkspaceProposal {
  id: string;
  title: string;
  rationale?: string;
  baseRevision: number;
  createdAt: string;
  updatedAt: string;
  createdBy: WorkspaceActor;
  status: ProposalStatus;
  operations: WorkspaceOperation[];
  summary: OperationSummary;
  conflictingTargets?: string[];
  acceptedRevision?: number;
}

export type ProposalResult =
  | { ok: true; proposal: WorkspaceProposal }
  | {
      ok: false;
      code: 'conflict' | 'checkpoint-required';
      revision: number;
      message: string;
      conflictingTargets?: string[];
    };

export type ProposalSummary = Omit<WorkspaceProposal, 'operations'>;

/** A named snapshot of the document at a revision (Packet R3). The page copies
 * live under separate keys; this summary is what list/create return. */
export interface CheckpointSummary {
  id: string;
  name: string;
  createdBy: WorkspaceActor;
  createdAt: string;
  /** The document revision captured. */
  revision: number;
  pageCount: number;
}

/** Result of forking a checkpoint into a brand-new workspace. */
export interface ForkResult {
  workspaceId: string;
  snapshot: WorkspaceSnapshot;
}

export interface WorkspacePageSummary {
  id: string;
  name: string;
  nodes: number;
  links: number;
  anchors: number;
  zones: number;
  flowPaths: number;
  policyMarkers: number;
}

export interface WorkspaceManifest {
  id: string;
  title: string;
  revision: number;
  /** Fetch the operation description only when this changes. */
  operationSchemaRevision: number;
  historyFloor: number;
  updatedAt: string;
  pages: WorkspacePageSummary[];
  lease: WorkspaceLease | null;
  pendingProposals: number;
}

export interface WorkspaceSnapshot {
  id: string;
  revision: number;
  document: TopologyDocument;
  lease: WorkspaceLease | null;
}

/**
 * One connected editor's presence, reconstructed by the coordinator purely from
 * a socket's ephemeral attachment (Packet S1). Never persisted — it exists only
 * for the lifetime of the WebSocket.
 */
export interface WorkspacePresence {
  kind: WorkspaceActor['kind'];
  label?: string;
  /** The page id this editor is currently viewing, if it has reported one. */
  pageId?: string;
}

/**
 * The compact push payload broadcast over the workspace socket (Packet S1).
 * Deliberately carries no document content — a client that receives it (or
 * misses it) re-hydrates through the existing `getWorkspaceChanges` / element
 * fetch path, so a lost notice degrades to exactly the polling behavior.
 */
export interface WorkspaceNotice {
  type: 'notice';
  revision: number;
  proposalCount: number;
  lease: WorkspaceLease | null;
  presence: WorkspacePresence[];
}

/** Client → server socket message: report the page this editor is viewing. */
export interface PresenceUpdateMessage {
  type: 'presence';
  pageId?: string;
}

export interface WorkspaceListItem {
  id: string;
  title: string;
  pages: number;
  revision: number | null;
  migrated: boolean;
  updatedAt?: string;
}

export interface WorkspaceDirectoryRecord {
  id: string;
  title: string;
  pages: number;
  revision: number;
  updatedAt: string;
  migratedFromLegacy: boolean;
}

export interface CommitRequest {
  baseRevision: number;
  operationId: string;
  operations: WorkspaceOperation[];
}

export type CommitResult =
  | {
      ok: true;
      revision: number;
      rebased: boolean;
      summary: OperationSummary;
    }
  | {
      ok: false;
      code:
        | 'conflict'
        | 'lease-required'
        | 'lease-expired'
        | 'out-of-scope'
        | 'checkpoint-required'
        | 'incoherent-subset';
      revision: number;
      message: string;
      conflictingTargets?: string[];
      /** For 'incoherent-subset': ids the selected operations depend on. */
      missingDependencies?: string[];
    };

export interface ChangesResult {
  revision: number;
  historyFloor: number;
  checkpointRequired: boolean;
  changes: Array<
    Omit<WorkspaceChange, 'operations'> & {
      operations?: WorkspaceOperation[];
    }
  >;
  nextRevision: number | null;
}

export interface ElementPageResult {
  workspaceId: string;
  revision: number;
  page: Pick<Page, 'id' | 'name' | 'viewBox'>;
  elements: Array<{
    kind: ElementKind;
    element: Record<string, unknown>;
  }>;
  nextCursor: number | null;
}
