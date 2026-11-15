/**
 * The one check every custom node spec passes on its way into a document —
 * the parse gate (`parseDoc`), the headless builder (`defineNodeType`), the
 * `define_node_type` agent tool, and the designer's save. The spec is rebuilt
 * from the fields the designer can produce: numbers are finite and inside the
 * designer's own ranges, settings are one of their listed values, flags are
 * booleans, the icon is a known icon, colours are markup-safe and the badge
 * text is bounded. Any other key is dropped.
 */
import { safeColor, safeType } from '../pages/safe-tokens.js';
import { ICONS, PATTERN_KEYS, SHAPE_KEYS } from './data.js';
import {
  CUSTOM_NODE_BADGE_MAX,
  CUSTOM_NODE_RANGES,
  LED_POSITIONS,
  PORT_POSITIONS,
  defaultSpec,
  type CustomNodeSpec,
} from './spec.js';

type NumericKey = keyof typeof CUSTOM_NODE_RANGES;

/** A finite number (or numeric string) clamped into `key`'s range, else `fallback`. */
export function specNumber(
  key: NumericKey,
  v: unknown,
  fallback: number,
): number {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim() !== ''
        ? Number(v)
        : NaN;
  if (!Number.isFinite(n)) return fallback;
  const [lo, hi] = CUSTOM_NODE_RANGES[key];
  // Counts drive loops: whole numbers only.
  const value = key === 'ledCount' || key === 'portCount' ? Math.round(n) : n;
  return Math.min(hi, Math.max(lo, value));
}

/** Whether `v` names one of the designer's icons (own keys only). */
export function isIconKey(v: unknown): v is string {
  return (
    typeof v === 'string' && Object.prototype.hasOwnProperty.call(ICONS, v)
  );
}

function oneOf<T extends string>(
  v: unknown,
  list: readonly T[],
  fallback: T,
): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

/**
 * Rebuild a custom node spec from its allowed fields; null when it has no
 * markup-safe type name. A spec the product made comes back equal to itself.
 */
export function sanitizeCustomNode(raw: unknown): CustomNodeSpec | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return null;
  const s = raw as Record<string, unknown>;
  const typeName = safeType(s.typeName, '');
  if (!typeName) return null;
  const def = defaultSpec();
  // A missing or non-boolean flag is off — what the renderer drew for it.
  const flag = (v: unknown): boolean => v === true;
  // Same key order as `defaultSpec`, so a saved document reads the same.
  return {
    typeName,
    shape: oneOf(s.shape, SHAPE_KEYS, def.shape),
    icon: isIconKey(s.icon) ? s.icon : null,
    colorStroke: safeColor(s.colorStroke) ?? def.colorStroke,
    colorFill: safeColor(s.colorFill) ?? def.colorFill,
    size: specNumber('size', s.size, def.size),
    strokeW: specNumber('strokeW', s.strokeW, def.strokeW),
    radius: specNumber('radius', s.radius, def.radius),
    glow: flag(s.glow),
    highlight: flag(s.highlight),
    innerRing: flag(s.innerRing),
    pattern: flag(s.pattern),
    patternType: oneOf(s.patternType, PATTERN_KEYS, def.patternType),
    leds: flag(s.leds),
    ledCount: specNumber('ledCount', s.ledCount, def.ledCount),
    ledColor: safeColor(s.ledColor) ?? def.ledColor,
    ledPos: oneOf(s.ledPos, LED_POSITIONS, def.ledPos),
    badge: flag(s.badge),
    badgeText:
      typeof s.badgeText === 'string'
        ? s.badgeText.slice(0, CUSTOM_NODE_BADGE_MAX)
        : '',
    badgeColor: safeColor(s.badgeColor) ?? def.badgeColor,
    antenna: flag(s.antenna),
    ports: flag(s.ports),
    portCount: specNumber('portCount', s.portCount, def.portCount),
    portPos: oneOf(s.portPos, PORT_POSITIONS, def.portPos),
  };
}
