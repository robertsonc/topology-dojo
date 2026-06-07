import type { ElementId, ResolvedScene } from './model.js';

export interface ElementTransition {
  id: ElementId;
  /** Appearing this beat (was invisible, now visible). */
  entering: boolean;
  /** Disappearing this beat. */
  exiting: boolean;
  /** Moved position — drives Magic-Move tweening. */
  moved: boolean;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Emphasis changed (e.g. neutral -> focus). */
  emphasisChanged: boolean;
  fromEmphasis: 'focus' | 'dim' | 'neutral';
  toEmphasis: 'focus' | 'dim' | 'neutral';
  flowChanged: boolean;
}

export interface Transition {
  fromBeat: number;
  toBeat: number;
  elements: ElementTransition[];
}

/**
 * Compute the per-element transition between two already-resolved scenes.
 * The presenter uses this to animate only what actually changed — you author
 * states, the engine derives the motion.
 */
export function diff(prev: ResolvedScene, next: ResolvedScene): Transition {
  const ids = new Set<ElementId>([
    ...Object.keys(prev.elements),
    ...Object.keys(next.elements),
  ]);

  const elements: ElementTransition[] = [];
  for (const id of ids) {
    const a = prev.elements[id];
    const b = next.elements[id];
    // Element only exists in one scene (shouldn't happen — topology is shared —
    // but guard for safety with noUncheckedIndexedAccess).
    if (!a || !b) continue;

    const entering = !a.visible && b.visible;
    const exiting = a.visible && !b.visible;
    const moved = a.x !== b.x || a.y !== b.y;
    const emphasisChanged = a.emphasis !== b.emphasis;
    const flowChanged = a.flowActive !== b.flowActive;

    if (entering || exiting || moved || emphasisChanged || flowChanged) {
      elements.push({
        id,
        entering,
        exiting,
        moved,
        from: { x: a.x, y: a.y },
        to: { x: b.x, y: b.y },
        emphasisChanged,
        fromEmphasis: a.emphasis,
        toEmphasis: b.emphasis,
        flowChanged,
      });
    }
  }

  return { fromBeat: prev.beatIndex, toBeat: next.beatIndex, elements };
}
