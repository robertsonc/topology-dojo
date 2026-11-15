/**
 * CustomNodeSpec — the declarative description of a user-designed node type.
 *
 * This is the legacy designer's flat `S` model, stored AS DATA in the document
 * (not generated code): serializable, re-editable, and rendered by a single
 * interpreter (`renderCustomNode`). One spec → one registered node type.
 */
import type { PatternKey, ShapeKey } from './data.js';

export interface CustomNodeSpec {
  /** The node-type name (used as `node.type` and in the palette). */
  typeName: string;
  shape: ShapeKey;
  icon: string | null;
  colorStroke: string;
  colorFill: string;
  size: number;
  strokeW: number;
  radius: number;
  glow: boolean;
  highlight: boolean;
  innerRing: boolean;
  pattern: boolean;
  patternType: PatternKey;
  leds: boolean;
  ledCount: number;
  ledColor: string;
  ledPos: (typeof LED_POSITIONS)[number];
  badge: boolean;
  badgeText: string;
  badgeColor: string;
  antenna: boolean;
  ports: boolean;
  portCount: number;
  portPos: (typeof PORT_POSITIONS)[number];
}

/** The designer's slider bounds for the numeric fields. */
export const DESIGNER_RANGES = {
  size: [12, 48],
  strokeW: [0.5, 4],
  radius: [0, 20],
  ledCount: [1, 4],
  portCount: [2, 8],
} as const satisfies Record<string, readonly [number, number]>;

/**
 * What a document may hold for the numeric fields: the designer's ranges,
 * except where the product itself goes further through the authoring API —
 * the shipped patch-panel art draws a 24-port row (`stock.ts`) and the
 * reference wiring sheet a size-60, 48-port chassis
 * (`scripts/build-wiring-sheet-fixture.ts`).
 */
export const CUSTOM_NODE_RANGES = {
  ...DESIGNER_RANGES,
  size: [12, 96],
  portCount: [2, 48],
} as const satisfies Record<
  keyof typeof DESIGNER_RANGES,
  readonly [number, number]
>;

/** The longest badge text a spec keeps. */
export const CUSTOM_NODE_BADGE_MAX = 32;

export const LED_POSITIONS = ['bottom', 'top', 'left', 'right'] as const;
export const PORT_POSITIONS = ['bottom', 'top'] as const;

export function defaultSpec(): CustomNodeSpec {
  return {
    typeName: 'myNode',
    shape: 'circle',
    icon: null,
    colorStroke: '#01a982',
    colorFill: '#292d3a',
    size: 24,
    strokeW: 1.2,
    radius: 3,
    glow: true,
    highlight: true,
    innerRing: false,
    pattern: false,
    patternType: 'none',
    leds: false,
    ledCount: 2,
    ledColor: '#05cc93',
    ledPos: 'bottom',
    badge: false,
    badgeText: 'EDGE',
    badgeColor: '#01a982',
    antenna: false,
    ports: false,
    portCount: 4,
    portPos: 'bottom',
  };
}
