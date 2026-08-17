/**
 * Shared display-text limits and normalizer.
 *
 * Catalog field specs advertise these caps, Zod rejects overlong MCP input,
 * and `parseDoc` truncates so a hostile or hand-edited document can never
 * carry unbounded free-text into the editor, renderer, or MCP context.
 */
export const TEXT_LIMITS = {
  /** Node/link/zone/marker labels, sublabels, and other short display strings. */
  label: 200,
  sublabel: 200,
  /** Page/frame narration shown during playback and export. */
  caption: 500,
  /** Zone description (and similarly long notes). */
  description: 1000,
  /** Node / flow-hop `meta` string values. */
  metaValue: 2000,
  /** Document title, proposal title. */
  title: 160,
  /** Proposal rationale. */
  rationale: 2000,
  /** Page, stencil, layer, and palette display names. */
  name: 200,
  /** Named workspace checkpoints (already enforced at the coordinator). */
  checkpointName: 120,
  /** URLs and other long-but-single-line strings (e.g. saas logoUrl). */
  url: 2000,
} as const;

export type TextLimit = (typeof TEXT_LIMITS)[keyof typeof TEXT_LIMITS];

export interface NormalizeTextOptions {
  /**
   * Keep newline boundaries (caption / description / rationale). Other
   * whitespace still collapses; C0/C1 controls are stripped in both modes.
   */
  multiline?: boolean;
}

/**
 * Per-key rules for free-text fields that appear on documents and patches.
 * Unknown keys are left alone (ids, types, colours, geometry).
 */
export const DISPLAY_FIELD_LIMITS: Readonly<
  Record<string, { max: number; multiline?: boolean }>
> = {
  label: { max: TEXT_LIMITS.label },
  sublabel: { max: TEXT_LIMITS.sublabel },
  fromLabel: { max: TEXT_LIMITS.label },
  toLabel: { max: TEXT_LIMITS.label },
  user: { max: TEXT_LIMITS.label },
  host: { max: TEXT_LIMITS.label },
  role: { max: TEXT_LIMITS.label },
  sub1: { max: TEXT_LIMITS.label },
  sub2: { max: TEXT_LIMITS.label },
  vlan: { max: TEXT_LIMITS.label },
  subnet: { max: TEXT_LIMITS.label },
  bandwidth: { max: TEXT_LIMITS.label },
  transport: { max: TEXT_LIMITS.label },
  reason: { max: TEXT_LIMITS.label },
  icon: { max: TEXT_LIMITS.label },
  fontWeight: { max: TEXT_LIMITS.label },
  badgeText: { max: TEXT_LIMITS.label },
  caption: { max: TEXT_LIMITS.caption, multiline: true },
  description: { max: TEXT_LIMITS.description, multiline: true },
  rationale: { max: TEXT_LIMITS.rationale, multiline: true },
  title: { max: TEXT_LIMITS.title },
  name: { max: TEXT_LIMITS.name },
  logoUrl: { max: TEXT_LIMITS.url },
  // Element hyperlinks + hover tooltips (the gap-closing batch). NOTE:
  // `imageHref` is deliberately absent — truncating a data URI would corrupt
  // the image silently; validation errors above 256KB instead.
  href: { max: TEXT_LIMITS.url },
  tooltip: { max: TEXT_LIMITS.caption },
};

/** C0/C1 controls except TAB / LF / CR (those are handled as whitespace). */
// eslint-disable-next-line no-control-regex -- the point of this class is to strip them
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Strip control characters and normalize whitespace. Does not truncate —
 * callers that must reject overlong input (Zod) check length on the raw
 * string; callers that must always produce a valid document (`parseDoc`)
 * use `boundText`.
 */
export function normalizeText(
  input: string,
  opts: NormalizeTextOptions = {},
): string {
  let s = input.normalize('NFC').replace(CONTROL_CHARS, '');
  if (opts.multiline) {
    s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    s = s.replace(/[^\S\n]+/g, ' ');
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.trim();
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** Normalize, then truncate to `max` (UTF-16 code units). */
export function boundText(
  input: string,
  max: number,
  opts: NormalizeTextOptions = {},
): string {
  const s = normalizeText(input, opts);
  return s.length > max ? s.slice(0, max) : s;
}

/** Bound every string value in a flat meta map; drop empty keys. */
export function sanitizeMetaMap(meta: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(meta)) {
    const nextKey = boundText(key, TEXT_LIMITS.label);
    const nextValue =
      typeof value === 'string'
        ? boundText(value, TEXT_LIMITS.metaValue)
        : value;
    if (nextKey !== key) delete meta[key];
    if (!nextKey) continue;
    meta[nextKey] = nextValue;
  }
}

/**
 * Walk a document / element / patch and bound known display strings + meta
 * maps in place. Structural fields (ids, types, colours, geometry) are
 * untouched.
 */
export function sanitizeDisplayFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) sanitizeDisplayFields(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const rec = value as Record<string, unknown>;
  for (const [key, v] of Object.entries(rec)) {
    if (key === 'meta' && v && typeof v === 'object' && !Array.isArray(v)) {
      sanitizeMetaMap(v as Record<string, unknown>);
      continue;
    }
    const rule = DISPLAY_FIELD_LIMITS[key];
    if (rule && typeof v === 'string') {
      rec[key] = boundText(v, rule.max, rule);
      continue;
    }
    if (v && typeof v === 'object') sanitizeDisplayFields(v);
  }
}

/**
 * If `value` is an overlong display string for `key`, return the cap;
 * otherwise null. Used by Zod to reject (not truncate) at the API boundary.
 */
export function overlongDisplayMax(key: string, value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const rule = DISPLAY_FIELD_LIMITS[key];
  if (rule && value.length > rule.max) return rule.max;
  return null;
}

/** True when a meta string value exceeds the cap (keys use the label cap). */
export function overlongMetaMax(
  key: string,
  value: unknown,
): { path: string; max: number } | null {
  if (key.length > TEXT_LIMITS.label)
    return { path: key, max: TEXT_LIMITS.label };
  if (typeof value === 'string' && value.length > TEXT_LIMITS.metaValue)
    return { path: key, max: TEXT_LIMITS.metaValue };
  return null;
}
