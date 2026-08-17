/**
 * Per-owner `TOPOLOGY_REGISTRY` addressing.
 *
 * New private-draft registries and workspace directories share the stable
 * `user-id:<numeric-uid>` Durable Object name. The pre-uid `user:<login>`
 * name is a read-only migration source: login is display metadata and must
 * never be used as a storage key.
 */
import { DOC_PREFIX, type DocStorage } from './persist-store.js';

/** Stable per-owner registry name. Survives GitHub login renames. */
export function currentRegistryName(uid: string): string {
  return `user-id:${uid}`;
}

/** Pre-uid draft registry name. Mutable GitHub login; migration source only. */
export function legacyRegistryName(login: string): string {
  return `user:${login}`;
}

export interface RegistryIdentity {
  /** GitHub numeric id (OAuth `props.id` or session `uid`). */
  uid?: string | number;
  /** GitHub login — display-only; used solely to find the legacy registry. */
  login?: string;
}

/**
 * The slice of `DurableObjectNamespace` addressing needs: name → id → stub.
 * Kept structural so unit tests can fake it without a Worker runtime.
 */
export interface NamedStorageNamespace<
  T extends DocStorage = DocStorage,
  Id = unknown,
> {
  idFromName(name: string): Id;
  get(id: Id): T;
}

/**
 * Resolve the authenticated owner for registry addressing. Fails closed
 * without a stable uid — login is never a substitute key.
 */
export function registryOwnerId(identity: RegistryIdentity): string {
  const uid = identity.uid;
  if (uid === undefined || uid === null || uid === '')
    throw new Error('no authenticated user (props.id) — refusing to persist');
  return String(uid);
}

/**
 * Copy `tdoc:` drafts from the login-keyed registry into the uid-keyed
 * registry. Existing destination keys win (never overwrite). Source keys
 * are retained as rollback material, matching the workspace directory
 * migration (legacy snapshots stay put after the new key is written).
 */
export async function migrateLegacyDrafts(
  current: DocStorage,
  legacy: DocStorage,
): Promise<string[]> {
  const [dest, src] = await Promise.all([
    current.list<string>({ prefix: DOC_PREFIX }),
    legacy.list<string>({ prefix: DOC_PREFIX }),
  ]);
  const copied: string[] = [];
  for (const [key, value] of src) {
    if (dest.has(key)) continue;
    await current.put(key, value);
    copied.push(key.slice(DOC_PREFIX.length));
  }
  return copied;
}

/**
 * Open the uid-keyed owner registry, lazily importing any `tdoc:` drafts
 * still sitting on `user:<login>`. Callers persist and rehydrate against
 * the returned stub only.
 */
export async function openOwnerRegistry<T extends DocStorage, Id>(
  ns: NamedStorageNamespace<T, Id>,
  identity: RegistryIdentity,
): Promise<T> {
  const uid = registryOwnerId(identity);
  const current = ns.get(ns.idFromName(currentRegistryName(uid)));
  if (identity.login)
    await migrateLegacyDrafts(
      current,
      ns.get(ns.idFromName(legacyRegistryName(identity.login))),
    );
  return current;
}
