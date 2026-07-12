import { afterEach, describe, expect, it, vi } from 'vitest';
import { listWorkspaces, WorkspaceDisabledError } from './client.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('workspace client — 503 workspace_disabled handling', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws a WorkspaceDisabledError with a user-facing message for a 503 workspace_disabled body', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'workspace_disabled' }, 503),
    ) as typeof fetch;

    const err = await listWorkspaces().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkspaceDisabledError);
    expect((err as Error).message).toBe(
      'Workspaces are not enabled on this deployment.',
    );
  });

  it('still throws a plain Error for an unrelated 5xx body', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'boom' }, 500),
    ) as typeof fetch;

    const err = await listWorkspaces().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(WorkspaceDisabledError);
    expect((err as Error).message).toBe('boom');
  });

  it('does not misclassify an unrelated 503 as workspace-disabled', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: 'overloaded' }, 503),
    ) as typeof fetch;

    const err = await listWorkspaces().catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(WorkspaceDisabledError);
    expect((err as Error).message).toBe('overloaded');
  });
});
