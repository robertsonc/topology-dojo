import { describe, it, expect } from 'vitest';
import {
  parseCookies,
  sessionHmacSecret,
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

  it('prefers SESSION_HMAC_SECRET over GITHUB_CLIENT_SECRET', () => {
    expect(
      sessionHmacSecret({
        SESSION_HMAC_SECRET: 'dedicated-session-key',
        GITHUB_CLIENT_SECRET: 'oauth-client-secret',
      }),
    ).toBe('dedicated-session-key');
  });

  it('falls back to GITHUB_CLIENT_SECRET when SESSION_HMAC_SECRET is unset', () => {
    expect(
      sessionHmacSecret({ GITHUB_CLIENT_SECRET: 'oauth-client-secret' }),
    ).toBe('oauth-client-secret');
  });

  it('falls back when SESSION_HMAC_SECRET is empty or whitespace', () => {
    expect(
      sessionHmacSecret({
        SESSION_HMAC_SECRET: '',
        GITHUB_CLIENT_SECRET: 'oauth-client-secret',
      }),
    ).toBe('oauth-client-secret');
    expect(
      sessionHmacSecret({
        SESSION_HMAC_SECRET: '   ',
        GITHUB_CLIENT_SECRET: 'oauth-client-secret',
      }),
    ).toBe('oauth-client-secret');
  });

  it('signs and verifies with the resolved dedicated secret', async () => {
    const secret = sessionHmacSecret({
      SESSION_HMAC_SECRET: 'dedicated-session-key',
      GITHUB_CLIENT_SECRET: 'oauth-client-secret',
    });
    const token = await signSession(USER, secret);
    expect(await verifySession(token, secret)).toEqual(USER);
    expect(await verifySession(token, 'oauth-client-secret')).toBeNull();
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
