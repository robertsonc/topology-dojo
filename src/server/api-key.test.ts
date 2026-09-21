import { describe, expect, it } from 'vitest';
import {
  API_KEY_SCOPES,
  apiKeyUsageKey,
  KEY_ID_LENGTH,
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
  type ApiKeyRecord,
} from './api-key.js';

describe('api-key primitives (proposal 0005)', () => {
  it('mints tdk_<20 id>_<43 secret> tokens that parse back and hash to the stored value', async () => {
    const minted = await mintApiKey();
    expect(minted.token).toMatch(/^tdk_[a-z0-9]{20}_[A-Za-z0-9_-]{43}$/);
    // Global-uniqueness budget: records are keyed by id in shared KV.
    expect(KEY_ID_LENGTH * Math.log2(36)).toBeGreaterThanOrEqual(96);
    const parsed = parseApiKey(minted.token);
    expect(parsed?.keyId).toBe(minted.keyId);
    expect(await hashSecret(parsed!.secret)).toBe(minted.secretHash);
    expect(minted.secretHash).toMatch(/^[0-9a-f]{64}$/);
    // The plaintext secret never equals its hash and never appears in the id.
    expect(minted.token).not.toContain(minted.secretHash);
  });

  it('mints distinct keys', async () => {
    const a = await mintApiKey();
    const b = await mintApiKey();
    expect(a.token).not.toBe(b.token);
    expect(a.keyId).not.toBe(b.keyId);
  });

  it('is deterministic under an injected RNG (tests can pin a token)', async () => {
    const fill = (bytes: Uint8Array) => bytes.fill(7);
    const a = await mintApiKey(fill);
    const b = await mintApiKey(fill);
    expect(a.token).toBe(b.token);
  });

  it('rejects anything that is not exactly the format', () => {
    expect(
      parseApiKey('tdk_abcdefghijklmnopqrst_' + 'x'.repeat(43)),
    ).not.toBeNull();
    expect(
      parseApiKey('tdk_ABCDEFGHIJKLMNOPQRST_' + 'x'.repeat(43)),
    ).toBeNull(); // id must be lowercase
    expect(parseApiKey('tdk_abcdefghij_' + 'x'.repeat(43))).toBeNull(); // the pre-release 10-char id
    expect(
      parseApiKey('tdk_abcdefghijklmnopqrst_' + 'x'.repeat(42)),
    ).toBeNull();
    expect(
      parseApiKey('tdk_abcdefghijklmnopqrst_' + 'x'.repeat(44)),
    ).toBeNull();
    expect(
      parseApiKey('tdk_abcdefghijklmnopqrst_' + 'x'.repeat(42) + '='),
    ).toBeNull();
    expect(parseApiKey('user:grant:secret')).toBeNull(); // the provider's own token shape
    expect(parseApiKey('')).toBeNull();
    expect(looksLikeApiKey('tdk_')).toBe(true);
    expect(looksLikeApiKey('Bearer tdk_')).toBe(false);
  });

  it('compares digests in constant time and rejects length mismatches', () => {
    expect(timingSafeEqual('abcd', 'abcd')).toBe(true);
    expect(timingSafeEqual('abcd', 'abce')).toBe(false);
    expect(timingSafeEqual('abcd', 'abc')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('normalizes scopes: author is implicit, order is canonical, unknowns reject', () => {
    expect(normalizeScopes(undefined)).toEqual(['author']);
    expect(normalizeScopes([])).toEqual(['author']);
    expect(normalizeScopes(['live-data', 'share', 'share'])).toEqual([
      'author',
      'share',
      'live-data',
    ]);
    expect(normalizeScopes(['shar'])).toBeNull();
    expect(normalizeScopes('share')).toBeNull();
    expect(normalizeScopes([1])).toBeNull();
    expect(API_KEY_SCOPES).toEqual([
      'author',
      'share',
      'workspace',
      'live-data',
    ]);
  });

  it('normalizes labels and expiry choices', () => {
    expect(normalizeLabel('  netclaw   border ')).toBe('netclaw border');
    expect(normalizeLabel('')).toBeNull();
    expect(normalizeLabel('x'.repeat(65))).toBeNull();
    expect(normalizeLabel(42)).toBeNull();
    expect(normalizeExpiryDays(null)).toBeNull();
    expect(normalizeExpiryDays('')).toBeNull();
    expect(normalizeExpiryDays(90)).toBe(90);
    expect(normalizeExpiryDays('365')).toBe(365);
    expect(normalizeExpiryDays(7)).toBeUndefined();
    expect(normalizeExpiryDays('soon')).toBeUndefined();
  });

  it('exposes only the public projection of a record', () => {
    const record: ApiKeyRecord = {
      keyId: 'abcdefghij',
      uid: '42',
      login: 'octocat',
      name: 'The Octocat',
      secretHash: 'f'.repeat(64),
      scopes: ['author', 'share'],
      label: 'ci',
      createdAt: '2026-09-20T00:00:00.000Z',
      expiresAt: '2026-12-19T00:00:00.000Z',
    };
    const pub = toPublic(record);
    expect(pub).toEqual({
      keyId: 'abcdefghij',
      prefix: 'tdk_abcdefghij_…',
      label: 'ci',
      scopes: ['author', 'share'],
      createdAt: '2026-09-20T00:00:00.000Z',
      expiresAt: '2026-12-19T00:00:00.000Z',
    });
    expect(JSON.stringify(pub)).not.toContain('secretHash');
    expect(JSON.stringify(pub)).not.toContain('octocat');
    expect(isApiKeyExpired(record, Date.parse('2026-12-18T00:00:00Z'))).toBe(
      false,
    );
    expect(isApiKeyExpired(record, Date.parse('2026-12-19T00:00:00Z'))).toBe(
      true,
    );
    expect(isApiKeyExpired({ ...record, expiresAt: undefined }, Infinity)).toBe(
      false,
    );
  });

  it('uses prefixes disjoint from the OAuth provider and the share store', () => {
    expect(apiKeyStorageKey('abc')).toBe('apikey:abc');
    expect(apiKeyUsageKey('abc')).toBe('apikeyuse:abc');
  });
});
