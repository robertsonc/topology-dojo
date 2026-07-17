/**
 * Pure roster/login-log correctness for the admin analytics store (MVP):
 * upsert (first-seen vs returning), bounded recent-log eviction, and stable
 * dashboard ordering. Deterministic — `at` is a fixed ISO string — so the DO's
 * `recordLogin` shell has real local coverage independent of the workerd-only
 * harness.
 */
import { describe, expect, it } from 'vitest';
import type { LoginEvent, RosterEntry } from './model.js';
import {
  MAX_RECENT_LOGINS,
  appendRecent,
  sortRoster,
  upsertRoster,
} from './roster.js';

describe('upsertRoster', () => {
  it('creates a first-seen entry with count 1 and equal first/last timestamps', () => {
    const entry = upsertRoster(undefined, {
      uid: 'u1',
      login: 'alice',
      name: 'Alice',
      at: '2026-07-17T09:00:00.000Z',
    });
    expect(entry).toEqual({
      uid: 'u1',
      login: 'alice',
      name: 'Alice',
      firstSeenAt: '2026-07-17T09:00:00.000Z',
      lastLoginAt: '2026-07-17T09:00:00.000Z',
      loginCount: 1,
    });
  });

  it('omits name when the account exposes none', () => {
    const entry = upsertRoster(undefined, {
      uid: 'u1',
      login: 'alice',
      at: '2026-07-17T09:00:00.000Z',
    });
    expect('name' in entry).toBe(false);
  });

  it('bumps a returning user: keeps firstSeenAt, refreshes login/last, +1 count', () => {
    const first = upsertRoster(undefined, {
      uid: 'u1',
      login: 'alice',
      at: '2026-07-17T09:00:00.000Z',
    });
    const next = upsertRoster(first, {
      uid: 'u1',
      login: 'alice-renamed',
      name: 'Alice',
      at: '2026-07-17T12:00:00.000Z',
    });
    expect(next.firstSeenAt).toBe('2026-07-17T09:00:00.000Z');
    expect(next.lastLoginAt).toBe('2026-07-17T12:00:00.000Z');
    expect(next.login).toBe('alice-renamed');
    expect(next.name).toBe('Alice');
    expect(next.loginCount).toBe(2);
  });

  it('never erases a known name on a later nameless login', () => {
    const named = upsertRoster(undefined, {
      uid: 'u1',
      login: 'alice',
      name: 'Alice',
      at: 't0',
    });
    const next = upsertRoster(named, { uid: 'u1', login: 'alice', at: 't1' });
    expect(next.name).toBe('Alice');
  });
});

describe('appendRecent', () => {
  it('appends newest-last', () => {
    const a: LoginEvent = { uid: 'u1', login: 'a', at: 't0' };
    const b: LoginEvent = { uid: 'u2', login: 'b', at: 't1' };
    expect(appendRecent([a], b)).toEqual([a, b]);
  });

  it('evicts the oldest once over the cap', () => {
    const seed: LoginEvent[] = Array.from(
      { length: MAX_RECENT_LOGINS },
      (_, i) => ({
        uid: `u${i}`,
        login: `l${i}`,
        at: `t${i}`,
      }),
    );
    const next = appendRecent(seed, { uid: 'new', login: 'new', at: 'tN' });
    expect(next).toHaveLength(MAX_RECENT_LOGINS);
    expect(next.at(-1)!.uid).toBe('new');
    expect(next[0]!.uid).toBe('u1'); // u0 evicted
  });
});

describe('sortRoster', () => {
  it('orders most-recently-active first, then login, then uid', () => {
    const mk = (over: Partial<RosterEntry>): RosterEntry => ({
      uid: 'u',
      login: 'l',
      firstSeenAt: 't',
      lastLoginAt: 't',
      loginCount: 1,
      ...over,
    });
    const ordered = sortRoster([
      mk({ uid: 'a', login: 'alice', lastLoginAt: '2026-07-01T00:00:00Z' }),
      mk({ uid: 'c', login: 'carol', lastLoginAt: '2026-07-09T00:00:00Z' }),
      mk({ uid: 'b', login: 'bob', lastLoginAt: '2026-07-05T00:00:00Z' }),
    ]);
    expect(ordered.map((e) => e.login)).toEqual(['carol', 'bob', 'alice']);
  });
});
