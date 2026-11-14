/**
 * Test support for the editor's unit tests. Not imported by the app.
 *
 * The editor only does `setAttribute` + `innerHTML =` against its two SVG
 * layers and listens for pointer events on the overlay, so a stub element
 * that records its listeners is enough to drive whole gestures for real:
 * tests fire `pointerdown` / `pointermove` / `pointerup` (and the rarer
 * `pointercancel`, `lostpointercapture`, window `blur`) through the same
 * listeners a browser would call. `getScreenCTM` is null, so client
 * coordinates ARE page coordinates.
 */
import { Editor, type InlineEditRequest } from './editor.js';
import type { Page } from '../pages/model.js';

type Listener = (e: unknown) => void;

export interface FakeText {
  textContent: string;
  getAttribute(name: string): string | null;
  getBBox(): { x: number; y: number; width: number; height: number };
  closest(
    selector: string,
  ): { getAttribute(name: string): string | null } | null;
}

export interface FakeSvg {
  innerHTML: string;
  style: Record<string, string>;
  /** `<text>` elements a test wants the layer to "have rendered". */
  texts: FakeText[];
  /** Pointer ids currently captured (set / release are recorded). */
  captured: Set<number>;
  fire(type: string, event: unknown): void;
}

/** A stub SVG layer: records listeners, capture calls and rendered markup. */
export function fakeSvg(): SVGSVGElement & FakeSvg {
  const listeners = new Map<string, Listener[]>();
  const el: FakeSvg & Record<string, unknown> = {
    innerHTML: '',
    style: {},
    texts: [],
    captured: new Set<number>(),
    setAttribute() {},
    getAttribute() {
      return null;
    },
    getScreenCTM() {
      return null; // identity fallback in coords.ts
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector === 'text') return el.texts;
      if (selector === 'g[data-tds-flowpath] text')
        return el.texts.filter((t) => t.closest('g[data-tds-flowpath]'));
      return [] as unknown[];
    },
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener() {},
    setPointerCapture(id: number) {
      el.captured.add(id);
    },
    releasePointerCapture(id: number) {
      el.captured.delete(id);
    },
    hasPointerCapture(id: number) {
      return el.captured.has(id);
    },
    getBoundingClientRect() {
      return {
        x: 0,
        y: 0,
        width: 1000,
        height: 700,
        left: 0,
        top: 0,
        right: 1000,
        bottom: 700,
        toJSON() {},
      };
    },
    fire(type: string, event: unknown) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
  return el as unknown as SVGSVGElement & FakeSvg;
}

/** A rendered label `<text>` at a box (page coordinates), for label hit-tests. */
export function fakeText(
  text: string,
  box: { x: number; y: number; width: number; height: number },
  flowPathId?: string,
): FakeText {
  return {
    textContent: text,
    getAttribute: () => null,
    getBBox: () => box,
    closest: (selector) =>
      flowPathId !== undefined && selector === 'g[data-tds-flowpath]'
        ? { getAttribute: () => flowPathId }
        : null,
  };
}

/** A do-nothing stand-in for the vendored SVG engine: the tests care about
 * the document and the selection, never the rendered markup. */
class StubEngine {
  reducedMotion = false;
  ambient: unknown = 'off';
  light = false;
  step = 0;
  _steps: unknown[] = [];
  anchor(): void {}
  node(): void {}
  link(): void {}
  zone(): void {}
  flowPath(): void {}
  policyMarker(): void {}
  act(): void {}
  addStep(): void {
    this._steps.push({});
  }
  _buildIndex(): void {}
  _renderSVG(): string {
    return '';
  }
  _svgDefs(): string {
    return '';
  }
}

/** Window-level listeners the editor registered (e.g. `blur`). */
const windowListeners = new Map<string, Listener[]>();

/** Fire a window-level event (e.g. `blur`) at every editor built so far. */
export function fireWindow(type: string, event: unknown = {}): void {
  for (const fn of windowListeners.get(type) ?? []) fn(event);
}

/** Install the globals the editor needs outside a browser. Call in `beforeAll`. */
export function installEditorGlobals(): void {
  globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  const engine = StubEngine as unknown as {
    NODE_TYPES: Record<string, unknown>;
    registerNodeType: () => void;
  };
  engine.NODE_TYPES = {};
  engine.registerNodeType = () => {};
  windowListeners.clear();
  (globalThis as unknown as { window: unknown }).window = {
    TopologyDesigner: engine,
    addEventListener(type: string, fn: Listener) {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]);
    },
    removeEventListener() {},
  };
}

export interface PointerInit {
  button?: number;
  buttons?: number;
  pointerId?: number;
  pointerType?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** A pointer event as the editor reads it (primary mouse button by default). */
export function pointer(
  x: number,
  y: number,
  init: PointerInit = {},
): Record<string, unknown> {
  return {
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: 'mouse',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault() {},
    ...init,
  };
}

export interface Harness {
  editor: Editor;
  art: SVGSVGElement & FakeSvg;
  overlay: SVGSVGElement & FakeSvg;
  /** Inline-edit requests the editor handed to the shell. */
  requests: InlineEditRequest[];
  /** Calls to the document-changed callback. */
  changes: { count: number };
  down(x: number, y: number, init?: PointerInit): void;
  move(x: number, y: number, init?: PointerInit): void;
  up(x: number, y: number, init?: PointerInit): void;
  /** Hover (no button), press and release at one point. */
  click(x: number, y: number, init?: PointerInit): void;
  /** Hover, press, move in `steps` and release. */
  drag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    init?: PointerInit,
  ): void;
}

/**
 * An editor on fake layers at 100% zoom (one page unit = one pixel), with an
 * inline-edit handler registered. `viewW` zooms out: the canvas is 1000 px
 * wide, so `viewW: 3000` shows everything at a third of its size.
 */
export function harness(page: Page, viewW = 1000): Harness {
  const art = fakeSvg();
  const overlay = fakeSvg();
  const changes = { count: 0 };
  const editor = new Editor(art, overlay, page, () => {
    changes.count++;
  });
  (
    editor as unknown as {
      view: { x: number; y: number; w: number; h: number };
    }
  ).view = { x: 0, y: 0, w: viewW, h: viewW * 0.7 };
  const requests: InlineEditRequest[] = [];
  editor.setInlineEditHandler((req) => requests.push(req));
  const down = (x: number, y: number, init?: PointerInit): void =>
    overlay.fire('pointerdown', pointer(x, y, init));
  const move = (x: number, y: number, init?: PointerInit): void =>
    overlay.fire('pointermove', pointer(x, y, init));
  const up = (x: number, y: number, init?: PointerInit): void =>
    overlay.fire('pointerup', pointer(x, y, { buttons: 0, ...init }));
  return {
    editor,
    art,
    overlay,
    requests,
    changes,
    down,
    move,
    up,
    click(x, y, init) {
      move(x, y, { ...init, buttons: 0 });
      down(x, y, init);
      up(x, y, init);
    },
    drag(from, to, init) {
      move(from.x, from.y, { ...init, buttons: 0 });
      down(from.x, from.y, init);
      const steps = 4;
      for (let i = 1; i <= steps; i++)
        move(
          from.x + ((to.x - from.x) * i) / steps,
          from.y + ((to.y - from.y) * i) / steps,
          init,
        );
      up(to.x, to.y, init);
    },
  };
}

/** A blank page to put test elements on. */
export function blankPage(id = 'p1'): Page {
  return {
    id,
    name: `Frame ${id}`,
    viewBox: '0 0 1000 700',
    nodes: [],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  };
}
