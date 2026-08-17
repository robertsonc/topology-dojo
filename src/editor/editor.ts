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
  type BrandPalette,
  type FlowPathConfig,
  type LinkConfig,
  type NodeConfig,
  type PolicyMarkerConfig,
  type ZoneConfig,
} from '../vendor/topology-ds.js';
import { clientToUser, userToClient } from './coords.js';
import { balancePage, tidyPage } from '../api/tidy.js';
import { layoutPage, type AutoLayoutOptions } from '../api/autolayout.js';
import { cloneElements } from './clone.js';
import type { Page } from '../pages/model.js';
import { cascadeEndpointRemoval } from '../pages/cascade.js';
import type {
  ElementKind,
  FieldPatch,
  WorkspaceOperation,
} from '../workspace/model.js';
import {
  hitTestAnchor,
  hitTestLink,
  hitTestNode,
  hitTestZone,
  linkPolyline,
  nodeBounds,
  nodeHalf,
  nodesInRect,
  resolvePos,
  zoneBounds,
} from './geometry.js';
import type { BadgePlacement } from './problem-badges.js';

const ACCENT = '#01a982';
/** Escape a string for use inside an SVG/HTML attribute value. */
function escXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const MUTED = '#7d8a92';
// Match the problems panel's `.prob-error` / `.prob-warning` dot colours
// (index.html) so a badge and its panel row read as the same severity.
const PROB_ERROR = '#fc6161';
const PROB_WARN = '#e0a44a';
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

/**
 * A request to edit an element's label in place (double-click gesture). The
 * editor computes what was hit and where its label anchor sits in *client*
 * coordinates; the shell (main.ts) owns the floating DOM input and commits
 * through the normal update paths. `kind: 'empty'` reports a double-click on
 * blank canvas (the quick-add gesture).
 */
export interface InlineEditRequest {
  kind: 'node' | 'link' | 'zone' | 'empty';
  /** Hit element id; null for 'empty'. */
  id: string | null;
  /** Current label text ('' when unset). */
  current: string;
  /** Anchor for the floating editor, in viewport (client) coordinates. */
  clientX: number;
  clientY: number;
  /** Model-space point of the double-click (used by quick-add placement). */
  pageX: number;
  pageY: number;
}

/**
 * A link dragged out from a node and released over empty canvas — the shell
 * offers a "create + connect" picker at the drop point (draw.io-style).
 */
export interface ConnectEmptyRequest {
  /** The source node the pending link starts from. */
  from: string;
  clientX: number;
  clientY: number;
  pageX: number;
  pageY: number;
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

/** Node style keys the format painter copies (appearance, never identity). */
const NODE_FORMAT_KEYS = ['color', 'labelColor', 'opacity'] as const;
/** Link style keys the format painter copies (type + line style, never wiring). */
const LINK_FORMAT_KEYS = [
  'type',
  'color',
  'lineStyle',
  'dashed',
  'strokeWidth',
  'flowSpeed',
  'flowParticles',
  'reverseFlow',
] as const;

export class Editor {
  private sel = new Set<string>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /**
   * Undo/redo stacks stashed per page id while other pages are edited (#204):
   * switching frames must not destroy the ability to undo edits made there.
   * Bounded: each stack is capped (see `snapshot`), and only the most recently
   * left MAX_STASHED_HISTORIES pages keep a stash (insertion-ordered eviction).
   */
  private histories = new Map<string, { undo: string[]; redo: string[] }>();
  private static readonly MAX_STASHED_HISTORIES = 32;
  /**
   * Gesture-native operation buffer (Packet S2). Each mutating gesture records
   * the semantic `WorkspaceOperation`(s) it just performed here, right where it
   * mutates `this.page`. The workspace commit layer drains this via
   * `takePendingOperations()` and — when the emitted ops reproduce the current
   * document exactly — commits them instead of a reconstructed snapshot diff, so
   * agent-visible history reflects the user's intent. Anything left un-emitted
   * (the long tail, plus undo/redo/page-switch) falls back to the diff adapter,
   * which is why partial coverage is safe. See `syncWorkspace`.
   */
  private pendingOps: WorkspaceOperation[] = [];
  grid = 20;
  snap = true;
  gridVisible = true;
  /** Calm canvas: render without animations (a view preference). */
  calm = false;
  /** Ambient backdrop level: 'off' | 'static' | 'animated' (a view preference). */
  ambient: 'off' | 'static' | 'animated' = 'animated';
  /** Render the canvas backdrop/grid/vignette for the light theme (#8). */
  light = false;
  /** Active brand palette — remaps the engine's accent colours on canvas (#7). */
  palette: BrandPalette | undefined = undefined;

  private drag: DragState | null = null;
  /** Active waypoint drag on the selected link (index into link.waypoints). */
  private wpDrag: { index: number; moved: boolean } | null = null;
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
  /** Cached badge circle/text pairs so `applyView` can resize them in place
   *  as the zoom level changes (see `updateBadgeSizes`), the same trick
   *  `gridRect` uses for the grid fill. */
  private badgeEls: { circle: SVGCircleElement; text: SVGTextElement }[] = [];
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
    /** Set when the drag started on a quick-connect chevron (its direction). */
    dir?: 'n' | 'e' | 's' | 'w';
  } | null = null;
  /**
   * A link label being repositioned by drag — the centre label or an endpoint
   * (port) label. The drag accumulates a doc-space delta into the link's
   * label/from/toLabelOffset, so the chip follows the cursor regardless of the
   * engine's per-type default placement. `moved` gates the undo snapshot.
   */
  private labelDrag: {
    lid: string;
    which: 'centre' | 'from' | 'to';
    ox: number;
    oy: number;
    startX: number;
    startY: number;
    moved: boolean;
    /** The label's rendered centre at drag start (doc coords), for guides. */
    basePos: { x: number; y: number } | null;
    /** Other labels' rendered centres at drag start, for alignment snapping. */
    others: { x: number; y: number }[];
  } | null = null;
  /** Transient guides drawn while dragging a label (tether home + alignment). */
  private labelGuides: {
    kind: 'tether' | 'align';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }[] = [];
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
  /** Format-painter buffer: a copied node/link style to brush onto others. */
  private formatClip: {
    kind: 'node' | 'link';
    style: Record<string, unknown>;
  } | null = null;
  /** True while a run of arrow-nudges is coalescing into one undo entry. */
  private nudgeActive = false;
  private nudgeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Pending coalesced art render (rAF handle), or 0 when none is queued. */
  private artRaf = 0;
  /** Inline label-edit requests (double-click) go to the shell through this. */
  private onInlineEdit: ((req: InlineEditRequest) => void) | null = null;
  /** Link-to-empty-canvas releases go to the shell through this (quick-connect). */
  private onConnectEmpty: ((req: ConnectEmptyRequest) => void) | null = null;

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

  /**
   * Switch to editing a different page (resets selection + view). History is
   * per-page: the outgoing page's undo/redo stacks are stashed under its id
   * and the incoming page's stacks restored (empty if none), so a frame switch
   * never destroys history (#204).
   */
  setPage(page: Page): void {
    if (page !== this.page) {
      this.stashHistory();
      const stashed = this.histories.get(page.id);
      this.histories.delete(page.id);
      this.undoStack = stashed?.undo ?? [];
      this.redoStack = stashed?.redo ?? [];
    }
    this.page = page;
    this.sel.clear();
    // A page switch (or a whole-document open) changes the commit baseline; any
    // ops buffered for the old page are dropped so the sync cleanly falls back
    // to the snapshot diff rather than committing stale intent.
    this.pendingOps = [];
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

  /** Auto-arrange the current page (grid-snap + de-overlap); page grows to fit. */
  tidy(): void {
    this.snapshot();
    // Don't clamp into the page — the page is effectively unlimited and grows to
    // wrap the result, so a big topology spreads out instead of being squeezed.
    const moved = tidyPage(this.page, { keepInBounds: false });
    const grew = this.growPageToFit();
    if (moved === 0 && !grew) {
      this.undoStack.pop(); // nothing changed — don't pollute history
      return;
    }
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }

  /** Balance the layout: de-overlap, align rows/columns, centre; page grows to fit. */
  balance(): void {
    this.snapshot();
    const moved =
      tidyPage(this.page, { keepInBounds: false }) + balancePage(this.page);
    const grew = this.growPageToFit();
    if (moved === 0 && !grew) {
      this.undoStack.pop();
      return;
    }
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }

  /**
   * Resize the page (viewBox) to wrap all content with a margin — the manual
   * "make the frame match what I've drawn" action. Grows or shrinks, and reframes
   * the view to show the result. Undoable; a no-op when already a tight fit.
   */
  fitPageToContent(): void {
    const b = this.contentBounds();
    if (!b) return;
    const M = 48;
    const vb = `${Math.round(b.x - M)} ${Math.round(b.y - M)} ${Math.round(b.w + 2 * M)} ${Math.round(b.h + 2 * M)}`;
    if (vb === this.page.viewBox) return;
    this.snapshot();
    this.setViewBox(vb);
  }

  /**
   * Grow the page (viewBox) so it contains all content + a margin — never
   * shrinks. Used by the layout tools so arranging a large topology expands the
   * page instead of cramming the nodes inward. Returns true if the page changed.
   */
  private growPageToFit(): boolean {
    const b = this.contentBounds();
    if (!b) return false;
    const M = 40;
    const [vx, vy, vw, vh] = this.page.viewBox.split(/\s+/).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    const minX = Math.min(vx, Math.round(b.x - M));
    const minY = Math.min(vy, Math.round(b.y - M));
    const maxX = Math.max(vx + vw, Math.round(b.x + b.w + M));
    const maxY = Math.max(vy + vh, Math.round(b.y + b.h + M));
    const nvb = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
    if (nvb === this.page.viewBox) return false;
    this.page.viewBox = nvb;
    return true;
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
    if (this.page.viewBox !== vb) this.emitPagePatch({ set: { viewBox: vb } });
    this.page.viewBox = vb;
    this.view = parseViewBox(vb);
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }

  /** Rename the current page (shown in the filmstrip). Not on the undo stack. */
  renamePage(name: string): void {
    if (this.page.name !== name) this.emitPagePatch({ set: { name } });
    this.page.name = name;
    this.onChange();
  }

  /**
   * Patch the page's storytelling/playback fields (caption / duration /
   * transition). Undoable — unlike name/viewBox these are frame content, and
   * history must restore them (#205). `undefined` clears a field. Pass
   * `commit=false` during continuous edits (caption typing) so a run of
   * keystrokes snapshots once, mirroring `updateNode`.
   */
  updatePageProps(
    patch: Partial<Pick<Page, 'caption' | 'duration' | 'transition'>>,
    commit = true,
  ): void {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    const before: Record<string, unknown> = {};
    for (const key of keys) before[key] = this.page[key];
    const fp = this.patchFromChange(before, patch, keys);
    if (!fp) return;
    if (commit) this.snapshot();
    for (const key of keys) {
      if (patch[key] === undefined) delete this.page[key];
      else (this.page as unknown as Record<string, unknown>)[key] = patch[key];
    }
    this.emitPagePatch(fp);
    this.renderOverlay(); // caption renders via the overlayExtra hook
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
    this.updateBadgeSizes();
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
      ambient: this.ambient,
      light: this.light,
      palette: this.palette,
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
      renderPageInto(this.art, this.page, {
        calm: this.calm,
        ambient: this.ambient,
        light: this.light,
        palette: this.palette,
      });
      this.applyView();
    });
  }

  /** Toggle the calm canvas (animations off) and re-render. */
  setCalm(on: boolean): void {
    this.calm = on;
    this.renderArt();
  }

  /** Set the ambient backdrop level (off/static/animated) and re-render. */
  setAmbient(level: 'off' | 'static' | 'animated'): void {
    this.ambient = level;
    this.renderArt();
  }

  /** Render the canvas for the light or dark theme and re-render (#8). */
  setLight(on: boolean): void {
    this.light = on;
    this.renderArt();
  }

  /** Set the active brand palette (or undefined for the default) and re-render (#7). */
  setPalette(palette: BrandPalette | undefined): void {
    this.palette = palette;
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

  /**
   * Keep problem badges at a legible on-screen size as the view pans/zooms —
   * a cheap attribute update on the cached badge shapes, with no overlay
   * rebuild (same trick as `updateGridFill`). Without this, `badgeRadius`
   * would only be recomputed the next time something else forces a full
   * `renderOverlay` (a selection/hover/edit), so a plain wheel-zoom would
   * leave badges shrinking/growing with the canvas instead of staying put.
   */
  private updateBadgeSizes(): void {
    if (this.badgeEls.length === 0) return;
    const r = this.badgeRadius();
    const fontSize = r * 1.15;
    for (const { circle, text } of this.badgeEls) {
      circle.setAttribute('r', String(r));
      text.setAttribute('font-size', String(fontSize));
    }
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

  /** Guides shown while dragging a label: a tether to its home + align lines. */
  private labelGuidesSvg(): string {
    if (this.labelGuides.length === 0) return '';
    let out = '';
    for (const g of this.labelGuides) {
      if (g.kind === 'tether') {
        out +=
          `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="${ACCENT}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>` +
          `<circle cx="${g.x1}" cy="${g.y1}" r="2.5" fill="none" stroke="${ACCENT}" stroke-width="1" opacity="0.8"/>`;
      } else {
        out += `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="#ff5db1" stroke-width="1" stroke-dasharray="6 4" opacity="0.9"/>`;
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
   * connection dot / quick-connect chevron the cursor is poised over (so the
   * affordances stay reachable even though they sit outside the node's body).
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
      for (const c of this.chevrons(id)) {
        if (Math.abs(p.x - c.x) <= r * 1.4 && Math.abs(p.y - c.y) <= r * 1.4)
          return id;
      }
    }
    return null;
  }

  /* ── quick-connect chevrons (create + connect the next node) ─────── */

  /**
   * The four directional quick-connect chevrons of a node, floating just
   * beyond its connection dots. Clicking one creates a same-type node in that
   * direction, linked back; dragging from one draws a link like the dots do.
   */
  private chevrons(
    id: string,
  ): { x: number; y: number; dir: 'n' | 'e' | 's' | 'w' }[] {
    const n = this.page.nodes.find((m) => m.id === id);
    if (!n) return [];
    const b = nodeBounds(n);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const off = this.dotRadius() * 4.2;
    return [
      { x: cx, y: b.y - off, dir: 'n' },
      { x: b.x + b.w + off, y: cy, dir: 'e' },
      { x: cx, y: b.y + b.h + off, dir: 's' },
      { x: b.x - off, y: cy, dir: 'w' },
    ];
  }

  /** The chevron (node + direction) under `p`, on hovered/selected nodes. */
  private chevronHit(p: {
    x: number;
    y: number;
  }): { id: string; dir: 'n' | 'e' | 's' | 'w' } | null {
    const r = this.dotRadius() * 2.4;
    for (const id of this.chevronNodeIds()) {
      for (const c of this.chevrons(id)) {
        if (Math.abs(p.x - c.x) <= r && Math.abs(p.y - c.y) <= r)
          return { id, dir: c.dir };
      }
    }
    return null;
  }

  /** Nodes that show chevrons: the hovered node + a sole selected node. */
  private chevronNodeIds(): string[] {
    const ids = new Set<string>();
    if (this.hoverNode) ids.add(this.hoverNode);
    if (this.sel.size === 1) ids.add([...this.sel][0]!);
    return [...ids].filter((id) => this.page.nodes.some((n) => n.id === id));
  }

  /** Chevron glyphs (outward-pointing triangles) for the overlay. */
  private chevronsSvg(): string {
    if (this.tool !== 'select' || this.dragLink || this.drag || this.marquee)
      return '';
    const s = this.dotRadius() * 1.5;
    let out = '';
    for (const id of this.chevronNodeIds()) {
      for (const c of this.chevrons(id)) {
        const rot = { n: 0, e: 90, s: 180, w: 270 }[c.dir];
        out +=
          `<g transform="translate(${c.x},${c.y}) rotate(${rot})" opacity="0.85">` +
          `<circle r="${s * 1.5}" fill="${ACCENT}" fill-opacity="0.10"/>` +
          `<path d="M0,${-s} L${s * 0.85},${s * 0.6} L${-s * 0.85},${s * 0.6} Z" fill="${ACCENT}"/>` +
          `</g>`;
      }
    }
    return out;
  }

  /** Register the shell's "link released over empty canvas" handler. */
  setConnectEmptyHandler(
    fn: ((req: ConnectEmptyRequest) => void) | null,
  ): void {
    this.onConnectEmpty = fn;
  }

  /**
   * Create a node of `type` at (x, y) linked from `fromId`, as ONE undo step
   * and one gesture batch — the quick-connect commit shared by chevron clicks
   * and the drag-to-empty picker. Selects the new node and opens its inline
   * label editor so a "next hop" is one gesture + typing.
   */
  quickConnectTo(
    fromId: string,
    type: string,
    x: number,
    y: number,
    style?: { color?: string },
  ): string | null {
    const from = this.page.nodes.find((n) => n.id === fromId);
    if (!from) return null;
    this.snapshot();
    const nid = `n${Date.now().toString(36)}${(this.nodeSeq++).toString(36)}`;
    const node: NodeConfig = {
      id: nid,
      type,
      x: this.snapVal(x),
      y: this.snapVal(y),
      label: defaultLabel(type),
      ...(style?.color ? { color: style.color } : {}),
    };
    this.page.nodes.push(node);
    const lid = `l${Date.now().toString(36)}${(this.linkSeq++).toString(36)}`;
    this.page.links.push({ id: lid, type: 'line', from: fromId, to: nid });
    this.emitAdds('nodes', [{ id: nid }]);
    this.emitAdds('links', [{ id: lid }]);
    this.clearLinkSel();
    this.clearAnchorSel();
    this.clearZoneSel();
    this.sel = new Set([nid]);
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireSelect();
    // Hand the fresh node straight to the inline label editor.
    if (this.onInlineEdit) {
      const h = nodeHalf(node);
      const c = userToClient(this.overlay, node.x, node.y + h.h + 12);
      this.onInlineEdit({
        kind: 'node',
        id: nid,
        current: String(node.label ?? ''),
        clientX: c.x,
        clientY: c.y,
        pageX: node.x,
        pageY: node.y,
      });
    }
    return nid;
  }

  /**
   * Chevron click: create a same-type node one pitch away in `dir`, linked
   * back to the source. Steps further along `dir` while the spot is occupied.
   */
  quickConnect(fromId: string, dir: 'n' | 'e' | 's' | 'w'): string | null {
    const src = this.page.nodes.find((n) => n.id === fromId);
    if (!src) return null;
    const h = nodeHalf(src);
    const pitchX = Math.max(180, h.w * 2 + 110);
    const pitchY = Math.max(140, h.h * 2 + 90);
    const step = {
      n: { dx: 0, dy: -pitchY },
      e: { dx: pitchX, dy: 0 },
      s: { dx: 0, dy: pitchY },
      w: { dx: -pitchX, dy: 0 },
    }[dir];
    let x = src.x + step.dx;
    let y = src.y + step.dy;
    for (let i = 0; i < 6 && hitTestNode(this.page, x, y, 40); i++) {
      x += step.dx * 0.75;
      y += step.dy * 0.75;
    }
    return this.quickConnectTo(fromId, src.type, x, y, {
      color: src.color as string | undefined,
    });
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

  /**
   * On-canvas problem badges (Packet B1) — placements computed by the host
   * from `validateDocument`/`analyzeLayout` output (see `problem-badges.ts`
   * and `renderProblems()` in `main.ts`). Empty when the badge toggle is off
   * or the page has no locatable problems.
   */
  private badges: BadgePlacement[] = [];
  /**
   * Fired when a badge is clicked — the host selects the element (reusing the
   * same `focusNode`/`focusLink`/`focusZone` path the problems panel uses)
   * and can scroll the matching panel row into view. Kept out of the editor
   * itself so the panel-scrolling stays a host (main.ts) concern.
   */
  private onBadgeClick:
    | ((kind: BadgePlacement['kind'], id: string) => void)
    | null = null;

  /** Feed this page's current problem badges; pass `[]` to hide them. */
  setBadges(placements: BadgePlacement[]): void {
    this.badges = placements;
    this.renderOverlay();
  }
  /** Register the host's badge-click handler (selection + panel scroll). */
  setOnBadgeClick(
    cb: ((kind: BadgePlacement['kind'], id: string) => void) | null,
  ): void {
    this.onBadgeClick = cb;
  }
  /** Badge hit-target radius in user units (~9 screen px, counter-scaled like
   *  connection dots — see `dotRadius` — so the glyph + count stay legible at
   *  any zoom level). */
  private badgeRadius(): number {
    const wpx = this.overlay.getBoundingClientRect().width || 1;
    return Math.max(6, (9 * this.view.w) / wpx);
  }
  /** The badge (if any) under point `p`, topmost-drawn first. */
  private hitTestBadge(p: { x: number; y: number }): BadgePlacement | null {
    if (this.badges.length === 0) return null;
    const r = this.badgeRadius();
    for (let i = this.badges.length - 1; i >= 0; i--) {
      const b = this.badges[i]!;
      if (Math.hypot(p.x - b.x, p.y - b.y) <= r) return b;
    }
    return null;
  }
  /**
   * Badges as small circles with a ⚠ glyph (single problem) or a count
   * (folded problems), error vs. warning coloured to match the problems
   * panel. Drawn above the art and the auto-legend, below the interactive
   * selection/anchor/connection-dot handles, in the same layer position the
   * `overlayExtra` hook already occupies for app-level decorations. The
   * group is `pointer-events: none` except each badge's own hit circle, so
   * badges never intercept drags, the marquee, or waypoint gestures aimed at
   * geometry beneath them.
   */
  private badgesSvg(): string {
    if (this.badges.length === 0) return '';
    const r = this.badgeRadius();
    const fontSize = r * 1.15;
    let out = '<g pointer-events="none">';
    for (const b of this.badges) {
      const color = b.level === 'error' ? PROB_ERROR : PROB_WARN;
      const label =
        b.count > 1 ? (b.count > 99 ? '99+' : String(b.count)) : '⚠';
      // Element ids come from documents (shared/imported — untrusted) and
      // are not sanitized by parseDoc, so escape before interpolating into
      // innerHTML-bound markup.
      out +=
        `<g pointer-events="auto" style="cursor:pointer" data-badge-kind="${b.kind}" data-badge-id="${escXmlAttr(b.id)}">` +
        `<circle cx="${b.x}" cy="${b.y}" r="${r}" fill="${color}" stroke="#0b0e14" stroke-width="1.5"/>` +
        `<text x="${b.x}" y="${b.y}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" font-weight="700" fill="#0b0e14">${label}</text>` +
        `</g>`;
    }
    out += '</g>';
    return out;
  }

  private renderOverlay(): void {
    this.overlay.innerHTML =
      this.backdropSvg() +
      this.gridSvg() +
      (this.overlayExtra?.() ?? '') +
      this.badgesSvg() +
      this.guidesSvg() +
      this.labelGuidesSvg() +
      this.zoneSelSvg() +
      this.anchorsSvg() +
      this.linkSelSvg() +
      this.selectionSvg() +
      this.connectionDotsSvg() +
      this.chevronsSvg() +
      this.marqueeSvg() +
      this.linkPreviewSvg();
    // Cache the grid fill so applyView can track it without rebuilding the overlay.
    this.gridRect = this.overlay.querySelector<SVGRectElement>('rect.tds-grid');
    // Cache the badge shapes the same way, so a zoom step can resize them
    // in place (see `updateBadgeSizes`) instead of paying for a full rebuild.
    this.badgeEls = Array.from(
      this.overlay.querySelectorAll<SVGGElement>('[data-badge-id]'),
    ).map((g) => ({
      circle: g.querySelector('circle')!,
      text: g.querySelector('text')!,
    }));
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

  /** Park the live stacks under the current page's id (see `setPage`). */
  private stashHistory(): void {
    this.histories.delete(this.page.id);
    if (this.undoStack.length === 0 && this.redoStack.length === 0) return;
    this.histories.set(this.page.id, {
      undo: this.undoStack,
      redo: this.redoStack,
    });
    while (this.histories.size > Editor.MAX_STASHED_HISTORIES) {
      const oldest = this.histories.keys().next().value;
      if (oldest === undefined) break;
      this.histories.delete(oldest);
    }
  }

  /** Forget a page's stashed history — call when the page is deleted for good. */
  dropPageHistory(pageId: string): void {
    this.histories.delete(pageId);
  }

  /* ── gesture → operation funnel (Packet S2) ───────────────────────
   *
   * The single seam through which gestures publish the semantic operation(s)
   * they performed. Helpers build an op (and are colocated so op construction
   * is not scattered). Correctness rests on one invariant: applying the drained
   * ops to the pre-edit document must reproduce the current document — the
   * commit layer's referee checks exactly this and falls back to the snapshot
   * diff otherwise, so an incomplete or wrong emission can never corrupt
   * history, only miss an intent-faithful label. */

  /** Drain the buffered operations (the commit layer calls this each sync). */
  takePendingOperations(): WorkspaceOperation[] {
    const ops = this.pendingOps;
    this.pendingOps = [];
    return ops;
  }

  private emit(op: WorkspaceOperation): void {
    this.pendingOps.push(op);
  }

  /** Emit `element.add` for freshly-inserted elements, in insertion order, with
   * each anchored after the element now preceding it (null ⇒ first) — matching
   * how `diffDocuments` positions an add. */
  private emitAdds(kind: ElementKind, added: readonly { id: string }[]): void {
    const coll = this.page[kind] as unknown as { id: string }[];
    for (const el of added) {
      const idx = coll.findIndex((e) => e.id === el.id);
      if (idx < 0) continue;
      this.emit({
        type: 'element.add',
        pageId: this.page.id,
        kind,
        // Clone the element as it now sits in the page (full fields), never the
        // id-only stub some call sites pass to name it.
        element: structuredClone(coll[idx]) as Record<string, unknown>,
        afterElementId: idx > 0 ? coll[idx - 1]!.id : null,
      });
    }
  }

  private emitRemoves(kind: ElementKind, ids: readonly string[]): void {
    for (const id of ids)
      this.emit({
        type: 'element.remove',
        pageId: this.page.id,
        kind,
        elementId: id,
      });
  }

  private emitPatch(kind: ElementKind, id: string, patch: FieldPatch): void {
    // Continuous edits (typing in the inspector, a live drag) call this once per
    // frame/keystroke against the same element. Fold such a patch into the
    // buffer's tail when it targets that same element so one gesture yields one
    // patch, not dozens — the merged result is the same final field state.
    const tail = this.pendingOps.at(-1);
    if (
      tail &&
      tail.type === 'element.patch' &&
      tail.pageId === this.page.id &&
      tail.kind === kind &&
      tail.elementId === id
    ) {
      const set = { ...(tail.patch.set ?? {}), ...(patch.set ?? {}) };
      const unset = new Set([
        ...(tail.patch.unset ?? []),
        ...(patch.unset ?? []),
      ]);
      // A field set by the newer patch is no longer unset, and vice versa.
      for (const key of Object.keys(patch.set ?? {})) unset.delete(key);
      for (const key of patch.unset ?? []) delete set[key];
      tail.patch = {
        ...(Object.keys(set).length ? { set } : {}),
        ...(unset.size ? { unset: [...unset] } : {}),
      };
      return;
    }
    this.emit({
      type: 'element.patch',
      pageId: this.page.id,
      kind,
      elementId: id,
      patch,
    });
  }

  /** Emit `element.reorder` for a collection's current order. */
  private emitReorder(kind: ElementKind): void {
    const ids = (this.page[kind] as unknown as { id: string }[]).map(
      (e) => e.id,
    );
    this.emit({
      type: 'element.reorder',
      pageId: this.page.id,
      kind,
      elementIds: ids,
    });
  }

  private emitPagePatch(patch: FieldPatch): void {
    this.emit({ type: 'page.patch', pageId: this.page.id, patch });
  }

  /** Build a minimal `FieldPatch` for the `keys` that actually changed between
   * `before` and `after` (set for new values, unset for removed ones) — mirrors
   * the field-granular diff so an emitted patch equals the referee's. Returns
   * null when nothing changed. */
  private patchFromChange(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    keys: readonly string[],
  ): FieldPatch | null {
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const key of keys) {
      if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
      if (after[key] === undefined) unset.push(key);
      else set[key] = structuredClone(after[key]);
    }
    if (!Object.keys(set).length && !unset.length) return null;
    return {
      ...(Object.keys(set).length ? { set } : {}),
      ...(unset.length ? { unset } : {}),
    };
  }

  /** Apply `patch` to the sole/selected element of `kind` and emit the matching
   * `element.patch` for exactly the fields that changed. Shared by the
   * inspector updaters so they don't each re-derive the delta. */
  private assignAndEmit(
    kind: ElementKind,
    target: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): void {
    const keys = Object.keys(patch);
    const before: Record<string, unknown> = {};
    for (const key of keys) before[key] = target[key];
    Object.assign(target, patch);
    const fp = this.patchFromChange(before, target, keys);
    if (fp) this.emitPatch(kind, target.id as string, fp);
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
    const p = JSON.parse(json) as Record<string, unknown>;
    const page = this.page as unknown as Record<string, unknown>;
    // serialize() emits every mutable page field (undefined included), so its
    // key set is the complete field list; a key absent from the stored JSON is
    // an optional field that was unset and must be deleted, not skipped.
    for (const key of Object.keys(serialize(this.page))) {
      if (p[key] === undefined) delete page[key];
      else page[key] = p[key];
    }
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    // Undo/redo replace the page wholesale; emitting precise inverse ops isn't
    // worth the risk, so we drop any buffered intent and let the sync fall back
    // to the snapshot diff, which computes the correct net delta.
    this.pendingOps = [];
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
    this.pendingOps = [];
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
    this.emitAdds('nodes', [{ id }]);
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
    // Snapshot the collections touched by the cascade so we can emit exact
    // removes (direct + cascade) and zone-membership patches afterward.
    const beforeNodes = this.page.nodes.map((n) => n.id);
    const beforeLinks = this.page.links.map((l) => l.id);
    const beforeAnchors = this.page.anchors.map((a) => a.id);
    const beforeZones = this.page.zones.map((z) => ({
      id: z.id,
      nodes: [...(z.nodes ?? [])],
    }));
    const beforeFlows = this.page.flowPaths.map((f) => ({
      id: f.id,
      snap: structuredClone({ waypoints: f.waypoints, hops: f.hops }) as Record<
        string,
        unknown
      >,
    }));
    const beforeMarkers = this.page.policyMarkers.map((m) => ({
      id: m.id,
      snap: { flowPathId: m.flowPathId } as Record<string, unknown>,
    }));
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
    // Cascade — the shared endpoint-removal semantics (pages/cascade.ts, also
    // behind the headless remove_element API): links, policy markers, zone
    // memberships, and flow-path waypoints/hops of vanished endpoints; a
    // touched path left with fewer than two waypoints goes too (#215).
    const nowNodeIds = new Set(this.page.nodes.map((n) => n.id));
    const nowAnchorIds = new Set(this.page.anchors.map((a) => a.id));
    cascadeEndpointRemoval(
      this.page,
      new Set([
        ...beforeNodes.filter((id) => !nowNodeIds.has(id)),
        ...beforeAnchors.filter((id) => !nowAnchorIds.has(id)),
      ]),
    );
    // Emit the semantic delete: one remove per element that vanished (direct or
    // via cascade), then a patch for any zone whose membership was pruned.
    const nowNodes = new Set(this.page.nodes.map((n) => n.id));
    const nowLinks = new Set(this.page.links.map((l) => l.id));
    const nowAnchors = new Set(this.page.anchors.map((a) => a.id));
    const nowZones = new Set(this.page.zones.map((z) => z.id));
    this.emitRemoves(
      'nodes',
      beforeNodes.filter((id) => !nowNodes.has(id)),
    );
    this.emitRemoves(
      'links',
      beforeLinks.filter((id) => !nowLinks.has(id)),
    );
    this.emitRemoves(
      'anchors',
      beforeAnchors.filter((id) => !nowAnchors.has(id)),
    );
    this.emitRemoves(
      'zones',
      beforeZones.filter((z) => !nowZones.has(z.id)).map((z) => z.id),
    );
    const nowFlows = new Set(this.page.flowPaths.map((f) => f.id));
    const nowMarkers = new Set(this.page.policyMarkers.map((m) => m.id));
    this.emitRemoves(
      'flowPaths',
      beforeFlows.filter((f) => !nowFlows.has(f.id)).map((f) => f.id),
    );
    this.emitRemoves(
      'policyMarkers',
      beforeMarkers.filter((m) => !nowMarkers.has(m.id)).map((m) => m.id),
    );
    for (const z of this.page.zones) {
      const was = beforeZones.find((b) => b.id === z.id);
      if (was && JSON.stringify(was.nodes) !== JSON.stringify(z.nodes ?? []))
        this.emitPatch('zones', z.id, {
          set: { nodes: structuredClone(z.nodes ?? []) },
        });
    }
    for (const f of this.page.flowPaths) {
      const was = beforeFlows.find((b) => b.id === f.id);
      const fp =
        was &&
        this.patchFromChange(
          was.snap,
          f as unknown as Record<string, unknown>,
          ['waypoints', 'hops'],
        );
      if (fp) this.emitPatch('flowPaths', f.id, fp);
    }
    for (const m of this.page.policyMarkers) {
      const was = beforeMarkers.find((b) => b.id === m.id);
      const fp =
        was &&
        this.patchFromChange(
          was.snap,
          m as unknown as Record<string, unknown>,
          ['flowPathId'],
        );
      if (fp) this.emitPatch('policyMarkers', m.id, fp);
    }
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

  /* ── format painter ───────────────────────────────────────────────
   * Copy one element's visual style and brush it onto others. We copy
   * appearance only — never identity/topology (id, from/to, waypoints) or label
   * TEXT — so a paste restyles without rewiring. */

  /** Copy is available when exactly one node or one link is selected. */
  canCopyFormat(): boolean {
    return !!this.getSelectedNode() || !!this.getSelectedLink();
  }

  /** Capture the selected element's style into the format buffer. */
  copyFormat(): void {
    const node = this.getSelectedNode();
    const link = node ? null : this.getSelectedLink();
    const src = (node ?? link) as Record<string, unknown> | null;
    if (!src) return;
    const keys = node ? NODE_FORMAT_KEYS : LINK_FORMAT_KEYS;
    const style: Record<string, unknown> = {};
    for (const k of keys) if (src[k] !== undefined) style[k] = src[k];
    this.formatClip = { kind: node ? 'node' : 'link', style };
  }

  /** Paste is available when the buffer matches what's selected. */
  canPasteFormat(): boolean {
    if (!this.formatClip) return false;
    return this.formatClip.kind === 'node' ? this.sel.size > 0 : !!this.linkSel;
  }

  /** Brush the copied style onto the selection (all nodes, or the one link). */
  pasteFormat(): void {
    const clip = this.formatClip;
    if (!clip) return;
    if (clip.kind === 'node') {
      if (this.sel.size === 0) return;
      this.snapshot();
      for (const id of this.sel) {
        const n = this.page.nodes.find((m) => m.id === id);
        if (n)
          this.assignAndEmit('nodes', n as Record<string, unknown>, clip.style);
      }
    } else {
      const link = this.getSelectedLink();
      if (!link) return;
      this.snapshot();
      this.assignAndEmit('links', link as Record<string, unknown>, clip.style);
    }
    this.renderArt();
    this.renderOverlay();
    this.onChange();
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
    this.emitAdds('nodes', nodes);
    this.emitAdds('links', links);
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
    this.emitAdds('nodes', nodes);
    this.emitAdds('links', links);
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

  /** Select a zone and pan it into view (used by the problems panel). */
  focusZone(id: string): void {
    const zone = this.page.zones.find((z) => z.id === id);
    if (!zone || !this.selectZone(id)) return;
    const b = zoneBounds(this.page, zone);
    if (b) this.panTo(b.x + b.w / 2, b.y + b.h / 2);
    this.renderOverlay();
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
    this.emitAdds('nodes', nodes);
    this.emitAdds('links', links);
    this.emitAdds('zones', [{ id: newZone.id }]);
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
    for (const n of nodes) {
      n.x = Math.round(n.x + dx);
      n.y = Math.round(n.y + dy);
      this.emitPatch('nodes', n.id, { set: { x: n.x, y: n.y } });
    }
    for (const a of anchors) {
      a.x = Math.round(a.x + dx);
      a.y = Math.round(a.y + dy);
      this.emitPatch('anchors', a.id, { set: { x: a.x, y: a.y } });
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
    this.emitReorder(this.linkSel ? 'links' : 'nodes');
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
    for (const n of nodes)
      this.assignAndEmit('nodes', n as unknown as Record<string, unknown>, {
        locked: next,
      });
    if (link)
      this.assignAndEmit('links', link as unknown as Record<string, unknown>, {
        locked: next,
      });
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
    this.assignAndEmit(
      'nodes',
      node as unknown as Record<string, unknown>,
      patch,
    );
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
    this.assignAndEmit(
      'links',
      link as unknown as Record<string, unknown>,
      patch,
    );
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
    this.emitPatch('links', link.id, {
      set: {
        from: link.from,
        to: link.to,
        ...(link.waypoints
          ? { waypoints: structuredClone(link.waypoints) }
          : {}),
      },
    });
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }

  /** Whether the selected link has manual bend points (waypoints) to clear. */
  selectedLinkHasBends(): boolean {
    return !!this.getSelectedLink()?.waypoints?.length;
  }

  /** Straighten the selected link: drop its waypoints back to a direct route. */
  straightenLink(): void {
    const link = this.getSelectedLink();
    if (!link?.waypoints?.length) return;
    this.snapshot();
    delete link.waypoints;
    this.emitPatch('links', link.id, { unset: ['waypoints'] });
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
    this.emitAdds('zones', [{ id: zone.id }]);
    this.afterAnnotationChange();
  }
  addFlowPath(flow: FlowPathConfig): void {
    this.snapshot();
    this.page.flowPaths.push(flow);
    this.emitAdds('flowPaths', [{ id: flow.id }]);
    this.afterAnnotationChange();
  }
  addPolicyMarker(marker: PolicyMarkerConfig): void {
    this.snapshot();
    this.page.policyMarkers.push(marker);
    this.emitAdds('policyMarkers', [{ id: marker.id }]);
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
    this.assignAndEmit(
      collection,
      el as unknown as Record<string, unknown>,
      patch,
    );
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
    this.emitRemoves(collection, [id]);
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
      const bx = n.x;
      const by = n.y;
      if (mode === 'left') n.x = minX;
      else if (mode === 'right') n.x = maxX;
      else if (mode === 'centerH') n.x = Math.round((minX + maxX) / 2);
      else if (mode === 'top') n.y = minY;
      else if (mode === 'bottom') n.y = maxY;
      else if (mode === 'middleV') n.y = Math.round((minY + maxY) / 2);
      const fp = this.patchFromChange({ x: bx, y: by }, n, ['x', 'y']);
      if (fp) this.emitPatch('nodes', n.id, fp);
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
      const before = axis === 'h' ? n.x : n.y;
      if (axis === 'h') n.x = v;
      else n.y = v;
      if (v !== before)
        this.emitPatch('nodes', n.id, {
          set: axis === 'h' ? { x: v } : { y: v },
        });
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
    this.assignAndEmit(
      'anchors',
      a as unknown as Record<string, unknown>,
      patch,
    );
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
    this.emitAdds('anchors', [{ id }]);
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
    this.emitAdds('links', [{ id }]);
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
    this.emitPatch('links', l.id, { set: { type: l.type } });
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
    if (next === 'straight') {
      delete l.lineStyle;
      this.emitPatch('links', l.id, { unset: ['lineStyle'] });
    } else {
      l.lineStyle = next as 'orthogonal' | 'curved';
      this.emitPatch('links', l.id, { set: { lineStyle: l.lineStyle } });
    }
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
  private tryWaypointGrab(
    p: { x: number; y: number },
    suppressInsert = false,
  ): boolean {
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
    // The second press of a rapid double-click must not insert a waypoint —
    // the double-click is heading for the inline label editor instead.
    if (suppressInsert) return false;
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
    // Already handled by the synthesized pointerup path? (see onUp)
    if (Date.now() - this.synthDblAt < 400) return;
    this.handleDoubleClick(e.clientX, e.clientY);
  }

  /** Shared double-click action: waypoint removal, else inline edit/quick-add. */
  private handleDoubleClick(clientX: number, clientY: number): void {
    if (this.tool !== 'select') return;
    // 1) Waypoint removal on the selected link keeps priority (existing gesture).
    if (this.linkSel) {
      const link = this.page.links.find((l) => l.id === this.linkSel);
      if (link?.waypoints?.length) {
        const p = clientToUser(this.overlay, clientX, clientY);
        const tol = this.handleSize() * 1.4;
        for (let i = 0; i < link.waypoints.length; i++) {
          if (dist(p, link.waypoints[i]!) <= tol) {
            this.snapshot();
            link.waypoints.splice(i, 1);
            if (link.waypoints.length === 0) {
              delete link.waypoints;
              this.emitPatch('links', link.id, { unset: ['waypoints'] });
            } else {
              this.emitPatch('links', link.id, {
                set: { waypoints: structuredClone(link.waypoints) },
              });
            }
            this.renderArt();
            this.renderOverlay();
            this.onChange();
            return;
          }
        }
      }
    }
    // 2) Inline label editing / quick-add (double-click anywhere else).
    this.requestInlineEditAt(clientX, clientY);
  }

  /** Register the shell's inline label-edit / quick-add handler. */
  setInlineEditHandler(fn: ((req: InlineEditRequest) => void) | null): void {
    this.onInlineEdit = fn;
  }

  /**
   * Resolve a double-click into an inline-edit request: hit-test the point,
   * select what was hit (so the normal update paths apply to it), and hand the
   * shell an anchored request. Returns the request kind, or null when no
   * handler is registered. Public for tests and synthetic gestures.
   */
  requestInlineEditAt(clientX: number, clientY: number): string | null {
    if (!this.onInlineEdit) return null;
    const p = clientToUser(this.overlay, clientX, clientY);
    const nodeId = hitTestNode(this.page, p.x, p.y);
    if (nodeId) {
      const node = this.page.nodes.find((n) => n.id === nodeId)!;
      this.clearLinkSel();
      this.clearAnchorSel();
      this.clearZoneSel();
      if (!(this.sel.size === 1 && this.sel.has(nodeId))) {
        this.sel = new Set([nodeId]);
        this.fireSelect();
      }
      this.renderOverlay();
      // Anchor on the node's label position (just under the node art).
      const h = nodeHalf(node);
      const c = userToClient(this.overlay, node.x, node.y + h.h + 12);
      this.onInlineEdit({
        kind: 'node',
        id: nodeId,
        current: String(node.label ?? ''),
        clientX: c.x,
        clientY: c.y,
        pageX: p.x,
        pageY: p.y,
      });
      return 'node';
    }
    const linkId = hitTestLink(this.page, p.x, p.y);
    if (linkId) {
      const link = this.page.links.find((l) => l.id === linkId)!;
      this.sel.clear();
      this.clearAnchorSel();
      this.clearZoneSel();
      this.fireSelect();
      if (this.linkSel !== linkId) {
        this.linkSel = linkId;
        this.fireLinkSelect();
      }
      this.renderOverlay();
      // Anchor on the centre-label position: polyline midpoint + offset.
      const pts = linkPolyline(this.page, link);
      let ax = p.x,
        ay = p.y;
      if (pts.length >= 2) {
        const mid = Math.floor((pts.length - 1) / 2);
        const a = pts[mid]!,
          b = pts[mid + 1]!;
        ax = (a.x + b.x) / 2;
        ay = (a.y + b.y) / 2;
      }
      const off = (link as { labelOffset?: { x?: number; y?: number } })
        .labelOffset;
      if (off) {
        ax += off.x ?? 0;
        ay += off.y ?? 0;
      }
      const c = userToClient(this.overlay, ax, ay);
      this.onInlineEdit({
        kind: 'link',
        id: linkId,
        current: String(link.label ?? ''),
        clientX: c.x,
        clientY: c.y,
        pageX: p.x,
        pageY: p.y,
      });
      return 'link';
    }
    const zoneId = hitTestZone(this.page, p.x, p.y);
    if (zoneId) {
      const zone = this.page.zones.find((z) => z.id === zoneId)!;
      this.selectZone(zoneId);
      const b = zoneBounds(this.page, zone);
      const c = b
        ? userToClient(this.overlay, b.x + b.w / 2, b.y + 6)
        : userToClient(this.overlay, p.x, p.y);
      this.onInlineEdit({
        kind: 'zone',
        id: zoneId,
        current: String(zone.label ?? ''),
        clientX: c.x,
        clientY: c.y,
        pageX: p.x,
        pageY: p.y,
      });
      return 'zone';
    }
    // Blank canvas — quick-add (the shell decides what to do with it).
    this.onInlineEdit({
      kind: 'empty',
      id: null,
      current: '',
      clientX,
      clientY,
      pageX: p.x,
      pageY: p.y,
    });
    return 'empty';
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

  /**
   * Hit-test the link labels (centre + endpoint/port) at point `p`. We match by
   * the label's rendered `<text>` element so the box is exactly where the engine
   * drew it — no need to replicate each link type's placement maths. The link's
   * geometry only disambiguates which element belongs to which link when several
   * share the same text. Returns the grabbed label, or null.
   */
  /**
   * Rendered centre (doc coords) of every link label currently drawn — matched
   * by the label's `<text>` element, like hitLabel. Used to capture the dragged
   * label's home + its neighbours for the drag guides.
   */
  private labelCenters(): {
    lid: string;
    which: 'centre' | 'from' | 'to';
    x: number;
    y: number;
  }[] {
    const texts = Array.from(
      this.art.querySelectorAll('text'),
    ) as SVGTextElement[];
    const nearest = (
      txt: string,
      region: { x: number; y: number },
    ): { x: number; y: number } | null => {
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const t of texts) {
        if ((t.textContent ?? '') !== txt) continue;
        let b: DOMRect;
        try {
          b = t.getBBox();
        } catch {
          continue;
        }
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        const d = Math.hypot(cx - region.x, cy - region.y);
        if (d < bestD) {
          bestD = d;
          best = { x: cx, y: cy };
        }
      }
      return best;
    };
    const out: {
      lid: string;
      which: 'centre' | 'from' | 'to';
      x: number;
      y: number;
    }[] = [];
    for (const link of this.page.links) {
      const pts = linkPolyline(this.page, link);
      if (pts.length < 2) continue;
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const probes: [
        string | undefined,
        'centre' | 'from' | 'to',
        { x: number; y: number },
      ][] = [
        [link.label, 'centre', mid],
        [link.fromLabel, 'from', a],
        [link.toLabel, 'to', b],
      ];
      for (const [txt, which, region] of probes) {
        if (!txt) continue;
        const c = nearest(String(txt), region);
        if (c) out.push({ lid: link.id, which, x: c.x, y: c.y });
      }
    }
    return out;
  }

  private hitLabel(p: {
    x: number;
    y: number;
  }): { lid: string; which: 'centre' | 'from' | 'to' } | null {
    const texts = Array.from(
      this.art.querySelectorAll('text'),
    ) as SVGTextElement[];
    if (!texts.length) return null;
    const PAD = 6;
    // The rendered text nearest `region` whose content matches `txt`.
    const nearest = (
      txt: string,
      region: { x: number; y: number },
    ): SVGTextElement | null => {
      let best: SVGTextElement | null = null;
      let bestD = Infinity;
      for (const t of texts) {
        if ((t.textContent ?? '') !== txt) continue;
        let b: DOMRect;
        try {
          b = t.getBBox();
        } catch {
          continue;
        }
        const d = Math.hypot(
          b.x + b.width / 2 - region.x,
          b.y + b.height / 2 - region.y,
        );
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      return best;
    };
    const inside = (t: SVGTextElement): boolean => {
      const b = t.getBBox();
      return (
        p.x >= b.x - PAD &&
        p.x <= b.x + b.width + PAD &&
        p.y >= b.y - PAD &&
        p.y <= b.y + b.height + PAD
      );
    };
    // Last link drawn sits on top, so test in reverse paint order.
    for (let i = this.page.links.length - 1; i >= 0; i--) {
      const link = this.page.links[i]!;
      const pts = linkPolyline(this.page, link);
      if (pts.length < 2) continue;
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const probes: [
        string | undefined,
        'centre' | 'from' | 'to',
        { x: number; y: number },
      ][] = [
        [link.label, 'centre', mid],
        [link.fromLabel, 'from', a],
        [link.toLabel, 'to', b],
      ];
      for (const [txt, which, region] of probes) {
        if (!txt) continue;
        const t = nearest(String(txt), region);
        if (t && inside(t)) return { lid: link.id, which };
      }
    }
    return null;
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

    // A problem badge takes priority over every other Select-tool hit: it's a
    // small fixed target sitting on top of its element's corner, and a click
    // there means "show me the problem", never "start dragging/marqueeing".
    // No pointer capture / drag state is set, so the gesture ends here.
    if (this.tool === 'select') {
      const badge = this.hitTestBadge(p);
      if (badge) {
        this.onBadgeClick?.(badge.kind, badge.id);
        return;
      }
    }

    // Editing waypoints on the selected link takes priority over other hits.
    if (
      this.tool === 'select' &&
      this.linkSel &&
      this.tryWaypointGrab(p, this.isSecondClickDown(e))
    ) {
      this.overlay.setPointerCapture(e.pointerId);
      this.renderOverlay();
      return;
    }

    // Grabbing a link label (centre or endpoint/port) repositions it. Checked
    // before nodes so a label resting over a node body is still draggable.
    if (this.tool === 'select' && !this.spaceHeld && !e.shiftKey) {
      const lab = this.hitLabel(p);
      if (lab) {
        const link = this.page.links.find((l) => l.id === lab.lid);
        if (link && !link.locked) {
          const off =
            (link[labelOffsetKey(lab.which)] as
              | { x?: number; y?: number }
              | undefined) ?? {};
          // Capture rendered label centres now (for the drag guides): the
          // grabbed label's "home" and its neighbours to align against.
          const centers = this.labelCenters();
          const self = centers.find(
            (c) => c.lid === lab.lid && c.which === lab.which,
          );
          this.labelDrag = {
            lid: lab.lid,
            which: lab.which,
            ox: off.x ?? 0,
            oy: off.y ?? 0,
            startX: p.x,
            startY: p.y,
            moved: false,
            basePos: self ? { x: self.x, y: self.y } : null,
            others: centers
              .filter((c) => c !== self)
              .map((c) => ({ x: c.x, y: c.y })),
          };
          // Select the link so the inspector + label tools reflect it.
          this.clearZoneSel();
          this.sel.clear();
          this.selAnchors.clear();
          this.syncAnchorSel();
          this.linkSel = lab.lid;
          this.overlay.setPointerCapture(e.pointerId);
          this.fireSelect();
          this.fireLinkSelect();
          this.renderOverlay();
          return;
        }
      }
    }

    const hit = hitTestNode(this.page, p.x, p.y);

    // Select tool: pressing a connection dot (the handles shown when hovering a
    // node) drags out a link — no tool switch needed. Dot beats node-body so you
    // can link from the edge without moving the node. A quick-connect chevron
    // starts the same drag; released without moving it creates + connects a
    // node in that direction instead (see finishUp).
    if (this.tool === 'select' && !this.spaceHeld && !e.shiftKey) {
      const chev = this.chevronHit(p);
      if (chev) {
        if (!this.sel.has(chev.id)) {
          this.sel.clear();
          this.sel.add(chev.id);
          this.fireSelect();
        }
        this.dragLink = {
          from: chev.id,
          start: p,
          cursor: p,
          moved: false,
          dir: chev.dir,
        };
        this.overlay.setPointerCapture(e.pointerId);
        this.renderOverlay();
        return;
      }
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
    if (this.labelDrag) {
      const pp = clientToUser(this.overlay, e.clientX, e.clientY);
      const ld = this.labelDrag;
      const link = this.page.links.find((l) => l.id === ld.lid);
      if (link) {
        if (!ld.moved) {
          this.snapshot();
          ld.moved = true;
        }
        let nx = Math.round(ld.ox + (pp.x - ld.startX));
        let ny = Math.round(ld.oy + (pp.y - ld.startY));
        const SNAP = 6;
        // Centering assist: snap each axis back to the default position (offset
        // 0) when close, so a label is easy to re-centre or square on the wire.
        if (Math.abs(nx) <= SNAP) nx = 0;
        if (Math.abs(ny) <= SNAP) ny = 0;
        this.labelGuides = [];
        if (ld.basePos) {
          // The label's home (offset 0) in doc coords.
          const defX = ld.basePos.x - ld.ox;
          const defY = ld.basePos.y - ld.oy;
          // Alignment snap: line the label's centre up with a neighbour's on
          // either axis (so port labels can sit at matching offsets).
          for (const o of ld.others) {
            if (nx !== 0 && Math.abs(defX + nx - o.x) <= SNAP) {
              nx = Math.round(o.x - defX);
              this.labelGuides.push({
                kind: 'align',
                x1: o.x,
                y1: Math.min(defY + ny, o.y) - 18,
                x2: o.x,
                y2: Math.max(defY + ny, o.y) + 18,
              });
            }
            if (ny !== 0 && Math.abs(defY + ny - o.y) <= SNAP) {
              ny = Math.round(o.y - defY);
              this.labelGuides.push({
                kind: 'align',
                x1: Math.min(defX + nx, o.x) - 18,
                y1: o.y,
                x2: Math.max(defX + nx, o.x) + 18,
                y2: o.y,
              });
            }
          }
          // Tether from the label's home to where it is now.
          if (nx !== 0 || ny !== 0)
            this.labelGuides.push({
              kind: 'tether',
              x1: defX,
              y1: defY,
              x2: defX + nx,
              y2: defY + ny,
            });
        }
        const key = labelOffsetKey(ld.which);
        if (nx === 0 && ny === 0) delete link[key];
        else link[key] = { x: nx, y: ny };
        this.scheduleArt();
        this.renderOverlay();
      }
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
        this.overlay.style.cursor = this.chevronHit(hp)
          ? 'copy'
          : this.connectionDotHit(hp)
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
    // Detect a double-click from two stationary pointerups. Chrome suppresses
    // the native click/dblclick pair whenever the pointerdown target left the
    // DOM mid-gesture — which happens constantly here because renderOverlay()
    // rebuilds the overlay's children on selection changes. So the editor
    // synthesizes its own double-click; the native dblclick handler stays as
    // a fallback and is de-duplicated via `synthDblAt`.
    const synthDbl = this.detectSynthDblClick(e);
    this.finishUp(e);
    if (synthDbl) {
      this.synthDblAt = Date.now();
      this.handleDoubleClick(e.clientX, e.clientY);
    }
  }

  /** Last stationary pointerup (for synthesized double-click detection). */
  private lastClick = { t: 0, x: 0, y: 0 };
  /** When a synthesized double-click last ran (guards the native handler). */
  private synthDblAt = 0;

  /**
   * True when this pointerdown looks like the second press of a double-click
   * (rapid + stationary relative to the last click's release) — used to keep
   * single-press gestures (waypoint insert) out of the double-click's way.
   */
  private isSecondClickDown(e: PointerEvent): boolean {
    return (
      Date.now() - this.lastClick.t < 450 &&
      Math.hypot(e.clientX - this.lastClick.x, e.clientY - this.lastClick.y) <=
        6
    );
  }

  /** True when this pointerup is the second stationary click of a double. */
  private detectSynthDblClick(e: PointerEvent): boolean {
    const m = this.marquee;
    // A dot/chevron press is a link gesture, never a click — it must not seed
    // or complete a double-click (a chevron click already creates a node).
    const gestureMoved =
      this.pan !== null ||
      this.dragLink !== null ||
      !!this.labelDrag?.moved ||
      !!this.wpDrag?.moved ||
      !!this.drag?.moved ||
      (m !== null && (Math.abs(m.x1 - m.x0) > 2 || Math.abs(m.y1 - m.y0) > 2));
    if (gestureMoved || this.tool !== 'select' || e.button !== 0) {
      this.lastClick.t = 0;
      return false;
    }
    const now = Date.now();
    const isDouble =
      now - this.lastClick.t < 450 &&
      Math.hypot(e.clientX - this.lastClick.x, e.clientY - this.lastClick.y) <=
        6;
    if (isDouble) {
      this.lastClick.t = 0; // a triple-click doesn't chain another double
      return true;
    }
    this.lastClick = { t: now, x: e.clientX, y: e.clientY };
    return false;
  }

  private finishUp(e: PointerEvent): void {
    this.overlay.releasePointerCapture(e.pointerId);
    if (this.pan) {
      this.pan = null;
      // Back to the hand cursor if Space is still held / Hand tool is on.
      this.overlay.style.cursor = this.handCursor();
      return;
    }
    if (this.labelDrag) {
      const moved = this.labelDrag.moved;
      const ld = this.labelDrag;
      this.labelDrag = null;
      this.labelGuides = [];
      if (moved) {
        const link = this.page.links.find((l) => l.id === ld.lid);
        const key = labelOffsetKey(ld.which);
        if (link)
          this.emitPatch(
            'links',
            link.id,
            link[key] === undefined
              ? { unset: [key] }
              : { set: { [key]: structuredClone(link[key]) } },
          );
        this.renderArt();
        this.onChange();
      }
      this.renderOverlay();
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
        if (link?.waypoints)
          this.emitPatch('links', link.id, {
            set: { waypoints: structuredClone(link.waypoints) },
          });
        this.renderArt();
        this.onChange();
      }
      this.wpDrag = null;
      this.renderOverlay();
      return;
    }
    if (this.dragLink) {
      const dl = this.dragLink;
      this.dragLink = null;
      if (dl.moved) {
        // Released over a node or anchor → connect. Over empty space → offer
        // the create-and-connect picker (draw.io-style) when the shell
        // registered one; otherwise cancel as before.
        const pp = clientToUser(this.overlay, e.clientX, e.clientY);
        const target =
          hitTestNode(this.page, pp.x, pp.y) ??
          hitTestAnchor(this.page, pp.x, pp.y, this.anchorHitPad());
        if (target && target !== dl.from) this.createLink(dl.from, target);
        else if (!target && this.onConnectEmpty) {
          this.onConnectEmpty({
            from: dl.from,
            clientX: e.clientX,
            clientY: e.clientY,
            pageX: pp.x,
            pageY: pp.y,
          });
        }
      } else if (dl.dir) {
        // A chevron click (no drag): create + connect the next node that way.
        this.quickConnect(dl.from, dl.dir);
      }
      // A plain dot press that never moved leaves the node selected.
      this.renderOverlay();
      return;
    }
    if (this.drag) {
      if (this.drag.moved) {
        // Positions were applied live during the drag; snapshot was taken on
        // the first move. Settle to integer coordinates and commit.
        this.applyDrag(true);
        // Emit one move (element.patch x/y) per element the drag repositioned.
        for (const id of this.drag.base.keys()) {
          if (this.drag.anchors.has(id)) {
            const a = this.page.anchors.find((m) => m.id === id);
            if (a) this.emitPatch('anchors', a.id, { set: { x: a.x, y: a.y } });
          } else {
            const n = this.page.nodes.find((m) => m.id === id);
            if (n) this.emitPatch('nodes', n.id, { set: { x: n.x, y: n.y } });
          }
        }
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

/** The LinkConfig field holding a given label's drag offset. */
function labelOffsetKey(
  which: 'centre' | 'from' | 'to',
): 'labelOffset' | 'fromLabelOffset' | 'toLabelOffset' {
  return which === 'from'
    ? 'fromLabelOffset'
    : which === 'to'
      ? 'toLabelOffset'
      : 'labelOffset';
}

/** Everything mutable on a Page — the page-level history unit (id is identity). */
type PageSnapshot = Omit<Page, 'id'>;

/**
 * Plain serializable view of a page for history. The mapped type makes every
 * `PageSnapshot` key REQUIRED in the literal, so adding a field to `Page`
 * without serializing it here is a compile error — an omitted field would make
 * undo silently drop it (#205). Optional fields are kept even when undefined
 * so `Object.keys` of a serialization is always the full field list (restore
 * relies on this; JSON.stringify drops the undefined ones afterwards).
 */
function serialize(page: Page): PageSnapshot {
  const snap: { [K in keyof Required<PageSnapshot>]: PageSnapshot[K] } = {
    name: page.name,
    viewBox: page.viewBox,
    duration: page.duration,
    transition: page.transition,
    caption: page.caption,
    emphasis: page.emphasis,
    nodes: page.nodes,
    links: page.links,
    anchors: page.anchors,
    zones: page.zones,
    flowPaths: page.flowPaths,
    policyMarkers: page.policyMarkers,
  };
  return structuredClone(snap);
}
