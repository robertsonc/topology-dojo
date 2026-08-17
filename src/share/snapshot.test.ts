import { describe, expect, it } from 'vitest';
import {
  getShareSnapshot,
  mintShareId,
  putShareSnapshot,
  revokeShareSnapshot,
  SHARE_CACHE_CONTROL,
  SHARE_TTL_SECONDS,
  shareKey,
  type ShareMetadata,
  type ShareStore,
} from './snapshot.js';

class MemoryShareStore implements ShareStore {
  private readonly values = new Map<
    string,
    { value: string; metadata?: ShareMetadata }
  >();

  /** Plant a value the way pre-ownership publishes did (no metadata). */
  seedLegacy(key: string, value: string): void {
    this.values.set(key, { value });
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key)?.value ?? null;
  }

  async getWithMetadata(key: string): Promise<{
    value: string | null;
    metadata: unknown;
  }> {
    const entry = this.values.get(key);
    if (!entry) return { value: null, metadata: null };
    return { value: entry.value, metadata: entry.metadata ?? null };
  }

  async put(
    key: string,
    value: string,
    options: { expirationTtl: number; metadata: ShareMetadata },
  ): Promise<void> {
    expect(options.expirationTtl).toBe(SHARE_TTL_SECONDS);
    this.values.set(key, { value, metadata: options.metadata });
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe('share snapshot KV helpers', () => {
  it('mints a 12-char URL-safe id and keys it as doc:<id>', () => {
    const id = mintShareId();
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(shareKey(id)).toBe(`doc:${id}`);
  });

  it('writes owner metadata and lets only that owner revoke', async () => {
    const kv = new MemoryShareStore();
    const id = 'abc123def456';
    await putShareSnapshot(kv, id, '{"title":"Shared"}', '99');

    expect(await getShareSnapshot(kv, id)).toBe('{"title":"Shared"}');
    expect(await revokeShareSnapshot(kv, id, 'other')).toBe('forbidden');
    expect(await getShareSnapshot(kv, id)).toBe('{"title":"Shared"}');
    expect(await revokeShareSnapshot(kv, id, '99')).toBe('revoked');
    expect(await getShareSnapshot(kv, id)).toBeNull();
    expect(await revokeShareSnapshot(kv, id, '99')).toBe('not_found');
  });

  it('refuses to revoke a legacy snapshot that has no owner metadata', async () => {
    const kv = new MemoryShareStore();
    kv.seedLegacy(shareKey('legacy'), '{}');
    expect(await revokeShareSnapshot(kv, 'legacy', '99')).toBe('forbidden');
    expect(await getShareSnapshot(kv, 'legacy')).toBe('{}');
  });

  it('uses a short revalidatable cache so revoke can take effect', () => {
    expect(SHARE_CACHE_CONTROL).toBe('public, max-age=60');
    expect(SHARE_CACHE_CONTROL).not.toMatch(/immutable/);
  });
});
