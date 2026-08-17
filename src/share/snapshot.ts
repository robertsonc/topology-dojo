/**
 * KV contract for public share snapshots (`doc:<id>`).
 *
 * Publish writes the document JSON plus owner metadata so only that GitHub
 * user can revoke. GET `/api/topology/:id` still returns the raw document
 * (no wrapper) so existing viewers keep working. Snapshots published before
 * owner metadata existed cannot be revoked through this path (fail closed).
 */

/** KV key for a published snapshot. */
export function shareKey(id: string): string {
  return `doc:${id}`;
}

/** Snapshots live in KV for 30 days unless republished or revoked. */
export const SHARE_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Public GET cache. Short and revalidatable so an owner revoke can take
 * effect without waiting out a 24h `immutable` cache.
 */
export const SHARE_CACHE_CONTROL = 'public, max-age=60';

export interface ShareMetadata {
  ownerId: string;
}

/** Minimal KV surface used by publish/revoke (real Worker KV satisfies this). */
export interface ShareStore {
  get(key: string): Promise<string | null>;
  getWithMetadata(key: string): Promise<{
    value: string | null;
    metadata: unknown;
  }>;
  put(
    key: string,
    value: string,
    options: { expirationTtl: number; metadata: ShareMetadata },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export type RevokeShareResult = 'revoked' | 'not_found' | 'forbidden';

/** Short, URL-safe id for a published snapshot. */
export function mintShareId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export async function putShareSnapshot(
  kv: ShareStore,
  id: string,
  json: string,
  ownerId: string,
): Promise<void> {
  await kv.put(shareKey(id), json, {
    expirationTtl: SHARE_TTL_SECONDS,
    metadata: { ownerId },
  });
}

export async function getShareSnapshot(
  kv: Pick<ShareStore, 'get'>,
  id: string,
): Promise<string | null> {
  return kv.get(shareKey(id));
}

function metadataOwnerId(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const ownerId = (metadata as { ownerId?: unknown }).ownerId;
  return typeof ownerId === 'string' && ownerId ? ownerId : undefined;
}

/**
 * Delete a snapshot only when `ownerId` matches the publisher recorded at
 * publish time. Missing metadata (legacy snapshots) is treated as forbidden.
 */
export async function revokeShareSnapshot(
  kv: Pick<ShareStore, 'getWithMetadata' | 'delete'>,
  id: string,
  ownerId: string,
): Promise<RevokeShareResult> {
  const { value, metadata } = await kv.getWithMetadata(shareKey(id));
  if (value === null) return 'not_found';
  if (metadataOwnerId(metadata) !== ownerId) return 'forbidden';
  await kv.delete(shareKey(id));
  return 'revoked';
}
