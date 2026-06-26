/**
 * Editor core — direct manipulation of a single page.
 *
 * Architecture: the page "art" is drawn by the vendored engine into the art
 * `<svg>` and re-rendered only when the model changes (drop / delete / undo).
 * A separate overlay `<svg>` (this module owns it) handles hit-testing,
 * selection visuals, the marquee, and drag ghosts — so dragging is smooth
 * without re-rendering the heavy art every frame.
 */
import {
  renderPageInto,
  type AnchorConfig,
  type FlowPathConfig,
  type LinkConfig,
  type NodeConfig,
  type PolicyMarkerConfig,
  type ZoneConfig,
} from '../vendor/topology-ds.js';
import { clientToUser } from './coords.js';
import { tidyPage } from '../api/tidy.js';
import { layoutPage, type AutoLayoutOptions } from '../api/autolayout.js';
import { cloneElements } from './clone.js';
import type { Page } from '../pages/model.js';
import {
  hitTestAnchor,
  hitTestLink,
  hitTestNode,
  hitTestZone,
  linkPolyline,
  nodeBounds,
  nodesInRect,
  resolvePos,
  zoneBounds,
} from './geometry.js';

const ACCENT = '#01a982';
const MUTED = '#7d8a92';
const LINK_TYPES = [
  'line',
  'tunnel',
  'wireguard',
  'flow',
  'wifi',
  'poe',
  'optical',
  'blocked',
  'packet',
];
const LINK_STYLES = ['straight', 'orthogonal', 'curved'];

interface DragState {
  startX: number;
  startY: number;
  /** Base positions of every moving element — nodes and anchors alike. */
  base: Map<string, { x: number; y: number }>;
  /** Subset of `base` ids that are anchors (the rest are nodes). */
  anchors: Set<string>;
  moved: boolean;
  /** The element grabbed (drives alignment/spacing guides). */
  primary: string;
  /** Effective (snapped) delta applied to the whole selection. */
  dx: number;
  dy: number;
}

type Guide =
  | { kind: 'align'; x1: number; y1: number; x2: number; y2: number }
  | {
      kind: 'spacing';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      ticks: { x: number; y: number }[];
      label: string;
      labelX: number;
      labelY: number;
    };

export class Editor {
  private sel = new Set<string>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  grid = 20;
  snap = true;
  gridVisible = true;
  /** Calm canvas: render without animations (a view preference). */
  calm = false;

  private drag: DragState | null = null;
  /** Active waypoint drag on the selected link (index into link.waypoints). */
  private wpDrag: { index: number; moved: boolean } | null = null;
  /** Active drag of a link label chip (interface or centre). */
  private labelDrag: {
    lid: string;
    key: string;
    startX: number;
    startY: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null = null;
  private marquee: { x0: number; y0: number; x1: number; y1: number } | null =
    null;
  /** Pan/zoom window in page coordinates (the displayed viewBox). */
  private view = { x: 0, y: 0, w: 1050, h: 700 };
  private viewInsets?: () => { right: number; bottom: number };
  private pan: { startClientX: number; startClientY: number } | null = null;
  /** Spacebar held → left-drag pans (hand mode), like Figma/Sketch. */
  private spaceHeld = false;
  /** Dedicated Hand tool active → left-drag pans without holding Space. */
  private handTool = false;
  private nodeSeq = 0;
  /** Smart guides computed during the current drag (alignment + spacing). */
  private guides: Guide[] = [];
  /** The pattern-filled rect backing the infinite grid (tracks the view). */
  private gridRect: SVGRectElement | null = null;
  /** Active tool: select/move, draw-link, or drop-anchor. */
  tool: 'select' | 'link' | 'anchor' = 'select';
  private linkStart: string | null = null;
  private linkCursor: { x: number; y: number } | null = null;
  /**
   * A link being dragged out from a node's edge while the Select tool is active
   * (so you don't have to switch to the Link tool). `moved` flips once the drag
   * passes a small threshold; a press that never moves falls through to a plain
   * click-select.
   */
  private dragLink: {
    from: string;
    start: { x: number; y: number };
    cursor: { x: number; y: number };
    moved: boolean;
  } | null = null;
  /** Node currently under the cursor in Select mode (drives connection dots). */
  private hoverNode: string | null = null;
  private linkSel: string | null = null;
  private linkSeq = 0;
  /**
   * The single selected anchor (drives the inspector). Mirrors `selAnchors`
   * when exactly one anchor and no nodes are selected; null otherwise.
   */
  private anchorSel: string | null = null;
  /** Multi-selection of anchors (parallel to `sel` for nodes). */
  private selAnchors = new Set<string>();
  private anchorSeq = 0;
  private zoneSeq = 0;
  /** The selected zone region (clicked on canvas), or null. */
  private zoneSel: string | null = null;
  /** Copy/paste buffer (cloned elements, page-independent). */
  private clipboard: { nodes: NodeConfig[]; links: LinkConfig[] } | null = null;
  /** True while a run of arrow-nudges is coalescing into one undo entry. */
  private nudgeActive = false;
  private nudgeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Pending coalesced art render (rAF handle), or 0 when none is queued. */
  private artRaf = 0;

  constructor(
    private art: SVGSVGElement,
    private overlay: SVGSVGElement,
    public page: Page,
    /** Called after any change that should re-sync external UI (e.g. thumbnails). */
    private onChange: () => void = () => {},
    /** Called whenever the selection size changes (drives the align toolbar). */
    private onSelect: (count: number) => void = () => {},
    /** Called when the selected link changes (drives the link toolbar). */
    private onLinkSelect: (linkId: string | null) => void = () => {},
    /** Called when the selected anchor changes (drives the anchor inspector). */
    private onAnchorSelect: (anchorId: string | null) => void = () => {},
    /** Called whenever the view (pan/zoom/page) changes (drives the status bar). */
    private onView: () => void = () => {},
    /** Called when the selected zone changes (drives the zone inspector). */
    private onZoneSelect: (zoneId: string | null) => void = () => {},
  ) {
    this.view = this.computeFitView();
    this.bind();
    this.renderArt();
    this.renderOverlay();
  }

  /** Switch to editing a different page (resets selection + history + view). */
  setPage(page: Page): void {
    this.page = page;
    this.sel.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.drag = null;
    this.marquee = null;
    this.wpDrag = null;
    this.linkSel = null;
    this.linkStart = null;
    this.dragLink = null;
    this.hoverNode = null;
    this.anchorSel = null;
    this.selAnchors.clear();
    this.zoneSel = null;
    this.view = this.computeFitView();
    this.renderArt();
    this.renderOverlay();
    this.fireSelect();
    this.fireLinkSelect();
    this.fireAnchorSelect();
    this.fireZoneSelect();
  }

  /** Re-render the current page (e.g. after a custom node type changed). */
  refresh(): void {
    this.renderArt();
    this.renderOverlay();
  }

  /** Arrange the current page with a layout algorithm (grid/hierarchical/…). */
  layout(opts: AutoLayoutOptions): void {
    this.snapshot();
    const moved = layoutPage(this.page, opts);
    if (moved === 0) {
      this.undoStack.pop();
      return;
    }
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }

  /** Auto-arrange the current page (grid-snap + de-overlap + keep in bounds). */
  tidy(): void {
    this.snapshot();
    const moved = tidyPage(this.page);
    if (moved === 0) {
      this.undoStack.pop(); // nothing changed — don't pollute history
      return;
    }
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }

  /** Reset pan/zoom to frame the page's content (falls back to the page box). */
  resetView(): void {
    this.view = this.computeFitView();
    this.applyView();
  }

  /**
   * Supply the on-screen insets (px) taken by floating panels (inspector,
   * minimap) so fit-to-content frames the *visible* canvas area rather than
   * tucking edge content behind a panel. Optional; defaults to no insets.
   */
  setViewInsets(fn: () => { right: number; bottom: number }): void {
    this.viewInsets = fn;
  }

  /** Axis-aligned bounds of all drawn content (nodes + anchors), or null. */
  private contentBounds(): {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let has = false;
    const add = (x: number, y: number, w: number, h: number): void => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
      has = true;
    };
    for (const n of this.page.nodes) {
      const b = nodeBounds(n);
      add(b.x, b.y, b.w, b.h);
    }
    for (const a of this.page.anchors) add(a.x - 4, a.y - 4, 8, 8);
    if (!has) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /**
   * Compute a view that frames the page's content (with padding), scaled so the
   * content fits the *visible* canvas area — the overlay minus any panel insets
   * — and centred within it. Falls back to the page viewBox when the page is
   * empty or the canvas hasn't been laid out yet.
   */
  private computeFitView(): { x: number; y: number; w: number; h: number } {
    const b = this.contentBounds();
    if (!b) return parseViewBox(this.page.viewBox);
    const pad = Math.max(40, 0.06 * Math.max(b.w, b.h));
    const cw = b.w + 2 * pad;
    const ch = b.h + 2 * pad;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const rect = this.overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0)
      return { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch };
    const insets = this.viewInsets?.() ?? { right: 0, bottom: 0 };
    const visW = Math.max(1, rect.width - Math.max(0, insets.right));
    const visH = Math.max(1, rect.height - Math.max(0, insets.bottom));
    // Page units per pixel needed to fit the content into the visible sub-rect.
    const scale = Math.max(cw / visW, ch / visH);
    // The view spans the whole canvas element at that scale; the content is
    // centred over the visible region, leaving the panel gutters as empty canvas.
    const visCenterX = (rect.width - Math.max(0, insets.right)) / 2;
    const visCenterY = (rect.height - Math.max(0, insets.bottom)) / 2;
    return {
      x: cx - visCenterX * scale,
      y: cy - visCenterY * scale,
      w: rect.width * scale,
      h: rect.height * scale,
    };
  }

  /** The current pan/zoom window (page coordinates) — drives the minimap. */
  getView(): { x: number; y: number; w: number; h: number } {
    return { ...this.view };
  }

  /** Center the view on a page point, keeping the current zoom. */
  panTo(cx: number, cy: number): void {
    this.view.x = cx - this.view.w / 2;
    this.view.y = cy - this.view.h / 2;
    this.applyView();
  }

  /** Select a single node and center the view on it (Find / jump-to-element). */
  focusNode(id: string): void {
    const n = this.page.nodes.find((m) => m.id === id);
    if (!n) return;
    this.linkSel = null;
    this.clearAnchorSel();
    this.sel = new Set([id]);
    this.panTo(n.x, n.y);
    this.renderOverlay();
    this.fireSelect();
    this.fireLinkSelect();
  }

  /** Select a single link and center the view on its midpoint (click-to-locate). */
  focusLink(id: string): void {
    const link = this.page.links.find((l) => l.id === id);
    if (!link) return;
    const a = resolvePos(this.page, link.from);
    const b = resolvePos(this.page, link.to);
    this.sel.clear();
    this.selAnchors.clear();
    this.anchorSel = null;
    this.linkSel = id;
    if (a && b) this.panTo((a.x + b.x) / 2, (a.y + b.y) / 2);
    this.renderOverlay();
    this.fireSelect();
    this.fireLinkSelect();
    this.fireAnchorSelect();
  }

  /**
   * Enter/leave spacebar pan ("hand") mode: while held, a left-drag pans the
   * canvas instead of selecting, and the cursor shows a grab hand.
   */
  setSpacePan(on: boolean): void {
    if (this.spaceHeld === on) return;
    this.spaceHeld = on;
    // Don't fight an in-progress drag's "grabbing" cursor.
    if (!this.pan) this.overlay.style.cursor = on ? 'grab' : this.handCursor();
  }

  /**
   * The dedicated Hand (pan) tool: a sticky version of spacebar-pan. While on,
   * a left-drag pans the canvas (like holding Space) until toggled off. The
   * keyboard pan still works regardless.
   */
  setHandTool(on: boolean): void {
    if (this.handTool === on) return;
    this.handTool = on;
    if (!this.pan) this.overlay.style.cursor = this.handCursor();
  }
  /** Whether the sticky Hand tool is currently active. */
  isHandActive(): boolean {
    return this.handTool;
  }
  /** Resting cursor for the overlay given the current pan affordances. */
  private handCursor(): string {
    return this.spaceHeld || this.handTool ? 'grab' : '';
  }

  /* ── page properties ──────────────────────────────────────────── */

  /**
   * Set the page's viewBox (canvas extent) and reframe to it. Not placed on the
   * undo stack — a structural change like the filmstrip rename, kept out so that
   * undoing node edits never resets pan/zoom.
   */
  setViewBox(vb: string): void {
    this.page.viewBox = vb;
    this.view = parseViewBox(vb);
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }

  /** Rename the current page (shown in the filmstrip). Not on the undo stack. */
  renamePage(name: string): void {
    this.page.name = name;
    this.onChange();
  }

  /* ── rendering ────────────────────────────────────────────────── */

  /** Apply the current pan/zoom window to both layers' viewBox. */
  private applyView(): void {
    this.normalizeView();
    const vb = `${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`;
    this.art.setAttribute('viewBox', vb);
    this.overlay.setAttribute('viewBox', vb);
    this.updateGridFill();
    this.onView();
  }

  /**
   * Expand the view to the canvas element's aspect ratio (keeping its centre) so
   * the SVG's preserveAspectRatio='meet' has nothing to letterbox. Without this
   * the art + grid get boxed into a centred band whenever the page aspect ratio
   * differs from the viewport — which reads as a hard "canvas edge" and breaks
   * the infinite-canvas feel. The page bounds still drive export; only what's
   * shown on screen is widened to fill. Idempotent: a view already at the right
   * aspect (or one only panned/zoomed) is left unchanged.
   */
  private normalizeView(): void {
    const rect = this.overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const screen = rect.width / rect.height;
    const view = this.view.w / this.view.h;
    if (Math.abs(view - screen) < 1e-3) return;
    if (view < screen) {
      const nw = this.view.h * screen;
      this.view.x -= (nw - this.view.w) / 2;
      this.view.w = nw;
    } else {
      const nh = this.view.w / screen;
      this.view.y -= (nh - this.view.h) / 2;
      this.view.h = nh;
    }
  }

  /** Re-fit the view to the (possibly resized) canvas element. */
  resync(): void {
    this.applyView();
  }

  /**
   * App-supplied extra render options (e.g. declared layers + their
   * visibility/opacity, B.3) merged into every art render. The `calm` flag is
   * always applied on top.
   */
  private renderOpts: (() => Record<string, unknown>) | null = null;
  setRenderOpts(fn: (() => Record<string, unknown>) | null): void {
    this.renderOpts = fn;
    this.renderArt();
  }
  /** Re-paint art + overlay (e.g. after a layer's visibility/opacity changed). */
  rerender(): void {
    this.renderArt();
    this.renderOverlay();
  }

  private renderArt(): void {
    // A pending coalesced render is now redundant — this draws current state.
    if (this.artRaf) {
      cancelAnimationFrame(this.artRaf);
      this.artRaf = 0;
    }
    renderPageInto(this.art, this.page, {
      ...this.renderOpts?.(),
      emphasis: this.page.emphasis,
      calm: this.calm,
    });
    // renderPageInto resets the art viewBox to the page's; re-apply the view.
    this.applyView();
  }

  /**
   * Coalesce art re-renders during continuous interaction (anchor drag, held
   * arrow-nudges, live inspector edits) to at most one per animation frame. The
   * art is the heavy layer — a full engine rebuild + innerHTML swap — so firing
   * it on every pointermove/keystroke is the main source of edit lag on large
   * topologies. The lightweight overlay still updates synchronously, so
   * selection/handles track the cursor with no perceptible delay.
   */
  private scheduleArt(): void {
    if (this.artRaf) return;
    this.artRaf = requestAnimationFrame(() => {
      this.artRaf = 0;
      renderPageInto(this.art, this.page, { calm: this.calm });
      this.applyView();
    });
  }

  /** Toggle the calm canvas (animations off) and re-render. */
  setCalm(on: boolean): void {
    this.calm = on;
    this.renderArt();
  }

  /**
   * The grid as a single cell tiled (in page coordinates) over a rect that
   * covers the viewport — an "infinite" canvas grid rather than one clipped to
   * the page bounds. The fill rect tracks the pan/zoom window (see
   * `updateGridFill`, called from `applyView`), so the grid keeps filling the
   * screen wherever you scroll. Neutral grey so it reads on dark and light.
   */
  private gridSvg(): string {
    if (!this.gridVisible) return '';
    const g = this.grid;
    const e = this.gridExtent();
    return (
      `<defs><pattern id="tds-grid" width="${g}" height="${g}" patternUnits="userSpaceOnUse">` +
      `<path d="M${g} 0 V ${g} M 0 ${g} H ${g}" stroke="${MUTED}" stroke-opacity="0.18" stroke-width="1" fill="none"/>` +
      `</pattern></defs>` +
      `<rect class="tds-grid" x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="url(#tds-grid)"/>`
    );
  }

  /**
   * Grid fill extent: the current view padded by a full viewport on each side
   * and snapped to the grid, so a fast pan still lands on gridded area before
   * the next `applyView` refresh catches up.
   */
  private gridExtent(): { x: number; y: number; w: number; h: number } {
    const g = this.grid;
    const { x, y, w, h } = this.view;
    return {
      x: Math.floor((x - w) / g) * g,
      y: Math.floor((y - h) / g) * g,
      w: w * 3,
      h: h * 3,
    };
  }

  /**
   * Keep the grid fill covering the viewport as the view pans/zooms — a cheap
   * attribute update on the existing rect, with no overlay rebuild (so panning
   * stays smooth).
   */
  private updateGridFill(): void {
    const r = this.gridRect;
    if (!r) return;
    const e = this.gridExtent();
    r.setAttribute('x', String(e.x));
    r.setAttribute('y', String(e.y));
    r.setAttribute('width', String(e.w));
    r.setAttribute('height', String(e.h));
  }

  private selectionSvg(): string {
    let out = '';
    for (const id of this.sel) {
      const n = this.page.nodes.find((m) => m.id === id);
      if (!n) continue;
      const b = nodeBounds(n);
      const p = 6;
      if (n.locked === true) {
        // Locked: muted dashed outline, no drag handles, a small lock glyph.
        out +=
          `<rect x="${b.x - p}" y="${b.y - p}" width="${b.w + p * 2}" height="${b.h + p * 2}" fill="none" stroke="${MUTED}" stroke-width="1.5" stroke-dasharray="3 3" rx="4"/>` +
          `<text x="${b.x + b.w + p - 2}" y="${b.y - p}" text-anchor="end" font-size="11" fill="${MUTED}">🔒</text>`;
        continue;
      }
      out += `<rect x="${b.x - p}" y="${b.y - p}" width="${b.w + p * 2}" height="${b.h + p * 2}" fill="none" stroke="${ACCENT}" stroke-width="1.5" rx="4"/>`;
      // corner handles
      for (const [hx, hy] of [
        [b.x - p, b.y - p],
        [b.x + b.w + p, b.y - p],
        [b.x - p, b.y + b.h + p],
        [b.x + b.w + p, b.y + b.h + p],
      ] as const) {
        out += `<rect x="${hx - 3}" y="${hy - 3}" width="6" height="6" fill="${ACCENT}"/>`;
      }
    }
    return out;
  }

  private guidesSvg(): string {
    if (this.guides.length === 0) return '';
    let out = '';
    for (const g of this.guides) {
      if (g.kind === 'align') {
        out += `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="#ff5db1" stroke-width="1" stroke-dasharray="6 4" opacity="0.9"/>`;
      } else {
        out += `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="#ff5db1" stroke-width="1" opacity="0.8"/>`;
        for (const t of g.ticks)
          out += `<line x1="${t.x - 3}" y1="${t.y - 3}" x2="${t.x + 3}" y2="${t.y + 3}" stroke="#ff5db1" stroke-width="1.2"/><line x1="${t.x - 3}" y1="${t.y + 3}" x2="${t.x + 3}" y2="${t.y - 3}" stroke="#ff5db1" stroke-width="1.2"/>`;
        out += `<text x="${g.labelX}" y="${g.labelY}" fill="#ff8ccb" font-size="11" font-family="ui-monospace,monospace" text-anchor="middle">${g.label}</text>`;
      }
    }
    return out;
  }

  private marqueeSvg(): string {
    if (!this.marquee) return '';
    const { x0, y0, x1, y1 } = this.marquee;
    return `<rect x="${Math.min(x0, x1)}" y="${Math.min(y0, y1)}" width="${Math.abs(x1 - x0)}" height="${Math.abs(y1 - y0)}" fill="${ACCENT}" fill-opacity="0.06" stroke="${ACCENT}" stroke-dasharray="5 4" stroke-width="1"/>`;
  }

  /** Highlight the selected zone's region (a dashed accent frame). */
  private zoneSelSvg(): string {
    if (this.zoneSel === null) return '';
    const zone = this.page.zones.find((z) => z.id === this.zoneSel);
    if (!zone) return '';
    const b = zoneBounds(this.page, zone);
    if (!b) return '';
    return (
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8" ` +
      `fill="${ACCENT}" fill-opacity="0.06" stroke="${ACCENT}" stroke-width="2" ` +
      `stroke-dasharray="6 4" pointer-events="none"/>`
    );
  }

  private linkSelSvg(): string {
    if (!this.linkSel) return '';
    const link = this.page.links.find((l) => l.id === this.linkSel);
    if (!link) return '';
    const pts = linkPolyline(this.page, link);
    if (pts.length < 2) return '';
    const d = 'M' + pts.map((p) => `${p.x},${p.y}`).join(' L');
    let out = `<path d="${d}" fill="none" stroke="${ACCENT}" stroke-width="3" opacity="0.5"/>`;
    const s = this.handleSize();
    // Endpoints (follow their nodes — not draggable): small dim dots.
    const ends = [pts[0]!, pts[pts.length - 1]!];
    for (const p of ends)
      out += `<circle cx="${p.x}" cy="${p.y}" r="${s * 0.5}" fill="${ACCENT}" opacity="0.6"/>`;
    // Midpoint "add" handles: hollow circle with a + on each segment.
    for (let k = 0; k < pts.length - 1; k++) {
      const m = midpoint(pts[k]!, pts[k + 1]!);
      out +=
        `<circle data-wp-add="${k}" cx="${m.x}" cy="${m.y}" r="${s * 0.6}" fill="${ACCENT}" fill-opacity="0.12" stroke="${ACCENT}" stroke-width="1"/>` +
        `<path d="M${m.x - s * 0.3},${m.y} h${s * 0.6} M${m.x},${m.y - s * 0.3} v${s * 0.6}" stroke="${ACCENT}" stroke-width="1"/>`;
    }
    // Waypoint handles (draggable squares).
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!;
      out += `<rect data-wp="${i - 1}" x="${p.x - s}" y="${p.y - s}" width="${s * 2}" height="${s * 2}" rx="2" fill="${ACCENT}" stroke="#fff" stroke-width="1"/>`;
    }
    return out;
  }

  /** Half-size of an interaction handle, in user units (≈7 screen px). */
  private handleSize(): number {
    const wpx = this.overlay.getBoundingClientRect().width || 1;
    return Math.max(3, (7 * this.view.w) / wpx);
  }

  /**
   * Click tolerance for grabbing an anchor, in user units. Anchors are tiny
   * (≈5px) link endpoints; a fixed user-space pad makes them un-clickable when
   * zoomed out, which reads as "linking to anchors doesn't work". Scale the pad
   * to a constant ≈14 screen px (min 8 user units) so they stay easy to hit.
   */
  private anchorHitPad(): number {
    const wpx = this.overlay.getBoundingClientRect().width || 1;
    return Math.max(8, (14 * this.view.w) / wpx);
  }

  private linkPreviewSvg(): string {
    // The Link tool's click-then-click preview…
    let a: { x: number; y: number } | null = null;
    let c: { x: number; y: number } | null = null;
    if (this.tool === 'link' && this.linkStart && this.linkCursor) {
      a = resolvePos(this.page, this.linkStart);
      c = this.linkCursor;
    } else if (this.dragLink && this.dragLink.moved) {
      // …or a link dragged out from a node's edge in Select mode.
      a = resolvePos(this.page, this.dragLink.from);
      c = this.dragLink.cursor;
    }
    if (!a || !c) return '';
    return `<line x1="${a.x}" y1="${a.y}" x2="${c.x}" y2="${c.y}" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="5 4" opacity="0.8"/>`;
  }

  /** Movement threshold (user units) before a press becomes a link drag. */
  private nodeEdgeBand(): number {
    const wpx = this.overlay.getBoundingClientRect().width || 1;
    return Math.max(4, (8 * this.view.w) / wpx);
  }

  /** Connection-dot radius in user units (≈5 screen px). */
  private dotRadius(): number {
    const wpx = this.overlay.getBoundingClientRect().width || 1;
    return Math.max(3, (5 * this.view.w) / wpx);
  }

  /** The four edge-midpoint connection points of a node, in user units. */
  private connectionDots(id: string): { x: number; y: number }[] {
    const n = this.page.nodes.find((m) => m.id === id);
    if (!n) return [];
    const b = nodeBounds(n);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return [
      { x: cx, y: b.y }, // top
      { x: b.x + b.w, y: cy }, // right
      { x: cx, y: b.y + b.h }, // bottom
      { x: b.x, y: cy }, // left
    ];
  }

  /**
   * If `p` lands on a connection dot of the hovered or a selected node, return
   * that node's id (so a link can be dragged out from it), else null.
   */
  private connectionDotHit(p: { x: number; y: number }): string | null {
    const r = this.dotRadius() * 1.8; // forgiving grab radius
    const ids = new Set<string>(this.sel);
    if (this.hoverNode) ids.add(this.hoverNode);
    for (const id of ids) {
      for (const d of this.connectionDots(id)) {
        if (Math.abs(p.x - d.x) <= r && Math.abs(p.y - d.y) <= r) return id;
      }
    }
    return null;
  }

  /**
   * The node to treat as "hovered": the one under the cursor, or one whose
   * connection dot the cursor is poised over (so dots stay reachable even though
   * they sit just on the node's edge).
   */
  private hoverNodeAt(p: { x: number; y: number }): string | null {
    const direct = hitTestNode(this.page, p.x, p.y);
    if (direct) return direct;
    const r = this.dotRadius() * 1.8;
    for (let i = this.page.nodes.length - 1; i >= 0; i--) {
      const id = this.page.nodes[i]!.id;
      for (const d of this.connectionDots(id)) {
        if (Math.abs(p.x - d.x) <= r && Math.abs(p.y - d.y) <= r) return id;
      }
    }
    return null;
  }

  /** Connection dots drawn on the hovered / selected node(s) in Select mode. */
  private connectionDotsSvg(): string {
    if (this.tool !== 'select' || this.dragLink || this.drag || this.marquee)
      return '';
    const r = this.dotRadius();
    const ids = new Set<string>(this.sel);
    if (this.hoverNode) ids.add(this.hoverNode);
    let out = '';
    for (const id of ids) {
      for (const d of this.connectionDots(id)) {
        out += `<circle cx="${d.x}" cy="${d.y}" r="${r}" fill="#0b0e14" stroke="${ACCENT}" stroke-width="1.5"/>`;
      }
    }
    return out;
  }

  /**
   * A transparent rect spanning the whole viewBox. An svg root only dispatches
   * pointer/context events over painted geometry; this backdrop ensures empty
   * canvas regions still receive them (marquee starts, right-click menus).
   */
  private backdropSvg(): string {
    const [x, y, w, h] = this.page.viewBox.split(' ').map(Number) as [
      number,
      number,
      number,
      number,
    ];
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent"/>`;
  }

  /**
   * Anchors as small diamond handles (the engine doesn't draw them). Always
   * visible so they can be seen, selected, moved, and used as link endpoints;
   * the selected one is highlighted.
   */
  private anchorsSvg(): string {
    let out = '';
    for (const a of this.page.anchors) {
      const sel = a.id === this.anchorSel || this.selAnchors.has(a.id);
      const c = sel ? ACCENT : MUTED;
      const r = 5;
      out +=
        `<g data-anchor-id="${a.id}">` +
        `<path d="M${a.x},${a.y - r} L${a.x + r},${a.y} L${a.x},${a.y + r} L${a.x - r},${a.y} Z" fill="${sel ? ACCENT : 'none'}" fill-opacity="${sel ? 0.25 : 0}" stroke="${c}" stroke-width="1.5"/>` +
        `<circle cx="${a.x}" cy="${a.y}" r="1.5" fill="${c}"/>` +
        `</g>`;
    }
    return out;
  }

  /**
   * Extra static SVG appended to the overlay each render — a hook for app-level
   * decorations that should track the canvas (e.g. the auto-legend). Drawn
   * beneath interactive handles so it never blocks selection.
   */
  private overlayExtra: (() => string) | null = null;
  setOverlayExtra(fn: (() => string) | null): void {
    this.overlayExtra = fn;
    this.renderOverlay();
  }
  /** Re-paint the overlay (e.g. after the legend config changed). */
  redrawOverlay(): void {
    this.renderOverlay();
  }

  private renderOverlay(): void {
    this.overlay.innerHTML =
      this.backdropSvg() +
      this.gridSvg() +
      (this.overlayExtra?.() ?? '') +
      this.guidesSvg() +
      this.zoneSelSvg() +
      this.anchorsSvg() +
      this.linkSelSvg() +
      this.selectionSvg() +
      this.connectionDotsSvg() +
      this.marqueeSvg() +
      this.linkPreviewSvg();
    // Cache the grid fill so applyView can track it without rebuilding the overlay.
    this.gridRect = this.overlay.querySelector<SVGRectElement>('rect.tds-grid');
  }

  /* ── history ──────────────────────────────────────────────────── */

  /** True when there is at least one state to undo back to. */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  /** True when an undone state can be re-applied. */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  /** Depth of the undo stack — drives the "History: N" status readout. */
  historyDepth(): number {
    return this.undoStack.length;
  }

  private snapshot(): void {
    this.nudgeActive = false; // any new snapshot ends a nudge-coalescing run
    this.undoStack.push(JSON.stringify(serialize(this.page)));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  private newNodeId(): string {
    return `n${Date.now().toString(36)}${(this.nodeSeq++).toString(36)}`;
  }
  private newLinkId(): string {
    return `l${Date.now().toString(36)}${(this.linkSeq++).toString(36)}`;
  }
  private newZoneId(): string {
    return `z${Date.now().toString(36)}${(this.zoneSeq++).toString(36)}`;
  }

  private restore(json: string): void {
    const p = JSON.parse(json) as ReturnType<typeof serialize>;
    this.page.viewBox = p.viewBox;
    this.page.name = p.name;
    this.page.nodes = p.nodes;
    this.page.links = p.links;
    this.page.anchors = p.anchors;
    this.page.zones = p.zones;
    this.page.flowPaths = p.flowPaths;
    this.page.policyMarkers = p.policyMarkers;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(JSON.stringify(serialize(this.page)));
    this.restore(prev);
    this.sel.clear();
    this.clearZoneSel();
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireSelect();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(JSON.stringify(serialize(this.page)));
    this.restore(next);
    this.sel.clear();
    this.clearZoneSel();
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireSelect();
  }

  /* ── mutations ────────────────────────────────────────────────── */

  /** Add a node of `type` at the current view center; selects it for dragging. */
  addNode(type: string, label?: string, extra?: Partial<NodeConfig>): void {
    this.snapshot();
    const id = `n${Date.now().toString(36)}${(this.nodeSeq++).toString(36)}`;
    const x = this.snapVal(this.view.x + this.view.w / 2);
    const y = this.snapVal(this.view.y + this.view.h / 2);
    this.page.nodes.push({
      id,
      type,
      x,
      y,
      label: label ?? defaultLabel(type),
      ...extra,
    });
    this.sel.clear();
    this.sel.add(id);
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireSelect();
  }

  deleteSelected(): void {
    if (
      this.sel.size === 0 &&
      this.linkSel === null &&
      this.selAnchors.size === 0 &&
      this.zoneSel === null
    )
      return;
    this.snapshot();
    if (this.zoneSel !== null) {
      // Deleting a zone removes the region annotation only — its member nodes
      // (and their links) stay on the canvas.
      this.page.zones = this.page.zones.filter((z) => z.id !== this.zoneSel);
      this.zoneSel = null;
      this.fireZoneSelect();
    }
    if (this.linkSel !== null) {
      this.page.links = this.page.links.filter((l) => l.id !== this.linkSel);
      this.linkSel = null;
      this.fireLinkSelect();
    }
    if (this.selAnchors.size > 0) {
      this.page.anchors = this.page.anchors.filter(
        (a) => !this.selAnchors.has(a.id),
      );
      this.selAnchors.clear();
      this.anchorSel = null;
      this.fireAnchorSelect();
    }
    if (this.sel.size > 0) {
      this.page.nodes = this.page.nodes.filter((n) => !this.sel.has(n.id));
      this.sel.clear();
    }
    // Cascade: drop links whose endpoints (node or anchor) no longer exist.
    const ids = new Set([
      ...this.page.nodes.map((n) => n.id),
      ...this.page.anchors.map((a) => a.id),
    ]);
    this.page.links = this.page.links.filter(
      (l) => ids.has(l.from) && ids.has(l.to),
    );
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireSelect();
  }

  /** Clear node + link + anchor + zone selection (Esc). */
  clearSelection(): void {
    const had =
      this.sel.size > 0 ||
      this.linkSel !== null ||
      this.selAnchors.size > 0 ||
      this.anchorSel !== null ||
      this.zoneSel !== null;
    this.sel.clear();
    this.selAnchors.clear();
    this.linkSel = null;
    this.anchorSel = null;
    this.clearZoneSel();
    if (had) {
      this.renderOverlay();
      this.fireSelect();
      this.fireLinkSelect();
      this.fireAnchorSelect();
    }
  }

  /* ── per-frame emphasis (Phase 2.2) ───────────────────────────── */

  /** Element ids spotlighted on this frame (others render dimmed). */
  getEmphasis(): string[] {
    return this.page.emphasis ?? [];
  }
  isEmphasized(id: string): boolean {
    return (this.page.emphasis ?? []).includes(id);
  }
  private applyEmphasis(ids: string[]): void {
    this.snapshot();
    this.page.emphasis = ids.length ? ids : undefined;
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }
  /** Add the current selection (nodes + the selected link) to the emphasis set. */
  emphasizeSelection(): void {
    const next = new Set(this.page.emphasis ?? []);
    for (const id of this.sel) next.add(id);
    if (this.linkSel) next.add(this.linkSel);
    if (next.size === (this.page.emphasis?.length ?? 0)) return;
    this.applyEmphasis([...next]);
  }
  /** Toggle a single element's membership in the emphasis set. */
  toggleEmphasis(id: string): void {
    const next = new Set(this.page.emphasis ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.applyEmphasis([...next]);
  }
  /** Clear the frame's emphasis (everything full again). */
  clearEmphasis(): void {
    if (!this.page.emphasis?.length) return;
    this.applyEmphasis([]);
  }

  /**
   * Hit-test at a client (screen) point and make that element the selection,
   * returning what was hit. Used by the right-click context menu so the menu
   * acts on whatever is under the cursor. A node/link under the cursor that is
   * already part of the selection is left selected (so a menu can act on a
   * multi-selection); otherwise the selection is replaced with the single hit.
   */
  pickAt(
    clientX: number,
    clientY: number,
  ): { kind: 'node' | 'link' | 'empty'; id: string | null } {
    const p = clientToUser(this.overlay, clientX, clientY);
    const node = hitTestNode(this.page, p.x, p.y);
    if (node) {
      this.clearLinkSel();
      this.clearAnchorSel();
      if (!this.sel.has(node)) {
        this.sel.clear();
        this.sel.add(node);
      }
      this.fireSelect();
      this.renderOverlay();
      return { kind: 'node', id: node };
    }
    const link = hitTestLink(this.page, p.x, p.y);
    if (link) {
      this.sel.clear();
      this.clearAnchorSel();
      this.fireSelect();
      if (this.linkSel !== link) {
        this.linkSel = link;
        this.fireLinkSelect();
      }
      this.renderOverlay();
      return { kind: 'link', id: link };
    }
    // Empty canvas — clear any current selection.
    this.sel.clear();
    this.clearLinkSel();
    this.clearAnchorSel();
    this.fireSelect();
    this.renderOverlay();
    return { kind: 'empty', id: null };
  }

  /* ── clipboard / duplicate / select-all ───────────────────────── */

  /** Select every node on the page. */
  selectAll(): void {
    this.linkSel = null;
    this.clearAnchorSel();
    this.sel = new Set(this.page.nodes.map((n) => n.id));
    this.renderOverlay();
    this.fireSelect();
    this.fireLinkSelect();
  }

  /* ── select by / filter ───────────────────────────────────────── */

  /** Replace the selection with all nodes matching `predicate`. */
  private selectWhere(predicate: (n: NodeConfig) => boolean): void {
    this.linkSel = null;
    this.clearAnchorSel();
    this.sel = new Set(this.page.nodes.filter(predicate).map((n) => n.id));
    this.renderOverlay();
    this.fireSelect();
    this.fireLinkSelect();
  }

  /** The first currently-selected node (selection order is page order). */
  private firstSelectedNode(): NodeConfig | null {
    return this.page.nodes.find((n) => this.sel.has(n.id)) ?? null;
  }

  /** Select every node sharing the (first) selected node's type. */
  selectSameType(): void {
    const ref = this.firstSelectedNode();
    if (ref) this.selectWhere((n) => n.type === ref.type);
  }

  /** Select every node sharing the (first) selected node's color. */
  selectSameColor(): void {
    const ref = this.firstSelectedNode();
    if (ref) this.selectWhere((n) => n.color === ref.color);
  }

  /** Invert the node selection (select the unselected, deselect the selected). */
  invertSelection(): void {
    const had = this.sel;
    this.selectWhere((n) => !had.has(n.id));
  }

  /**
   * Grow the selection by one hop: add every node linked to a selected node.
   * Repeatable — press again to keep expanding across the connected component.
   */
  growConnected(): void {
    if (this.sel.size === 0) return;
    const next = new Set(this.sel);
    for (const l of this.page.links) {
      if (this.sel.has(l.from) && this.page.nodes.some((n) => n.id === l.to))
        next.add(l.to);
      if (this.sel.has(l.to) && this.page.nodes.some((n) => n.id === l.from))
        next.add(l.from);
    }
    this.linkSel = null;
    this.clearAnchorSel();
    this.sel = next;
    this.renderOverlay();
    this.fireSelect();
    this.fireLinkSelect();
  }

  /** Current zoom factor (1 = 100%): page width over the displayed width. */
  zoom(): number {
    const [, , pw] = parseVB(this.page.viewBox);
    return pw / this.view.w;
  }

  /**
   * Scale the view by `factor` about its centre (same limits as wheel zoom).
   * factor < 1 zooms in (the window shrinks), > 1 zooms out. Drives the
   * on-canvas zoom +/− buttons.
   */
  zoomBy(factor: number): void {
    const cx = this.view.x + this.view.w / 2;
    const cy = this.view.y + this.view.h / 2;
    const w = clamp(this.view.w * factor, 80, 8000);
    const h = clamp(this.view.h * factor, 53, 5333);
    this.view = { x: cx - w / 2, y: cy - h / 2, w, h };
    this.applyView();
  }
  /** Step zoom in (button +). */
  zoomIn(): void {
    this.zoomBy(1 / 1.25);
  }
  /** Step zoom out (button −). */
  zoomOut(): void {
    this.zoomBy(1.25);
  }

  /** Copy the selected nodes (+ links internal to them) into the clipboard. */
  copySelection(): void {
    if (this.sel.size === 0) return;
    const ids = this.sel;
    this.clipboard = {
      nodes: this.page.nodes
        .filter((n) => ids.has(n.id))
        .map((n) => structuredClone(n)),
      links: this.page.links
        .filter((l) => ids.has(l.from) && ids.has(l.to))
        .map((l) => structuredClone(l)),
    };
  }

  /** Copy then delete the selection. */
  cut(): void {
    if (this.sel.size === 0) return;
    this.copySelection();
    this.deleteSelected();
  }

  /** Whether the clipboard holds nodes that `paste()` would place. */
  canPaste(): boolean {
    return !!this.clipboard && this.clipboard.nodes.length > 0;
  }

  /** Paste the clipboard (offset), selecting the new nodes. */
  paste(): void {
    if (!this.clipboard || this.clipboard.nodes.length === 0) return;
    this.placeClones(this.clipboard.nodes, this.clipboard.links);
  }

  /** Duplicate the current selection in place (offset), selecting the copies. */
  duplicateSelection(): void {
    if (this.sel.size === 0) return;
    const ids = this.sel;
    const nodes = this.page.nodes.filter((n) => ids.has(n.id));
    const links = this.page.links.filter(
      (l) => ids.has(l.from) && ids.has(l.to),
    );
    this.placeClones(nodes, links);
  }

  private placeClones(srcNodes: NodeConfig[], srcLinks: LinkConfig[]): void {
    if (srcNodes.length === 0) return;
    this.snapshot();
    const { nodes, links } = cloneElements(srcNodes, srcLinks, {
      nextNodeId: () => this.newNodeId(),
      nextLinkId: () => this.newLinkId(),
      dx: 24,
      dy: 24,
    });
    this.page.nodes.push(...nodes);
    this.page.links.push(...links);
    this.linkSel = null;
    this.sel = new Set(nodes.map((n) => n.id));
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireSelect();
    this.fireLinkSelect();
  }

  /* ── stencils / reusable groups (C.3) ─────────────────────────── */

  /**
   * The selected nodes + the links internal to them, cloned — the raw material
   * for saving a stencil. Returns null when no node is selected.
   */
  selectionElements(): { nodes: NodeConfig[]; links: LinkConfig[] } | null {
    if (this.sel.size === 0) return null;
    const ids = this.sel;
    return {
      nodes: this.page.nodes
        .filter((n) => ids.has(n.id))
        .map((n) => structuredClone(n)),
      links: this.page.links
        .filter((l) => ids.has(l.from) && ids.has(l.to))
        .map((l) => structuredClone(l)),
    };
  }

  /**
   * Stamp a saved stencil's elements onto the current page, centred on the
   * viewport with fresh ids, selecting the placed copies. The stencil's nodes
   * are stored centred on (0,0), so the viewport centre becomes the group's
   * centre. Undoable.
   */
  stampStencil(srcNodes: NodeConfig[], srcLinks: LinkConfig[]): void {
    if (srcNodes.length === 0) return;
    this.snapshot();
    const cx = this.snapVal(this.view.x + this.view.w / 2);
    const cy = this.snapVal(this.view.y + this.view.h / 2);
    const { nodes, links } = cloneElements(srcNodes, srcLinks, {
      nextNodeId: () => this.newNodeId(),
      nextLinkId: () => this.newLinkId(),
      dx: cx,
      dy: cy,
    });
    this.page.nodes.push(...nodes);
    this.page.links.push(...links);
    this.linkSel = null;
    this.clearAnchorSel();
    this.sel = new Set(nodes.map((n) => n.id));
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireSelect();
    this.fireLinkSelect();
  }

  /* ── container zones (C.2) ────────────────────────────────────── */

  /** A zone's member node ids that still exist on the page. */
  private zoneMemberIds(id: string): string[] {
    const z = this.page.zones.find((zz) => zz.id === id);
    if (!z) return [];
    const present = new Set(this.page.nodes.map((n) => n.id));
    return (z.nodes ?? []).filter((nid) => present.has(nid));
  }

  /**
   * Select a zone's member nodes (so the existing group-drag / nudge moves the
   * whole zone — it auto-sizes around its members). Makes a zone behave as a
   * movable container.
   */
  selectZoneMembers(id: string): boolean {
    const ids = this.zoneMemberIds(id);
    if (!ids.length) return false;
    this.linkSel = null;
    this.clearAnchorSel();
    this.clearZoneSel();
    this.sel = new Set(ids);
    this.renderOverlay();
    this.fireSelect();
    this.fireLinkSelect();
    return true;
  }

  /** Select a zone by id (e.g. from the annotations list) and show its editor. */
  selectZone(id: string): boolean {
    if (!this.page.zones.some((z) => z.id === id)) return false;
    this.sel.clear();
    this.selAnchors.clear();
    this.clearAnchorSel();
    this.linkSel = null;
    this.zoneSel = id;
    this.renderOverlay();
    this.fireSelect();
    this.fireLinkSelect();
    this.fireZoneSelect();
    return true;
  }

  /**
   * Duplicate a zone together with its contained nodes + the links internal to
   * them, all with fresh ids and offset — so a zone is a reusable container.
   * Selects the new nodes.
   */
  duplicateZone(id: string): void {
    const z = this.page.zones.find((zz) => zz.id === id);
    if (!z) return;
    const memberIds = new Set(this.zoneMemberIds(id));
    const srcNodes = this.page.nodes.filter((n) => memberIds.has(n.id));
    if (!srcNodes.length) return;
    const srcLinks = this.page.links.filter(
      (l) => memberIds.has(l.from) && memberIds.has(l.to),
    );
    this.snapshot();
    const { nodes, links } = cloneElements(srcNodes, srcLinks, {
      nextNodeId: () => this.newNodeId(),
      nextLinkId: () => this.newLinkId(),
      dx: 32,
      dy: 32,
    });
    // cloneElements maps over srcNodes in order, so nodes[i] is srcNodes[i]'s clone.
    const idMap = new Map(srcNodes.map((n, i) => [n.id, nodes[i]!.id]));
    const newZone: ZoneConfig = {
      ...structuredClone(z),
      id: this.newZoneId(),
      nodes: srcNodes.map((n) => idMap.get(n.id)!),
      ...(z.label ? { label: `${z.label} copy` } : {}),
    };
    this.page.nodes.push(...nodes);
    this.page.links.push(...links);
    this.page.zones.push(newZone);
    this.linkSel = null;
    this.clearAnchorSel();
    this.sel = new Set(nodes.map((n) => n.id));
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireSelect();
    this.fireLinkSelect();
  }

  /* ── nudge (arrow keys) ───────────────────────────────────────── */

  /**
   * Move the (unlocked) selected nodes + anchors by (dx,dy); coalesces a burst
   * of arrow-key presses into one undo entry.
   */
  nudge(dx: number, dy: number): void {
    const nodes = [...this.sel]
      .map((id) => this.page.nodes.find((n) => n.id === id))
      .filter((n): n is NodeConfig => !!n && n.locked !== true);
    const anchors = [...this.selAnchors]
      .map((id) => this.page.anchors.find((a) => a.id === id))
      .filter((a): a is AnchorConfig => !!a);
    if (nodes.length === 0 && anchors.length === 0) return;
    if (!this.nudgeActive) this.snapshot();
    this.nudgeActive = true;
    for (const el of [...nodes, ...anchors]) {
      el.x = Math.round(el.x + dx);
      el.y = Math.round(el.y + dy);
    }
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => (this.nudgeActive = false), 500);
    // Held arrow keys repeat faster than frames — coalesce the art render.
    this.scheduleArt();
    this.renderOverlay();
    this.onChange();
  }

  /* ── z-order ──────────────────────────────────────────────────── */

  bringToFront(): void {
    this.zorder('front');
  }
  sendToBack(): void {
    this.zorder('back');
  }
  bringForward(): void {
    this.zorder('forward');
  }
  sendBackward(): void {
    this.zorder('backward');
  }

  /** Reorder the sole selected node (or the selected link) within its array. */
  private zorder(mode: 'front' | 'back' | 'forward' | 'backward'): void {
    const arr: { id: string }[] | null = this.linkSel
      ? this.page.links
      : this.sel.size === 1
        ? this.page.nodes
        : null;
    const id = this.linkSel ?? (this.sel.size === 1 ? [...this.sel][0]! : null);
    if (!arr || id === null) return;
    const i = arr.findIndex((e) => e.id === id);
    if (i < 0) return;
    const j =
      mode === 'front'
        ? arr.length - 1
        : mode === 'back'
          ? 0
          : mode === 'forward'
            ? Math.min(arr.length - 1, i + 1)
            : Math.max(0, i - 1);
    if (j === i) return;
    this.snapshot();
    const [el] = arr.splice(i, 1);
    arr.splice(j, 0, el!);
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }

  /* ── lock ─────────────────────────────────────────────────────── */

  /** Whether z-order/lock actions apply (exactly one node, or a link). */
  canArrange(): boolean {
    return this.linkSel !== null || this.sel.size === 1;
  }

  /** Whether every selected node/link is locked (so the menu can label it). */
  selectionLocked(): boolean {
    const targets: { locked?: boolean }[] = this.page.nodes.filter((n) =>
      this.sel.has(n.id),
    );
    const link = this.linkSel
      ? this.page.links.find((l) => l.id === this.linkSel)
      : null;
    if (link) targets.push(link);
    return targets.length > 0 && targets.every((t) => t.locked === true);
  }

  /** Toggle lock on the selected nodes + link (locks all unless all locked). */
  toggleLock(): void {
    const nodes = this.page.nodes.filter((n) => this.sel.has(n.id));
    const link = this.linkSel
      ? this.page.links.find((l) => l.id === this.linkSel)
      : null;
    const targets: { locked?: boolean }[] = [...nodes];
    if (link) targets.push(link);
    if (targets.length === 0) return;
    const next = !targets.every((t) => t.locked === true);
    this.snapshot();
    for (const t of targets) t.locked = next;
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }

  /* ── inspector accessors / updaters ───────────────────────────── */

  /** The sole selected node (for the inspector), or null if 0 or >1 selected. */
  getSelectedNode(): NodeConfig | null {
    if (this.sel.size !== 1) return null;
    const id = [...this.sel][0]!;
    return this.page.nodes.find((n) => n.id === id) ?? null;
  }

  /** The selected link (for the inspector), or null. */
  getSelectedLink(): LinkConfig | null {
    if (!this.linkSel) return null;
    return this.page.links.find((l) => l.id === this.linkSel) ?? null;
  }

  /**
   * Patch the sole selected node. Re-renders the art but NOT the inspector
   * (so a focused text field keeps focus while typing). Pass `commit=false`
   * during continuous edits and `true` on the first to snapshot once.
   */
  updateNode(patch: Partial<NodeConfig>, commit = true): void {
    const node = this.getSelectedNode();
    if (!node) return;
    if (commit) this.snapshot();
    Object.assign(node, patch);
    // Discrete edits render now; continuous edits (typing) coalesce per frame.
    if (commit) this.renderArt();
    else this.scheduleArt();
    this.renderOverlay();
    this.onChange();
  }

  /** Patch the selected link (re-renders art, keeps the inspector DOM). */
  updateLink(patch: Partial<LinkConfig>, commit = true): void {
    const link = this.getSelectedLink();
    if (!link) return;
    if (commit) this.snapshot();
    Object.assign(link, patch);
    if (commit) this.renderArt();
    else this.scheduleArt();
    this.renderOverlay();
    this.onChange();
  }

  /** Swap the selected link's endpoints (and reverse any waypoints). */
  swapLink(): void {
    const link = this.getSelectedLink();
    if (!link) return;
    this.snapshot();
    const { from, to } = link;
    link.from = to;
    link.to = from;
    if (link.waypoints) link.waypoints = [...link.waypoints].reverse();
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }

  /* ── annotations (zones / flow paths / policy markers) ────────── */

  /** Ids of the currently selected nodes — used to seed zones / flow paths. */
  selectedNodeIds(): string[] {
    return [...this.sel].filter((id) =>
      this.page.nodes.some((n) => n.id === id),
    );
  }

  addZone(zone: ZoneConfig): void {
    this.snapshot();
    this.page.zones.push(zone);
    this.afterAnnotationChange();
  }
  addFlowPath(flow: FlowPathConfig): void {
    this.snapshot();
    this.page.flowPaths.push(flow);
    this.afterAnnotationChange();
  }
  addPolicyMarker(marker: PolicyMarkerConfig): void {
    this.snapshot();
    this.page.policyMarkers.push(marker);
    this.afterAnnotationChange();
  }

  /** Patch an annotation by id. `commit=false` for continuous edits (snapshot once). */
  updateAnnotation(
    collection: 'zones' | 'flowPaths' | 'policyMarkers',
    id: string,
    patch: Record<string, unknown>,
    commit = true,
  ): void {
    const el = (this.page[collection] as { id: string }[]).find(
      (e) => e.id === id,
    );
    if (!el) return;
    if (commit) this.snapshot();
    Object.assign(el, patch);
    this.afterAnnotationChange(commit);
  }

  removeAnnotation(
    collection: 'zones' | 'flowPaths' | 'policyMarkers',
    id: string,
  ): void {
    this.snapshot();
    if (collection === 'zones') {
      this.page.zones = this.page.zones.filter((e) => e.id !== id);
      if (this.zoneSel === id) this.clearZoneSel();
    } else if (collection === 'flowPaths')
      this.page.flowPaths = this.page.flowPaths.filter((e) => e.id !== id);
    else
      this.page.policyMarkers = this.page.policyMarkers.filter(
        (e) => e.id !== id,
      );
    this.afterAnnotationChange();
  }

  private afterAnnotationChange(immediate = true): void {
    if (immediate) this.renderArt();
    else this.scheduleArt();
    this.renderOverlay();
    this.onChange();
  }

  /** Align selected nodes' centers. Needs 2+ selected. */
  alignSelection(
    mode: 'left' | 'centerH' | 'right' | 'top' | 'middleV' | 'bottom',
  ): void {
    const nodes = this.page.nodes.filter((n) => this.sel.has(n.id));
    if (nodes.length < 2) return;
    this.snapshot();
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    for (const n of nodes) {
      if (mode === 'left') n.x = minX;
      else if (mode === 'right') n.x = maxX;
      else if (mode === 'centerH') n.x = Math.round((minX + maxX) / 2);
      else if (mode === 'top') n.y = minY;
      else if (mode === 'bottom') n.y = maxY;
      else if (mode === 'middleV') n.y = Math.round((minY + maxY) / 2);
    }
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }

  /** Distribute selected nodes' centers evenly along an axis. Needs 3+ selected. */
  distributeSelection(axis: 'h' | 'v'): void {
    const nodes = this.page.nodes.filter((n) => this.sel.has(n.id));
    if (nodes.length < 3) return;
    this.snapshot();
    nodes.sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const span = axis === 'h' ? last.x - first.x : last.y - first.y;
    const step = span / (nodes.length - 1);
    nodes.forEach((n, i) => {
      const v = Math.round((axis === 'h' ? first.x : first.y) + step * i);
      if (axis === 'h') n.x = v;
      else n.y = v;
    });
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }

  private fireSelect(): void {
    this.onSelect(this.sel.size);
  }

  private fireLinkSelect(): void {
    this.onLinkSelect(this.linkSel);
  }

  private fireAnchorSelect(): void {
    this.onAnchorSelect(this.anchorSel);
  }

  private fireZoneSelect(): void {
    this.onZoneSelect(this.zoneSel);
  }

  /** The selected zone (clicked on canvas), or null. */
  getSelectedZone(): ZoneConfig | null {
    if (this.zoneSel === null) return null;
    return this.page.zones.find((z) => z.id === this.zoneSel) ?? null;
  }

  /** Drop any zone selection (and notify) — used when another element is picked. */
  private clearZoneSel(): void {
    if (this.zoneSel !== null) {
      this.zoneSel = null;
      this.fireZoneSelect();
    }
  }

  private clearAnchorSel(): void {
    this.selAnchors.clear();
    if (this.anchorSel !== null) {
      this.anchorSel = null;
      this.fireAnchorSelect();
    }
  }

  /**
   * Keep `anchorSel` (the inspector's single-anchor target) in sync with the
   * multi-selection: it points at the lone selected anchor when exactly one
   * anchor and no nodes are selected, else null.
   */
  private syncAnchorSel(): void {
    const single =
      this.sel.size === 0 && this.selAnchors.size === 1
        ? [...this.selAnchors][0]!
        : null;
    if (single !== this.anchorSel) {
      this.anchorSel = single;
      this.fireAnchorSelect();
    }
  }

  /**
   * Start dragging the current selection (nodes + anchors) as a group, pivoting
   * on `primary`. Locked nodes are excluded; if the primary itself is excluded
   * (locked) no drag begins.
   */
  private beginGroupDrag(primary: string, p: { x: number; y: number }): void {
    const base = new Map<string, { x: number; y: number }>();
    const anchors = new Set<string>();
    for (const id of this.sel) {
      const n = this.page.nodes.find((m) => m.id === id);
      if (n && n.locked !== true) base.set(id, { x: n.x, y: n.y });
    }
    for (const id of this.selAnchors) {
      const a = this.page.anchors.find((m) => m.id === id);
      if (a) {
        base.set(id, { x: a.x, y: a.y });
        anchors.add(id);
      }
    }
    if (base.size > 0 && base.has(primary)) {
      this.drag = {
        startX: p.x,
        startY: p.y,
        base,
        anchors,
        moved: false,
        primary,
        dx: 0,
        dy: 0,
      };
    }
  }

  /** Apply the live drag delta to every moving node/anchor (no rounding). */
  private applyDrag(round = false): void {
    if (!this.drag) return;
    const { dx, dy } = this.drag;
    const set = (
      el: { x: number; y: number },
      base: { x: number; y: number },
    ): void => {
      el.x = round ? Math.round(base.x + dx) : base.x + dx;
      el.y = round ? Math.round(base.y + dy) : base.y + dy;
    };
    for (const [id, base] of this.drag.base) {
      if (this.drag.anchors.has(id)) {
        const a = this.page.anchors.find((m) => m.id === id);
        if (a) set(a, base);
      } else {
        const n = this.page.nodes.find((m) => m.id === id);
        if (n) set(n, base);
      }
    }
  }

  /* ── anchors (free-floating link endpoints) ───────────────────── */

  /** The selected anchor (for the inspector), or null. */
  getSelectedAnchor(): AnchorConfig | null {
    if (!this.anchorSel) return null;
    return this.page.anchors.find((a) => a.id === this.anchorSel) ?? null;
  }

  /** How many links use the given anchor as an endpoint. */
  anchorLinkCount(id: string): number {
    return this.page.links.filter((l) => l.from === id || l.to === id).length;
  }

  /** Patch the selected anchor's position (re-renders art + overlay). */
  updateAnchor(patch: Partial<AnchorConfig>, commit = true): void {
    const a = this.getSelectedAnchor();
    if (!a) return;
    if (commit) this.snapshot();
    Object.assign(a, patch);
    if (commit) this.renderArt();
    else this.scheduleArt();
    this.renderOverlay();
    this.onChange();
  }

  /** Drop a new anchor at a page point, select it (used by the anchor tool). */
  private addAnchorAt(x: number, y: number): void {
    this.snapshot();
    const id = `a${Date.now().toString(36)}${(this.anchorSeq++).toString(36)}`;
    this.page.anchors.push({ id, x: this.snapVal(x), y: this.snapVal(y) });
    this.sel.clear();
    this.clearLinkSel();
    this.anchorSel = id;
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireSelect();
    this.fireAnchorSelect();
  }

  /* ── links ────────────────────────────────────────────────────── */

  setTool(t: 'select' | 'link' | 'anchor'): void {
    this.tool = t;
    this.linkStart = null;
    this.linkCursor = null;
    this.dragLink = null;
    this.hoverNode = null;
    this.renderOverlay();
  }

  private createLink(from: string, to: string): void {
    this.snapshot();
    const id = `l${Date.now().toString(36)}${(this.linkSeq++).toString(36)}`;
    this.page.links.push({ id, type: 'line', from, to });
    this.sel.clear();
    this.linkSel = id;
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireSelect();
    this.fireLinkSelect();
  }

  /** Current selected link's type + routing style (for the link toolbar). */
  selectedLinkInfo(): { type: string; style: string } | null {
    const l = this.page.links.find((m) => m.id === this.linkSel);
    if (!l) return null;
    return { type: l.type, style: (l.lineStyle as string) ?? 'straight' };
  }

  cycleLinkType(): void {
    const l = this.page.links.find((m) => m.id === this.linkSel);
    if (!l) return;
    this.snapshot();
    const i = LINK_TYPES.indexOf(l.type);
    l.type = LINK_TYPES[(i + 1) % LINK_TYPES.length]!;
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireLinkSelect();
  }

  cycleLinkStyle(): void {
    const l = this.page.links.find((m) => m.id === this.linkSel);
    if (!l) return;
    this.snapshot();
    const cur = (l.lineStyle as string) ?? 'straight';
    const next =
      LINK_STYLES[(LINK_STYLES.indexOf(cur) + 1) % LINK_STYLES.length]!;
    if (next === 'straight') delete l.lineStyle;
    else l.lineStyle = next as 'orthogonal' | 'curved';
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireLinkSelect();
  }

  /* ── interaction ──────────────────────────────────────────────── */

  private snapVal(v: number): number {
    return this.snap ? Math.round(v / this.grid) * this.grid : Math.round(v);
  }

  /**
   * Compute the effective (snapped) drag delta + the guides to draw. Alignment
   * to other nodes' centers wins over grid snap; spacing guides are advisory
   * (drawn when the dragged node sits in an equal-gap run, no snap).
   */
  private computeSnap(
    drag: DragState,
    rawX: number,
    rawY: number,
  ): { dx: number; dy: number; guides: Guide[] } {
    const pb = drag.base.get(drag.primary)!;
    const projX = pb.x + rawX;
    const projY = pb.y + rawY;
    const T = 6; // user-space snap threshold

    let snapX: number | null = null;
    let snapY: number | null = null;
    let bestX = T;
    let bestY = T;
    // Align/space against every static element — nodes AND anchors — so dragging
    // an anchor snaps to the same guides a node does (and vice-versa).
    for (const t of this.snapTargets(drag)) {
      const dxn = Math.abs(t.x - projX);
      if (dxn <= bestX) {
        bestX = dxn;
        snapX = t.x;
      }
      const dyn = Math.abs(t.y - projY);
      if (dyn <= bestY) {
        bestY = dyn;
        snapY = t.y;
      }
    }

    const finalX = snapX ?? this.snapVal(projX);
    const finalY = snapY ?? this.snapVal(projY);

    const [vx, vy, vw, vh] = parseVB(this.page.viewBox);
    const guides: Guide[] = [];
    if (snapX !== null)
      guides.push({
        kind: 'align',
        x1: finalX,
        y1: vy,
        x2: finalX,
        y2: vy + vh,
      });
    if (snapY !== null)
      guides.push({
        kind: 'align',
        x1: vx,
        y1: finalY,
        x2: vx + vw,
        y2: finalY,
      });
    guides.push(
      ...this.spacingGuides(drag, finalX, finalY, T, [vx, vy, vw, vh]),
    );

    return { dx: finalX - pb.x, dy: finalY - pb.y, guides };
  }

  /** Static elements (nodes + anchors) the drag can align/space against. */
  private snapTargets(drag: DragState): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const n of this.page.nodes)
      if (!drag.base.has(n.id)) out.push({ x: n.x, y: n.y });
    for (const a of this.page.anchors)
      if (!drag.base.has(a.id)) out.push({ x: a.x, y: a.y });
    return out;
  }

  /** Equal-spacing hints: the dragged point + two others evenly spaced on an axis. */
  private spacingGuides(
    drag: DragState,
    x: number,
    y: number,
    T: number,
    vb: [number, number, number, number],
  ): Guide[] {
    const out: Guide[] = [];
    const others = this.snapTargets(drag);
    const cand = { x, y };

    const run = (axis: 'h' | 'v', pts: { x: number; y: number }[]): void => {
      const ordered = [...pts].sort((a, b) =>
        axis === 'h' ? a.x - b.x : a.y - b.y,
      );
      const c = ordered.map((p) => (axis === 'h' ? p.x : p.y));
      const gapA = c[1]! - c[0]!;
      const gapB = c[2]! - c[1]!;
      if (gapA <= 0 || gapB <= 0 || Math.abs(gapA - gapB) > T) return;
      out.push(spacingGuide(axis, ordered, (gapA + gapB) / 2, vb));
    };

    const row = others.filter((p) => Math.abs(p.y - y) <= T);
    const left = row.filter((p) => p.x < x).sort((a, b) => b.x - a.x);
    const right = row.filter((p) => p.x > x).sort((a, b) => a.x - b.x);
    if (left[0] && right[0]) run('h', [left[0], cand, right[0]]);
    if (left[0] && left[1]) run('h', [left[1], left[0], cand]);
    if (right[0] && right[1]) run('h', [cand, right[0], right[1]]);

    const col = others.filter((p) => Math.abs(p.x - x) <= T);
    const above = col.filter((p) => p.y < y).sort((a, b) => b.y - a.y);
    const below = col.filter((p) => p.y > y).sort((a, b) => a.y - b.y);
    if (above[0] && below[0]) run('v', [above[0], cand, below[0]]);
    if (above[0] && above[1]) run('v', [above[1], above[0], cand]);
    if (below[0] && below[1]) run('v', [cand, below[0], below[1]]);

    return out;
  }

  private bind(): void {
    this.overlay.addEventListener('pointerdown', (e) => this.onDown(e));
    this.overlay.addEventListener('pointermove', (e) => this.onMove(e));
    this.overlay.addEventListener('pointerup', (e) => this.onUp(e));
    this.overlay.addEventListener('pointerleave', () => {
      if (this.hoverNode !== null) {
        this.hoverNode = null;
        this.renderOverlay();
      }
    });
    this.overlay.addEventListener('dblclick', (e) => this.onDblClick(e));
    this.overlay.addEventListener('wheel', (e) => this.onWheel(e), {
      passive: false,
    });
  }

  /**
   * If `p` lands on a waypoint handle of the selected link, begin dragging it; if
   * it lands on a segment's midpoint "+" handle, insert a new waypoint there and
   * drag that. Returns true when a grab started.
   */
  /**
   * The link label chip under a doc point, if any — read from the rendered art
   * (each chip is tagged `.tds-llabel` with data-lid/data-llabel). Topmost wins.
   */
  private hitLabel(p: { x: number; y: number }): {
    lid: string;
    which: string;
  } | null {
    const els = this.art.querySelectorAll<SVGGraphicsElement>('.tds-llabel');
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i]!;
      let bb: DOMRect;
      try {
        bb = el.getBBox();
      } catch {
        continue;
      }
      const pad = 2;
      if (
        p.x >= bb.x - pad &&
        p.x <= bb.x + bb.width + pad &&
        p.y >= bb.y - pad &&
        p.y <= bb.y + bb.height + pad
      ) {
        const lid = el.getAttribute('data-lid');
        const which = el.getAttribute('data-llabel');
        if (lid && which) return { lid, which };
      }
    }
    return null;
  }

  private tryWaypointGrab(p: { x: number; y: number }): boolean {
    const link = this.page.links.find((l) => l.id === this.linkSel);
    if (!link) return false;
    const pts = linkPolyline(this.page, link);
    if (pts.length < 2) return false;
    const tol = this.handleSize() * 1.4;
    // Existing waypoint handles (polyline indices 1..n-2).
    for (let i = 1; i < pts.length - 1; i++) {
      if (dist(p, pts[i]!) <= tol) {
        this.wpDrag = { index: i - 1, moved: false };
        return true;
      }
    }
    // Segment midpoint "add" handles → insert a waypoint at segment index k.
    for (let k = 0; k < pts.length - 1; k++) {
      const m = midpoint(pts[k]!, pts[k + 1]!);
      if (dist(p, m) <= tol) {
        this.snapshot();
        const wps = link.waypoints ? [...link.waypoints] : [];
        wps.splice(k, 0, { x: Math.round(m.x), y: Math.round(m.y) });
        link.waypoints = wps;
        this.wpDrag = { index: k, moved: true };
        this.renderArt();
        this.onChange();
        return true;
      }
    }
    return false;
  }

  /** Double-click a waypoint handle to remove that bend point. */
  private onDblClick(e: MouseEvent): void {
    if (this.tool !== 'select' || !this.linkSel) return;
    const link = this.page.links.find((l) => l.id === this.linkSel);
    if (!link?.waypoints?.length) return;
    const p = clientToUser(this.overlay, e.clientX, e.clientY);
    const tol = this.handleSize() * 1.4;
    for (let i = 0; i < link.waypoints.length; i++) {
      if (dist(p, link.waypoints[i]!) <= tol) {
        this.snapshot();
        link.waypoints.splice(i, 1);
        if (link.waypoints.length === 0) delete link.waypoints;
        this.renderArt();
        this.renderOverlay();
        this.onChange();
        return;
      }
    }
  }

  /** Wheel = zoom toward the cursor (keeps the point under the cursor fixed). */
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const before = clientToUser(this.overlay, e.clientX, e.clientY);
    const factor = Math.exp(e.deltaY * 0.0015); // up = zoom in
    const w = clamp(this.view.w * factor, 80, 8000);
    const h = clamp(this.view.h * factor, 53, 5333);
    // Keep the cursor's page-point stationary on screen.
    const rect = this.overlay.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    this.view = { x: before.x - fx * w, y: before.y - fy * h, w, h };
    this.applyView();
  }

  private onDown(e: PointerEvent): void {
    // Pan: middle button, or left button while Space is held / Hand tool is on.
    if (
      e.button === 1 ||
      ((this.spaceHeld || this.handTool) && e.button === 0)
    ) {
      e.preventDefault();
      this.pan = { startClientX: e.clientX, startClientY: e.clientY };
      this.overlay.setPointerCapture(e.pointerId);
      this.overlay.style.cursor = 'grabbing';
      return;
    }
    const p = clientToUser(this.overlay, e.clientX, e.clientY);

    // Anchor tool: click drops a new anchor (a free-floating link endpoint).
    if (this.tool === 'anchor') {
      this.addAnchorAt(p.x, p.y);
      this.overlay.setPointerCapture(e.pointerId);
      return;
    }

    // Editing waypoints on the selected link takes priority over other hits.
    if (this.tool === 'select' && this.linkSel && this.tryWaypointGrab(p)) {
      this.overlay.setPointerCapture(e.pointerId);
      this.renderOverlay();
      return;
    }

    // Grabbing a link's label chip (interface or centre) drags it — beats node
    // selection so you can move a label that overlaps an icon.
    if (this.tool === 'select' && !this.spaceHeld) {
      const lh = this.hitLabel(p);
      if (lh) {
        const link = this.page.links.find((l) => l.id === lh.lid);
        if (link) {
          const key = labelOffsetKey(lh.which);
          const cur = (link[key] as { x?: number; y?: number }) ?? {};
          this.labelDrag = {
            lid: lh.lid,
            key,
            startX: p.x,
            startY: p.y,
            ox: cur.x ?? 0,
            oy: cur.y ?? 0,
            moved: false,
          };
          this.clearZoneSel();
          this.sel.clear();
          this.selAnchors.clear();
          this.syncAnchorSel();
          this.linkSel = lh.lid;
          this.fireSelect();
          this.fireLinkSelect();
          this.overlay.setPointerCapture(e.pointerId);
          this.renderOverlay();
          return;
        }
      }
    }

    const hit = hitTestNode(this.page, p.x, p.y);

    // Select tool: pressing a connection dot (the handles shown when hovering a
    // node) drags out a link — no tool switch needed. Dot beats node-body so you
    // can link from the edge without moving the node.
    if (this.tool === 'select' && !this.spaceHeld && !e.shiftKey) {
      const dotNode = this.connectionDotHit(p);
      if (dotNode) {
        if (!this.sel.has(dotNode)) {
          this.sel.clear();
          this.sel.add(dotNode);
          this.fireSelect();
        }
        this.dragLink = { from: dotNode, start: p, cursor: p, moved: false };
        this.overlay.setPointerCapture(e.pointerId);
        this.renderOverlay();
        return;
      }
    }

    // Link tool: click source, then target, to create a link. Endpoints may be
    // a node or an anchor (anchors exist precisely to be link endpoints).
    if (this.tool === 'link') {
      const endpoint =
        hit ?? hitTestAnchor(this.page, p.x, p.y, this.anchorHitPad());
      if (endpoint) {
        if (this.linkStart === null) {
          this.linkStart = endpoint;
          this.linkCursor = p;
        } else if (endpoint !== this.linkStart) {
          this.createLink(this.linkStart, endpoint);
          this.linkStart = null;
          this.linkCursor = null;
        }
      } else {
        this.linkStart = null; // click on empty cancels
      }
      this.overlay.setPointerCapture(e.pointerId);
      this.renderOverlay();
      return;
    }

    if (hit) {
      this.clearLinkSel();
      this.clearZoneSel();
      if (e.shiftKey) {
        if (this.sel.has(hit)) this.sel.delete(hit);
        else this.sel.add(hit);
      } else if (!this.sel.has(hit)) {
        // Plain click on a fresh node replaces the whole selection.
        this.sel.clear();
        this.selAnchors.clear();
        this.sel.add(hit);
      }
      this.syncAnchorSel();
      // Begin drag of the current selection (locked nodes don't move).
      if (this.sel.has(hit)) this.beginGroupDrag(hit, p);
    } else {
      // No node — try an anchor, then a link, else start a marquee.
      const anchorHit = hitTestAnchor(this.page, p.x, p.y, this.anchorHitPad());
      if (anchorHit) {
        this.clearLinkSel();
        this.clearZoneSel();
        if (e.shiftKey) {
          if (this.selAnchors.has(anchorHit)) this.selAnchors.delete(anchorHit);
          else this.selAnchors.add(anchorHit);
        } else if (!this.selAnchors.has(anchorHit)) {
          // Plain click on a fresh anchor replaces the whole selection.
          this.sel.clear();
          this.selAnchors.clear();
          this.selAnchors.add(anchorHit);
        }
        this.syncAnchorSel();
        if (this.selAnchors.has(anchorHit)) this.beginGroupDrag(anchorHit, p);
        this.fireSelect();
        this.overlay.setPointerCapture(e.pointerId);
        this.renderOverlay();
        return;
      }
      const link = hitTestLink(this.page, p.x, p.y);
      if (link) {
        this.clearZoneSel();
        this.sel.clear();
        this.selAnchors.clear();
        this.syncAnchorSel();
        this.linkSel = link;
        this.fireSelect();
        this.fireLinkSelect();
        this.overlay.setPointerCapture(e.pointerId);
        this.renderOverlay();
        return;
      }
      // No node/anchor/link — an empty spot inside a zone's region selects the
      // zone (so it's reachable on canvas, not only via the inspector list).
      const zoneHit = hitTestZone(this.page, p.x, p.y);
      if (zoneHit) {
        this.clearLinkSel();
        this.sel.clear();
        this.selAnchors.clear();
        this.syncAnchorSel();
        this.zoneSel = zoneHit;
        this.fireSelect();
        this.fireZoneSelect();
        this.overlay.setPointerCapture(e.pointerId);
        this.renderOverlay();
        return;
      }
      this.clearLinkSel();
      this.clearZoneSel();
      if (!e.shiftKey) {
        this.sel.clear();
        this.selAnchors.clear();
        this.syncAnchorSel();
      }
      this.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    }
    this.overlay.setPointerCapture(e.pointerId);
    this.fireSelect();
    this.renderOverlay();
  }

  private clearLinkSel(): void {
    if (this.linkSel !== null) {
      this.linkSel = null;
      this.fireLinkSelect();
    }
  }

  private onMove(e: PointerEvent): void {
    if (this.pan) {
      const rect = this.overlay.getBoundingClientRect();
      const dx =
        ((e.clientX - this.pan.startClientX) / rect.width) * this.view.w;
      const dy =
        ((e.clientY - this.pan.startClientY) / rect.height) * this.view.h;
      this.view.x -= dx;
      this.view.y -= dy;
      this.pan.startClientX = e.clientX;
      this.pan.startClientY = e.clientY;
      this.applyView();
      return;
    }
    if (this.tool === 'link' && this.linkStart) {
      this.linkCursor = clientToUser(this.overlay, e.clientX, e.clientY);
      this.renderOverlay();
      return;
    }
    if (this.dragLink) {
      const pp = clientToUser(this.overlay, e.clientX, e.clientY);
      this.dragLink.cursor = pp;
      if (dist(pp, this.dragLink.start) > this.nodeEdgeBand())
        this.dragLink.moved = true;
      this.renderOverlay();
      return;
    }
    if (this.wpDrag) {
      const pp = clientToUser(this.overlay, e.clientX, e.clientY);
      const link = this.page.links.find((l) => l.id === this.linkSel);
      const wp = link?.waypoints?.[this.wpDrag.index];
      if (wp) {
        if (!this.wpDrag.moved) {
          this.snapshot();
          this.wpDrag.moved = true;
        }
        wp.x = this.snapVal(pp.x);
        wp.y = this.snapVal(pp.y);
        this.renderOverlay();
      }
      return;
    }
    if (this.labelDrag) {
      const pp = clientToUser(this.overlay, e.clientX, e.clientY);
      const link = this.page.links.find((l) => l.id === this.labelDrag!.lid);
      if (link) {
        if (!this.labelDrag.moved) {
          this.snapshot();
          this.labelDrag.moved = true;
        }
        link[this.labelDrag.key] = {
          x: Math.round(this.labelDrag.ox + (pp.x - this.labelDrag.startX)),
          y: Math.round(this.labelDrag.oy + (pp.y - this.labelDrag.startY)),
        };
        this.scheduleArt();
      }
      return;
    }
    // Idle hover: show connection dots on the node under the cursor, and a
    // crosshair when poised over a dot (drag it out to draw a link).
    if (!this.drag && !this.marquee) {
      if (
        this.tool === 'select' &&
        !this.spaceHeld &&
        !this.handTool &&
        e.buttons === 0
      ) {
        const hp = clientToUser(this.overlay, e.clientX, e.clientY);
        const over = this.hoverNodeAt(hp);
        if (over !== this.hoverNode) {
          this.hoverNode = over;
          this.renderOverlay();
        }
        this.overlay.style.cursor = this.connectionDotHit(hp)
          ? 'crosshair'
          : '';
      }
      return;
    }
    const p = clientToUser(this.overlay, e.clientX, e.clientY);
    if (this.drag) {
      const rawX = p.x - this.drag.startX;
      const rawY = p.y - this.drag.startY;
      const wasMoved = this.drag.moved;
      if (Math.abs(rawX) > 1 || Math.abs(rawY) > 1) this.drag.moved = true;
      // Snapshot once, when the drag first commits to moving.
      if (!wasMoved && this.drag.moved) this.snapshot();
      const snap = this.computeSnap(this.drag, rawX, rawY);
      this.drag.dx = snap.dx;
      this.drag.dy = snap.dy;
      this.guides = this.drag.moved ? snap.guides : [];
      if (this.drag.moved) {
        // Move live so connected links re-route under the cursor (coalesced
        // per frame); selection rings + guides ride along on the overlay.
        this.applyDrag();
        this.scheduleArt();
      }
    } else if (this.marquee) {
      this.marquee.x1 = p.x;
      this.marquee.y1 = p.y;
    }
    this.renderOverlay();
  }

  private onUp(e: PointerEvent): void {
    this.overlay.releasePointerCapture(e.pointerId);
    if (this.pan) {
      this.pan = null;
      // Back to the hand cursor if Space is still held / Hand tool is on.
      this.overlay.style.cursor = this.handCursor();
      return;
    }
    if (this.wpDrag) {
      if (this.wpDrag.moved) {
        const link = this.page.links.find((l) => l.id === this.linkSel);
        const wp = link?.waypoints?.[this.wpDrag.index];
        if (wp) {
          wp.x = Math.round(wp.x);
          wp.y = Math.round(wp.y);
        }
        this.renderArt();
        this.onChange();
      }
      this.wpDrag = null;
      this.renderOverlay();
      return;
    }
    if (this.labelDrag) {
      if (this.labelDrag.moved) {
        this.renderArt();
        this.onChange();
      }
      this.labelDrag = null;
      this.renderOverlay();
      return;
    }
    if (this.dragLink) {
      const dl = this.dragLink;
      this.dragLink = null;
      if (dl.moved) {
        // Released over a node or anchor → connect; over empty space → cancel.
        const pp = clientToUser(this.overlay, e.clientX, e.clientY);
        const target =
          hitTestNode(this.page, pp.x, pp.y) ??
          hitTestAnchor(this.page, pp.x, pp.y, this.anchorHitPad());
        if (target && target !== dl.from) this.createLink(dl.from, target);
      }
      // A press that never moved leaves the node selected (plain click-select).
      this.renderOverlay();
      return;
    }
    if (this.drag) {
      if (this.drag.moved) {
        // Positions were applied live during the drag; snapshot was taken on
        // the first move. Settle to integer coordinates and commit.
        this.applyDrag(true);
        this.guides = [];
        this.renderArt();
        this.onChange();
      }
      this.drag = null;
    } else if (this.marquee) {
      const { x0, y0, x1, y1 } = this.marquee;
      if (Math.abs(x1 - x0) > 2 || Math.abs(y1 - y0) > 2) {
        for (const id of nodesInRect(this.page, x0, y0, x1, y1))
          this.sel.add(id);
        // Anchors whose point falls in the rect join the selection too.
        const xa = Math.min(x0, x1),
          xb = Math.max(x0, x1),
          ya = Math.min(y0, y1),
          yb = Math.max(y0, y1);
        for (const a of this.page.anchors)
          if (a.x >= xa && a.x <= xb && a.y >= ya && a.y <= yb)
            this.selAnchors.add(a.id);
        this.syncAnchorSel();
      }
      this.marquee = null;
    }
    this.fireSelect();
    this.renderOverlay();
  }

  /* ── view toggles ─────────────────────────────────────────────── */

  toggleGrid(): void {
    this.gridVisible = !this.gridVisible;
    this.renderOverlay();
  }
  toggleSnap(): void {
    this.snap = !this.snap;
  }
  /** Total movable elements selected (nodes + anchors) — gates arrow-nudge. */
  selectionCount(): number {
    return this.sel.size + this.selAnchors.size;
  }
}

/** The link field that stores a given label chip's drag offset. */
function labelOffsetKey(which: string): string {
  return which === 'from'
    ? 'fromLabelOffset'
    : which === 'to'
      ? 'toLabelOffset'
      : 'labelOffset';
}

function parseViewBox(vb: string): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const [x, y, w, h] = vb.split(/\s+/).map(Number);
  return { x: x || 0, y: y || 0, w: w || 1050, h: h || 700 };
}

function parseVB(vb: string): [number, number, number, number] {
  const [x, y, w, h] = vb.split(/\s+/).map(Number);
  return [x || 0, y || 0, w || 1050, h || 700];
}

/** Build a spacing guide (line + ticks + gap label) for 3 evenly-spaced points. */
function spacingGuide(
  axis: 'h' | 'v',
  pts: { x: number; y: number }[],
  gap: number,
  vb: [number, number, number, number],
): Guide {
  const label = `${Math.round(gap)}px`;
  if (axis === 'h') {
    const xs = pts.map((p) => p.x);
    const avgY = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const gy = avgY - 42 < vb[1] + 12 ? avgY + 42 : avgY - 42;
    return {
      kind: 'spacing',
      x1: Math.min(...xs),
      y1: gy,
      x2: Math.max(...xs),
      y2: gy,
      ticks: pts.map((p) => ({ x: p.x, y: gy })),
      label,
      labelX: (Math.min(...xs) + Math.max(...xs)) / 2,
      labelY: gy - 7,
    };
  }
  const ys = pts.map((p) => p.y);
  const avgX = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const gx = avgX - 42 < vb[0] + 12 ? avgX + 42 : avgX - 42;
  return {
    kind: 'spacing',
    x1: gx,
    y1: Math.min(...ys),
    x2: gx,
    y2: Math.max(...ys),
    ticks: pts.map((p) => ({ x: gx, y: p.y })),
    label,
    labelX: gx,
    labelY: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function dist(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** A readable default label for a freshly-added node. */
function defaultLabel(type: string): string {
  const t = type.replace(/^shape:/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Plain serializable view of a page (drops nothing — pages are already plain). */
function serialize(page: Page): {
  viewBox: string;
  name: string;
  nodes: NodeConfig[];
  links: Page['links'];
  anchors: Page['anchors'];
  zones: Page['zones'];
  flowPaths: Page['flowPaths'];
  policyMarkers: Page['policyMarkers'];
} {
  return structuredClone({
    viewBox: page.viewBox,
    name: page.name,
    nodes: page.nodes,
    links: page.links,
    anchors: page.anchors,
    zones: page.zones,
    flowPaths: page.flowPaths,
    policyMarkers: page.policyMarkers,
  });
}
