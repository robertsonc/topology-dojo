/**
 * Stateless signed session cookies for the web login (worker/auth).
 *
 * A session is a base64url JSON payload + an HMAC-SHA256 signature over it,
 * keyed by a server secret — so the cookie is tamper-evident without any
 * server-side store. WebCrypto only (runs in the Worker and in Node tests).
 * The MCP OAuth flow is unrelated and unaffected; this is purely for gating the
 * browser app.
 */
export interface SessionUser {
  /** GitHub numeric id (as a string). */
  uid: string;
  /** GitHub login handle. */
  login: string;
  /** GitHub display name, if any. */
  name?: string;
}

interface SessionPayload extends SessionUser {
  /** Expiry, unix seconds. */
  exp: number;
}

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(input: string): Uint8Array {
  let s = input.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Default session lifetime: 7 days. */
export const SESSION_TTL_SEC = 7 * 24 * 3600;

/**
 * HMAC key for browser session cookies.
 *
 * Prefer `SESSION_HMAC_SECRET` when set so rotating the GitHub OAuth client
 * secret does not invalidate every signed-in browser. Fall back to
 * `GITHUB_CLIENT_SECRET` only when the dedicated secret is unset (or
 * whitespace) — a migration path, not a required cutover.
 */
export function sessionHmacSecret(env: {
  SESSION_HMAC_SECRET?: string;
  GITHUB_CLIENT_SECRET: string;
}): string {
  const dedicated = env.SESSION_HMAC_SECRET?.trim();
  return dedicated ? dedicated : env.GITHUB_CLIENT_SECRET;
}

/** Sign a session token for a user (body.signature, both base64url). */
export async function signSession(
  user: SessionUser,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  ttlSec: number = SESSION_TTL_SEC,
): Promise<string> {
  const payload: SessionPayload = {
    uid: user.uid,
    login: user.login,
    ...(user.name ? { name: user.name } : {}),
    exp: nowSec + ttlSec,
  };
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(body)),
  );
  return `${body}.${b64urlEncode(sig)}`;
}

/** Verify + decode a session token; null if tampered, malformed, or expired. */
export async function verifySession(
  token: string | undefined | null,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<SessionUser | null> {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const key = await hmacKey(secret);
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sig) as BufferSource,
      enc.encode(body),
    );
  } catch {
    return null;
  }
  if (!ok) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(b64urlDecode(body)),
    ) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < nowSec) return null;
  if (!payload.uid || !payload.login) return null;
  return { uid: payload.uid, login: payload.login, name: payload.name };
}

/** Parse a Cookie header into a name→value map (values URI-decoded). */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
