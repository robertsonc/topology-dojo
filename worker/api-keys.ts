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
 * Storage splits by consistency need:
 * - `OAUTH_KV` `apikey:<keyId>` — the credential record (hash, scopes, owner).
 *   Read on every authentication at the edge; **never written by the auth
 *   path** (a rewrite could race a revoke and resurrect the credential).
 * - `OAUTH_KV` `apikeyuse:<keyId>` — `lastUsedAt` telemetry, its own key,
 *   written at most hourly, best-effort.
 * - the owner's `TopologyRegistry` Durable Object (`user-id:<uid>`) — the
 *   per-owner index and the 10-key cap. A DO runs one request at a time, so
 *   create/revoke never lose an entry to a KV read-modify-write race and the
 *   cap is strict. Exposed to this module through the structural
 *   `ApiKeyIndex` so the pure half stays unit-testable.
 * Credential-class KV data is already isolated per environment by
 * scripts/check-wrangler-env.mjs; no new binding, no migration. KV is
 * eventually consistent: a revoked key can keep working for up to ~60 s at
 * other edge locations (documented in the user guide).
 *
 * Deliberately structural (no `cloudflare:workers` / ambient types) so the
 * pure half is unit-testable from `src/testing` against an in-memory KV, the
 * same way `worker/share.ts` is.
 */
import {
  MAX_API_KEYS_PER_USER,
  apiKeyStorageKey,
  apiKeyUsageKey,
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

/**
 * The owner's key index — the serialization point for create/revoke and the
 * cap. In the Worker this is the owner's `TopologyRegistry` DO
 * (`registryApiKeyIndex`); tests supply an in-memory one.
 */
export interface ApiKeyIndexEntry {
  keyId: string;
  createdAt: string;
  expiresAt?: string;
  /** True between `reserve` and `confirm`; a stale pending entry expires on its own. */
  pending: boolean;
}

export interface ApiKeyIndex {
  /**
   * Reserve a PENDING slot for `keyId`; false when the owner already holds
   * `max` live keys. Idempotent. A reservation that is never confirmed
   * expires on its own, so no failure sequence can strand a slot forever.
   */
  reserve(keyId: string, max: number, expiresAt?: string): Promise<boolean>;
  /** Make the slot durable once the KV record exists (re-creates it if pruned). */
  confirm(keyId: string, expiresAt?: string): Promise<void>;
  release(keyId: string): Promise<void>;
  /** Live entries (confirmed and still-pending), oldest first. Never consults KV. */
  entries(): Promise<ApiKeyIndexEntry[]>;
}

export type ApiKeyIndexFactory = (uid: string) => ApiKeyIndex;

/** The slice of the registry DO namespace/stub this module needs. */
export interface ApiKeyIndexStub {
  apiKeyReserve(
    keyId: string,
    max: number,
    expiresAt?: string,
  ): Promise<boolean>;
  apiKeyConfirm(keyId: string, expiresAt?: string): Promise<void>;
  apiKeyRelease(keyId: string): Promise<void>;
  apiKeyEntries(): Promise<ApiKeyIndexEntry[]>;
}
export interface ApiKeyIndexNamespace<Id = unknown> {
  idFromName(name: string): Id;
  get(id: Id): ApiKeyIndexStub;
}

/** The owner's registry DO as an `ApiKeyIndex` (same `user-id:<uid>` naming as drafts). */
export function registryApiKeyIndex<Id>(
  ns: ApiKeyIndexNamespace<Id>,
  uid: string,
): ApiKeyIndex {
  const stub = ns.get(ns.idFromName(`user-id:${uid}`));
  return {
    reserve: (keyId, max, expiresAt) =>
      stub.apiKeyReserve(keyId, max, expiresAt),
    confirm: (keyId, expiresAt) => stub.apiKeyConfirm(keyId, expiresAt),
    release: (keyId) => stub.apiKeyRelease(keyId),
    entries: () => stub.apiKeyEntries(),
  };
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
 *
 * **Best-effort, not strict**: the counter is a KV read-modify-write per
 * IP/window, so concurrent failures can overwrite each other and KV may
 * throttle writes to one key. It blunts online guessing of a 256-bit secret;
 * it is not an exact quota. A strict budget would need a serialized primitive
 * on the hot path (a DO hop per authentication), which is not worth it here.
 */
export const API_KEY_AUTH_FAILURE_LIMIT: RateLimitSpec = {
  label: 'API key authentication failures',
  limit: 20,
  windowMs: 5 * 60_000,
};

/**
 * A CONFIRMED index slot whose KV record has been missing for at least this
 * long is an orphan (a revoke whose release failed, or a cross-owner overwrite
 * that the 103-bit key id makes practically impossible) and may be reclaimed.
 * Far longer than KV's ~60 s propagation, so a fresh key read at another edge
 * is never mistaken for one.
 */
export const ORPHAN_GRACE_MS = 10 * 60_000;

/** `lastUsedAt` telemetry is written at most this often — one KV write per key per hour, not per request. */
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

/** Best-effort telemetry read; never blocks a listing. */
async function readUsage(
  kv: ApiKeyKv,
  keyId: string,
): Promise<string | undefined> {
  try {
    const raw = await kv.get(apiKeyUsageKey(keyId));
    return raw && Number.isFinite(Date.parse(raw)) ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The owner's live keys. Never returns the hash. Read-only: an id whose KV
 * record is missing (a create still in flight, or KV lagging at this edge)
 * or expired is simply not listed — the index prunes its own slots, and
 * nothing here may release a slot another request just reserved. A key whose
 * record exists but whose slot is still pending (its confirm failed) is
 * listed and confirmed here, best-effort.
 */
export async function listApiKeys(
  kv: ApiKeyKv,
  index: ApiKeyIndex,
  uid: string,
  nowMs = Date.now(),
): Promise<ApiKeyPublic[]> {
  const entries = await index.entries();
  const live: ApiKeyPublic[] = [];
  for (const entry of entries) {
    const record = await readRecord(kv, entry.keyId);
    if (!record || record.uid !== uid || isApiKeyExpired(record, nowMs))
      continue;
    if (entry.pending)
      await index.confirm(entry.keyId, record.expiresAt).catch(() => undefined);
    live.push(toPublic(record, await readUsage(kv, entry.keyId)));
  }
  return live;
}

/**
 * Confirmed slots whose KV record has been gone for longer than
 * ORPHAN_GRACE_MS. Read-only; `reconcileOrphans` is the path that frees them,
 * and `revokeApiKey` frees one on demand.
 */
export async function orphanedKeyIds(
  kv: ApiKeyKv,
  index: ApiKeyIndex,
  nowMs = Date.now(),
): Promise<string[]> {
  const orphaned: string[] = [];
  for (const entry of await index.entries()) {
    if (entry.pending) continue;
    if (Date.parse(entry.createdAt) + ORPHAN_GRACE_MS > nowMs) continue;
    if (!(await readRecord(kv, entry.keyId))) orphaned.push(entry.keyId);
  }
  return orphaned;
}

/** Release every orphaned slot (see `orphanedKeyIds`). Idempotent. Returns what was freed. */
export async function reconcileOrphans(
  kv: ApiKeyKv,
  index: ApiKeyIndex,
  nowMs = Date.now(),
): Promise<string[]> {
  const orphaned = await orphanedKeyIds(kv, index, nowMs);
  for (const keyId of orphaned) await index.release(keyId);
  return orphaned;
}

export interface CreateApiKeyInput {
  label?: unknown;
  scopes?: unknown;
  expiresInDays?: unknown;
}

/**
 * Mint + store a key for `user`. Throws `ApiKeyRequestError` on bad input or
 * when the per-user cap is reached. Slot lifecycle, all against the owner's
 * serialized index:
 *
 *   reserve (pending) → write KV record → confirm
 *
 * - record write fails → release (best-effort); even if that fails too, the
 *   pending reservation expires on its own — no permanent ghost slot;
 * - confirm fails → the record is deleted (best-effort) and the slot released,
 *   the create fails; a record that somehow survives is still listed and
 *   re-confirmed by the next listing while its reservation is pending;
 * - cap reached → orphaned slots (confirmed, record gone for > ORPHAN_GRACE_MS)
 *   are reclaimed once and the reservation retried.
 *
 * The returned `token` is the only time the plaintext exists outside the
 * caller's hands.
 */
export async function createApiKey(
  kv: ApiKeyKv,
  index: ApiKeyIndex,
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

  const expiresAt = days
    ? nowIso(nowMs + days * 24 * 60 * 60 * 1000)
    : undefined;
  const minted = await mintApiKey();
  let reserved = await index.reserve(
    minted.keyId,
    MAX_API_KEYS_PER_USER,
    expiresAt,
  );
  if (!reserved && (await reconcileOrphans(kv, index, nowMs)).length)
    reserved = await index.reserve(
      minted.keyId,
      MAX_API_KEYS_PER_USER,
      expiresAt,
    );
  if (!reserved) throw new ApiKeyRequestError('too_many_keys', 409);
  const record: ApiKeyRecord = {
    keyId: minted.keyId,
    uid: user.uid,
    login: user.login,
    ...(user.name ? { name: user.name } : {}),
    secretHash: minted.secretHash,
    scopes,
    label,
    createdAt: nowIso(nowMs),
    ...(expiresAt ? { expiresAt } : {}),
  };
  try {
    await putRecord(kv, record, nowMs);
  } catch (err) {
    await index.release(minted.keyId).catch(() => undefined);
    throw err;
  }
  try {
    await index.confirm(minted.keyId, expiresAt);
  } catch (err) {
    await kv.delete(apiKeyStorageKey(minted.keyId)).catch(() => undefined);
    await index.release(minted.keyId).catch(() => undefined);
    throw err;
  }
  return { token: minted.token, key: toPublic(record) };
}

/**
 * Owner-only revoke. A foreign or unknown keyId is `not_found` — the same
 * answer either way, so the endpoint never confirms another owner's keyId.
 * Order: delete the credential (validity), then release the slot
 * (visibility). Retry-safe: when the record is already gone but the owner's
 * index still holds the slot (a previous attempt's release failed, or an
 * orphan), the slot is released and the answer is still `revoked`.
 */
export async function revokeApiKey(
  kv: ApiKeyKv,
  index: ApiKeyIndex,
  uid: string,
  keyId: string,
): Promise<'revoked' | 'not_found'> {
  const record = await readRecord(kv, keyId);
  if (record && record.uid !== uid) return 'not_found';
  if (record) {
    await kv.delete(apiKeyStorageKey(keyId));
    await kv.delete(apiKeyUsageKey(keyId)).catch(() => undefined);
    await index.release(keyId);
    return 'revoked';
  }
  const held = (await index.entries()).some((e) => e.keyId === keyId);
  if (!held) return 'not_found';
  await index.release(keyId);
  return 'revoked';
}

/**
 * Refresh `lastUsedAt` telemetry at most hourly. Its own KV key: the
 * credential record is never rewritten by an authentication, so a revoke that
 * lands between the record read and this write cannot be undone.
 */
async function touchUsage(
  kv: ApiKeyKv,
  keyId: string,
  nowMs: number,
): Promise<void> {
  try {
    const raw = await kv.get(apiKeyUsageKey(keyId));
    const last = raw ? Date.parse(raw) : NaN;
    if (Number.isFinite(last) && nowMs - last < LAST_USED_WRITE_INTERVAL_MS)
      return;
    await kv.put(apiKeyUsageKey(keyId), nowIso(nowMs));
  } catch {
    // Best-effort telemetry; authentication already succeeded.
  }
}

/**
 * Verify a bearer against storage. Null for anything not a live, matching
 * key. The hash compare is constant-time. Read-only with respect to the
 * credential record: the only write is the hourly usage telemetry on its own
 * key, and it never blocks the result.
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
  await touchUsage(kv, record.keyId, nowMs);
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
  indexFor: ApiKeyIndexFactory,
): Promise<Response> {
  if (!apiKeysEnabled(env)) return apiKeysDisabledResponse();
  const user = await sessionUser(request, env);
  if (!user) return json({ error: 'authentication required' }, 401);
  const index = indexFor(user.uid);

  const url = new URL(request.url);
  const rest = url.pathname.slice('/api/keys'.length).replace(/^\//, '');

  if (request.method === 'GET' && !rest) {
    // `orphaned`: confirmed slots whose record is gone (revoke half-done);
    // DELETE /api/keys/:keyId frees one, a create at the cap frees them all.
    return json({
      keys: await listApiKeys(env.OAUTH_KV, index, user.uid),
      orphaned: await orphanedKeyIds(env.OAUTH_KV, index),
    });
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
      const created = await createApiKey(env.OAUTH_KV, index, user, input);
      return json(created, 201);
    } catch (err) {
      if (err instanceof ApiKeyRequestError)
        return json({ error: err.code }, err.status);
      throw err;
    }
  }
  if (request.method === 'DELETE' && rest && !rest.includes('/')) {
    const result = await revokeApiKey(env.OAUTH_KV, index, user.uid, rest);
    return result === 'revoked'
      ? json({ revoked: true })
      : json({ error: 'not_found' }, 404);
  }
  return json({ error: 'method not allowed' }, 405);
}
