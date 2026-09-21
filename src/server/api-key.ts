/**
 * API key primitives — pure and runtime-free (Web Crypto only), shared by the
 * Worker (mint / verify) and the Node test suite (Node 22 exposes the same
 * `crypto` globals). Nothing here touches KV, cookies, or the OAuth provider;
 * `worker/api-keys.ts` layers storage and HTTP on top.
 *
 * Format: `tdk_<keyId>_<secret>`
 *   - `tdk_`   fixed prefix, so a key is recognizable in a secret scan, a
 *              `git grep`, or a client's contract test, and so the OAuth
 *              provider's own `<userId>:<grantId>:<secret>` tokens can never be
 *              mistaken for one (see `resolveExternalToken` in worker/index.ts).
 *   - keyId    20 lowercase alphanumerics (~103 bits) — the public, loggable
 *              handle used for storage, listing, and revocation. Not secret,
 *              but wide enough that two owners can never mint the same id:
 *              records are keyed globally as `apikey:<keyId>` in shared KV
 *              while uniqueness is only reserved inside each owner's registry
 *              DO, so the id itself must make a cross-owner collision
 *              impossible in practice.
 *   - secret   32 random bytes, base64url (43 chars). Only its SHA-256 is ever
 *              stored; the plaintext token is shown exactly once at mint time.
 *
 * Proposal 0005 (docs/proposals/0005-api-key-auth.md).
 */

export const API_KEY_PREFIX = 'tdk_';
export const KEY_ID_LENGTH = 20;
const KEY_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SECRET_BYTES = 32;
const API_KEY_RE = /^tdk_([a-z0-9]{20})_([A-Za-z0-9_-]{43})$/;

/**
 * Scopes a key may carry. `author` is implicit on every key (private-draft
 * authoring, validation, layout, render, guidance). The other three each
 * unlock one conditionally-registered tool group in `worker/mcp.ts`; a key
 * without `share` never even sees `share_topology` in `tools/list`.
 */
export const API_KEY_SCOPES = [
  'author',
  'share',
  'workspace',
  'live-data',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Hard cap per user — keys are per-agent credentials, not per-request. */
export const MAX_API_KEYS_PER_USER = 10;
/**
 * A slot reserved in the owner's index but never confirmed (the record write
 * failed AND the release failed) is dropped by the index after this long, so
 * no failure sequence can strand a slot forever (worker/registry.ts).
 */
export const API_KEY_PENDING_TTL_MS = 2 * 60_000;
export const MAX_API_KEY_LABEL = 64;
/** Expiry choices offered by the UI (days). `null` = no expiry (revocable). */
export const API_KEY_EXPIRY_DAYS = [30, 90, 365] as const;

/** The stored record. `secretHash` is hex SHA-256 of the secret half only. */
export interface ApiKeyRecord {
  keyId: string;
  /** GitHub numeric id as a string — the same tenancy key as OAuth sessions. */
  uid: string;
  login: string;
  name?: string;
  secretHash: string;
  scopes: ApiKeyScope[];
  label: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601; absent = never expires. */
  expiresAt?: string;
  /**
   * @deprecated Usage telemetry lives under `apiKeyUsageKey(keyId)` so the
   * authentication path never rewrites this record (a rewrite could race a
   * revoke and resurrect the credential). Tolerated on old records only.
   */
  lastUsedAt?: string;
}

/** What listings return — never the hash, never the owner identity. */
export interface ApiKeyPublic {
  keyId: string;
  /** `tdk_<keyId>_…` — enough to match against a client's config, no secret. */
  prefix: string;
  label: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
}

export function apiKeyPrefixForDisplay(keyId: string): string {
  return `${API_KEY_PREFIX}${keyId}_…`;
}

export function toPublic(
  record: ApiKeyRecord,
  lastUsedAt?: string,
): ApiKeyPublic {
  const used = lastUsedAt ?? record.lastUsedAt;
  return {
    keyId: record.keyId,
    prefix: apiKeyPrefixForDisplay(record.keyId),
    label: record.label,
    scopes: [...record.scopes],
    createdAt: record.createdAt,
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
    ...(used ? { lastUsedAt: used } : {}),
  };
}

/** Cheap pre-check so garbage bearers never reach storage. */
export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}

/** Strict parse; anything not exactly `tdk_<20>_<43>` is rejected. */
export function parseApiKey(
  token: string,
): { keyId: string; secret: string } | null {
  const m = API_KEY_RE.exec(token);
  if (!m) return null;
  const keyId = m[1];
  const secret = m[2];
  if (!keyId || !secret) return null;
  return { keyId, secret };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Hex SHA-256 of the secret half. Random 256-bit secrets need no KDF. */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret),
  );
  return hex(new Uint8Array(digest));
}

/**
 * Constant-time string compare for two hex digests. Length mismatch returns
 * false without an early exit on content; both inputs are attacker-independent
 * fixed-length digests, so the length check itself leaks nothing useful.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Fill `bytes` with CSPRNG output; injectable for deterministic tests. */
export type RandomFill = (bytes: Uint8Array) => Uint8Array;
const defaultRandom: RandomFill = (bytes) => crypto.getRandomValues(bytes);

export interface MintedApiKey {
  /** The full `tdk_…` token — return it once, never store it. */
  token: string;
  keyId: string;
  secretHash: string;
}

/** Mint a fresh key. The keyId's modulo mapping is fine: it is an identifier, not a secret. */
export async function mintApiKey(
  random: RandomFill = defaultRandom,
): Promise<MintedApiKey> {
  const idBytes = random(new Uint8Array(KEY_ID_LENGTH));
  let keyId = '';
  for (const b of idBytes) keyId += KEY_ID_ALPHABET[b % KEY_ID_ALPHABET.length];
  const secret = base64Url(random(new Uint8Array(SECRET_BYTES)));
  const token = `${API_KEY_PREFIX}${keyId}_${secret}`;
  if (!parseApiKey(token)) throw new Error('minted key failed self-check');
  return { token, keyId, secretHash: await hashSecret(secret) };
}

/**
 * Validate a requested scope list. Unknown scopes reject the whole request
 * (never silently dropped — an operator who typo'd `shar` should find out).
 * `author` is always present; the result is de-duplicated and canonically
 * ordered so two keys with the same grant list identically.
 */
export function normalizeScopes(input: unknown): ApiKeyScope[] | null {
  const requested = input === undefined || input === null ? [] : input;
  if (!Array.isArray(requested)) return null;
  const set = new Set<ApiKeyScope>(['author']);
  for (const raw of requested) {
    if (typeof raw !== 'string') return null;
    const scope = raw.trim() as ApiKeyScope;
    if (!(API_KEY_SCOPES as readonly string[]).includes(scope)) return null;
    set.add(scope);
  }
  return API_KEY_SCOPES.filter((s) => set.has(s));
}

/** Validate a label: trimmed, non-empty, bounded, single line. */
export function normalizeLabel(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const label = input.trim().replace(/\s+/g, ' ');
  if (!label || label.length > MAX_API_KEY_LABEL) return null;
  return label;
}

/** Validate an expiry choice (days) — one of the offered values or null. */
export function normalizeExpiryDays(input: unknown): number | null | undefined {
  if (input === undefined || input === null || input === '') return null;
  const n = typeof input === 'number' ? input : Number(input);
  return (API_KEY_EXPIRY_DAYS as readonly number[]).includes(n) ? n : undefined;
}

export function isApiKeyExpired(record: ApiKeyRecord, nowMs: number): boolean {
  if (!record.expiresAt) return false;
  const t = Date.parse(record.expiresAt);
  return Number.isFinite(t) && t <= nowMs;
}

/** KV key for one record. Isolated from the OAuth provider's own prefixes. */
export function apiKeyStorageKey(keyId: string): string {
  return `apikey:${keyId}`;
}

/** KV key for one owner's list of keyIds. */
/**
 * Usage telemetry (`lastUsedAt`) for one key — a separate KV key so a
 * successful authentication is read-only with respect to the credential
 * record itself.
 */
export function apiKeyUsageKey(keyId: string): string {
  return `apikeyuse:${keyId}`;
}
