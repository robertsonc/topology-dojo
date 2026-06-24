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
});
