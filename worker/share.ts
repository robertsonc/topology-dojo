/**
 * Owner share operations layered over the canonical snapshot contract
 * (`src/share/snapshot.ts`, PR #240): publish / list / revoke shared by the
 * browser (`/api/share` + `DELETE /api/topology/:id`) and MCP
 * (`share_topology`, `list_shares`, `unpublish_topology`).
 *
 * Ownership is AUTHORITATIVELY the snapshot's KV metadata (`{ ownerId }`,
 * checked by `revokeShareSnapshot`) — that survives anything that happens to
 * the index and distinguishes forbidden from not-found. The per-owner index
 * this module adds (`shares:<uid>`: newest-first records, capped, pruned of
 * expired entries on read) exists purely to power LISTING — the Share
 * dialog's "published links" and the `list_shares` tool. Losing an index
 * entry can therefore never grant or deny revocation; it only hides a row.
 *
 * Snapshots published before either mechanism existed have neither metadata
 * nor an index record: they cannot be listed or revoked and expire on their
 * original TTL (fail closed).
 */
import { serializeDoc } from '../src/pages/persist.js';
import type { TopologyDocument } from '../src/pages/model.js';
import {
  mintShareId,
  putShareSnapshot,
  revokeShareSnapshot,
  SHARE_TTL_SECONDS,
  type RevokeShareResult,
  type ShareStore,
} from '../src/share/snapshot.js';

export { SHARE_TTL_SECONDS };
export type { RevokeShareResult };

/** At most this many records are retained per owner (oldest dropped first). */
const INDEX_CAP = 50;

/**
 * The slice of the Worker environment sharing needs, expressed structurally
 * (a `WorkerEnv` satisfies it) so this module — and its unit tests — never
 * pull the full Worker type graph into the app's tsconfig program.
 */
/** The snapshot contract's KV surface, plus a plain metadata-less put for
 * the listing index (real Worker KV satisfies both call shapes). */
export type ShareIndexStore = ShareStore & {
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
};

export interface ShareEnv {
  TOPOLOGY_KV: ShareIndexStore;
  PUBLIC_BASE_URL?: string;
}

export interface ShareRecord {
  id: string;
  /** Document title at publish time (labels the link in the manage list). */
  title: string;
  /** Publication time (ms since epoch). */
  createdAt: number;
  /** When the KV TTL retires the snapshot (ms since epoch). */
  expiresAt: number;
}

const indexKey = (uid: string): string => `shares:${uid}`;

async function readIndex(env: ShareEnv, uid: string): Promise<ShareRecord[]> {
  const raw = await env.TOPOLOGY_KV.get(indexKey(uid));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is ShareRecord =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as ShareRecord).id === 'string' &&
        typeof (r as ShareRecord).expiresAt === 'number',
    );
  } catch {
    return [];
  }
}

async function writeIndex(
  env: ShareEnv,
  uid: string,
  records: ShareRecord[],
): Promise<void> {
  // The index itself needs no TTL: it is capped, pruned on read, and only
  // ever lists — the snapshots' own TTL/metadata stay authoritative.
  await env.TOPOLOGY_KV.put(indexKey(uid), JSON.stringify(records), {
    expirationTtl: SHARE_TTL_SECONDS,
  });
}

/** The share URL for an id ("/v/<id>", absolute when a base is configured). */
export function shareUrl(env: ShareEnv, id: string): string {
  const base = (env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  return `${base}/v/${id}`;
}

/**
 * Publish a snapshot: store the document with owner metadata (the canonical
 * contract) and record it in the owner's listing index. `uid` is the stable
 * numeric GitHub id as a string — identical for the browser session
 * (`SessionUser.uid`) and the MCP agent (`String(props.id)`).
 */
export async function publishSnapshot(
  env: ShareEnv,
  uid: string,
  doc: TopologyDocument,
): Promise<{ id: string; url: string; expiresAt: number }> {
  const id = mintShareId();
  const now = Date.now();
  const expiresAt = now + SHARE_TTL_SECONDS * 1000;
  await putShareSnapshot(env.TOPOLOGY_KV, id, serializeDoc(doc), uid);
  const index = (await readIndex(env, uid)).filter((r) => r.expiresAt > now);
  index.unshift({
    id,
    title: typeof doc.title === 'string' && doc.title ? doc.title : 'Untitled',
    createdAt: now,
    expiresAt,
  });
  await writeIndex(env, uid, index.slice(0, INDEX_CAP));
  return { id, url: shareUrl(env, id), expiresAt };
}

/** The owner's live share records, newest first (expired entries pruned). */
export async function listShares(
  env: ShareEnv,
  uid: string,
): Promise<ShareRecord[]> {
  const now = Date.now();
  const index = await readIndex(env, uid);
  const live = index.filter((r) => r.expiresAt > now);
  if (live.length !== index.length) await writeIndex(env, uid, live);
  return live;
}

/**
 * Revoke a snapshot through the canonical metadata ownership check, then
 * drop the owner's listing record on success. `forbidden` (someone else's
 * snapshot, or a legacy one without metadata) never touches anything.
 */
export async function revokeShare(
  env: ShareEnv,
  uid: string,
  id: string,
): Promise<RevokeShareResult> {
  const result = await revokeShareSnapshot(env.TOPOLOGY_KV, id, uid);
  if (result === 'revoked') {
    const index = await readIndex(env, uid);
    if (index.some((r) => r.id === id))
      await writeIndex(
        env,
        uid,
        index.filter((r) => r.id !== id),
      );
  }
  return result;
}
