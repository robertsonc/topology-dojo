/**
 * Hit-box registry — the headless twin of the engine's `registerNodeType`
 * plugin table. The engine sizes a node's hit AABB from the plugin
 * registered for its type (stock pack + the document's custom types), and
 * the TypeScript mirrors (zone boxes, link attachment, footprints, pills)
 * must size the same node the same way. Stock specs are registered at
 * load; a document's custom specs are registered by every entry point that
 * has the document (render, validate, layout, tidy, inspect, the editor).
 *
 * Headless entry points register a document's types only for the length of
 * one call (`withDocumentHitBoxes`), so nothing one document declares
 * outlives the call that used it. The editor registers the open document's
 * types and resets to the baseline (`resetHitBoxes`) when it loads another.
 */
import type { CustomNodeSpec } from '../nodes/spec.js';
import { customHitBox } from '../nodes/render.js';
import { STOCK_NODE_SPECS } from '../nodes/stock.js';

export interface HitBox {
  rx: number;
  ry: number;
}

const registry = new Map<string, HitBox>();
/** Types drawn from a Node Designer spec (stock pack + document custom):
 * their glyph fills the hit box, so south labels clear it. Hardware panel
 * types (`registerHitBox`) keep the classic label distance. */
const designerTypes = new Set<string>();
for (const spec of STOCK_NODE_SPECS) {
  registry.set(spec.typeName, customHitBox(spec));
  designerTypes.add(spec.typeName);
}

/** Register (overwrite by type name) a document's custom node hit boxes.
 * Outlives the call: headless callers use `withDocumentHitBoxes` instead. */
export function registerHitBoxes(specs: readonly CustomNodeSpec[] = []): void {
  for (const spec of specs) {
    registry.set(spec.typeName, customHitBox(spec));
    designerTypes.add(spec.typeName);
  }
}

/** The hit box of a Node Designer type (stock or custom), else undefined. */
export function designerHitBox(type: string): HitBox | undefined {
  return designerTypes.has(type) ? registry.get(type) : undefined;
}

/** Register one type's hit box (wire-sheet panel types, hw-catalog Phase 4). */
export function registerHitBox(type: string, box: HitBox): void {
  registry.set(type, box);
  designerTypes.delete(type);
}

/** The live registry: stock pack + every custom type registered so far. */
export function registeredHitBoxes(): ReadonlyMap<string, HitBox> {
  return registry;
}

/** The hit boxes for a document: the registry with its custom types applied
 * (a copy when it has any; the registry itself is left as it was). */
export function hitBoxesFor(
  customNodes: readonly CustomNodeSpec[] | undefined,
): ReadonlyMap<string, HitBox> {
  if (!customNodes?.length) return registry;
  const out = new Map(registry);
  for (const spec of customNodes) out.set(spec.typeName, customHitBox(spec));
  return out;
}

/** Undo every registration made since the snapshot was taken. */
export type RestoreHitBoxes = () => void;

/** Snapshot the registry; the returned function puts it back exactly. */
export function snapshotHitBoxes(): RestoreHitBoxes {
  const boxes = new Map(registry);
  const designer = new Set(designerTypes);
  return () => {
    registry.clear();
    for (const [k, v] of boxes) registry.set(k, v);
    designerTypes.clear();
    for (const t of designer) designerTypes.add(t);
  };
}

/**
 * Run `fn` with a document's custom hit boxes registered, then restore the
 * registry to what it was before, so one document's types never change how
 * another is measured. Synchronous by design: nothing can interleave.
 */
export function withDocumentHitBoxes<T>(
  customNodes: readonly CustomNodeSpec[] | undefined,
  fn: () => T,
): T {
  const restore = snapshotHitBoxes();
  try {
    registerHitBoxes(customNodes);
    return fn();
  } finally {
    restore();
  }
}

/** The registry as loaded: the stock pack only (the editor, on opening a
 * different document). */
const BASELINE = snapshotHitBoxes();
export function resetHitBoxes(): void {
  BASELINE();
}
