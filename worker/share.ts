/**
 * Public share snapshots — the ONE publish/list/revoke path shared by the
 * browser (`/api/share` routes) and the MCP agent (`share_topology`,
 * `list_shares`, `revoke_share`).
 *
 * Storage shape:
 * - `doc:<id>`     — the published document JSON (30-day TTL; write-once).
 * - `shares:<uid>` — the owner's index: a JSON array of records, newest
 *   first, capped, pruned of expired entries on every read. The index is
 *   what makes revocation possible (finding M20): only ids present in the
 *   caller's own index can be revoked, so one user can never delete
 *   another's snapshot.
 *
 * Snapshots published before the index existed have no owner record; they
 * keep expiring on their original TTL but cannot be listed/revoked.
 */
import { serializeDoc } from '../src/pages/persist.js';
import type { TopologyDocument } from '../src/pages/model.js';

/**
 * The slice of the Worker environment sharing needs, expressed structurally
 * (a `WorkerEnv` satisfies it) so this module — and its unit tests — never
 * pull the full Worker type graph into the app's tsconfig program.
 */
export interface ShareKv {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}
export interface ShareEnv {
  TOPOLOGY_KV: ShareKv;
  PUBLIC_BASE_URL?: string;
}

/** Snapshots live in KV for 30 days unless re-published (bounded namespace). */
export const SHARE_TTL_SECONDS = 60 * 60 * 24 * 30;

/** At most this many records are retained per owner (oldest dropped first). */
const INDEX_CAP = 50;

export interface ShareRecord {
  id: string;
  /** Document title at publish time (labels the link in the manage list). */
  title: string;
  /** Publication time (ms since epoch). */
  createdAt: number;
  /** When the KV TTL retires the snapshot (ms since epoch). */
  expiresAt: number;
}

/** Short, URL-safe id for a published snapshot (collision-negligible). */
export function shareId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
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
  await env.TOPOLOGY_KV.put(indexKey(uid), JSON.stringify(records));
}

/** The share URL for an id ("/v/<id>", absolute when a base is configured). */
export function shareUrl(env: ShareEnv, id: string): string {
  const base = (env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  return `${base}/v/${id}`;
}

/**
 * Publish a snapshot: store the document under a fresh id and record it in
 * the owner's index. `uid` is the stable numeric GitHub id as a string —
 * identical for the browser session (`SessionUser.uid`) and the MCP agent
 * (`String(props.id)`), so both surfaces share one revocable index.
 */
export async function publishSnapshot(
  env: ShareEnv,
  uid: string | null,
  doc: TopologyDocument,
): Promise<{ id: string; url: string; expiresAt: number }> {
  const id = shareId();
  const now = Date.now();
  const expiresAt = now + SHARE_TTL_SECONDS * 1000;
  await env.TOPOLOGY_KV.put(`doc:${id}`, serializeDoc(doc), {
    expirationTtl: SHARE_TTL_SECONDS,
  });
  if (uid) {
    const index = (await readIndex(env, uid)).filter((r) => r.expiresAt > now);
    index.unshift({
      id,
      title:
        typeof doc.title === 'string' && doc.title ? doc.title : 'Untitled',
      createdAt: now,
      expiresAt,
    });
    await writeIndex(env, uid, index.slice(0, INDEX_CAP));
  }
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
 * Revoke one of the owner's snapshots: delete the KV value and drop the index
 * record. Ownership is enforced by the index — an id absent from the caller's
 * own index is reported `not-found`, never deleted.
 */
export async function revokeShare(
  env: ShareEnv,
  uid: string,
  id: string,
): Promise<'revoked' | 'not-found'> {
  const index = await readIndex(env, uid);
  const record = index.find((r) => r.id === id);
  if (!record) return 'not-found';
  await env.TOPOLOGY_KV.delete(`doc:${id}`);
  await writeIndex(
    env,
    uid,
    index.filter((r) => r.id !== id),
  );
  return 'revoked';
}
