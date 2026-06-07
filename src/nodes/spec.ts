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
  ledPos: 'bottom' | 'top' | 'left' | 'right';
  badge: boolean;
  badgeText: string;
  badgeColor: string;
  antenna: boolean;
  ports: boolean;
  portCount: number;
  portPos: 'bottom' | 'top';
}

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
