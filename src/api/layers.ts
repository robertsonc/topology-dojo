/**
 * Layers — the document-level axis that lets one page express the planes of a
 * fabric (underlay / overlay / policy / …) stacked on top of each other.
 *
 * Layers are declared on the document (`doc.layers`, bottom → top); elements
 * opt in with `layer: <layer id>`. Untagged elements form the implicit base
 * layer, drawn beneath every declared layer. Layers affect stacking order and
 * visibility only — never geometry — so a page stays a single, standalone
 * flipbook frame.
 */

export const LAYER_KINDS = [
  'underlay',
  'overlay',
  'policy',
  'service',
] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

/** A declared document layer. Declaration order is z-order (bottom → top). */
export interface LayerDef {
  id: string;
  /** Display name (falls back to the id). */
  name?: string;
  /** Semantic role — an affordance for agents/GUI, not a rendering input. */
  kind?: LayerKind;
  color?: string;
  /** Drawn when no explicit visible set is given (defaults to true). */
  defaultVisible?: boolean;
  /** Layer-wide opacity 0–1 (B.3). Multiplies each member element's opacity. */
  opacity?: number;
}

/** An element that may opt into a layer. */
export interface Layered {
  layer?: string;
}

/** Stacking rank of a layer id: base/undeclared = -1, else declaration index. */
export function layerRank(
  layers: readonly LayerDef[],
  layer: string | undefined,
): number {
  if (!layer) return -1;
  return layers.findIndex((l) => l.id === layer);
}

/**
 * Whether an element draws, given an explicit visible set (overrides) or the
 * layers' `defaultVisible`. Base (untagged) elements always draw.
 */
export function layerVisible(
  layers: readonly LayerDef[],
  layer: string | undefined,
  visibleLayers?: readonly string[],
): boolean {
  if (!layer) return true;
  if (visibleLayers) return visibleLayers.includes(layer);
  const def = layers.find((l) => l.id === layer);
  return def?.defaultVisible !== false;
}

/**
 * The renderable view of a collection: hidden layers dropped, the rest in
 * stable bottom → top stacking order (base first, then declaration order).
 */
export function layerView<T extends Layered>(
  items: readonly T[],
  layers: readonly LayerDef[] = [],
  visibleLayers?: readonly string[],
): T[] {
  const shown = items.filter((it) =>
    layerVisible(layers, it.layer, visibleLayers),
  );
  if (!layers.length) return shown;
  // Array.prototype.sort is stable: same-rank elements keep authoring order.
  return shown.sort(
    (a, b) => layerRank(layers, a.layer) - layerRank(layers, b.layer),
  );
}
