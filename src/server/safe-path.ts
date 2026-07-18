/**
 * `safePath` — the guard on the browser login's post-sign-in redirect target
 * (`?go=`). Lives here (framework-free, alongside `session.ts`) so both the
 * Worker (`worker/auth.ts`) and unit tests import the same implementation
 * without pulling the Worker's Durable Object types into the browser build.
 */

/**
 * Reduce an untrusted redirect target to a safe, same-origin path. Resolves `p`
 * against a fixed sentinel origin with WHATWG URL parsing — the exact
 * normalization the browser applies — so any value that escapes off-origin
 * resolves to a foreign origin and is rejected to `/`: an absolute URL, a
 * protocol-relative `//host`, a backslash `/\host` (browsers read `\` as `/`),
 * or embedded control chars/whitespace the parser strips. Only a genuinely
 * relative path keeps the sentinel origin and is returned (path + query + hash).
 * Closes finding M18 (open redirect via backslash bypass).
 */
export function safePath(p: string | null): string {
  if (!p) return '/';
  try {
    const u = new URL(p, 'https://redirect.invalid');
    if (u.origin !== 'https://redirect.invalid') return '/';
    return u.pathname + u.search + u.hash;
  } catch {
    return '/';
  }
}
