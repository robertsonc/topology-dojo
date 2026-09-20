/**
 * User-tied API keys for the hosted MCP endpoint (proposal 0005).
 *
 * A key is minted by a signed-in browser user and presented by an unattended
 * agent as `Authorization: Bearer tdk_…` on `/mcp`. The OAuth provider hands
 * unknown bearers to `resolveApiKeyToken` (its `resolveExternalToken` hook,
 * wired in `worker/index.ts`); a valid key resolves to the SAME `props` shape
 * an OAuth grant produces (`{ id, login, name }`) plus `auth: 'api_key'` and
 * the key's `scopes`, so every downstream identity decision — registry
 * addressing, rate limits, share ownership, the live-data allowlist — keys on
 * the GitHub uid exactly as before. Nothing else in the Worker learns a new
 * identity concept.
 *
 * Storage is `OAUTH_KV` under distinct prefixes (`apikey:<keyId>` records,
 * `apikeys:<uid>` per-owner index) — credential-class data, already isolated
 * per environment by scripts/check-wrangler-env.mjs, no new binding, no
 * migration. KV is eventually consistent: a revoked key can keep working for
 * up to ~60 s at other edge locations (documented in the user guide).
 *
 * Deliberately structural (no `cloudflare:workers` / ambient types) so the
 * pure half is unit-testable from `src/testing` against an in-memory KV, the
 * same way `worker/share.ts` is.
 */
import {
  MAX_API_KEYS_PER_USER,
  apiKeyIndexKey,
  apiKeyStorageKey,
  hashSecret,
  isApiKeyExpired,
  looksLikeApiKey,
  mintApiKey,
  normalizeExpiryDays,
  normalizeLabel,
  normalizeScopes,
  parseApiKey,
  timingSafeEqual,
  toPublic,
  type ApiKeyPublic,
  type ApiKeyRecord,
  type ApiKeyScope,
} from '../src/server/api-key.js';
import type { RateLimitSpec } from '../src/mcp/rate-limit.js';
import { snapshotClientIp } from '../src/mcp/rate-limit.js';
import {
  SESSION_COOKIE_NAME,
  parseCookies,
  sessionHmacSecret,
  verifySession,
  type SessionUser,
} from '../src/server/session.js';

/** The slice of `KVNamespace` this module needs (structural, test-friendly). */
export interface ApiKeyKv {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<unknown>;
}

/** The env slice: the KV namespace, the flag, and the session secrets. */
export interface ApiKeyEnv {
  OAUTH_KV: ApiKeyKv;
  API_KEYS_ENABLED?: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_HMAC_SECRET?: string;
}

/**
 * Opt-in like `profilesEnabled` / `liveDataEnabled`: only the literal
 * `"true"` enables. Off ⇒ every `tdk_` bearer is rejected (401), `/api/keys`
 * answers 503 `api_keys_disabled`, and `/keys` explains the surface is off.
 */
export function apiKeysEnabled(
  env: Pick<ApiKeyEnv, 'API_KEYS_ENABLED'>,
): boolean {
  return env.API_KEYS_ENABLED === 'true';
}

/**
 * Per-IP budget for FAILED key authentications (unknown keyId, wrong secret,
 * expired). Successful calls never count. Exhausted ⇒ the resolver answers
 * null (401) without touching the record, blunting online guessing. Fail-open
 * on KV errors: a limiter blip must not lock every agent out.
 */
export const API_KEY_AUTH_FAILURE_LIMIT: RateLimitSpec = {
  label: 'API key authentication failures',
  limit: 20,
  windowMs: 5 * 60_000,
};

/** `lastUsedAt` is written at most this often — one KV write per key per hour, not per request. */
export const LAST_USED_WRITE_INTERVAL_MS = 60 * 60_000;

/** KV records for keys with an expiry get a TTL too, so KV prunes them itself. */
const KV_TTL_GRACE_SEC = 60;
const KV_MIN_TTL_SEC = 60;

/** What `/mcp` sees as `this.props` for an API-key session. */
export interface ApiKeyPrincipal {
  id: number;
  login: string;
  name?: string;
  auth: 'api_key';
  keyId: string;
  scopes: ApiKeyScope[];
}

export type ApiKeyErrorCode =
  | 'invalid_label'
  | 'invalid_scopes'
  | 'invalid_expiry'
  | 'too_many_keys';

export class ApiKeyRequestError extends Error {
  constructor(
    readonly code: ApiKeyErrorCode,
    readonly status = 400,
  ) {
    super(code);
  }
}

function nowIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

function ttlFor(record: ApiKeyRecord, nowMs: number): number | undefined {
  if (!record.expiresAt) return undefined;
  const remaining = Math.ceil((Date.parse(record.expiresAt) - nowMs) / 1000);
  return Math.max(KV_MIN_TTL_SEC, remaining + KV_TTL_GRACE_SEC);
}

async function putRecord(
  kv: ApiKeyKv,
  record: ApiKeyRecord,
  nowMs: number,
): Promise<void> {
  const ttl = ttlFor(record, nowMs);
  await kv.put(
    apiKeyStorageKey(record.keyId),
    JSON.stringify(record),
    ttl === undefined ? undefined : { expirationTtl: ttl },
  );
}

function isRecord(value: unknown): value is ApiKeyRecord {
  const r = value as Partial<ApiKeyRecord> | null;
  return (
    !!r &&
    typeof r.keyId === 'string' &&
    typeof r.uid === 'string' &&
    typeof r.login === 'string' &&
    typeof r.secretHash === 'string' &&
    Array.isArray(r.scopes) &&
    typeof r.label === 'string' &&
    typeof r.createdAt === 'string'
  );
}

async function readRecord(
  kv: ApiKeyKv,
  keyId: string,
): Promise<ApiKeyRecord | null> {
  const raw = await kv.get(apiKeyStorageKey(keyId));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readIndex(kv: ApiKeyKv, uid: string): Promise<string[]> {
  const raw = await kv.get(apiKeyIndexKey(uid));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

async function writeIndex(
  kv: ApiKeyKv,
  uid: string,
  ids: string[],
): Promise<void> {
  if (ids.length) await kv.put(apiKeyIndexKey(uid), JSON.stringify(ids));
  else await kv.delete(apiKeyIndexKey(uid));
}

/**
 * The owner's live keys (expired ones are dropped and pruned from the index,
 * best-effort). Never returns the hash.
 */
export async function listApiKeys(
  kv: ApiKeyKv,
  uid: string,
  nowMs = Date.now(),
): Promise<ApiKeyPublic[]> {
  const ids = await readIndex(kv, uid);
  const live: ApiKeyRecord[] = [];
  for (const id of ids) {
    const record = await readRecord(kv, id);
    if (record && record.uid === uid && !isApiKeyExpired(record, nowMs))
      live.push(record);
  }
  if (live.length !== ids.length) {
    try {
      await writeIndex(
        kv,
        uid,
        live.map((r) => r.keyId),
      );
    } catch {
      // Pruning is a convenience; the listing above is already correct.
    }
  }
  return live.map(toPublic);
}

export interface CreateApiKeyInput {
  label?: unknown;
  scopes?: unknown;
  expiresInDays?: unknown;
}

/**
 * Mint + store a key for `user`. Throws `ApiKeyRequestError` on bad input or
 * when the per-user cap is reached. The returned `token` is the only time the
 * plaintext exists outside the caller's hands.
 */
export async function createApiKey(
  kv: ApiKeyKv,
  user: SessionUser,
  input: CreateApiKeyInput,
  nowMs = Date.now(),
): Promise<{ token: string; key: ApiKeyPublic }> {
  const label = normalizeLabel(input.label);
  if (!label) throw new ApiKeyRequestError('invalid_label');
  const scopes = normalizeScopes(input.scopes);
  if (!scopes) throw new ApiKeyRequestError('invalid_scopes');
  const days = normalizeExpiryDays(input.expiresInDays);
  if (days === undefined) throw new ApiKeyRequestError('invalid_expiry');

  const existing = await listApiKeys(kv, user.uid, nowMs);
  if (existing.length >= MAX_API_KEYS_PER_USER)
    throw new ApiKeyRequestError('too_many_keys', 409);

  const minted = await mintApiKey();
  const record: ApiKeyRecord = {
    keyId: minted.keyId,
    uid: user.uid,
    login: user.login,
    ...(user.name ? { name: user.name } : {}),
    secretHash: minted.secretHash,
    scopes,
    label,
    createdAt: nowIso(nowMs),
    ...(days ? { expiresAt: nowIso(nowMs + days * 24 * 60 * 60 * 1000) } : {}),
  };
  await putRecord(kv, record, nowMs);
  await writeIndex(kv, user.uid, [
    ...existing.map((k) => k.keyId),
    record.keyId,
  ]);
  return { token: minted.token, key: toPublic(record) };
}

/**
 * Owner-only revoke. A foreign or unknown keyId is `not_found` — the same
 * answer either way, so the endpoint never confirms another owner's keyId.
 */
export async function revokeApiKey(
  kv: ApiKeyKv,
  uid: string,
  keyId: string,
): Promise<'revoked' | 'not_found'> {
  const record = await readRecord(kv, keyId);
  if (!record || record.uid !== uid) return 'not_found';
  await kv.delete(apiKeyStorageKey(keyId));
  const ids = await readIndex(kv, uid);
  await writeIndex(
    kv,
    uid,
    ids.filter((id) => id !== keyId),
  );
  return 'revoked';
}

/**
 * Verify a bearer against storage. Null for anything not a live, matching
 * key. The hash compare is constant-time; `lastUsedAt` is refreshed at most
 * hourly and never blocks the result.
 */
export async function resolveApiKey(
  kv: ApiKeyKv,
  token: string,
  nowMs = Date.now(),
): Promise<ApiKeyPrincipal | null> {
  const parsed = parseApiKey(token);
  if (!parsed) return null;
  const record = await readRecord(kv, parsed.keyId);
  if (!record) return null;
  const hash = await hashSecret(parsed.secret);
  if (!timingSafeEqual(hash, record.secretHash)) return null;
  if (isApiKeyExpired(record, nowMs)) return null;
  const id = Number(record.uid);
  if (!Number.isFinite(id)) return null;

  const last = record.lastUsedAt ? Date.parse(record.lastUsedAt) : NaN;
  if (!Number.isFinite(last) || nowMs - last >= LAST_USED_WRITE_INTERVAL_MS) {
    try {
      await putRecord(kv, { ...record, lastUsedAt: nowIso(nowMs) }, nowMs);
    } catch {
      // Best-effort telemetry; authentication already succeeded.
    }
  }
  return {
    id,
    login: record.login,
    ...(record.name ? { name: record.name } : {}),
    auth: 'api_key',
    keyId: record.keyId,
    scopes: [...record.scopes],
  };
}

function failureKey(ip: string, nowMs: number): string {
  const windowId = Math.floor(nowMs / API_KEY_AUTH_FAILURE_LIMIT.windowMs);
  return `rl:apikeyfail:${ip}:${windowId}`;
}

async function failuresExhausted(
  kv: ApiKeyKv,
  ip: string,
  nowMs: number,
): Promise<boolean> {
  try {
    const raw = await kv.get(failureKey(ip, nowMs));
    return raw !== null && Number(raw) >= API_KEY_AUTH_FAILURE_LIMIT.limit;
  } catch {
    return false;
  }
}

async function recordFailure(
  kv: ApiKeyKv,
  ip: string,
  nowMs: number,
): Promise<void> {
  try {
    const key = failureKey(ip, nowMs);
    const raw = await kv.get(key);
    const current = raw === null ? 0 : Math.max(0, Math.trunc(Number(raw)));
    await kv.put(key, String(current + 1), {
      expirationTtl: Math.ceil(API_KEY_AUTH_FAILURE_LIMIT.windowMs / 1000) + 1,
    });
  } catch {
    // Fail open — see API_KEY_AUTH_FAILURE_LIMIT.
  }
}

/**
 * The OAuth provider's `resolveExternalToken` hook. Cheap on garbage (prefix
 * check before any I/O), fail-closed on the flag and on lookup errors, and
 * budgeted per client IP on failures.
 */
export async function resolveApiKeyToken(input: {
  token: string;
  request: Request;
  env: ApiKeyEnv;
}): Promise<{ props: ApiKeyPrincipal } | null> {
  const { token, request, env } = input;
  if (!apiKeysEnabled(env)) return null;
  if (!looksLikeApiKey(token)) return null;
  const nowMs = Date.now();
  const ip = snapshotClientIp(request);
  if (ip && (await failuresExhausted(env.OAUTH_KV, ip, nowMs))) return null;
  let principal: ApiKeyPrincipal | null = null;
  try {
    principal = await resolveApiKey(env.OAUTH_KV, token, nowMs);
  } catch (err) {
    console.error('api key resolve failed', err);
    principal = null;
  }
  if (!principal) {
    if (ip) await recordFailure(env.OAUTH_KV, ip, nowMs);
    return null;
  }
  return { props: principal };
}

/** The API-key principal behind `props`, or undefined for an OAuth session. */
export function apiKeyPrincipal(props: unknown): ApiKeyPrincipal | undefined {
  const p = props as Partial<ApiKeyPrincipal> | null | undefined;
  if (!p || p.auth !== 'api_key') return undefined;
  if (typeof p.id !== 'number' || typeof p.login !== 'string') return undefined;
  return {
    id: p.id,
    login: p.login,
    ...(p.name ? { name: p.name } : {}),
    auth: 'api_key',
    keyId: typeof p.keyId === 'string' ? p.keyId : '',
    scopes: Array.isArray(p.scopes) ? (p.scopes as ApiKeyScope[]) : [],
  };
}

/**
 * Whether the session behind `props` may use a scoped tool group. An OAuth
 * session (no `auth` marker) keeps the full grant it always had; an API-key
 * session gets exactly its scopes. Consulted once at tool registration in
 * `worker/mcp.ts`, so an unscoped group is absent from `tools/list` rather
 * than present-but-refusing.
 */
export function principalAllows(props: unknown, scope: ApiKeyScope): boolean {
  const marker = (props as { auth?: unknown } | null | undefined)?.auth;
  if (marker !== 'api_key') return true;
  // Marked as a key session but malformed (no id/login/scopes): fail closed.
  const principal = apiKeyPrincipal(props);
  return principal !== undefined && principal.scopes.includes(scope);
}

/* ── HTTP: /api/keys (browser session only — never mintable over MCP) ───── */

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** The signed-in browser user, verified from the session cookie. */
export async function sessionUser(
  request: Request,
  env: Pick<ApiKeyEnv, 'GITHUB_CLIENT_SECRET' | 'SESSION_HMAC_SECRET'>,
): Promise<SessionUser | null> {
  const token = parseCookies(request.headers.get('cookie'))[
    SESSION_COOKIE_NAME
  ];
  return verifySession(token, sessionHmacSecret(env));
}

export const API_KEYS_DISABLED_BODY = JSON.stringify({
  error: 'api_keys_disabled',
});

/** Stable 503 for the `API_KEYS_ENABLED` gate, mirroring `workspace_disabled`. */
export function apiKeysDisabledResponse(): Response {
  return new Response(API_KEYS_DISABLED_BODY, {
    status: 503,
    headers: JSON_HEADERS,
  });
}

/**
 * GET    /api/keys           → { keys: ApiKeyPublic[] }
 * POST   /api/keys           → 201 { token, key }   (token shown once)
 * DELETE /api/keys/:keyId    → { revoked: true } | 404 { error: "not_found" }
 *
 * Cookie-authenticated only. Keys cannot mint or revoke keys: an agent holding
 * a key must never be able to grant itself persistence.
 */
export async function handleApiKeysApi(
  request: Request,
  env: ApiKeyEnv,
): Promise<Response> {
  if (!apiKeysEnabled(env)) return apiKeysDisabledResponse();
  const user = await sessionUser(request, env);
  if (!user) return json({ error: 'authentication required' }, 401);

  const url = new URL(request.url);
  const rest = url.pathname.slice('/api/keys'.length).replace(/^\//, '');

  if (request.method === 'GET' && !rest) {
    return json({ keys: await listApiKeys(env.OAUTH_KV, user.uid) });
  }
  if (request.method === 'POST' && !rest) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid JSON body' }, 400);
    }
    const input = (body ?? {}) as CreateApiKeyInput;
    try {
      const created = await createApiKey(env.OAUTH_KV, user, input);
      return json(created, 201);
    } catch (err) {
      if (err instanceof ApiKeyRequestError)
        return json({ error: err.code }, err.status);
      throw err;
    }
  }
  if (request.method === 'DELETE' && rest && !rest.includes('/')) {
    const result = await revokeApiKey(env.OAUTH_KV, user.uid, rest);
    return result === 'revoked'
      ? json({ revoked: true })
      : json({ error: 'not_found' }, 404);
  }
  return json({ error: 'method not allowed' }, 405);
}
