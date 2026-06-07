/**
 * Authoring edits — the *write* side of the document, kept pure and tested so
 * the DOM editor can stay thin. Every function here mutates the single mutable
 * Scene the app owns (the document of record) and writes the *minimal* delta,
 * which is what keeps beats readable (DESIGN.md: deltas, low cognitive load).
 *
 * The central rule (the Phase 2 "Base = structure" decision): editing on the
 * base (beatIndex === -1) changes the model itself; editing on a beat writes an
 * override. The same gesture, two meanings, chosen by what's selected — no
 * extra mode.
 */
import type { ElementId, ElementOverride, Scene } from './model.js';

/** Authored coordinates are rounded to keep the document tidy and diffs stable. */
function round(n: number): number {
  return Math.round(n);
}

/**
 * Reposition a node. On the base this moves the model's real position; on a beat
 * it writes an x/y position override (the key direct-manipulation bet: drag a
 * node and the beat records where it went).
 */
export function moveNode(
  scene: Scene,
  beatIndex: number,
  id: ElementId,
  x: number,
  y: number,
): void {
  if (beatIndex < 0) {
    const node = scene.topology.nodes[id];
    if (node) {
      node.x = round(x);
      node.y = round(y);
    }
    return;
  }
  const beat = scene.beats[beatIndex];
  if (!beat) return;
  const ov: ElementOverride = { ...(beat.overrides[id] ?? {}) };
  ov.x = round(x);
  ov.y = round(y);
  beat.overrides[id] = ov;
}

/**
 * Set/replace one override field on a beat. No-op on the base — visibility,
 * emphasis and flow are presentation deltas that only exist relative to a beat.
 */
export function setOverrideField<K extends keyof ElementOverride>(
  scene: Scene,
  beatIndex: number,
  id: ElementId,
  field: K,
  value: ElementOverride[K],
): void {
  const beat = scene.beats[beatIndex];
  if (!beat) return;
  const ov: ElementOverride = { ...(beat.overrides[id] ?? {}) };
  ov[field] = value;
  beat.overrides[id] = ov;
}

/**
 * Clear one override field on a beat, reverting that element's field to whatever
 * it inherits. If the element's override becomes empty it is removed entirely,
 * so a beat never carries dead entries (keeps the delta minimal and the
 * validator/inspector honest).
 */
export function clearOverrideField(
  scene: Scene,
  beatIndex: number,
  id: ElementId,
  field: keyof ElementOverride,
): void {
  const beat = scene.beats[beatIndex];
  const ov = beat?.overrides[id];
  if (!ov) return;
  delete ov[field];
  if (Object.keys(ov).length === 0) delete beat!.overrides[id];
}

/**
 * Cycle an emphasis control through its four authoring states:
 *   inherit (undefined) → focus → dim → neutral → inherit
 * `neutral` is explicit (it actively resets emphasis a previous beat set);
 * `undefined` means "inherit", which is the absence of a delta.
 */
export function cycleEmphasis(
  current: ElementOverride['emphasis'],
): ElementOverride['emphasis'] {
  switch (current) {
    case undefined:
      return 'focus';
    case 'focus':
      return 'dim';
    case 'dim':
      return 'neutral';
    case 'neutral':
      return undefined;
  }
}

/**
 * The set of element ids whose presentation this beat authors (i.e. has an
 * override for). Drives the on-canvas "changed this beat" markers so the author
 * sees what a beat touches without reading a panel.
 */
export function authoredThisBeat(
  scene: Scene,
  beatIndex: number,
): Set<ElementId> {
  const beat = scene.beats[beatIndex];
  if (!beat) return new Set();
  return new Set(Object.keys(beat.overrides));
}
