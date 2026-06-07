/**
 * Core domain model for the topology studio.
 *
 * Design note: every element is keyed by a stable string `id`. Beats reference
 * elements by id, and tweening relies on identity being stable across beats.
 * This is the invariant the whole choreography model rests on.
 */

export type ElementId = string;

export type NodeType =
  | 'ec'
  | 'switch'
  | 'cloud'
  | 'host'
  | 'router'
  | 'firewall'
  | 'server'
  | 'generic';

export interface NodeModel {
  readonly id: ElementId;
  type: NodeType;
  /** Canvas position. The single source of truth the tween engine diffs against. */
  x: number;
  y: number;
  label: string;
  /** Optional override color; otherwise the renderer falls back to the type default. */
  color?: string;
  /** Editing-only grouping. NOT a playback axis (deliberate demotion from the old model). */
  layerId: ElementId;
  zoneId?: ElementId;
}

export type LinkType = 'line' | 'tunnel' | 'tunnel3d' | 'flow' | 'blocked';

export interface Waypoint {
  x: number;
  y: number;
}

export interface LinkModel {
  readonly id: ElementId;
  type: LinkType;
  from: ElementId;
  to: ElementId;
  label?: string;
  color?: string;
  waypoints: Waypoint[];
  layerId: ElementId;
}

export interface ZoneModel {
  readonly id: ElementId;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface LayerModel {
  readonly id: ElementId;
  name: string;
  /** Editing convenience: hide a layer while authoring. Not part of playback. */
  hiddenInEditor: boolean;
  locked: boolean;
}

/**
 * The full design state, independent of any beat.
 * This is what the renderer can draw on its own (the "base" topology).
 */
export interface Topology {
  nodes: Record<ElementId, NodeModel>;
  links: Record<ElementId, LinkModel>;
  zones: Record<ElementId, ZoneModel>;
  layers: Record<ElementId, LayerModel>;
  viewBox: [number, number, number, number];
  title: string;
}

/**
 * Per-element presentation overrides that a beat can apply.
 * `undefined` means "inherit from previous resolved state" — this is what makes
 * beats deltas rather than full snapshots.
 */
export interface ElementOverride {
  /** Visible at this beat? */
  visible?: boolean;
  /** Position override (enables Magic-Move style tweening between beats). */
  x?: number;
  y?: number;
  /** Emphasis: 'focus' brightens, 'dim' fades, 'neutral' explicitly resets. undefined = inherit. */
  emphasis?: 'focus' | 'dim' | 'neutral';
  /** For links: whether animated flow particles run. */
  flowActive?: boolean;
}

/**
 * A Beat is a named, ordered checkpoint. It stores ONLY the deltas relative to
 * the previous beat's resolved state. Advancing the presenter = apply next beat.
 *
 * This single structure replaces Act -> Step -> Phase + the parallel
 * layer-visibility timeline.
 */
export interface Beat {
  readonly id: ElementId;
  name: string;
  /** Element id -> override applied at this beat. */
  overrides: Record<ElementId, ElementOverride>;
  /** Presenter notes shown in the speaker panel (replaces the narrator). */
  note?: string;
}

export interface Scene {
  topology: Topology;
  /** Beat 0 is the implicit base; beats[] are the authored deltas after it. */
  beats: Beat[];
}

/**
 * Fully resolved presentation state at a given beat index — what the renderer
 * actually consumes. No deltas, no inheritance: everything is concrete.
 */
export interface ResolvedElement {
  visible: boolean;
  x: number;
  y: number;
  emphasis: 'focus' | 'dim' | 'neutral';
  flowActive: boolean;
}

export interface ResolvedScene {
  topology: Topology;
  /** element id -> concrete resolved presentation state */
  elements: Record<ElementId, ResolvedElement>;
  beatIndex: number;
  beatName: string;
  note?: string;
}
