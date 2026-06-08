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
  hitTestLink,
  hitTestNode,
  linkPolyline,
  nodeBounds,
  nodeHalf,
  nodesInRect,
  resolvePos,
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
  base: Map<string, { x: number; y: number }>;
  moved: boolean;
  /** The node grabbed (drives alignment/spacing guides). */
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
  private marquee: { x0: number; y0: number; x1: number; y1: number } | null =
    null;
  /** Pan/zoom window in page coordinates (the displayed viewBox). */
  private view = { x: 0, y: 0, w: 1050, h: 700 };
  private pan: { startClientX: number; startClientY: number } | null = null;
  private nodeSeq = 0;
  /** Smart guides computed during the current drag (alignment + spacing). */
  private guides: Guide[] = [];
  /** Active tool: select/move, or draw-link. */
  tool: 'select' | 'link' = 'select';
  private linkStart: string | null = null;
  private linkCursor: { x: number; y: number } | null = null;
  private linkSel: string | null = null;
  private linkSeq = 0;
  /** Copy/paste buffer (cloned elements, page-independent). */
  private clipboard: { nodes: NodeConfig[]; links: LinkConfig[] } | null = null;
  /** True while a run of arrow-nudges is coalescing into one undo entry. */
  private nudgeActive = false;
  private nudgeTimer: ReturnType<typeof setTimeout> | undefined;

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
  ) {
    this.view = parseViewBox(page.viewBox);
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
    this.view = parseViewBox(page.viewBox);
    this.renderArt();
    this.renderOverlay();
    this.fireSelect();
    this.fireLinkSelect();
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

  /** Reset pan/zoom to frame the whole page. */
  resetView(): void {
    this.view = parseViewBox(this.page.viewBox);
    this.applyView();
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
    const vb = `${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`;
    this.art.setAttribute('viewBox', vb);
    this.overlay.setAttribute('viewBox', vb);
  }

  private renderArt(): void {
    renderPageInto(this.art, this.page, { calm: this.calm });
    // renderPageInto resets the art viewBox to the page's; re-apply the view.
    this.applyView();
  }

  /** Toggle the calm canvas (animations off) and re-render. */
  setCalm(on: boolean): void {
    this.calm = on;
    this.renderArt();
  }

  private gridSvg(): string {
    if (!this.gridVisible) return '';
    const [, , vw, vh] = this.page.viewBox.split(' ').map(Number) as [
      number,
      number,
      number,
      number,
    ];
    let d = '';
    for (let x = 0; x <= vw; x += this.grid) d += `M${x},0 V${vh} `;
    for (let y = 0; y <= vh; y += this.grid) d += `M0,${y} H${vw} `;
    return `<path d="${d}" stroke="#ffffff" stroke-opacity="0.05" stroke-width="1" fill="none"/>`;
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

  private dragGhostSvg(): string {
    if (!this.drag || !this.drag.moved) return '';
    const { dx, dy } = this.drag;
    let out = '';
    for (const [id, base] of this.drag.base) {
      const n = this.page.nodes.find((m) => m.id === id);
      if (!n) continue;
      const h = nodeHalf(n);
      out += `<rect x="${base.x + dx - h.w}" y="${base.y + dy - h.h}" width="${h.w * 2}" height="${h.h * 2}" fill="${ACCENT}" fill-opacity="0.08" stroke="${ACCENT}" stroke-dasharray="4 3" stroke-width="1.5" rx="4"/>`;
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

  private linkPreviewSvg(): string {
    if (this.tool !== 'link' || !this.linkStart || !this.linkCursor) return '';
    const a = resolvePos(this.page, this.linkStart);
    if (!a) return '';
    return `<line x1="${a.x}" y1="${a.y}" x2="${this.linkCursor.x}" y2="${this.linkCursor.y}" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="5 4" opacity="0.8"/>`;
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

  private renderOverlay(): void {
    this.overlay.innerHTML =
      this.backdropSvg() +
      this.gridSvg() +
      this.guidesSvg() +
      this.linkSelSvg() +
      this.selectionSvg() +
      this.dragGhostSvg() +
      this.marqueeSvg() +
      this.linkPreviewSvg();
  }

  /* ── history ──────────────────────────────────────────────────── */

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
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireSelect();
  }

  /* ── mutations ────────────────────────────────────────────────── */

  /** Add a node of `type` at the current view center; selects it for dragging. */
  addNode(type: string, label?: string): void {
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
    });
    this.sel.clear();
    this.sel.add(id);
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireSelect();
  }

  deleteSelected(): void {
    if (this.sel.size === 0 && this.linkSel === null) return;
    this.snapshot();
    if (this.linkSel !== null) {
      this.page.links = this.page.links.filter((l) => l.id !== this.linkSel);
      this.linkSel = null;
      this.fireLinkSelect();
    }
    if (this.sel.size > 0) {
      this.page.nodes = this.page.nodes.filter((n) => !this.sel.has(n.id));
      // Cascade: drop links whose endpoints no longer exist.
      const ids = new Set([
        ...this.page.nodes.map((n) => n.id),
        ...this.page.anchors.map((a) => a.id),
      ]);
      this.page.links = this.page.links.filter(
        (l) => ids.has(l.from) && ids.has(l.to),
      );
      this.sel.clear();
    }
    this.renderArt();
    this.renderOverlay();
    this.onChange();
    this.fireSelect();
  }

  /** Clear node + link selection (Esc). */
  clearSelection(): void {
    const had = this.sel.size > 0 || this.linkSel !== null;
    this.sel.clear();
    this.linkSel = null;
    if (had) {
      this.renderOverlay();
      this.fireSelect();
      this.fireLinkSelect();
    }
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
    this.fireSelect();
    this.renderOverlay();
    return { kind: 'empty', id: null };
  }

  /* ── clipboard / duplicate / select-all ───────────────────────── */

  /** Select every node on the page. */
  selectAll(): void {
    this.linkSel = null;
    this.sel = new Set(this.page.nodes.map((n) => n.id));
    this.renderOverlay();
    this.fireSelect();
    this.fireLinkSelect();
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

  /* ── nudge (arrow keys) ───────────────────────────────────────── */

  /** Move the (unlocked) selected nodes by (dx,dy); coalesces into one undo. */
  nudge(dx: number, dy: number): void {
    const movable = [...this.sel]
      .map((id) => this.page.nodes.find((n) => n.id === id))
      .filter((n): n is NodeConfig => !!n && n.locked !== true);
    if (movable.length === 0) return;
    if (!this.nudgeActive) this.snapshot();
    this.nudgeActive = true;
    for (const n of movable) {
      n.x = Math.round(n.x + dx);
      n.y = Math.round(n.y + dy);
    }
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => (this.nudgeActive = false), 500);
    this.renderArt();
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
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }

  /** Patch the selected link (re-renders art, keeps the inspector DOM). */
  updateLink(patch: Partial<LinkConfig>, commit = true): void {
    const link = this.getSelectedLink();
    if (!link) return;
    if (commit) this.snapshot();
    Object.assign(link, patch);
    this.renderArt();
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
    this.afterAnnotationChange();
  }

  removeAnnotation(
    collection: 'zones' | 'flowPaths' | 'policyMarkers',
    id: string,
  ): void {
    this.snapshot();
    if (collection === 'zones')
      this.page.zones = this.page.zones.filter((e) => e.id !== id);
    else if (collection === 'flowPaths')
      this.page.flowPaths = this.page.flowPaths.filter((e) => e.id !== id);
    else
      this.page.policyMarkers = this.page.policyMarkers.filter(
        (e) => e.id !== id,
      );
    this.afterAnnotationChange();
  }

  private afterAnnotationChange(): void {
    this.renderArt();
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

  /* ── links ────────────────────────────────────────────────────── */

  setTool(t: 'select' | 'link'): void {
    this.tool = t;
    this.linkStart = null;
    this.linkCursor = null;
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
    for (const n of this.page.nodes) {
      if (this.sel.has(n.id)) continue; // never align to the moving selection
      const dxn = Math.abs(n.x - projX);
      if (dxn <= bestX) {
        bestX = dxn;
        snapX = n.x;
      }
      const dyn = Math.abs(n.y - projY);
      if (dyn <= bestY) {
        bestY = dyn;
        snapY = n.y;
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
    guides.push(...this.spacingGuides(finalX, finalY, T, [vx, vy, vw, vh]));

    return { dx: finalX - pb.x, dy: finalY - pb.y, guides };
  }

  /** Equal-spacing hints: the dragged point + two others evenly spaced on an axis. */
  private spacingGuides(
    x: number,
    y: number,
    T: number,
    vb: [number, number, number, number],
  ): Guide[] {
    const out: Guide[] = [];
    const others = this.page.nodes.filter((n) => !this.sel.has(n.id));
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
    // Middle button (or space-less default) → pan.
    if (e.button === 1) {
      e.preventDefault();
      this.pan = { startClientX: e.clientX, startClientY: e.clientY };
      this.overlay.setPointerCapture(e.pointerId);
      return;
    }
    const p = clientToUser(this.overlay, e.clientX, e.clientY);

    // Editing waypoints on the selected link takes priority over other hits.
    if (this.tool === 'select' && this.linkSel && this.tryWaypointGrab(p)) {
      this.overlay.setPointerCapture(e.pointerId);
      this.renderOverlay();
      return;
    }

    const hit = hitTestNode(this.page, p.x, p.y);

    // Link tool: click source node, then target node, to create a link.
    if (this.tool === 'link') {
      if (hit) {
        if (this.linkStart === null) {
          this.linkStart = hit;
          this.linkCursor = p;
        } else if (hit !== this.linkStart) {
          this.createLink(this.linkStart, hit);
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
      if (e.shiftKey) {
        if (this.sel.has(hit)) this.sel.delete(hit);
        else this.sel.add(hit);
      } else if (!this.sel.has(hit)) {
        this.sel.clear();
        this.sel.add(hit);
      }
      // Begin drag of the current selection (locked nodes don't move).
      if (this.sel.has(hit)) {
        const base = new Map<string, { x: number; y: number }>();
        for (const id of this.sel) {
          const n = this.page.nodes.find((m) => m.id === id);
          if (n && n.locked !== true) base.set(id, { x: n.x, y: n.y });
        }
        if (base.size > 0) {
          this.drag = {
            startX: p.x,
            startY: p.y,
            base,
            moved: false,
            primary: hit,
            dx: 0,
            dy: 0,
          };
        }
      }
    } else {
      // No node — try selecting a link, else start a marquee.
      const link = hitTestLink(this.page, p.x, p.y);
      if (link) {
        this.sel.clear();
        this.linkSel = link;
        this.fireSelect();
        this.fireLinkSelect();
        this.overlay.setPointerCapture(e.pointerId);
        this.renderOverlay();
        return;
      }
      this.clearLinkSel();
      if (!e.shiftKey) this.sel.clear();
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
    if (!this.drag && !this.marquee) return;
    const p = clientToUser(this.overlay, e.clientX, e.clientY);
    if (this.drag) {
      const rawX = p.x - this.drag.startX;
      const rawY = p.y - this.drag.startY;
      if (Math.abs(rawX) > 1 || Math.abs(rawY) > 1) this.drag.moved = true;
      const snap = this.computeSnap(this.drag, rawX, rawY);
      this.drag.dx = snap.dx;
      this.drag.dy = snap.dy;
      this.guides = this.drag.moved ? snap.guides : [];
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
    if (this.drag) {
      if (this.drag.moved) {
        this.snapshot();
        const { dx, dy } = this.drag;
        for (const [id, base] of this.drag.base) {
          const n = this.page.nodes.find((m) => m.id === id);
          if (n) {
            n.x = Math.round(base.x + dx);
            n.y = Math.round(base.y + dy);
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
  selectionCount(): number {
    return this.sel.size;
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
