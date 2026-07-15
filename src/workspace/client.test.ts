import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listWorkspaces,
  openWorkspaceSocket,
  WorkspaceDisabledError,
} from './client.js';
import type { WorkspaceNotice } from './model.js';

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

/**
 * `openWorkspaceSocket` is a pure accelerant: a working socket forwards notices
 * and presence, while *any* failure (construction throw, error/close event, a
 * server that lacks the route) must route to `onDown` so the caller keeps
 * polling. These tests stub the `WebSocket`/`location` globals absent from the
 * Node test environment; a real socket is never exercised here (see the DO
 * Miniflare suite `document-socket.test.ts` for the wire-level behavior).
 */
describe('workspace client — openWorkspaceSocket fallback', () => {
  type Listener = (event: unknown) => void;

  class FakeWebSocket {
    static readonly OPEN = 1;
    static instances: FakeWebSocket[] = [];
    readyState = FakeWebSocket.OPEN;
    sent: string[] = [];
    closed = false;
    private listeners = new Map<string, Listener[]>();
    constructor(readonly url: string) {
      FakeWebSocket.instances.push(this);
    }
    addEventListener(type: string, cb: Listener): void {
      const list = this.listeners.get(type) ?? [];
      list.push(cb);
      this.listeners.set(type, list);
    }
    send(data: string): void {
      this.sent.push(data);
    }
    close(): void {
      this.closed = true;
      this.emit('close', {});
    }
    emit(type: string, event: unknown): void {
      for (const cb of this.listeners.get(type) ?? []) cb(event);
    }
  }

  const g = globalThis as unknown as {
    WebSocket?: unknown;
    location?: unknown;
  };
  const originalWebSocket = g.WebSocket;
  const originalLocation = g.location;

  afterEach(() => {
    g.WebSocket = originalWebSocket;
    g.location = originalLocation;
    FakeWebSocket.instances = [];
  });

  function install(): void {
    g.WebSocket = FakeWebSocket;
    g.location = { origin: 'https://studio.test' };
  }

  it('opens a ws:// URL, forwards notices, and sends presence', () => {
    install();
    const notices: WorkspaceNotice[] = [];
    let downCount = 0;
    const handle = openWorkspaceSocket('w_1', {
      onNotice: (notice) => notices.push(notice),
      onDown: () => downCount++,
      pageId: 'p1',
    });
    const socket = FakeWebSocket.instances[0]!;
    expect(socket.url).toBe(
      'wss://studio.test/api/workspaces/w_1/socket?pageId=p1',
    );

    const notice: WorkspaceNotice = {
      type: 'notice',
      revision: 3,
      proposalCount: 1,
      lease: null,
      presence: [{ kind: 'user', label: 'alice', pageId: 'p1' }],
    };
    socket.emit('message', { data: JSON.stringify(notice) });
    // A non-notice frame is ignored; malformed JSON never throws.
    socket.emit('message', { data: JSON.stringify({ type: 'other' }) });
    socket.emit('message', { data: '{not json' });
    expect(notices).toEqual([notice]);

    handle.sendPresence('p2');
    expect(socket.sent).toEqual([
      JSON.stringify({ type: 'presence', pageId: 'p2' }),
    ]);
    expect(downCount).toBe(0);
  });

  it('routes an error event to onDown exactly once', () => {
    install();
    let downCount = 0;
    openWorkspaceSocket('w_1', {
      onNotice: () => undefined,
      onDown: () => downCount++,
    });
    const socket = FakeWebSocket.instances[0]!;
    socket.emit('error', {});
    socket.emit('close', {}); // a following close must not double-fire onDown
    expect(downCount).toBe(1);
  });

  it('falls back to onDown when WebSocket construction throws', () => {
    g.WebSocket = undefined; // no global ⇒ `new WebSocket()` throws
    g.location = { origin: 'https://studio.test' };
    let downCount = 0;
    const handle = openWorkspaceSocket('w_1', {
      onNotice: () => undefined,
      onDown: () => downCount++,
    });
    expect(downCount).toBe(1);
    // sendPresence on a dead handle is a safe no-op.
    expect(() => handle.sendPresence('p1')).not.toThrow();
  });

  it('does not fire onDown for an intentional close()', () => {
    install();
    let downCount = 0;
    const handle = openWorkspaceSocket('w_1', {
      onNotice: () => undefined,
      onDown: () => downCount++,
    });
    handle.close();
    expect(FakeWebSocket.instances[0]!.closed).toBe(true);
    expect(downCount).toBe(0);
  });
});
