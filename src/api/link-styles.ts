/**
 * Link styles (proposal 0008, W1) — a document-level key for wire CLASSES.
 *
 * A wiring sheet colours every cable by its media and speed ("100GBASE-DA
 * (DAC)" red, "25GBASE-DA (DAC)" blue …) and prints the mapping in a Key.
 * Rather than repeating a colour on a hundred links, a document declares the
 * classes once (`doc.linkStyles`) and each link names one (`link.style`).
 *
 * Precedence on a link: an explicit `color` / `strokeWidth` / `dashed` wins,
 * then the style, then the link type's default — so every existing document
 * renders byte-identically. `bandwidth` / `transport` stay DATA on the link;
 * a style is the PRESENTATION of a class.
 *
 * Pure + DOM-free: resolved at render time by the browser facade and the
 * headless render core, read by the legend (one `line` row per style in use)
 * and by the derived port tables (the PHY column).
 */
import type { LinkConfig } from '../vendor/topology-ds.js';

export const LINK_STYLE_DASHES = ['solid', 'dashed', 'dotted'] as const;
export type LinkStyleDash = (typeof LINK_STYLE_DASHES)[number];

/** A declared wire class. */
export interface LinkStyleDef {
  id: string;
  /** The Key row text, e.g. "100GBASE-DA (DAC)". Falls back to the id. */
  label?: string;
  color: string;
  /** Stroke width (px). Absent = the link type's default (2 for a line). */
  width?: number;
  /** Absent = solid. The engine draws dashed and dotted alike ("6 4"). */
  dash?: LinkStyleDash;
}

/** Stroke width bounds the catalog advertises and `validate` enforces. */
export const LINK_STYLE_WIDTH_RANGE: readonly [number, number] = [0.25, 12];

/**
 * The Ethernet media starter set — the eleven classes of the reference
 * wiring sheet, so an agent never invents colours. Ids are stable; a
 * document copies the entries it needs (`define_link_style` with
 * `preset: 'ethernet-media'` loads them all).
 */
export const ETHERNET_MEDIA_STYLES: readonly LinkStyleDef[] = [
  { id: '10g-dac', label: '10GBASE-DA (DAC)', color: '#1a9e5c' },
  { id: '10g-sr', label: '10GBASE-SR (MMF)', color: '#e8862a' },
  { id: '10g-lr', label: '10GBASE-LR (SMF)', color: '#2f9fd8' },
  { id: 'nbase-t', label: 'NBASE-T', color: '#5b4b8a' },
  { id: '25g-dac', label: '25GBASE-DA (DAC)', color: '#1f5fbf' },
  { id: '40g-dac', label: '40GBASE-DA (DAC)', color: '#e6c02a' },
  { id: '40g-lr', label: '40GBASE-LR (SMF)', color: '#b89a00' },
  { id: '50g-dac', label: '50GBASE-DA (DAC)', color: '#5c3d99' },
  { id: '50g-lr', label: '50GBASE-LR (SMF)', color: '#8f7ab8' },
  { id: '100g-dac', label: '100GBASE-DA (DAC)', color: '#e01b24' },
  { id: '100g-lr', label: '100GBASE-LR (SMF)', color: '#8c1a1a' },
];

/** Named starter sets a document can load wholesale. */
export const LINK_STYLE_PRESETS: Readonly<
  Record<string, readonly LinkStyleDef[]>
> = {
  'ethernet-media': ETHERNET_MEDIA_STYLES,
};

/** The Key row text for a style. */
export function linkStyleLabel(def: LinkStyleDef): string {
  return def.label?.trim() || def.id;
}

/** Find a declared style by id. */
export function findLinkStyle(
  styles: readonly LinkStyleDef[] | undefined,
  id: unknown,
): LinkStyleDef | undefined {
  if (typeof id !== 'string' || !id || !styles) return undefined;
  return styles.find((s) => s.id === id);
}

/**
 * The link config the renderer draws: the link's own `color` / `strokeWidth`
 * / `dashed` where set, else the named style's. Returns the input object
 * itself when nothing changes (no style, or unknown style), so unstyled
 * documents take the same path they always did.
 */
export function resolveLinkStyle<T extends LinkConfig>(
  link: T,
  styles: readonly LinkStyleDef[] | undefined,
): T {
  const def = findLinkStyle(styles, link.style);
  if (!def) return link;
  const out: Record<string, unknown> = { ...link };
  if (link.color === undefined || link.color === '') out.color = def.color;
  if (
    def.width !== undefined &&
    (link.strokeWidth === undefined || link.strokeWidth === '')
  )
    out.strokeWidth = def.width;
  if (def.dash && def.dash !== 'solid' && link.dashed === undefined)
    out.dashed = true;
  return out as T;
}

/**
 * Declare (or update, by id) a document link style. Returns the stored
 * list. An invalid colour is rejected by `validate`; this only normalises.
 */
export function defineLinkStyle(
  doc: { linkStyles?: LinkStyleDef[] },
  def: LinkStyleDef,
): LinkStyleDef[] {
  const styles = (doc.linkStyles ??= []);
  const next: LinkStyleDef = {
    id: def.id,
    color: def.color,
    ...(def.label !== undefined ? { label: def.label } : {}),
    ...(def.width !== undefined ? { width: def.width } : {}),
    ...(def.dash !== undefined && def.dash !== 'solid'
      ? { dash: def.dash }
      : {}),
  };
  const i = styles.findIndex((s) => s.id === def.id);
  if (i >= 0) styles[i] = next;
  else styles.push(next);
  return styles;
}

/** The ids of styles used by at least one link on a page, in declaration order. */
export function usedLinkStyles(
  styles: readonly LinkStyleDef[] | undefined,
  links: readonly LinkConfig[],
): LinkStyleDef[] {
  if (!styles?.length) return [];
  const used = new Set<string>();
  for (const l of links) if (typeof l.style === 'string') used.add(l.style);
  return styles.filter((s) => used.has(s.id));
}
