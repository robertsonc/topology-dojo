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
