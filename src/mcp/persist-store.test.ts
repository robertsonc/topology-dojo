import { describe, it, expect } from 'vitest';
import { TopologyStore } from './store.js';
import {
  DOC_PREFIX,
  persistStore,
  rehydrateStore,
  type DocStorage,
} from './persist-store.js';

/** A fake of the DurableObjectStorage slice we use, backed by a Map. */
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

describe('MCP store durability', () => {
  it('persists then rehydrates a topology across a cold start', async () => {
    const storage = fakeStorage();

    // A first "isolate": create + mutate, persisting after each tool.
    const s1 = new TopologyStore();
    const { id } = s1.create('My Topology');
    s1.page(id).nodes.push({ id: 'n1', type: 'ec', x: 10, y: 20, label: 'EC' });
    await persistStore(s1, storage);

    expect(storage.map.has(DOC_PREFIX + id)).toBe(true);

    // A fresh "isolate" after hibernation: the id still resolves.
    const s2 = new TopologyStore();
    await rehydrateStore(s2, storage);
    const doc = s2.get(id);
    expect(doc.title).toBe('My Topology');
    expect(doc.pages.at(-1)!.nodes.map((n) => n.id)).toContain('n1');
  });

  it('drops a deleted topology from storage on the next persist', async () => {
    const storage = fakeStorage();
    const store = new TopologyStore();
    const a = store.create('A').id;
    const b = store.create('B').id;
    await persistStore(store, storage);
    expect([...storage.map.keys()].sort()).toEqual(
      [DOC_PREFIX + a, DOC_PREFIX + b].sort(),
    );

    store.remove(a);
    await persistStore(store, storage);
    expect([...storage.map.keys()]).toEqual([DOC_PREFIX + b]);

    const restored = new TopologyStore();
    await rehydrateStore(restored, storage);
    expect(() => restored.get(a)).toThrow(/unknown topology/);
    expect(restored.get(b).title).toBe('B');
  });

  it('never deletes documents it did not itself remove (shared cross-session storage)', async () => {
    // The registry is shared across a user's MCP sessions. A session that only
    // knows about a subset of docs must not wipe the others when it persists.
    const storage = fakeStorage();
    const seed = new TopologyStore();
    const a = seed.create('A').id;
    const b = seed.create('B').id;
    await persistStore(seed, storage);

    // A different session (fresh store, e.g. a cold start whose rehydrate threw
    // and left it empty) creates one topology and persists.
    const other = new TopologyStore();
    const c = other.create('C').id;
    await persistStore(other, storage);

    // Pre-existing docs survive (no mirror-delete); C is added.
    expect(storage.map.has(DOC_PREFIX + a)).toBe(true);
    expect(storage.map.has(DOC_PREFIX + b)).toBe(true);
    expect(storage.map.has(DOC_PREFIX + c)).toBe(true);
    expect([...storage.map.keys()]).toHaveLength(3);
  });

  it('preserves an unparseable stored doc and loads the rest (per-doc isolation)', async () => {
    const storage = fakeStorage();
    const seed = new TopologyStore();
    const good = seed.create('Good').id;
    await persistStore(seed, storage);
    // Corrupt a second key that cannot be parsed back into a document.
    storage.map.set(DOC_PREFIX + 'corrupt', '{ not valid json');

    const restored = new TopologyStore();
    const { loaded, failed } = await rehydrateStore(restored, storage);
    expect(loaded).toContain(good);
    expect(failed).toContain('corrupt');
    expect(restored.get(good).title).toBe('Good');

    // A subsequent persist must not drop the unparseable key: it was never
    // loaded, so it's neither in `current` nor in the explicit delete set.
    await persistStore(restored, storage);
    expect(storage.map.has(DOC_PREFIX + 'corrupt')).toBe(true);
    expect(storage.map.has(DOC_PREFIX + good)).toBe(true);
  });

  // Issue #302: storage is shared across a user's sessions, each with its own
  // in-memory copy. A session must only write what it changed.
  it('does not resurrect a topology another session deleted', async () => {
    const storage = fakeStorage();
    const seed = new TopologyStore();
    const x = seed.create('Deleted topology').id;
    await persistStore(seed, storage);

    // Two warm sessions both loaded X.
    const a = new TopologyStore();
    const b = new TopologyStore();
    await rehydrateStore(a, storage);
    await rehydrateStore(b, storage);

    a.remove(x);
    await persistStore(a, storage);
    expect(storage.map.has(DOC_PREFIX + x)).toBe(false);

    // Session B, still holding its stale X, changes something unrelated.
    const y = b.create('Unrelated').id;
    await persistStore(b, storage);

    expect(storage.map.has(DOC_PREFIX + y)).toBe(true);
    expect(storage.map.has(DOC_PREFIX + x)).toBe(false);
    const fresh = new TopologyStore();
    await rehydrateStore(fresh, storage);
    expect(() => fresh.get(x)).toThrow(/unknown topology/);
  });

  it("does not overwrite another session's edit with an untouched stale copy", async () => {
    const storage = fakeStorage();
    const seed = new TopologyStore();
    const x = seed.create('Shared').id;
    await persistStore(seed, storage);

    const a = new TopologyStore();
    const b = new TopologyStore();
    await rehydrateStore(a, storage);
    await rehydrateStore(b, storage);

    a.page(x).nodes.push({ id: 'n1', type: 'ec', x: 10, y: 20, label: 'EC' });
    await persistStore(a, storage);

    b.create('Unrelated');
    await persistStore(b, storage);

    const fresh = new TopologyStore();
    await rehydrateStore(fresh, storage);
    expect(fresh.page(x).nodes.map((n) => n.id)).toEqual(['n1']);
  });

  it('writes only the documents that changed since the last persist', async () => {
    const storage = fakeStorage();
    const puts: string[] = [];
    const put = storage.put.bind(storage);
    storage.put = async (key, value) => {
      puts.push(key);
      await put(key, value);
    };

    const store = new TopologyStore();
    const a = store.create('A').id;
    const b = store.create('B').id;
    await persistStore(store, storage);
    expect(puts.sort()).toEqual([DOC_PREFIX + a, DOC_PREFIX + b].sort());

    puts.length = 0;
    await persistStore(store, storage);
    expect(puts).toEqual([]);

    store.get(b).title = 'B renamed';
    await persistStore(store, storage);
    expect(puts).toEqual([DOC_PREFIX + b]);

    // Same rule after a cold start: a rehydrated, untouched store writes
    // nothing, and an in-place edit is still picked up.
    puts.length = 0;
    const warm = new TopologyStore();
    await rehydrateStore(warm, storage);
    await persistStore(warm, storage);
    expect(puts).toEqual([]);
    warm.page(a).nodes.push({ id: 'n1', type: 'ec', x: 0, y: 0, label: 'EC' });
    await persistStore(warm, storage);
    expect(puts).toEqual([DOC_PREFIX + a]);
  });

  it('does not rewrite a stored document whose bytes are not canonical', async () => {
    // An older/hand-written stored shape parses fine; loading it must not
    // count as a change, or an unrelated persist would write it back (and so
    // resurrect it after another session's delete).
    const storage = fakeStorage();
    const seed = new TopologyStore();
    const x = seed.create('Compact').id;
    await persistStore(seed, storage);
    const compact = JSON.stringify(
      JSON.parse(storage.map.get(DOC_PREFIX + x)!),
    );
    storage.map.set(DOC_PREFIX + x, compact);

    const b = new TopologyStore();
    await rehydrateStore(b, storage);
    storage.map.delete(DOC_PREFIX + x); // another session deletes it
    b.create('Unrelated');
    await persistStore(b, storage);
    expect(storage.map.has(DOC_PREFIX + x)).toBe(false);
  });
});
