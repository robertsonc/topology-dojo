/** Thin browser client for the owner-authenticated workspace API. */
import type { TopologyDocument } from '../pages/model.js';
import type {
  CommitRequest,
  CommitResult,
  ProposalSummary,
  WorkspaceLease,
  WorkspaceListItem,
  WorkspaceManifest,
  WorkspaceProposal,
  WorkspaceSnapshot,
} from './model.js';

/**
 * Thrown instead of a generic `Error` when the server reports the workspace
 * surface is disabled for this deployment (`WORKSPACE_ENABLED=false` — see
 * `worker/env.ts`). Its message is already user-facing, so every existing
 * `error instanceof Error ? error.message : …` call site in `main.ts` shows
 * something sensible for free; the Agent Workspace panel additionally
 * special-cases this type to swap the "hand off / open" card for a plain
 * disabled notice instead of offering actions that would just 503.
 */
export class WorkspaceDisabledError extends Error {
  constructor() {
    super('Workspaces are not enabled on this deployment.');
    this.name = 'WorkspaceDisabledError';
  }
}

async function decode<T>(response: Response): Promise<T> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`workspace request failed (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const message = (value as { error?: unknown }).error;
    if (response.status === 503 && message === 'workspace_disabled') {
      throw new WorkspaceDisabledError();
    }
    throw new Error(
      typeof message === 'string'
        ? message
        : `workspace request failed (HTTP ${response.status})`,
    );
  }
  return value as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return decode<T>(
    await fetch(path, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    }),
  );
}

export function createWorkspace(
  document: TopologyDocument,
): Promise<WorkspaceSnapshot> {
  return request('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ document }),
  });
}

export function listWorkspaces(): Promise<WorkspaceListItem[]> {
  return request('/api/workspaces');
}

export function getWorkspace(id: string): Promise<WorkspaceSnapshot> {
  return request(`/api/workspaces/${encodeURIComponent(id)}`);
}

export function getWorkspaceManifest(id: string): Promise<WorkspaceManifest> {
  return request(`/api/workspaces/${encodeURIComponent(id)}/manifest`);
}

export async function commitWorkspaceOperations(
  id: string,
  commit: CommitRequest,
): Promise<CommitResult> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(id)}/operations`,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(commit),
    },
  );
  // A conflict is a typed result, not a transport failure.
  if (response.status === 409) return (await response.json()) as CommitResult;
  return decode<CommitResult>(response);
}

export function listWorkspaceProposals(id: string): Promise<ProposalSummary[]> {
  return request(
    `/api/workspaces/${encodeURIComponent(id)}/proposals?resolved=false`,
  );
}

export function getWorkspaceProposal(
  id: string,
  proposalId: string,
): Promise<WorkspaceProposal> {
  return request(
    `/api/workspaces/${encodeURIComponent(id)}/proposals/${encodeURIComponent(proposalId)}`,
  );
}

export async function acceptWorkspaceProposal(
  id: string,
  proposalId: string,
  operationId: string,
  /** Accept only these operation indices (a coherent subset). Omit to accept all. */
  selectedOperationIndices?: number[],
): Promise<CommitResult> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(id)}/proposals/${encodeURIComponent(proposalId)}/accept`,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        selectedOperationIndices
          ? { operationId, selectedOperationIndices }
          : { operationId },
      ),
    },
  );
  if (response.status === 409) return (await response.json()) as CommitResult;
  return decode<CommitResult>(response);
}

export function rejectWorkspaceProposal(
  id: string,
  proposalId: string,
): Promise<WorkspaceProposal> {
  return request(
    `/api/workspaces/${encodeURIComponent(id)}/proposals/${encodeURIComponent(proposalId)}/reject`,
    { method: 'POST', body: '{}' },
  );
}

export function grantWorkspaceLease(
  id: string,
  pageId: string,
  ttlSeconds = 600,
): Promise<WorkspaceLease> {
  return request(`/api/workspaces/${encodeURIComponent(id)}/lease`, {
    method: 'PUT',
    body: JSON.stringify({ pageId, ttlSeconds }),
  });
}

export function revokeWorkspaceLease(
  id: string,
): Promise<{ revoked: boolean }> {
  return request(`/api/workspaces/${encodeURIComponent(id)}/lease`, {
    method: 'DELETE',
  });
}
