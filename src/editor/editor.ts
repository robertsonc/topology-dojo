/**
 * Editor core — direct manipulation of a single page.
 *
 * Architecture: the page "art" is drawn by the vendored engine into the art
 * `<svg>` and re-rendered only when the model changes (drop / delete / undo).
 * A separate overlay `<svg>` (this module owns it) handles hit-testing,
 * selection visuals, the marquee, and drag ghosts — so dragging is smooth
 * without re-rendering the heavy art every frame.
 */
import { renderPageInto, type NodeConfig } from '../vendor/topology-ds.js';
import { clientToUser } from './coords.js';
import type { Page } from '../pages/model.js';
import { hitTestNode, nodeBounds, nodeHalf, nodesInRect } from './geometry.js';

const ACCENT = '#01a982';

interface DragState {
  startX: number;
  startY: number;
  base: Map<string, { x: number; y: number }>;
  moved: boolean;
}

export class Editor {
  private sel = new Set<string>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  grid = 20;
  snap = true;
  gridVisible = true;

  private drag: DragState | null = null;
  private marquee: { x0: number; y0: number; x1: number; y1: number } | null =
    null;

  constructor(
    private art: SVGSVGElement,
    private overlay: SVGSVGElement,
    public page: Page,
    /** Called after any change that should re-sync external UI (e.g. thumbnails). */
    private onChange: () => void = () => {},
  ) {
    this.overlay.setAttribute('viewBox', page.viewBox);
    this.bind();
    this.renderArt();
    this.renderOverlay();
  }

  /** Switch to editing a different page (resets selection + history). */
  setPage(page: Page): void {
    this.page = page;
    this.sel.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.drag = null;
    this.marquee = null;
    this.overlay.setAttribute('viewBox', page.viewBox);
    this.renderArt();
    this.renderOverlay();
  }

  /* ── rendering ────────────────────────────────────────────────── */

  private renderArt(): void {
    renderPageInto(this.art, this.page);
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
    const d = this.dragDelta();
    let out = '';
    for (const [id, base] of this.drag.base) {
      const n = this.page.nodes.find((m) => m.id === id);
      if (!n) continue;
      const h = nodeHalf(n);
      out += `<rect x="${base.x + d.x - h.w}" y="${base.y + d.y - h.h}" width="${h.w * 2}" height="${h.h * 2}" fill="${ACCENT}" fill-opacity="0.08" stroke="${ACCENT}" stroke-dasharray="4 3" stroke-width="1.5" rx="4"/>`;
    }
    return out;
  }

  private marqueeSvg(): string {
    if (!this.marquee) return '';
    const { x0, y0, x1, y1 } = this.marquee;
    return `<rect x="${Math.min(x0, x1)}" y="${Math.min(y0, y1)}" width="${Math.abs(x1 - x0)}" height="${Math.abs(y1 - y0)}" fill="${ACCENT}" fill-opacity="0.06" stroke="${ACCENT}" stroke-dasharray="5 4" stroke-width="1"/>`;
  }

  private renderOverlay(): void {
    this.overlay.innerHTML =
      this.gridSvg() +
      this.selectionSvg() +
      this.dragGhostSvg() +
      this.marqueeSvg();
  }

  /* ── history ──────────────────────────────────────────────────── */

  private snapshot(): void {
    this.undoStack.push(JSON.stringify(serialize(this.page)));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  private restore(json: string): void {
    const p = JSON.parse(json) as ReturnType<typeof serialize>;
    this.page.viewBox = p.viewBox;
    this.page.name = p.name;
    this.page.nodes = p.nodes;
    this.page.links = p.links;
    this.page.anchors = p.anchors;
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
  }

  /* ── mutations ────────────────────────────────────────────────── */

  deleteSelected(): void {
    if (this.sel.size === 0) return;
    this.snapshot();
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
    this.renderArt();
    this.renderOverlay();
    this.onChange();
  }

  /* ── interaction ──────────────────────────────────────────────── */

  private snapVal(v: number): number {
    return this.snap ? Math.round(v / this.grid) * this.grid : Math.round(v);
  }

  private dragDelta(): { x: number; y: number } {
    if (!this.drag) return { x: 0, y: 0 };
    return {
      x: this.cur.x - this.drag.startX,
      y: this.cur.y - this.drag.startY,
    };
  }

  private cur = { x: 0, y: 0 };

  private bind(): void {
    this.overlay.addEventListener('pointerdown', (e) => this.onDown(e));
    this.overlay.addEventListener('pointermove', (e) => this.onMove(e));
    this.overlay.addEventListener('pointerup', (e) => this.onUp(e));
  }

  private onDown(e: PointerEvent): void {
    const p = clientToUser(this.overlay, e.clientX, e.clientY);
    this.cur = p;
    const hit = hitTestNode(this.page, p.x, p.y);

    if (hit) {
      if (e.shiftKey) {
        if (this.sel.has(hit)) this.sel.delete(hit);
        else this.sel.add(hit);
      } else if (!this.sel.has(hit)) {
        this.sel.clear();
        this.sel.add(hit);
      }
      // Begin drag of the current selection (if the hit is still selected).
      if (this.sel.has(hit)) {
        const base = new Map<string, { x: number; y: number }>();
        for (const id of this.sel) {
          const n = this.page.nodes.find((m) => m.id === id);
          if (n) base.set(id, { x: n.x, y: n.y });
        }
        this.drag = { startX: p.x, startY: p.y, base, moved: false };
      }
    } else {
      if (!e.shiftKey) this.sel.clear();
      this.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    }
    this.overlay.setPointerCapture(e.pointerId);
    this.renderOverlay();
  }

  private onMove(e: PointerEvent): void {
    if (!this.drag && !this.marquee) return;
    const p = clientToUser(this.overlay, e.clientX, e.clientY);
    this.cur = p;
    if (this.drag) {
      const d = this.dragDelta();
      if (Math.abs(d.x) > 1 || Math.abs(d.y) > 1) this.drag.moved = true;
    } else if (this.marquee) {
      this.marquee.x1 = p.x;
      this.marquee.y1 = p.y;
    }
    this.renderOverlay();
  }

  private onUp(e: PointerEvent): void {
    this.overlay.releasePointerCapture(e.pointerId);
    if (this.drag) {
      if (this.drag.moved) {
        this.snapshot();
        const d = this.dragDelta();
        for (const [id, base] of this.drag.base) {
          const n = this.page.nodes.find((m) => m.id === id);
          if (n) {
            n.x = this.snapVal(base.x + d.x);
            n.y = this.snapVal(base.y + d.y);
          }
        }
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

/** Plain serializable view of a page (drops nothing — pages are already plain). */
function serialize(page: Page): {
  viewBox: string;
  name: string;
  nodes: NodeConfig[];
  links: Page['links'];
  anchors: Page['anchors'];
} {
  return structuredClone({
    viewBox: page.viewBox,
    name: page.name,
    nodes: page.nodes,
    links: page.links,
    anchors: page.anchors,
  });
}
