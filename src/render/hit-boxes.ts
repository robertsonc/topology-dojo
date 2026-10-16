/**
 * Hit-box registry — the headless twin of the engine's `registerNodeType`
 * plugin table. The engine sizes a node's hit AABB from the plugin
 * registered for its type (stock pack + the document's custom types), and
 * the TypeScript mirrors (zone boxes, link attachment, footprints, pills)
 * must size the same node the same way. Stock specs are registered at
 * load; a document's custom specs are registered by every entry point that
 * has the document (render, validate, layout, tidy, inspect, the editor),
 * exactly as the engine's own global registration works — last
 * registration of a type name wins.
 */
import type { CustomNodeSpec } from '../nodes/spec.js';
import { customHitBox } from '../nodes/render.js';
import { STOCK_NODE_SPECS } from '../nodes/stock.js';

export interface HitBox {
  rx: number;
  ry: number;
}

const registry = new Map<string, HitBox>();
for (const spec of STOCK_NODE_SPECS)
  registry.set(spec.typeName, customHitBox(spec));

/** Register (overwrite by type name) a document's custom node hit boxes. */
export function registerHitBoxes(specs: readonly CustomNodeSpec[] = []): void {
  for (const spec of specs) registry.set(spec.typeName, customHitBox(spec));
}

/** The live registry: stock pack + every custom type registered so far. */
export function registeredHitBoxes(): ReadonlyMap<string, HitBox> {
  return registry;
}

/** The hit boxes for a document: the registry with its custom types applied. */
export function hitBoxesFor(
  customNodes: readonly CustomNodeSpec[] | undefined,
): ReadonlyMap<string, HitBox> {
  if (customNodes?.length) registerHitBoxes(customNodes);
  return registry;
}
