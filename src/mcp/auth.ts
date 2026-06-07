/**
 * Bearer-token auth for the remote (Cloudflare) MCP server.
 *
 * A single shared secret model: the client sends `Authorization: Bearer <key>`
 * and we compare it against the configured secret in (length-aware) constant
 * time. Runtime-neutral (uses only the Fetch `Request` + plain JS), so it runs
 * in the Worker and is unit-testable under Node.
 */

/** Constant-time string comparison (avoids leaking length-prefix timing). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Extract the bearer token from an Authorization header, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]!.trim() : null;
}

/**
 * True iff the request carries the correct bearer secret. Fails closed: if no
 * secret is configured, every request is rejected (so a misconfigured deploy is
 * never wide open).
 */
export function isAuthorized(
  request: Request,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  const token = bearerToken(request);
  return token !== null && safeEqual(token, secret);
}
