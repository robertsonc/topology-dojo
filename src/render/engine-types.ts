/**
 * Snapshot and restore of the vendored engine's node-type tables.
 *
 * `registerNodeType` writes into static tables on the engine class
 * (`NODE_TYPES`, `_nodePluginMeta`) that live as long as the process (the
 * Worker isolate, the stdio server, the browser tab). A document's custom
 * types must not outlive the render that used them, so callers take a
 * snapshot before registering and restore it afterwards.
 */

type Table = Record<string, unknown>;
const TABLES = ['NODE_TYPES', '_nodePluginMeta'] as const;

/** Put the engine's type tables back exactly as they are now (in place, so
 * any held reference to a table stays valid). */
export type RestoreEngineTypes = () => void;

export function snapshotEngineTypes(engine: unknown): RestoreEngineTypes {
  const e = (engine ?? {}) as Partial<Record<(typeof TABLES)[number], Table>>;
  const saved = TABLES.map((name) => {
    const table = e[name];
    return table && typeof table === 'object'
      ? { table, copy: { ...table } }
      : null;
  });
  return () => {
    for (const s of saved) {
      if (!s) continue;
      for (const k of Object.keys(s.table))
        if (!Object.prototype.hasOwnProperty.call(s.copy, k)) delete s.table[k];
      Object.assign(s.table, s.copy);
    }
  };
}
