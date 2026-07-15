/** Thin browser client for the owner-authenticated workspace API. */
import type { TopologyDocument } from '../pages/model.js';
import type {
  ChangesResult,
  CheckpointSummary,
  CommitRequest,
  CommitResult,
  ForkResult,
  ProposalSummary,
  WorkspaceLease,
  WorkspaceListItem,
  WorkspaceManifest,
  WorkspaceNotice,
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

/** Bounded change log after `since`. Defaults to compact summaries (no
 * operations) — the revision timeline reads exactly this projection. */
export function getWorkspaceChanges(
  id: string,
  since: number,
  limit?: number,
  detail: 'summary' | 'operations' = 'summary',
): Promise<ChangesResult> {
  const params = new URLSearchParams({ since: String(since) });
  if (limit !== undefined) params.set('limit', String(limit));
  if (detail === 'operations') params.set('detail', 'operations');
  return request(
    `/api/workspaces/${encodeURIComponent(id)}/changes?${params.toString()}`,
  );
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

export function listWorkspaceCheckpoints(
  id: string,
): Promise<CheckpointSummary[]> {
  return request(`/api/workspaces/${encodeURIComponent(id)}/checkpoints`);
}

export function createWorkspaceCheckpoint(
  id: string,
  name: string,
): Promise<CheckpointSummary> {
  return request(`/api/workspaces/${encodeURIComponent(id)}/checkpoints`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function deleteWorkspaceCheckpoint(
  id: string,
  checkpointId: string,
): Promise<{ deleted: string }> {
  return request(
    `/api/workspaces/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}`,
    { method: 'DELETE' },
  );
}

export async function restoreWorkspaceCheckpoint(
  id: string,
  checkpointId: string,
  operationId: string,
): Promise<CommitResult> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}/restore`,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ operationId }),
    },
  );
  if (response.status === 409) return (await response.json()) as CommitResult;
  return decode<CommitResult>(response);
}

export function forkWorkspaceCheckpoint(
  id: string,
  checkpointId: string,
): Promise<ForkResult> {
  return request(
    `/api/workspaces/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}/fork`,
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

/** A live workspace socket. `close()` tears it down without firing `onDown`. */
export interface WorkspaceSocketHandle {
  /** Report the page this editor is now viewing (best-effort; no-op if down). */
  sendPresence(pageId: string): void;
  /** Intentionally close the socket. Does not invoke the `onDown` callback. */
  close(): void;
}

export interface WorkspaceSocketOptions {
  /** A compact push notice arrived (new revision/proposal/lease/presence). */
  onNotice: (notice: WorkspaceNotice) => void;
  /**
   * The socket is unavailable — closed, errored, or never opened (e.g. the
   * server predates the `/socket` route and 404/426s the upgrade). The caller
   * must keep/resume polling; the socket is only ever an accelerant.
   */
  onDown: () => void;
  /** The page this editor is viewing at connect time, seeded into presence. */
  pageId?: string;
}

/**
 * Open the workspace push socket (Packet S1). It is a pure accelerant over the
 * existing manifest polling: a `notice` should trigger an immediate cheap
 * refresh, and any failure — a throw constructing the socket, an `error`, a
 * `close`, or a server that lacks the route — routes to `onDown` so the caller
 * degrades to exactly today's polling behavior. Never carries document content.
 */
export function openWorkspaceSocket(
  id: string,
  options: WorkspaceSocketOptions,
): WorkspaceSocketHandle {
  let socket: WebSocket | null = null;
  // Guards double-firing `onDown` and suppresses it after an intentional close.
  let settled = false;
  const down = (): void => {
    if (settled) return;
    settled = true;
    options.onDown();
  };
  try {
    const base = location.origin.replace(/^http/, 'ws');
    const params = options.pageId
      ? `?pageId=${encodeURIComponent(options.pageId)}`
      : '';
    socket = new WebSocket(
      `${base}/api/workspaces/${encodeURIComponent(id)}/socket${params}`,
    );
    socket.addEventListener('message', (event) => {
      let notice: unknown;
      try {
        notice = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (
        notice &&
        typeof notice === 'object' &&
        (notice as { type?: unknown }).type === 'notice'
      )
        options.onNotice(notice as WorkspaceNotice);
    });
    socket.addEventListener('error', () => down());
    socket.addEventListener('close', () => down());
  } catch {
    // WebSocket construction itself failed — degrade immediately.
    down();
  }
  return {
    sendPresence(pageId: string): void {
      try {
        if (socket && socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: 'presence', pageId }));
      } catch {
        // best-effort; a failed presence ping never breaks the editor
      }
    },
    close(): void {
      settled = true; // an intentional close must not trigger the poll-resume
      try {
        socket?.close();
      } catch {
        // already closing/closed
      }
    },
  };
}
