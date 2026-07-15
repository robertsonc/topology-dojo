/**
 * Packet S2 — gesture-native operations.
 *
 * Three guards, in order of the packet's safety argument:
 *
 * 1. Characterization — pins the current `diffDocuments` commit behavior for
 *    representative gesture-shaped document pairs, so the refactor cannot
 *    silently change what the snapshot-diff adapter (the fallback + referee)
 *    produces.
 *
 * 2. Referee corpus — drives the *real* editor headlessly through each common
 *    gesture and asserts the operations it emits, applied to the pre-gesture
 *    document, reproduce the exact document the snapshot diff would. This is the
 *    correctness gate: it proves the emitted intent never diverges from the
 *    referee, so committing it can never corrupt history.
 *
 * 3. Undo/redo equivalence — after a gesture then undo the page equals its
 *    pre-gesture state; redo restores it (the editor's own history is unchanged
 *    by the op funnel).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Editor } from './editor.js';
import type { Page, TopologyDocument } from '../pages/model.js';
import { applyOperations, diffDocuments } from '../workspace/operations.js';

/* ── headless harness ─────────────────────────────────────────────────────
 * The editor is DOM-driven; renderPageInto only does `setAttribute` +
 * `innerHTML =`, and the overlay is queried but never structurally read here,
 * so a tiny stub SVG element plus a no-op rAF is enough to drive gestures via
 * the editor's public (and, for the few private ones, cast) methods. No real
 * browser, no vendored render output — exactly the document mutations run. */
function fakeSvg(): SVGSVGElement {
  const el = {
    innerHTML: '',
    style: {} as Record<string, string>,
    setAttribute() {},
    getAttribute() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [] as unknown[];
    },
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    releasePointerCapture() {},
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
  };
  return el as unknown as SVGSVGElement;
}

/** A do-nothing stand-in for the vendored SVG engine — the referee only cares
 * about the document mutations, never the rendered markup, so every draw call
 * is a no-op and `_renderSVG` returns empty. */
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

beforeAll(() => {
  globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  const engine = StubEngine as unknown as {
    NODE_TYPES: Record<string, unknown>;
    registerNodeType: () => void;
  };
  engine.NODE_TYPES = {};
  engine.registerNodeType = () => {};
  (globalThis as unknown as { window: unknown }).window = {
    TopologyDesigner: engine,
  };
});

function basePage(): Page {
  return {
    id: 'p1',
    name: 'Frame 1',
    viewBox: '0 0 1000 700',
    // Deliberately uneven x-spacing so align/distribute actually move nodes.
    nodes: [
      { id: 'a', type: 'ec', x: 100, y: 100, label: 'A' },
      { id: 'b', type: 'ec', x: 250, y: 100, label: 'B' },
      { id: 'c', type: 'ec', x: 520, y: 100, label: 'C' },
    ],
    links: [{ id: 'ab', type: 'line', from: 'a', to: 'b' }],
    anchors: [{ id: 'an1', x: 200, y: 300 }],
    zones: [{ id: 'z1', nodes: ['a', 'b'], label: 'Zone' }],
    flowPaths: [{ id: 'f1', waypoints: ['a', 'b'] }],
    policyMarkers: [{ id: 'm1', nodeId: 'a', type: 'inspect' }],
  };
}

function wrap(page: Page): TopologyDocument {
  return { title: 'T', customNodes: [], pages: [structuredClone(page)] };
}

function mkEditor(page: Page): Editor {
  return new Editor(fakeSvg(), fakeSvg(), page);
}

/* ── 1. Characterization: pin the snapshot-diff adapter ───────────────────── */

describe('diffDocuments characterization (locks the fallback/referee)', () => {
  it('an added node → a single element.add anchored last', () => {
    const before = wrap(basePage());
    const after = structuredClone(before);
    after.pages[0]!.nodes.push({
      id: 'd',
      type: 'ec',
      x: 700,
      y: 100,
      label: 'D',
    });
    expect(diffDocuments(before, after)).toEqual([
      {
        type: 'element.add',
        pageId: 'p1',
        kind: 'nodes',
        element: { id: 'd', type: 'ec', x: 700, y: 100, label: 'D' },
        afterElementId: 'c',
      },
    ]);
  });

  it('a moved node → a single element.patch of the changed fields', () => {
    const before = wrap(basePage());
    const after = structuredClone(before);
    after.pages[0]!.nodes[0]!.x = 160;
    after.pages[0]!.nodes[0]!.y = 120;
    expect(diffDocuments(before, after)).toEqual([
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'a',
        patch: { set: { x: 160, y: 120 } },
      },
    ]);
  });

  it('deleting a node with a dependent link → two removes (order by kind)', () => {
    const before = wrap(basePage());
    // Mirror deleteSelected's cascade: drop node b, its link ab, and prune b
    // from the zone's membership (flow path / marker referencing b are left as
    // the editor leaves them).
    const after = structuredClone(before);
    after.pages[0]!.nodes = after.pages[0]!.nodes.filter((n) => n.id !== 'b');
    after.pages[0]!.links = [];
    after.pages[0]!.zones[0]!.nodes = ['a'];
    const ops = diffDocuments(before, after);
    // Removes come out ordered by ELEMENT_KINDS: nodes, then links.
    expect(ops.filter((o) => o.type === 'element.remove')).toEqual([
      { type: 'element.remove', pageId: 'p1', kind: 'nodes', elementId: 'b' },
      { type: 'element.remove', pageId: 'p1', kind: 'links', elementId: 'ab' },
    ]);
  });

  it('reordering a collection → a single element.reorder', () => {
    const before = wrap(basePage());
    const after = structuredClone(before);
    after.pages[0]!.nodes.reverse();
    expect(diffDocuments(before, after)).toEqual([
      {
        type: 'element.reorder',
        pageId: 'p1',
        kind: 'nodes',
        elementIds: ['c', 'b', 'a'],
      },
    ]);
  });
});

/* ── 2. Referee corpus ─────────────────────────────────────────────────────
 * Each case sets up an editor, runs a gesture, then asserts the emitted ops
 * reproduce the same document the snapshot diff would. `undoable` marks
 * gestures placed on the undo stack (page rename/viewBox are deliberately not). */
interface GestureCase {
  name: string;
  setup?: (editor: Editor, page: Page) => void;
  run: (editor: Editor) => void;
  undoable: boolean;
}

const cases: GestureCase[] = [
  {
    name: 'palette drop (addNode)',
    run: (e) => e.addNode('ec', 'New'),
    undoable: true,
  },
  {
    name: 'drag-move a node (pointer up)',
    setup: (e) => ((e as unknown as { sel: Set<string> }).sel = new Set(['a'])),
    run: (e) => {
      const priv = e as unknown as {
        drag: unknown;
        onUp: (ev: { pointerId: number }) => void;
      };
      priv.drag = {
        startX: 0,
        startY: 0,
        base: new Map([['a', { x: 100, y: 100 }]]),
        anchors: new Set<string>(),
        moved: true,
        primary: 'a',
        dx: 40,
        dy: 20,
      };
      priv.onUp({ pointerId: 1 });
    },
    undoable: false, // drag snapshots on first move; here we inject post-move state
  },
  {
    name: 'drag-move an anchor (pointer up)',
    run: (e) => {
      const priv = e as unknown as {
        drag: unknown;
        onUp: (ev: { pointerId: number }) => void;
      };
      priv.drag = {
        startX: 0,
        startY: 0,
        base: new Map([['an1', { x: 200, y: 300 }]]),
        anchors: new Set(['an1']),
        moved: true,
        primary: 'an1',
        dx: 10,
        dy: -30,
      };
      priv.onUp({ pointerId: 1 });
    },
    undoable: false,
  },
  {
    name: 'delete a node with cascade (deleteSelected)',
    setup: (e) => ((e as unknown as { sel: Set<string> }).sel = new Set(['b'])),
    run: (e) => e.deleteSelected(),
    undoable: true,
  },
  {
    name: 'inspector commit on a node (updateNode)',
    setup: (e) => e.focusNode('a'),
    run: (e) => e.updateNode({ label: 'Renamed', color: '#ff0000' }),
    undoable: true,
  },
  {
    name: 'inspector commit on a link (updateLink)',
    setup: (e) => e.focusLink('ab'),
    run: (e) => e.updateLink({ type: 'tunnel' }),
    undoable: true,
  },
  {
    name: 'inspector commit on an anchor (updateAnchor)',
    setup: (e) => ((e as unknown as { anchorSel: string }).anchorSel = 'an1'),
    run: (e) => e.updateAnchor({ x: 240, y: 320 }),
    undoable: true,
  },
  {
    name: 'inspector commit on a zone (updateAnnotation)',
    run: (e) => e.updateAnnotation('zones', 'z1', { label: 'Region' }),
    undoable: true,
  },
  {
    name: 'nudge selected nodes + anchor',
    setup: (e) => {
      (e as unknown as { sel: Set<string> }).sel = new Set(['a', 'c']);
      (e as unknown as { selAnchors: Set<string> }).selAnchors = new Set([
        'an1',
      ]);
    },
    run: (e) => e.nudge(20, 0),
    undoable: true,
  },
  {
    name: 'align selected nodes',
    setup: (e) =>
      ((e as unknown as { sel: Set<string> }).sel = new Set(['a', 'b', 'c'])),
    run: (e) => e.alignSelection('left'),
    undoable: true,
  },
  {
    name: 'distribute selected nodes',
    setup: (e) =>
      ((e as unknown as { sel: Set<string> }).sel = new Set(['a', 'b', 'c'])),
    run: (e) => e.distributeSelection('h'),
    undoable: true,
  },
  {
    name: 'duplicate selection',
    setup: (e) =>
      ((e as unknown as { sel: Set<string> }).sel = new Set(['a', 'b'])),
    run: (e) => e.duplicateSelection(),
    undoable: true,
  },
  {
    name: 'stamp stencil',
    run: (e) =>
      e.stampStencil(
        [
          { id: 's1', type: 'ec', x: -20, y: 0, label: 'S1' },
          { id: 's2', type: 'ec', x: 20, y: 0, label: 'S2' },
        ],
        [{ id: 'sl', type: 'line', from: 's1', to: 's2' }],
      ),
    undoable: true,
  },
  {
    name: 'add zone',
    run: (e) => e.addZone({ id: 'z2', nodes: ['c'], label: 'New Zone' }),
    undoable: true,
  },
  {
    name: 'add flow path',
    run: (e) => e.addFlowPath({ id: 'f2', waypoints: ['b', 'c'] }),
    undoable: true,
  },
  {
    name: 'add policy marker',
    run: (e) => e.addPolicyMarker({ id: 'm2', nodeId: 'b', type: 'encrypt' }),
    undoable: true,
  },
  {
    name: 'remove annotation (zone)',
    run: (e) => e.removeAnnotation('zones', 'z1'),
    undoable: true,
  },
  {
    name: 'swap link endpoints',
    setup: (e) => e.focusLink('ab'),
    run: (e) => e.swapLink(),
    undoable: true,
  },
  {
    name: 'cycle link type',
    setup: (e) => e.focusLink('ab'),
    run: (e) => e.cycleLinkType(),
    undoable: true,
  },
  {
    name: 'cycle link style',
    setup: (e) => e.focusLink('ab'),
    run: (e) => e.cycleLinkStyle(),
    undoable: true,
  },
  {
    name: 'toggle lock on a node',
    setup: (e) => ((e as unknown as { sel: Set<string> }).sel = new Set(['a'])),
    run: (e) => e.toggleLock(),
    undoable: true,
  },
  {
    name: 'z-order bring to front (reorder)',
    setup: (e) => ((e as unknown as { sel: Set<string> }).sel = new Set(['a'])),
    run: (e) => e.bringToFront(),
    undoable: true,
  },
  {
    name: 'create link (drag-to-connect)',
    run: (e) =>
      (
        e as unknown as { createLink: (a: string, b: string) => void }
      ).createLink('a', 'c'),
    undoable: true,
  },
  {
    name: 'add anchor',
    run: (e) =>
      (
        e as unknown as { addAnchorAt: (x: number, y: number) => void }
      ).addAnchorAt(400, 400),
    undoable: true,
  },
  {
    name: 'move a link waypoint (pointer up)',
    setup: (e, page) => {
      page.links[0]!.waypoints = [{ x: 200, y: 150 }];
      e.focusLink('ab');
    },
    run: (e) => {
      const link = e.page.links.find((l) => l.id === 'ab')!;
      link.waypoints![0] = { x: 250, y: 180 };
      const priv = e as unknown as {
        wpDrag: unknown;
        onUp: (ev: { pointerId: number }) => void;
      };
      priv.wpDrag = { index: 0, moved: true };
      priv.onUp({ pointerId: 1 });
    },
    undoable: false, // waypoint drag snapshots on first move; we inject post-move state
  },
  {
    name: 'straighten link (clear waypoints)',
    setup: (e, page) => {
      page.links[0]!.waypoints = [{ x: 200, y: 150 }];
      e.focusLink('ab');
    },
    run: (e) => e.straightenLink(),
    undoable: true,
  },
  {
    name: 'rename page (page.patch, not undoable)',
    run: (e) => e.renamePage('Renamed Frame'),
    undoable: false,
  },
  {
    name: 'set viewBox (page.patch, not undoable)',
    run: (e) => e.setViewBox('0 0 1200 800'),
    undoable: false,
  },
];

describe('referee corpus — emitted ops reproduce the snapshot diff', () => {
  for (const gesture of cases) {
    it(gesture.name, () => {
      const page = basePage();
      const editor = mkEditor(page);
      editor.takePendingOperations(); // clear any residue
      gesture.setup?.(editor, editor.page);
      editor.takePendingOperations(); // setup (e.g. focus) must not leak ops

      const before = wrap(editor.page);
      gesture.run(editor);
      const after = wrap(editor.page);
      const emitted = editor.takePendingOperations();

      // The gesture is genuinely gesture-native (did not silently fall back).
      expect(emitted.length).toBeGreaterThan(0);

      const viaEmitted = applyOperations(before, emitted);
      const viaDiff = applyOperations(before, diffDocuments(before, after));
      // The core guarantee: emitted intent and the snapshot diff land on the
      // exact same document — so committing either never corrupts history.
      expect(viaEmitted).toEqual(viaDiff);
    });
  }
});

/* ── 3. Undo / redo equivalence ────────────────────────────────────────────── */

describe('undo/redo equivalence across gestures', () => {
  for (const gesture of cases.filter((c) => c.undoable)) {
    it(gesture.name, () => {
      const page = basePage();
      const editor = mkEditor(page);
      gesture.setup?.(editor, editor.page);

      const t0 = structuredClone(editor.page);
      gesture.run(editor);
      const t1 = structuredClone(editor.page);
      expect(t1).not.toEqual(t0);

      editor.undo();
      expect(structuredClone(editor.page)).toEqual(t0);
      editor.redo();
      expect(structuredClone(editor.page)).toEqual(t1);
    });
  }
});

/* ── 4. Buffer behavior: coalescing + fallback boundaries ──────────────────── */

describe('operation buffer', () => {
  it('coalesces a run of continuous inspector edits into one patch', () => {
    const editor = mkEditor(basePage());
    editor.focusNode('a');
    editor.takePendingOperations();
    // First edit commits (snapshots); the rest are continuous (commit=false),
    // exactly as typing in a text field drives updateNode.
    editor.updateNode({ label: 'R' }, true);
    editor.updateNode({ label: 'Re' }, false);
    editor.updateNode({ label: 'Reg' }, false);
    editor.updateNode({ label: 'Region' }, false);
    const emitted = editor.takePendingOperations();
    expect(emitted).toEqual([
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'a',
        patch: { set: { label: 'Region' } },
      },
    ]);
  });

  it('undo drops buffered intent so the sync falls back to the diff', () => {
    const editor = mkEditor(basePage());
    editor.addNode('ec', 'Temp');
    expect(editor.takePendingOperations().length).toBeGreaterThan(0);
    // Re-add, then undo without draining: the buffer must be cleared.
    editor.addNode('ec', 'Temp2');
    editor.undo();
    expect(editor.takePendingOperations()).toEqual([]);
  });

  it('a page switch drops buffered intent (new commit baseline)', () => {
    const editor = mkEditor(basePage());
    editor.addNode('ec', 'Temp');
    editor.setPage(basePage());
    expect(editor.takePendingOperations()).toEqual([]);
  });
});
