import type {
  Beat,
  ElementId,
  ResolvedElement,
  ResolvedScene,
  Scene,
  Topology,
} from './model.js';

/**
 * Every element's presentation state at "beat 0" (base topology, before any
 * authored beat). Default: everything visible, at its model position, neutral.
 *
 * Rationale: the base topology is what you see in the editor with no beat
 * selected, so it must be fully visible — otherwise authoring is blind.
 */
function baseElements(topology: Topology): Record<ElementId, ResolvedElement> {
  const out: Record<ElementId, ResolvedElement> = {};

  for (const node of Object.values(topology.nodes)) {
    out[node.id] = {
      visible: true,
      x: node.x,
      y: node.y,
      emphasis: 'neutral',
      flowActive: false,
    };
  }
  for (const link of Object.values(topology.links)) {
    // Links don't carry their own position; x/y are unused for links but kept
    // for a uniform ResolvedElement shape. Renderer reads endpoints from nodes.
    out[link.id] = {
      visible: true,
      x: 0,
      y: 0,
      emphasis: 'neutral',
      flowActive: false,
    };
  }
  return out;
}

/**
 * Apply one beat's overrides on top of an already-resolved state, returning a
 * new state (no mutation). `undefined` fields inherit — that's the delta model.
 */
function applyBeat(
  prev: Record<ElementId, ResolvedElement>,
  beat: Beat,
): Record<ElementId, ResolvedElement> {
  const next: Record<ElementId, ResolvedElement> = {};
  // Clone prior state first (set-and-hold inheritance).
  for (const [id, el] of Object.entries(prev)) {
    next[id] = { ...el };
  }

  for (const [id, ov] of Object.entries(beat.overrides)) {
    const target = next[id];
    if (!target) {
      // An override referencing a non-existent element is an authoring error.
      // We surface it loudly rather than silently rendering nothing (the
      // single worst bug-class of the old model).
      throw new ResolveError(
        `Beat "${beat.name}" (${beat.id}) overrides unknown element "${id}"`,
      );
    }
    if (ov.visible !== undefined) target.visible = ov.visible;
    if (ov.x !== undefined) target.x = ov.x;
    if (ov.y !== undefined) target.y = ov.y;
    if (ov.emphasis !== undefined) target.emphasis = ov.emphasis;
    if (ov.flowActive !== undefined) target.flowActive = ov.flowActive;
  }
  return next;
}

export class ResolveError extends Error {
  override name = 'ResolveError';
}

/**
 * Resolve the scene up to and including `beatIndex`.
 * beatIndex = -1 -> base topology only (the editor's "no beat" view).
 * beatIndex = 0  -> base + beats[0], etc.
 */
export function resolve(scene: Scene, beatIndex: number): ResolvedScene {
  const { topology, beats } = scene;

  if (beatIndex < -1 || beatIndex >= beats.length) {
    throw new ResolveError(
      `beatIndex ${beatIndex} out of range [-1, ${beats.length - 1}]`,
    );
  }

  let elements = baseElements(topology);
  for (let i = 0; i <= beatIndex; i++) {
    const beat = beats[i];
    if (!beat) continue; // satisfies noUncheckedIndexedAccess
    elements = applyBeat(elements, beat);
  }

  const activeBeat = beatIndex >= 0 ? beats[beatIndex] : undefined;
  return {
    topology,
    elements,
    beatIndex,
    beatName: activeBeat?.name ?? 'Base',
    ...(activeBeat?.note !== undefined ? { note: activeBeat.note } : {}),
  };
}

/**
 * Validate the whole scene without rendering — every beat resolves cleanly and
 * references only existing elements. Returns the list of problems (empty = ok).
 * This is the compile-time-ish safety net the old JS model lacked.
 */
export function validate(scene: Scene): string[] {
  const problems: string[] = [];
  for (let i = 0; i < scene.beats.length; i++) {
    try {
      resolve(scene, i);
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  return problems;
}
