import { describe, it, expect } from 'vitest';
import { bearerToken, isAuthorized } from './auth.js';

const req = (auth?: string): Request =>
  new Request(
    'https://x/mcp',
    auth ? { headers: { authorization: auth } } : {},
  );

describe('mcp auth', () => {
  it('extracts a bearer token (case-insensitive scheme)', () => {
    expect(bearerToken(req('Bearer abc123'))).toBe('abc123');
    expect(bearerToken(req('bearer  spaced '))).toBe('spaced');
    expect(bearerToken(req('Basic abc'))).toBeNull();
    expect(bearerToken(req())).toBeNull();
  });

  it('authorizes only the exact configured secret', () => {
    expect(isAuthorized(req('Bearer s3cret'), 's3cret')).toBe(true);
    expect(isAuthorized(req('Bearer wrong'), 's3cret')).toBe(false);
    expect(isAuthorized(req('Bearer s3cre'), 's3cret')).toBe(false); // length differs
  });

  it('fails closed when no secret is configured', () => {
    expect(isAuthorized(req('Bearer anything'), undefined)).toBe(false);
    expect(isAuthorized(req('Bearer anything'), '')).toBe(false);
  });

  it('rejects requests with no/!bearer authorization', () => {
    expect(isAuthorized(req(), 's3cret')).toBe(false);
    expect(isAuthorized(req('Basic s3cret'), 's3cret')).toBe(false);
  });
});
