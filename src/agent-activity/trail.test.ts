/**
 * Pure session-activity correctness: ring-buffer append/evict, index upsert
 * (first-seen vs returning), stable dashboard ordering, and the honest
 * (non-causal) guidance-consulted signal. Deterministic — `at` is a fixed
 * ISO string — so the DO shells have real local coverage independent of
 * the workerd-only harness. Mirrors `src/admin/roster.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { GUIDANCE_TOOL_NAME, type SessionSummary } from './model.js';
import {
  MAX_SESSION_INDEX,
  MAX_TRAIL_EVENTS,
  appendTrail,
  guidanceConsultedBefore,
  sortSessions,
  upsertSessionIndex,
} from './trail.js';
import type { ToolCallEvent } from './model.js';

function event(
  over: Partial<ToolCallEvent> & Pick<ToolCallEvent, 'toolName'>,
): ToolCallEvent {
  return {
    at: 't0',
    outcome: 'success',
    ...over,
  };
}

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: 's1',
    ownerId: 'u1',
    ownerLogin: 'alice',
    startedAt: '2026-08-19T09:00:00.000Z',
    toolCallCount: 0,
    ...over,
  };
}

describe('appendTrail', () => {
  it('appends newest-last', () => {
    const a = event({ toolName: 'list_templates', at: 't0' });
    const b = event({ toolName: 'validate_topology', at: 't1' });
    expect(appendTrail([a], b)).toEqual([a, b]);
  });

  it('evicts the oldest once over the cap', () => {
    const seed: ToolCallEvent[] = Array.from(
      { length: MAX_TRAIL_EVENTS },
      (_, i) => event({ toolName: `t${i}`, at: `t${i}` }),
    );
    const next = appendTrail(
      seed,
      event({ toolName: 'newest', at: 'tN', outcome: 'error' }),
    );
    expect(next).toHaveLength(MAX_TRAIL_EVENTS);
    expect(next.at(-1)!.toolName).toBe('newest');
    expect(next.at(-1)!.outcome).toBe('error');
    expect(next[0]!.toolName).toBe('t1'); // t0 evicted
  });
});

describe('upsertSessionIndex', () => {
  it('creates a first-seen row', () => {
    const row = session({ toolCallCount: 0 });
    expect(upsertSessionIndex([], row)).toEqual([row]);
  });

  it('updates a returning session: keeps startedAt, refreshes count/last, moves newest-last', () => {
    const first = session({
      sessionId: 's1',
      startedAt: '2026-08-19T09:00:00.000Z',
      toolCallCount: 1,
    });
    const other = session({
      sessionId: 's2',
      startedAt: '2026-08-19T10:00:00.000Z',
      toolCallCount: 3,
    });
    const next = upsertSessionIndex([first, other], {
      sessionId: 's1',
      ownerId: 'u1',
      ownerLogin: 'alice-renamed',
      startedAt: '2026-08-19T12:00:00.000Z',
      lastToolAt: '2026-08-19T12:00:00.000Z',
      toolCallCount: 4,
    });
    expect(next.map((s) => s.sessionId)).toEqual(['s2', 's1']);
    const updated = next.at(-1)!;
    expect(updated.startedAt).toBe('2026-08-19T09:00:00.000Z');
    expect(updated.lastToolAt).toBe('2026-08-19T12:00:00.000Z');
    expect(updated.ownerLogin).toBe('alice-renamed');
    expect(updated.toolCallCount).toBe(4);
  });

  it('never erases a known ownerLogin on a later nameless upsert', () => {
    const named = upsertSessionIndex([], session({ ownerLogin: 'alice' }));
    const next = upsertSessionIndex(named, {
      sessionId: 's1',
      ownerId: 'u1',
      startedAt: 't1',
      toolCallCount: 2,
    });
    expect(next[0]!.ownerLogin).toBe('alice');
  });

  it('evicts the oldest once over the cap', () => {
    const seed: SessionSummary[] = Array.from(
      { length: MAX_SESSION_INDEX },
      (_, i) =>
        session({
          sessionId: `s${i}`,
          startedAt: `t${i}`,
          toolCallCount: 1,
        }),
    );
    const next = upsertSessionIndex(
      seed,
      session({ sessionId: 'new', startedAt: 'tN', toolCallCount: 1 }),
    );
    expect(next).toHaveLength(MAX_SESSION_INDEX);
    expect(next.at(-1)!.sessionId).toBe('new');
    expect(next[0]!.sessionId).toBe('s1'); // s0 evicted
  });
});

describe('sortSessions', () => {
  it('orders most-recently-active first, then startedAt, then sessionId', () => {
    const ordered = sortSessions([
      session({
        sessionId: 'a',
        lastToolAt: '2026-08-01T00:00:00Z',
        startedAt: '2026-07-01T00:00:00Z',
      }),
      session({
        sessionId: 'c',
        lastToolAt: '2026-08-09T00:00:00Z',
        startedAt: '2026-07-01T00:00:00Z',
      }),
      session({
        sessionId: 'b',
        startedAt: '2026-08-05T00:00:00Z',
      }),
    ]);
    expect(ordered.map((s) => s.sessionId)).toEqual(['c', 'b', 'a']);
  });
});

describe('guidanceConsultedBefore', () => {
  it('is true only when get_authoring_guidance succeeded earlier', () => {
    const trail = [
      event({ toolName: 'list_templates', at: 't0' }),
      event({
        toolName: GUIDANCE_TOOL_NAME,
        at: 't1',
        outcome: 'success',
      }),
      event({ toolName: 'apply_workspace_changes', at: 't2' }),
    ];
    expect(guidanceConsultedBefore(trail)).toBe(true);
    expect(guidanceConsultedBefore(trail, 't1')).toBe(true);
    expect(guidanceConsultedBefore(trail, 't0')).toBe(false);
  });

  it('does not treat an erroring guidance call as consulted', () => {
    expect(
      guidanceConsultedBefore([
        event({
          toolName: GUIDANCE_TOOL_NAME,
          at: 't1',
          outcome: 'error',
        }),
      ]),
    ).toBe(false);
  });

  it('is false on an empty trail', () => {
    expect(guidanceConsultedBefore([])).toBe(false);
  });
});
