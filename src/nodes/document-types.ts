/**
 * The editor's custom node types belong to the open document.
 *
 * The browser registers a document's custom types with the page's engine
 * (and the hit-box mirror) so the canvas can draw them. Opening a different
 * document — a file, a workspace, a share link — must first take the
 * previous document's types away again, or they would keep drawing nodes of
 * those type names in the next one.
 */
import type { CustomNodeSpec } from './spec.js';
import { registerCustomNodes } from './render.js';
import { isReservedNodeTypeName } from './reserved.js';
import { registerHitBoxes, resetHitBoxes } from '../render/hit-boxes.js';
import {
  snapshotEngineTypes,
  type RestoreEngineTypes,
} from '../render/engine-types.js';

let baseline: RestoreEngineTypes | null = null;

/** Record the engine's type tables as they are now (built-in + stock pack,
 * before any document's types) as the state every document starts from. */
export function markBaselineNodeTypes(engine: unknown): void {
  baseline = snapshotEngineTypes(engine);
}

/** Replace the registered document types with `specs`: undo everything
 * registered since the baseline, then register these. */
export function useDocumentNodeTypes(specs: readonly CustomNodeSpec[]): void {
  baseline?.();
  resetHitBoxes();
  const own = specs.filter((s) => !isReservedNodeTypeName(s.typeName));
  registerCustomNodes(own);
  registerHitBoxes(own);
}
