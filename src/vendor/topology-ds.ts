/**
 * Typed facade over the vendored legacy rendering engine (`public/vendor/
 * topology-ds.js`, loaded as a classic script that sets `window.TopologyDesigner`).
 *
 * We reuse the legacy engine purely as a RENDERER. A "page" is rendered by
 * building a throwaway TopologyDesigner from the page's elements plus a single
 * step that shows everything, then asking the engine for its SVG. None of the
 * choreography (Acts/Steps/Phases) is exposed upward — pages replace it.
 *
 * The seam (validated against the engine): wrap output in
 *   `.tds-root > .tds-canvas > svg[viewBox]`
 * set `step` to the last (1-based) index so every element's show-phase is
 * satisfied, then read `_renderSVG()`.
 */

/**
 * Link anchor box (EXPERIMENTAL, opt-in). When a page or node carries this
 * object, link endpoints attach to an ANCHOR BOX instead of the icon
 * silhouette: the node's hit box inflated by `pad` (default 6) on every side,
 * with the side carrying the label extended to clear the label block — so a
 * south-attached link no longer runs through the label text. `distribute`
 * spreads every endpoint on a side into evenly spaced slots (ordered by the
 * far end's position, so links never cross at the node). A node's object
 * merges over the page's. Absent on both = the classic attachment, unchanged.
 * Mirrored headlessly by `render/link-attach` (the inspect_render geometry).
 */
export interface LinkAttachOptions {
  /** Inflation of the hit box, px (≥ 0). Default 6 when the object is present. */
  pad?: number;
  /** Spread the endpoints on each side of the node into even slots. */
  distribute?: boolean;
}

/** A node on a page — the legacy node config shape (permissive by design). */
export interface NodeConfig {
  id: string;
  type: string;
  x: number;
  y: number;
  label?: string;
  sublabel?: string;
  /**
   * Long-form paragraph text (up to TEXT_LIMITS.body, newlines kept).
   * Rendered only by the `callout` and `text` node types, as a word-wrapped
   * block between the label and the sublabel; other types ignore it.
   */
  body?: string;
  color?: string;
  /** Node opacity, 0–1 (defaults to 1). */
  opacity?: number;
  /** Colour of the node's label text. */
  labelColor?: string;
  /**
   * Where the label sits relative to the node: a compass code. Absent = `'s'`
   * (the classic centred label below the node). East/west placements anchor
   * the text just outside the glyph; north placements stack label + sublabel
   * above it. Shape nodes default to a label inside the shape; any placement
   * moves it outside.
   */
  labelPlacement?: 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
  /**
   * Absolute vertical offset of the label baseline from the node centre
   * (positive = down). Overrides the placement's default distance (24 below
   * for the classic placement).
   */
  labelOffset?: number;
  /** Absolute horizontal offset of the label anchor from the node centre. */
  labelOffsetX?: number;
  /**
   * Wrap width (px) for the classic label block. Absent = the label is cut
   * at 24 characters with an ellipsis and the sublabel wraps at ~26
   * characters (2 lines); set, both wrap at this width (label: 2 lines of
   * 10px; sublabel: 2 lines of 7.5px). The renderer clamps to [40, 600].
   * See render/node-labels.
   */
  labelWidth?: number;
  /** When true, the editor won't move the node (drag/marquee/nudge skip it). */
  locked?: boolean;
  /**
   * Free-form key/value metadata for real-network attributes — serial numbers,
   * software versions, hostnames, site/cluster names, etc. Flat primitives only;
   * ignored by the renderer, carried in the document, editable via API/MCP/GUI.
   */
  meta?: Record<string, string | number | boolean>;
  /** Hyperlink: rendered as a clickable <a> (http(s) only) in SVG/viewer. */
  href?: string;
  /** Hover tooltip, rendered as an SVG <title>. */
  tooltip?: string;
  /**
   * Operational status — rendered as a coloured LED at the node's corner
   * (and in the legend when any node on the page uses one). Hand-authored
   * today; the seam live-import / failure-storytelling data can drive.
   */
  status?: 'ok' | 'warn' | 'down' | 'maintenance' | 'unknown';
  /** Id of a declared document layer (see api/layers); absent = base layer. */
  layer?: string;
  /** External identity in a source system (see api/source); enables upsert. */
  source?: SourceRef;
  /**
   * EXPERIMENTAL: per-node link anchor box, merged over the page's
   * `linkAttach` (see `LinkAttachOptions`). Present = active for this node
   * even when the page has no setting.
   */
  linkAttach?: LinkAttachOptions;
  [key: string]: unknown;
}

/** A link on a page — the legacy link config shape. */
export interface LinkConfig {
  id: string;
  type: string;
  from: string;
  to: string;
  color?: string;
  label?: string;
  /** Endpoint (interface/port) labels near the link's source and destination. */
  fromLabel?: string;
  toLabel?: string;
  /**
   * Moveable label offsets, doc-space {x,y}, set by dragging the chip in the
   * editor. `labelOffset` shifts the centre label (honoured by every link type);
   * `from`/`toLabelOffset` shift the endpoint (port) labels. All optional and
   * backward-compatible (absent = the default auto-placement).
   */
  labelOffset?: { x: number; y: number };
  fromLabelOffset?: { x: number; y: number };
  toLabelOffset?: { x: number; y: number };
  /**
   * Per-link label size multiplier, applied to every one of this link's labels
   * (centre + endpoint) about their anchor so the glass chip and text stay in
   * proportion. Absent = `1` (the default size); the renderer clamps to
   * [0.25, 4]. Backward-compatible: unset documents render unchanged.
   */
  labelScale?: number;
  /**
   * Wrap width (px) for the centre label's text. Absent = auto-wrap at ~26
   * characters; the renderer clamps to [40, 600]. The pill sizes to the
   * wrapped block (see render/wire-labels).
   */
  labelWidth?: number;
  waypoints?: { x: number; y: number }[];
  lineStyle?: 'orthogonal' | 'curved';
  /**
   * A.5 connection ports — pin an endpoint to a node side/corner. Absent = the
   * A.4 auto-boundary (attach to the perimeter facing the other end).
   */
  fromPort?: 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
  toPort?: 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
  /**
   * EXPERIMENTAL (link anchor box): fractional shift of the endpoint along
   * the side it attaches to, in [-1, 1] (0 = the side's centre line, ±1 = its
   * ends; clamped). Applies to side ports (n/s/e/w) and auto endpoints,
   * ignored for corner ports, and only when `linkAttach` is active for the
   * node at that end.
   */
  fromPortOffset?: number;
  toPortOffset?: number;
  /**
   * B.2 first-class link metadata — renderable on the wire when `showMeta` is
   * set. Endpoint interface names reuse `fromLabel`/`toLabel`. All optional and
   * machine-populatable (north-star data feed).
   */
  vlan?: string | number;
  subnet?: string;
  bandwidth?: string;
  transport?: string;
  showMeta?: boolean;
  /** When true, the editor won't move/edit the link via direct manipulation. */
  locked?: boolean;
  /** Per-link animated-flow controls (tunnel / wireguard / flow types). */
  flowSpeed?: number;
  flowParticles?: number;
  reverseFlow?: boolean;
  /** Hyperlink: rendered as a clickable <a> (http(s) only) in SVG/viewer. */
  href?: string;
  /** Hover tooltip, rendered as an SVG <title>. */
  tooltip?: string;
  /** Id of a declared document layer (see api/layers); absent = base layer. */
  layer?: string;
  /** External identity in a source system (see api/source); enables upsert. */
  source?: SourceRef;
  [key: string]: unknown;
}

/** A free-floating position marker usable as a link endpoint. */
export interface AnchorConfig {
  id: string;
  x: number;
  y: number;
}

/**
 * A zone — a labeled region that visually groups member nodes. The engine
 * auto-sizes a dashed/solid border around the members (+ padding); there is no
 * explicit rectangle to draw, so a zone is defined purely by its membership.
 */
export interface ZoneConfig {
  id: string;
  /** Ids of member nodes the region encompasses. */
  nodes: string[];
  label?: string;
  sublabel?: string;
  description?: string;
  color?: string;
  borderStyle?: 'dashed' | 'solid' | 'dotted';
  padding?: number;
  labelAlign?: 'left' | 'center' | 'right';
  /** Id of an enclosing zone (zones may nest). */
  parentZone?: string;
  /** Hyperlink: rendered as a clickable <a> (http(s) only) in SVG/viewer. */
  href?: string;
  /** Hover tooltip, rendered as an SVG <title>. */
  tooltip?: string;
  /** Id of a declared document layer (see api/layers); absent = base layer. */
  layer?: string;
  /** External identity in a source system (see api/source); enables upsert. */
  source?: SourceRef;
}

/**
 * Per-hop annotation paired with a flow path's waypoint sequence — which
 * link/tunnel a segment rode and its measurements. Machine-authored (by the
 * flow compiler); ignored by the renderer, carried in the document.
 */
export interface FlowHop {
  /** The waypoint id (node/anchor) this hop arrives at. */
  ref: string;
  /** Id of the page link (e.g. the tunnel) the segment traversed. */
  linkId?: string;
  /** Layer the segment belongs to (underlay/overlay plane). */
  layer?: string;
  /** Flat measurements/facts: tunnel id, latency ms, bytes, overlay name… */
  meta?: Record<string, string | number | boolean>;
}

/**
 * A flow path — an animated overlay route that threads through an ordered list
 * of node/anchor ids, drawn on top of the topology (particles / dashes / pulse).
 */
export interface FlowPathConfig {
  id: string;
  /** Ordered node/anchor ids the path passes through (≥2). */
  waypoints: string[];
  /**
   * Ride the drawn link between each consecutive waypoint pair (its curve,
   * bus waypoints, orthogonal route and ports) instead of a straight
   * centre→centre segment. A pair with no connecting link still gets the
   * straight hop. Default true; set false for plain centre→centre segments.
   */
  followLinks?: boolean;
  label?: string;
  /**
   * Moveable label offset, doc-space {x,y}, applied after the label is placed
   * on the longest drawn segment (same shape as a link's `labelOffset`).
   */
  labelOffset?: { x: number; y: number };
  /** Wrap width (px) for the label; absent = ~26 chars. Clamped to [40, 600]. */
  labelWidth?: number;
  name?: string;
  color?: string;
  animation?: 'particles' | 'dashed' | 'pulse';
  speed?: 'slow' | 'medium' | 'fast' | number;
  direction?: 'forward' | 'reverse' | 'bidirectional';
  width?: number;
  opacity?: number;
  /** Per-hop annotations (one per segment arrival, machine-authored). */
  hops?: FlowHop[];
  /** Id of a declared document layer (see api/layers); absent = base layer. */
  layer?: string;
  /** External identity in a source system (see api/source); enables upsert. */
  source?: SourceRef;
}

/**
 * Marker types a policy marker can represent — enforcement actions plus host-OS
 * and SSE posture. The canonical list + default glyphs live in `api/markers`.
 */
export type { PolicyMarkerType } from '../api/markers.js';
import { withMarkerIcon, type PolicyMarkerType } from '../api/markers.js';
import { layerView, type LayerDef } from '../api/layers.js';
import type { SourceRef } from '../api/source.js';
import {
  applyRenderTheme,
  hexChannels,
  resolveTheme,
  type RenderTheme,
} from '../render/theme.js';

/** A policy marker — an enforcement / posture badge pinned to a node. */
export interface PolicyMarkerConfig {
  id: string;
  /** Id of the node the badge attaches to. */
  nodeId: string;
  type: PolicyMarkerType;
  /** Rendered under the badge at 8px, up to 2 lines (then an ellipsis). */
  label?: string;
  /** Wrap width (px) for the label; absent = ~26 chars. Clamped to [40, 600]. */
  labelWidth?: number;
  color?: string;
  /** Glyph override; defaults to the type's glyph (see api/markers). */
  icon?: string;
  /** Placement relative to the node centre. */
  align?: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'C';
  /** Optional association with a flow path. */
  flowPathId?: string;
  /** Id of a declared document layer (see api/layers); absent = base layer. */
  layer?: string;
  /** External identity in a source system (see api/source); enables upsert. */
  source?: SourceRef;
}

/** The minimal slice of the vendored engine instance we drive. */
interface EngineInstance {
  node(id: string, cfg: Record<string, unknown>): void;
  link(id: string, cfg: Record<string, unknown>): void;
  anchor(id: string, pos: { x: number; y: number }): void;
  zone(id: string, cfg: Record<string, unknown>): void;
  flowPath(id: string, cfg: Record<string, unknown>): void;
  policyMarker(id: string, cfg: Record<string, unknown>): void;
  act(id: string, cfg: Record<string, unknown>): void;
  addStep(id: string, cfg: Record<string, unknown>): void;
  _buildIndex(): void;
  _renderSVG(): string;
  _svgDefs(): string;
  _steps: unknown[];
  step: number;
  /** When true, the engine omits animations (particles, pulses, glints). */
  reducedMotion: boolean;
  /** Ambient backdrop level: 'off' | 'static' | 'animated' (default animated). */
  ambient?: 'off' | 'static' | 'animated';
  /** Render the canvas backdrop/grid/vignette for a light theme. */
  light?: boolean;
}

/**
 * A document brand palette (#7). The vendored engine hardcodes its accent
 * colours in the rendered SVG (it has no colour-variable hooks), so a palette is
 * applied at render time by remapping those source brand colours to the chosen
 * ones — see `applyPalette`. The same `accent` also drives the app chrome's
 * `--accent` (handled in the app, not here). Optional and round-trip safe.
 */
export interface BrandPalette {
  /** Preset id this palette came from, or 'custom' (UI selection only). */
  id?: string;
  /** Human label — the preset name or 'Custom'. */
  name?: string;
  /** Primary brand colour — remaps the engine's green accent (#01a982). */
  accent: string;
  /** Secondary brand colour — remaps the engine's blue accent (#65aef9). */
  secondary?: string;
  /** Chrome accent override for the app UI; defaults to `accent` (app-side). */
  chrome?: string;
}

/**
 * The engine's source brand colours, with their `rgb()` channel forms so the
 * many `rgba(r,g,b,a)` glow/wash usages remap too — not just the `#hex` ones.
 */
const ENGINE_BRAND = {
  accent: { hex: '01a982', rgb: '1,169,130' },
  secondary: { hex: '65aef9', rgb: '101,174,249' },
} as const;

/** Remap one engine brand colour (all `#hex` + `rgb/rgba(...)` forms) to `toHex`. */
function remapColor(
  svg: string,
  src: { hex: string; rgb: string },
  toHex: string,
): string {
  const chans = hexChannels(toHex);
  if (!chans) return svg; // invalid target — leave the SVG untouched
  const hex = toHex.startsWith('#') ? toHex : `#${toHex}`;
  // The `#01a982` literal form (node strokes, link colours, glow flood-colors).
  let out = svg.replace(new RegExp(`#${src.hex}`, 'gi'), hex);
  // The `rgb()/rgba()` channel forms used by glows, ambient washes and LEDs.
  out = out.split(`(${src.rgb}`).join(`(${chans}`);
  return out;
}

/**
 * Recolour a rendered SVG string for a brand palette by substituting the
 * engine's source brand colours. Bounded to the two accent colours, so it never
 * touches functional colours (reds for alerts, greys for inactive, etc.).
 */
export function applyPalette(svg: string, palette: BrandPalette): string {
  let out = svg;
  if (palette.accent)
    out = remapColor(out, ENGINE_BRAND.accent, palette.accent);
  if (palette.secondary)
    out = remapColor(out, ENGINE_BRAND.secondary, palette.secondary);
  return out;
}

/**
 * Light-mode canvas (#8 follow-up, generalised by #264). The engine bakes a
 * DARK card surface and LIGHT on-card / label text straight into the SVG, so
 * in light mode node cards stayed dark and their labels (drawn on the
 * now-light canvas) became unreadable. The remap table now lives in
 * `render/theme` (`LIGHT_THEME_MAP`) and is shared by the headless export
 * path, so the in-app light canvas and a `theme: 'light'` export match.
 * `LIGHT_CANVAS` is the card/text subset the icon-library exporter themes.
 */
export { LIGHT_CANVAS } from '../render/theme.js';

/** Recolour a rendered SVG for a light canvas — `applyRenderTheme(svg, 'light')`. */
export function lightenCanvas(svg: string): string {
  return applyRenderTheme(svg, 'light');
}

/**
 * Flatten the vendored engine's cinematic FX into a crisp, flat viewer so that
 * glow becomes an EMPHASIS-ONLY channel. Pure string transform over the
 * engine's SVG markup, shared by the browser canvas/export path
 * (`renderPageSVG`) and the headless MCP/flipbook path (`renderPageWithEngine`
 * in render/core) so live canvas, exported SVG/PNG and flipbook all render
 * identically flat.
 *
 *  1. Strip every decorative `filter="url(#tds-…)"` (glow/bloom/dof/halo/…) —
 *     this also flattens the custom node-art filters.
 *  2. Remove the ambient colour-wash + vignette background rects, keeping the
 *     functional alignment grid (`tds-grid`).
 *  3. If `emphasisIds` is non-empty, add the single soft `tds-emphasis` glow to
 *     each spotlighted node/link group — the ONLY glow anywhere on screen.
 */
export function flattenViewer(svg: string, emphasisIds: string[] = []): string {
  // 1. Strip all decorative engine filters. Runs first so the emphasis filter
  //    injected in step 3 is never caught by this pass.
  let out = svg.replace(/\s*filter="url\(#tds-[^"]*"/g, '');

  // 2. Drop the ambient sheen + vignette backdrop rects — both the static
  //    (`… opacity=".4"/>`) and animated (`…><animate…/></rect>`) forms — while
  //    keeping the functional `tds-grid` rect.
  out = out.replace(
    /<rect\b[^>]*?fill="url\(#tds-(?:ambientGreen|ambientPurple|ambientBlue|vignette)\)"[^>]*?(?:\/>|>\s*<animate\b[^>]*\/>\s*<\/rect>)/g,
    '',
  );

  // 3. Emphasis glow — the one soft pass, only on spotlighted members.
  const ids = emphasisIds.filter(Boolean);
  if (ids.length) {
    for (const id of ids) {
      const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out
        .replace(
          new RegExp(`<g data-tds-node="${esc}"`, 'g'),
          `<g filter="url(#tds-emphasis)" data-tds-node="${id}"`,
        )
        .replace(
          new RegExp(`<g data-tds-link="${esc}"`, 'g'),
          `<g filter="url(#tds-emphasis)" data-tds-link="${id}"`,
        );
    }
    // A single soft drop-shadow at the accent colour (~50% alpha) — one pass,
    // never stacked. Prepended as its own <defs> (valid to have several).
    out =
      `<defs><filter id="tds-emphasis" x="-40%" y="-40%" width="180%" height="180%">` +
      `<feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#01a982" flood-opacity="0.5"/>` +
      `</filter></defs>` +
      out;
  }
  return out;
}

/** Render options shared by the page renderers. */
export interface RenderOptions {
  /** Calm canvas: suppress motion (animated flow particles, link dots, glints). */
  calm?: boolean;
  /**
   * Ambient backdrop decoration level (independent of `calm`): 'off' (just the
   * grid), 'static' (colour washes, no motion), or 'animated' (full). Lets the
   * decorative ambient be quieted while meaningful flow particles still animate.
   */
  ambient?: 'off' | 'static' | 'animated';
  /**
   * Render theme (#264), default `'dark'` (the engine's native output).
   * `'light'` lifts the hardcoded dark grid/vignette AND remaps every
   * engine-sourced colour (surfaces, text greys, overlays, accents) through
   * `LIGHT_THEME_MAP` so the SVG reads on a light page.
   */
  theme?: RenderTheme;
  /** Older boolean alias for `theme: 'light'`; `theme` wins when both are set. */
  light?: boolean;
  /** Document brand palette — remaps the engine's accent colours at render time. */
  palette?: BrandPalette;
  /** Declared document layers (bottom → top) — drives stacking order. */
  layers?: LayerDef[];
  /** Only draw these layer ids (untagged base elements always draw). */
  visibleLayers?: string[];
  /** Per-frame emphasis (2.2): node/link ids to spotlight; others dim to 25%. */
  emphasis?: string[];
}

/** Plugin shape accepted by the engine's static registerNodeType. */
export interface NodePlugin {
  render: (x: number, y: number, cfg: { color?: string }) => string;
  defaults?: Record<string, unknown>;
  hitBox?: { rx: number; ry: number };
  haloColor?: string;
}

interface EngineStatic {
  new (cfg: Record<string, unknown>): EngineInstance;
  NODE_TYPES: Record<string, (x: number, y: number, cfg: unknown) => string>;
  registerNodeType(name: string, plugin: NodePlugin): void;
}

declare global {
  interface Window {
    TopologyDesigner?: EngineStatic;
    TopologyGraph?: unknown;
  }
}

function engine(): EngineStatic {
  const e = window.TopologyDesigner;
  if (!e) {
    throw new Error(
      'TopologyDesigner not loaded — ensure public/vendor/topology-ds.js is included before the app script.',
    );
  }
  return e;
}

/** The set of node types the vendored engine knows how to draw. */
export function nodeTypes(): string[] {
  return Object.keys(engine().NODE_TYPES);
}

/** The engine's shared SVG `<defs>` (glow/bloom/gradient filters) — for previews. */
export function engineDefs(): string {
  return new (engine())({})._svgDefs();
}

/** A renderable page: a complete, standalone topology frame. */
export interface RenderablePage {
  viewBox: string;
  nodes: NodeConfig[];
  links: LinkConfig[];
  anchors?: AnchorConfig[];
  /** Region groupings drawn behind the nodes. */
  zones?: ZoneConfig[];
  /** Animated overlay routes drawn on top of the topology. */
  flowPaths?: FlowPathConfig[];
  /** Enforcement badges pinned to nodes. */
  policyMarkers?: PolicyMarkerConfig[];
  /** Line-jump rendering at link crossings ('arc' | 'gap'; absent = none). */
  lineJumps?: 'arc' | 'gap';
  /**
   * EXPERIMENTAL: page-level link anchor box (see `LinkAttachOptions`);
   * absent = the classic silhouette attachment, unchanged.
   */
  linkAttach?: LinkAttachOptions;
}

/**
 * Render a page to an SVG inner-markup string (defs + ambient + elements),
 * meant to be injected into an `<svg viewBox=…>` inside a `.tds-canvas`.
 */
export function renderPageSVG(
  page: RenderablePage,
  opts: RenderOptions = {},
): string {
  const Engine = engine();
  const topo = new Engine({ viewBox: page.viewBox });
  // `calm` is the authoritative motion switch for the editor. Set it both ways:
  // the engine constructor turns reducedMotion ON from the OS
  // `prefers-reduced-motion` setting, and only ever forcing it true (the old
  // `if (opts.calm)`) left motion stuck off for those users with no in-app
  // override. The Calm toggle defaults from the OS setting (see main.ts) but can
  // now re-enable animation when off.
  topo.reducedMotion = !!opts.calm;
  if (opts.ambient) topo.ambient = opts.ambient;
  const theme = resolveTheme(opts);
  topo.light = theme === 'light';
  // Line jumps at link crossings — a page-level setting (persisted; part of
  // the document contract via set_page_properties), applied at render time.
  (topo as unknown as { lineJumps?: string }).lineJumps = page.lineJumps;
  // Experimental link anchor box — page-level setting, applied at render time
  // (left null when absent so the classic attachment is untouched).
  (topo as unknown as { linkAttach?: LinkAttachOptions | null }).linkAttach =
    page.linkAttach ?? null;

  // The layer view: hidden layers dropped, the rest stacked bottom → top
  // (insertion order is the engine's paint order within each collection).
  const layers = opts.layers ?? [];
  const nodes = layerView(page.nodes, layers, opts.visibleLayers);
  const links = layerView(page.links, layers, opts.visibleLayers);
  const zones = layerView(page.zones ?? [], layers, opts.visibleLayers);
  const flows = layerView(page.flowPaths ?? [], layers, opts.visibleLayers);
  const markers = layerView(
    page.policyMarkers ?? [],
    layers,
    opts.visibleLayers,
  );

  // Per-layer opacity (B.3): fade every element on a dimmed layer by folding the
  // layer's opacity into each member's own opacity (1 = no change).
  const layerOpacity = new Map<string, number>();
  for (const ly of layers)
    if (typeof ly.opacity === 'number' && ly.opacity < 1)
      layerOpacity.set(ly.id, Math.max(0, ly.opacity));
  const faded = <T extends { layer?: string; opacity?: number }>(cfg: T): T => {
    const lo = cfg.layer ? layerOpacity.get(cfg.layer) : undefined;
    if (lo === undefined) return cfg;
    return { ...cfg, opacity: (cfg.opacity ?? 1) * lo };
  };
  // Per-frame emphasis (2.2): when a non-empty set is given, dim every node/link
  // that isn't in it to 25%. Combines with layer opacity above.
  const emphasis =
    opts.emphasis && opts.emphasis.length ? new Set(opts.emphasis) : null;
  const fadedEmph = <T extends { layer?: string; opacity?: number }>(
    id: string,
    cfg: T,
  ): T => {
    let m = cfg.layer ? (layerOpacity.get(cfg.layer) ?? 1) : 1;
    if (emphasis && !emphasis.has(id)) m *= 0.3;
    return m === 1 ? cfg : { ...cfg, opacity: (cfg.opacity ?? 1) * m };
  };

  for (const a of page.anchors ?? []) topo.anchor(a.id, { x: a.x, y: a.y });
  for (const n of nodes) {
    const { id, ...cfg } = n;
    topo.node(id, fadedEmph(id, cfg));
  }
  for (const l of links) {
    const { id, ...cfg } = l;
    topo.link(id, fadedEmph(id, cfg));
  }
  for (const z of zones) {
    const { id, ...cfg } = z;
    topo.zone(id, faded(cfg));
  }
  for (const f of flows) {
    const { id, ...cfg } = f;
    topo.flowPath(id, faded(cfg));
  }
  for (const m of markers) {
    const { id, ...cfg } = m;
    topo.policyMarker(id, withMarkerIcon(cfg));
  }

  // One step that shows every element at once — a static frame, no choreography.
  const ids = [...nodes.map((n) => n.id), ...links.map((l) => l.id)];
  topo.act('all', { label: 'All' });
  topo.addStep('all', {
    act: 'all',
    name: 'All',
    focus: [],
    phases: [{ show: ids, diff: '' }],
  });
  // A trailing empty step we sit ON, so the all-showing step is in the PAST.
  // The engine then renders every element fully with no entrance animation
  // (anim only plays for the *current* step) — a static frame that won't replay
  // fades/draw-ins on each re-render. Important for smooth editing.
  topo.addStep('end', {
    act: 'all',
    name: 'end',
    focus: [],
    phases: [{ show: [], diff: '' }],
  });
  topo._buildIndex();
  topo.step = topo._steps.length; // sit on the trailing step (within range)

  let svg = topo._renderSVG();
  // The engine bakes colours straight into the SVG string, so both the brand
  // palette (#7) and the light theme (#8/#264) are applied as final
  // colour-substitution passes over the markup. Palette FIRST: it consumes the
  // engine's source accents, so the theme pass (which darkens those same
  // accents for a light page) never touches a document's chosen brand colour.
  if (opts.palette) svg = applyPalette(svg, opts.palette);
  svg = applyRenderTheme(svg, theme);
  // Flatten the cinematic FX (glow/bloom/ambient) last — glow survives only as
  // the emphasis channel. Applied to both the live canvas and the export path
  // (which shares this function), so exported SVG/PNG/flipbook match.
  svg = flattenViewer(svg, opts.emphasis ?? []);
  return svg;
}

/** Render a page directly into a host `<svg>` element, syncing its viewBox. */
export function renderPageInto(
  svg: SVGSVGElement,
  page: RenderablePage,
  opts: RenderOptions = {},
): void {
  svg.setAttribute('viewBox', page.viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = renderPageSVG(page, opts);
}
