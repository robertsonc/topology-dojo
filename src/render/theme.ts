/**
 * Render themes (#264). The vendored engine bakes a dark-tuned palette straight
 * into its SVG markup (dark card surfaces, light label text, white-alpha
 * overlays, bright accents) and has no colour-variable hooks, so a light theme
 * is applied the same way a brand palette is (`applyPalette` in
 * `vendor/topology-ds`): a final colour-substitution pass over the rendered
 * string. This module owns that remap table and the pass itself so the
 * headless MCP/flipbook path, the browser export and the live editor canvas all
 * produce the same light output.
 *
 * Pure string work — no DOM, no engine import — so it bundles for Node, the
 * Cloudflare Worker and the browser alike.
 */

export type RenderTheme = 'dark' | 'light';

/** What a remapped colour paints — documents intent; the contrast test keys on it. */
export type ThemeRole =
  | 'background'
  | 'surface'
  | 'text'
  | 'overlay'
  | 'accent';

export interface ThemeRemap {
  /** Engine source colour: `#rrggbb` (any case) or an exact `rgba(r,g,b,a)` literal. */
  from: string;
  /** Replacement, in the same form. */
  to: string;
  role: ThemeRole;
  /**
   * Part of the original light-canvas card remap (#8) that the icon-library
   * exporter also themes through CSS classes — see `LIGHT_CANVAS`.
   */
  card?: boolean;
}

/** Export backdrop fill per theme (the `<rect>` the SVG wrappers paint first). */
export const DARK_BACKGROUND = '#0e1613';
/** Matches the engine's own light canvas (`setTheme('light')` / `--tds-canvas-bg`). */
export const LIGHT_BACKGROUND = '#f0f1f3';

/**
 * The light remap table — every engine-sourced constant found in a rendered
 * page, keyed by evidence (a probe render of every node type, link labels,
 * zones, flow paths, markers, callouts, text boxes and the legend/caption),
 * not by memory. Tune here; nothing else carries colour values.
 *
 * Only `#hex` sources are also matched in their `rgb()/rgba()` channel form
 * (alpha preserved), so the label-glass gradient stops, the legend/caption
 * panels and the engine's translucent washes follow their base colour.
 *
 * Accents follow the engine's own light stylesheet (`.tds-root.tds-light`
 * `--tds-green/blue/purple/gold/red/orange/teal/coral`) where it defines one,
 * darkened further where that value did not reach the 3:1 contrast floor on
 * the light page. The brand palette is applied BEFORE this pass, so a document
 * palette colour is never touched (its engine source colour is already gone).
 *
 * Known limit, shared with the palette mechanism: the remap is string-based,
 * so a document that explicitly sets one of these exact engine constants as a
 * node/link colour is remapped with it.
 */
export const LIGHT_THEME_MAP: readonly ThemeRemap[] = [
  // Page background (the export wrapper backdrop; the editor canvas is CSS).
  { from: '#0e1613', to: LIGHT_BACKGROUND, role: 'background' },

  // Card / shape surfaces (dark → light). The first four are the #8 remap.
  { from: '#292d3a', to: '#ffffff', role: 'surface', card: true },
  { from: '#22252e', to: '#f2f5f8', role: 'surface', card: true },
  { from: '#1d1f27', to: '#e9edf2', role: 'surface', card: true },
  { from: '#3e4550', to: '#ccd4dc', role: 'surface', card: true },
  // Status-LED ring (separates the dot from the card).
  { from: '#0b0e14', to: '#ffffff', role: 'surface' },
  // Managed-switch screen / fibre-port wells (tinted dark fills on cards).
  { from: '#093d32', to: '#d7f3e8', role: 'surface' },
  { from: '#1a1a3a', to: '#e4e6f6', role: 'surface' },
  // Legend panel `rgba(20,24,32,0.86)` and caption panel `rgba(16,20,28,0.82)`.
  { from: '#141820', to: '#ffffff', role: 'surface' },
  { from: '#10141c', to: '#ffffff', role: 'surface' },

  // Text greys (light → dark). Must stay ≥ 4.5:1 on every light surface.
  { from: '#e6e8e9', to: '#1d1f27', role: 'text', card: true },
  { from: '#7d8a92', to: '#5c6b76', role: 'text' },
  { from: '#b1b9be', to: '#4a5661', role: 'text' },

  // White-alpha overlays → black-alpha at the same alpha (card highlight
  // lines, label-chip strokes, legend/caption borders). Any other
  // `rgba(255,255,255,a)` with a < 1 is flipped the same way as a fallback.
  { from: 'rgba(255,255,255,.03)', to: 'rgba(0,0,0,.03)', role: 'overlay' },
  { from: 'rgba(255,255,255,.04)', to: 'rgba(0,0,0,.04)', role: 'overlay' },
  { from: 'rgba(255,255,255,.06)', to: 'rgba(0,0,0,.06)', role: 'overlay' },
  { from: 'rgba(255,255,255,0.12)', to: 'rgba(0,0,0,0.12)', role: 'overlay' },
  { from: 'rgba(255,255,255,0.14)', to: 'rgba(0,0,0,0.14)', role: 'overlay' },
  // Policy-marker badge disc (dark disc under the icon → light disc).
  { from: 'rgba(0,0,0,.6)', to: 'rgba(255,255,255,.6)', role: 'overlay' },

  // Accents, darkened for ≥ 3:1 on the light page.
  { from: '#01a982', to: '#00875a', role: 'accent' }, // brand green
  { from: '#05cc93', to: '#048f68', role: 'accent' }, // bright green (LEDs, flows)
  { from: '#65aef9', to: '#2563eb', role: 'accent' }, // blue
  { from: '#deb146', to: '#9a7400', role: 'accent' }, // gold
  { from: '#e0a44a', to: '#a8700a', role: 'accent' }, // legend "warn" gold
  { from: '#fc6161', to: '#dc2626', role: 'accent' }, // red / alert
  { from: '#00a4b3', to: '#0e7490', role: 'accent' }, // teal
  { from: '#7764fc', to: '#6d4dd0', role: 'accent' }, // purple
  { from: '#ec8c25', to: '#c2700e', role: 'accent' }, // orange LEDs
  { from: '#d25f4b', to: '#b8432f', role: 'accent' }, // coral
];

/**
 * The #8 light-canvas card subset in the shape the icon-library exporter
 * consumes (`{from, rgb, to, toRgb}`, hex digits without `#`). Derived from
 * the table above so the two never drift.
 */
export const LIGHT_CANVAS: {
  from: string;
  rgb: string;
  to: string;
  toRgb: string;
}[] = LIGHT_THEME_MAP.filter((e) => e.card).map((e) => ({
  from: e.from.slice(1),
  rgb: hexChannels(e.from)!,
  to: e.to,
  toRgb: hexChannels(e.to)!,
}));

/** The backdrop fill the export wrappers paint for a theme. */
export function themeBackground(theme: RenderTheme | undefined): string {
  return theme === 'light' ? LIGHT_BACKGROUND : DARK_BACKGROUND;
}

/** Resolve the public option (plus the older `light` boolean alias). */
export function resolveTheme(opts: {
  theme?: RenderTheme;
  light?: boolean;
}): RenderTheme {
  return opts.theme ?? (opts.light ? 'light' : 'dark');
}

/** `#rrggbb` → `r,g,b`; null for anything not a 6-digit hex. */
export function hexChannels(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** `rgba( 1 , 2,3 , .5 )` → `rgba(1,2,3,.5)` (lower-case, no whitespace). */
function normalizeRgba(tok: string): string {
  return tok.toLowerCase().replace(/\s+/g, '');
}

interface Lookup {
  hex: Map<string, string>; // 'rrggbb' → '#rrggbb'
  channels: Map<string, string>; // 'r,g,b' → 'r,g,b'
  literal: Map<string, string>; // normalised rgba literal → replacement
}

const lookups = new Map<RenderTheme, Lookup>();

function lookupFor(theme: RenderTheme): Lookup {
  let lk = lookups.get(theme);
  if (lk) return lk;
  lk = { hex: new Map(), channels: new Map(), literal: new Map() };
  const table = theme === 'light' ? LIGHT_THEME_MAP : [];
  for (const e of table) {
    const fromCh = hexChannels(e.from);
    const toCh = hexChannels(e.to);
    if (fromCh && toCh) {
      lk.hex.set(e.from.slice(1).toLowerCase(), e.to.toLowerCase());
      lk.channels.set(fromCh, toCh);
    } else {
      lk.literal.set(normalizeRgba(e.from), e.to);
    }
  }
  lookups.set(theme, lk);
  return lk;
}

/** Every colour token the pass considers: 6/8-digit hex, or rgb()/rgba(). */
const COLOR_TOKEN =
  /#([0-9a-f]{6})([0-9a-f]{2})?\b|rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)/gi;

/**
 * Recolour rendered SVG markup for a theme. A single tokenising pass: each
 * colour token is looked up once, so entries never chain (`#e6e8e9 → #1d1f27`
 * text is not re-mapped by the `#1d1f27` surface entry) and the table order is
 * irrelevant. Hex matching is case-insensitive; an 8-digit `#rrggbbaa` keeps
 * its alpha byte; `rgb()/rgba()` forms of a hex source keep their alpha.
 * The dark theme is the engine's native output and returns the input as-is.
 */
export function applyRenderTheme(svg: string, theme: RenderTheme): string {
  if (theme !== 'light') return svg;
  const lk = lookupFor(theme);
  let out = svg.replace(
    COLOR_TOKEN,
    (
      tok,
      hex6?: string,
      hexA?: string,
      r?: string,
      g?: string,
      b?: string,
      a?: string,
    ) => {
      if (hex6) {
        const to = lk.hex.get(hex6.toLowerCase());
        return to ? to + (hexA ?? '') : tok;
      }
      const lit = lk.literal.get(normalizeRgba(tok));
      if (lit) return lit;
      const ch = `${Number(r)},${Number(g)},${Number(b)}`;
      const alpha = a !== undefined ? `,${a}` : '';
      const to = lk.channels.get(ch);
      if (to) return `${alpha ? 'rgba' : 'rgb'}(${to}${alpha})`;
      // Fallback: any translucent white overlay becomes the same-alpha black.
      if (ch === '255,255,255' && a !== undefined && Number(a) < 1)
        return `rgba(0,0,0${alpha})`;
      return tok;
    },
  );
  // Label chips fill from the `tds-labelGlass` gradient, whose stops use
  // `rgba()` — which Chromium ignores in SVG `stop-color`, falling back to
  // black. The stops are remapped above for coherence, but the chips are
  // swapped to a solid light fill so they read on a light canvas (#8).
  out = out.split('url(#tds-labelGlass)').join('#ffffff');
  return out;
}

/* ── Contrast helpers (WCAG 2.x relative luminance), used by the theme test ── */

/** `#rrggbb` → [r, g, b] in 0..255. */
export function hexToRgb(hex: string): [number, number, number] {
  const ch = hexChannels(hex);
  if (!ch) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const [r, g, b] = ch.split(',').map(Number) as [number, number, number];
  return [r, g, b];
}

/** WCAG relative luminance of an sRGB colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two opaque colours (1..21). */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Flatten an `rgba(r,g,b,a)` colour over an opaque `#rrggbb` backdrop. */
export function compositeOver(rgba: string, bgHex: string): string {
  const m =
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i.exec(
      rgba,
    );
  if (!m) throw new Error(`not an rgba() colour: ${rgba}`);
  const a = m[4] !== undefined ? Number(m[4]) : 1;
  const fg = [Number(m[1]), Number(m[2]), Number(m[3])];
  const bg = hexToRgb(bgHex);
  const mix = fg.map((c, i) => Math.round(c * a + bg[i]! * (1 - a)));
  return '#' + mix.map((c) => c.toString(16).padStart(2, '0')).join('');
}
