/**
 * Regression coverage for `safePath` (worker/auth.ts) — the sole guard on the
 * post-login `?go=` redirect target. Closes finding M18 (open redirect via a
 * backslash bypass: the old `startsWith('//')` check let `/\evil.com` through,
 * and browsers normalize `\` to `/`, so `Location: /\evil.com` resolved to
 * `https://evil.com/`). Pure function, so this runs locally (no workerd).
 */
import { describe, expect, it } from 'vitest';
import { safePath } from '../server/safe-path.js';

describe('safePath — same-origin redirect targets are preserved', () => {
  it('returns a genuine relative path verbatim, with query and hash', () => {
    expect(safePath('/')).toBe('/');
    expect(safePath('/dashboard')).toBe('/dashboard');
    expect(safePath('/v/abc123')).toBe('/v/abc123');
    expect(safePath('/v/abc?x=1&y=2')).toBe('/v/abc?x=1&y=2');
    expect(safePath('/board#section')).toBe('/board#section');
  });

  it('defaults empty / missing targets to /', () => {
    expect(safePath(null)).toBe('/');
    expect(safePath('')).toBe('/');
  });
});

describe('safePath — off-origin escapes are rejected to /', () => {
  it('rejects the M18 backslash bypass (browser reads \\ as /)', () => {
    // The exact payload from the finding: passed the old guard, escaped origin.
    expect(safePath('/\\evil.com')).toBe('/');
    expect(safePath('/\\\\evil.com')).toBe('/');
  });

  it('rejects protocol-relative and absolute URLs', () => {
    expect(safePath('//evil.com')).toBe('/');
    expect(safePath('https://evil.com')).toBe('/');
    expect(safePath('http://evil.com/path')).toBe('/');
  });

  it('rejects non-http(s) and mixed-tricks targets', () => {
    expect(safePath('javascript:alert(1)')).toBe('/');
    expect(safePath('\\/evil.com')).toBe('/');
    expect(safePath(' //evil.com')).toBe('/'); // leading space is stripped by the URL parser
  });

  it('keeps a backslash INSIDE the path same-origin (normalized, not an escape)', () => {
    // `/foo/\bar` normalizes to the same-origin path `/foo//bar` — a harmless
    // odd path, NOT an off-origin escape, so it is kept rather than rejected.
    expect(safePath('/foo/\\bar')).toBe('/foo//bar');
  });
});
