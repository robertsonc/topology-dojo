import { describe, it, expect } from 'vitest';
import {
  parseCookies,
  signSession,
  verifySession,
  SESSION_TTL_SEC,
} from './session.js';

const SECRET = 'test-signing-secret';
const USER = { uid: '42', login: 'octocat', name: 'The Octocat' };

describe('session cookies', () => {
  it('round-trips a signed session', async () => {
    const token = await signSession(USER, SECRET);
    const back = await verifySession(token, SECRET);
    expect(back).toEqual(USER);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession(USER, SECRET);
    expect(await verifySession(token, 'other-secret')).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signSession(USER, SECRET);
    const [body, sig] = token.split('.');
    // Flip a character in the body; the signature no longer matches.
    const forged = `${body!.slice(0, -1)}${body!.slice(-1) === 'A' ? 'B' : 'A'}.${sig}`;
    expect(await verifySession(forged, SECRET)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const now = 1_000_000;
    const token = await signSession(USER, SECRET, now, 100);
    // 101s later → past the 100s ttl.
    expect(await verifySession(token, SECRET, now + 101)).toBeNull();
    expect(await verifySession(token, SECRET, now + 50)).toEqual(USER);
  });

  it('rejects malformed / empty tokens', async () => {
    expect(await verifySession('', SECRET)).toBeNull();
    expect(await verifySession(undefined, SECRET)).toBeNull();
    expect(await verifySession('nodot', SECRET)).toBeNull();
    expect(await verifySession('a.b.c.d', SECRET)).toBeNull();
  });

  it('defaults to a 7-day lifetime', () => {
    expect(SESSION_TTL_SEC).toBe(604800);
  });

  it('parses a Cookie header into name→value', () => {
    expect(parseCookies('a=1; tdg_session=xyz%2Fz; b=two')).toEqual({
      a: '1',
      tdg_session: 'xyz/z',
      b: 'two',
    });
    expect(parseCookies(null)).toEqual({});
  });
});
