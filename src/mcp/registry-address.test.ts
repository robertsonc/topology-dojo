import { describe, expect, it } from 'vitest';
import { DOC_PREFIX, type DocStorage } from './persist-store.js';
import {
  currentRegistryName,
  legacyRegistryName,
  migrateLegacyDrafts,
  openOwnerRegistry,
  registryOwnerId,
  type NamedStorageNamespace,
} from './registry-address.js';

function fakeStorage(): DocStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async list<T = string>(options: {
      prefix: string;
    }): Promise<Map<string, T>> {
      const out = new Map<string, T>();
      for (const [k, v] of map)
        if (k.startsWith(options.prefix)) out.set(k, v as unknown as T);
      return out;
    },
    async put(key: string, value: string): Promise<void> {
      map.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return map.delete(key);
    },
  };
}

function fakeNamespace(): NamedStorageNamespace<
  DocStorage & { map: Map<string, string> }
> & {
  stores: Map<string, DocStorage & { map: Map<string, string> }>;
} {
  const stores = new Map<string, DocStorage & { map: Map<string, string> }>();
  return {
    stores,
    idFromName(name: string): string {
      return name;
    },
    get(id: unknown) {
      const name = String(id);
      let store = stores.get(name);
      if (!store) {
        store = fakeStorage();
        stores.set(name, store);
      }
      return store;
    },
  };
}

describe('registry addressing', () => {
  it('keys the current registry on the stable numeric uid, not login', () => {
    expect(currentRegistryName('17257145')).toBe('user-id:17257145');
    expect(currentRegistryName('17257145')).not.toContain('alice');
    expect(legacyRegistryName('alice')).toBe('user:alice');
  });

  it('resolves the owner from uid and treats login as display-only', () => {
    expect(registryOwnerId({ uid: 17257145, login: 'alice' })).toBe('17257145');
    expect(registryOwnerId({ uid: '17257145', login: 'renamed' })).toBe(
      '17257145',
    );
    expect(registryOwnerId({ uid: 7 })).toBe('7');
  });

  it('accepts MCP OAuth props.id as the stable uid alias', () => {
    expect(registryOwnerId({ id: 17257145, login: 'alice' })).toBe('17257145');
    expect(registryOwnerId({ uid: '9', id: 17257145 })).toBe('9');
  });

  it('fails closed without a stable uid', () => {
    expect(() => registryOwnerId({ login: 'alice' })).toThrow(
      /no authenticated user \(props\.id\)/,
    );
    expect(() => registryOwnerId({})).toThrow(/props\.id/);
    expect(() => registryOwnerId({ uid: '' })).toThrow(/props\.id/);
    expect(() => registryOwnerId({ id: '' })).toThrow(/props\.id/);
  });
});

describe('legacy draft migration', () => {
  it('copies missing tdoc: keys from the login-keyed registry', async () => {
    const current = fakeStorage();
    const legacy = fakeStorage();
    legacy.map.set(DOC_PREFIX + 'draft-a', '{"title":"A"}');
    legacy.map.set(DOC_PREFIX + 'draft-b', '{"title":"B"}');

    const copied = await migrateLegacyDrafts(current, legacy);
    expect(copied.sort()).toEqual(['draft-a', 'draft-b']);
    expect(current.map.get(DOC_PREFIX + 'draft-a')).toBe('{"title":"A"}');
    expect(current.map.get(DOC_PREFIX + 'draft-b')).toBe('{"title":"B"}');
    // Source stays put — same rollback stance as the workspace directory
    // migration, which retains the legacy snapshot after the new write.
    expect(legacy.map.get(DOC_PREFIX + 'draft-a')).toBe('{"title":"A"}');
  });

  it('does not overwrite a draft already stored under the uid key', async () => {
    const current = fakeStorage();
    const legacy = fakeStorage();
    current.map.set(DOC_PREFIX + 'draft-a', '{"title":"canonical"}');
    legacy.map.set(DOC_PREFIX + 'draft-a', '{"title":"stale"}');
    legacy.map.set(DOC_PREFIX + 'draft-b', '{"title":"only-legacy"}');

    const copied = await migrateLegacyDrafts(current, legacy);
    expect(copied).toEqual(['draft-b']);
    expect(current.map.get(DOC_PREFIX + 'draft-a')).toBe(
      '{"title":"canonical"}',
    );
    expect(current.map.get(DOC_PREFIX + 'draft-b')).toBe(
      '{"title":"only-legacy"}',
    );
  });

  it('is idempotent and ignores non-draft keys', async () => {
    const current = fakeStorage();
    const legacy = fakeStorage();
    legacy.map.set(DOC_PREFIX + 'draft-a', '{"title":"A"}');
    legacy.map.set('workspace:w1', '{"id":"w1"}');

    await migrateLegacyDrafts(current, legacy);
    const second = await migrateLegacyDrafts(current, legacy);
    expect(second).toEqual([]);
    expect([...current.map.keys()]).toEqual([DOC_PREFIX + 'draft-a']);
  });
});

describe('openOwnerRegistry', () => {
  it('opens from the real MCP props shape { id, login } and migrates user:alice', async () => {
    const ns = fakeNamespace();
    ns.get('user:alice').map.set(DOC_PREFIX + 'old', '{"title":"legacy"}');

    const registry = await openOwnerRegistry(ns, {
      id: 17257145,
      login: 'alice',
    });
    expect(ns.stores.has('user-id:17257145')).toBe(true);
    expect(ns.stores.has('user-id:undefined')).toBe(false);
    expect(registry.map.get(DOC_PREFIX + 'old')).toBe('{"title":"legacy"}');
  });

  it('addresses user-id:<uid> and lazily imports user:<login> drafts', async () => {
    const ns = fakeNamespace();
    ns.get('user:alice').map.set(DOC_PREFIX + 'old', '{"title":"legacy"}');

    const registry = await openOwnerRegistry(ns, {
      uid: 42,
      login: 'alice',
    });
    expect(ns.stores.has('user-id:42')).toBe(true);
    expect(registry.map.get(DOC_PREFIX + 'old')).toBe('{"title":"legacy"}');

    // A later login rename still hits the same uid-keyed store.
    const afterRename = await openOwnerRegistry(ns, {
      uid: 42,
      login: 'alice-renamed',
    });
    expect(afterRename.map.get(DOC_PREFIX + 'old')).toBe('{"title":"legacy"}');
    expect(ns.stores.has('user:alice-renamed')).toBe(true);
    expect(ns.get('user:alice-renamed').map.size).toBe(0);
  });

  it('opens the uid-keyed registry when login is absent (no migration)', async () => {
    const ns = fakeNamespace();
    const registry = await openOwnerRegistry(ns, { uid: '9' });
    expect(ns.stores.has('user-id:9')).toBe(true);
    expect(ns.stores.has('user:undefined')).toBe(false);
    expect(registry.map.size).toBe(0);
  });

  it('refuses to open a registry without a uid', async () => {
    const ns = fakeNamespace();
    await expect(openOwnerRegistry(ns, { login: 'alice' })).rejects.toThrow(
      /no authenticated user \(props\.id\)/,
    );
    expect(ns.stores.size).toBe(0);
  });
});
