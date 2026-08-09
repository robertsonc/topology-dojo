/**
 * Editor history + delete-cascade behavior (#205 / #204 / #215):
 *
 * - #205: `snapshot()` captures the COMPLETE page — emphasis, caption,
 *   duration, transition included — so page-presentation edits round-trip
 *   through undo/redo instead of silently reverting an older edit.
 * - #204: history is per-page — switching frames stashes the outgoing page's
 *   stacks and restores the incoming page's, and a deleted page's stash can
 *   be dropped.
 * - #215: deleting nodes/anchors cascades through flow paths (waypoints,
 *   hops) and policy markers with the same semantics as the headless
 *   `remove_element` API (shared helper in pages/cascade.ts).
 *
 * Uses the same headless harness as gesture-operations.test.ts: the editor
 * only does `setAttribute` + `innerHTML =` against the SVG layers, so a stub
 * element plus a no-op rAF drives every mutation for real.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Editor } from './editor.js';
import type { Page, TopologyDocument } from '../pages/model.js';
import { applyOperations, diffDocuments } from '../workspace/operations.js';

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

/** No-op engine stand-in (see gesture-operations.test.ts). */
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

function basePage(id = 'p1'): Page {
  return {
    id,
    name: `Frame ${id}`,
    viewBox: '0 0 1000 700',
    nodes: [
      { id: 'a', type: 'ec', x: 100, y: 100, label: 'A' },
      { id: 'b', type: 'ec', x: 300, y: 100, label: 'B' },
    ],
    links: [{ id: 'ab', type: 'line', from: 'a', to: 'b' }],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  };
}

function mkEditor(page: Page): Editor {
  return new Editor(fakeSvg(), fakeSvg(), page);
}

function selectNodes(editor: Editor, ids: string[]): void {
  (editor as unknown as { sel: Set<string> }).sel = new Set(ids);
}

/* ── #205: snapshots capture every page-level field ──────────────────────── */

describe('undo snapshots include page presentation fields (#205)', () => {
  it('emphasize → undo → redo round-trips exactly', () => {
    const editor = mkEditor(basePage());
    editor.focusNode('a');
    editor.emphasizeSelection();
    expect(editor.page.emphasis).toEqual(['a']);

    editor.undo();
    expect(editor.page.emphasis).toBeUndefined();
    editor.redo();
    expect(editor.page.emphasis).toEqual(['a']);
  });

  it('toggle + clear emphasis are individually undoable (no older edit reverts)', () => {
    const editor = mkEditor(basePage());
    editor.addNode('ec', 'Extra');
    const withNode = editor.page.nodes.length;
    editor.toggleEmphasis('a');
    editor.toggleEmphasis('b');
    editor.clearEmphasis();
    expect(editor.page.emphasis).toBeUndefined();

    editor.undo(); // undoes the clear, NOT the node add
    expect(editor.page.emphasis).toEqual(['a', 'b']);
    expect(editor.page.nodes.length).toBe(withNode);
    editor.undo();
    expect(editor.page.emphasis).toEqual(['a']);
    editor.undo();
    expect(editor.page.emphasis).toBeUndefined();
    expect(editor.page.nodes.length).toBe(withNode);
    editor.undo(); // only now does the node add revert
    expect(editor.page.nodes.length).toBe(withNode - 1);
  });

  it('caption / duration / transition edits round-trip through history', () => {
    const editor = mkEditor(basePage());
    editor.updatePageProps({ caption: 'Step 1' });
    editor.updatePageProps({ duration: 1500, transition: 'fade' });
    expect(editor.page).toMatchObject({
      caption: 'Step 1',
      duration: 1500,
      transition: 'fade',
    });

    editor.undo();
    expect(editor.page.duration).toBeUndefined();
    expect(editor.page.transition).toBeUndefined();
    expect(editor.page.caption).toBe('Step 1');
    editor.undo();
    expect(editor.page.caption).toBeUndefined();
    editor.redo();
    editor.redo();
    expect(editor.page).toMatchObject({
      caption: 'Step 1',
      duration: 1500,
      transition: 'fade',
    });
  });

  it('clearing a page prop (undefined) is undoable, and a no-op change is not', () => {
    const editor = mkEditor(basePage());
    editor.updatePageProps({ caption: 'Narration' });
    editor.updatePageProps({ caption: undefined });
    expect(editor.page.caption).toBeUndefined();
    editor.undo();
    expect(editor.page.caption).toBe('Narration');

    const depth = editor.historyDepth();
    editor.updatePageProps({ caption: 'Narration' }); // unchanged → no entry
    expect(editor.historyDepth()).toBe(depth);
  });
});

/* ── #204: per-page history across frame switches ────────────────────────── */

describe('per-page history across setPage (#204)', () => {
  it('edit → switch frame → switch back → undo undoes the prior edit', () => {
    const p1 = basePage('p1');
    const p2 = basePage('p2');
    const editor = mkEditor(p1);
    editor.addNode('ec', 'New');
    expect(editor.canUndo()).toBe(true);

    editor.setPage(p2);
    expect(editor.canUndo()).toBe(false); // p2 has its own (empty) history
    editor.setPage(p1);
    expect(editor.canUndo()).toBe(true);
    editor.undo();
    expect(p1.nodes.map((n) => n.label)).not.toContain('New');
  });

  it('redo survives a round-trip to another frame', () => {
    const p1 = basePage('p1');
    const p2 = basePage('p2');
    const editor = mkEditor(p1);
    editor.addNode('ec', 'New');
    editor.undo();
    expect(editor.canRedo()).toBe(true);

    editor.setPage(p2);
    editor.setPage(p1);
    expect(editor.canRedo()).toBe(true);
    editor.redo();
    expect(p1.nodes.map((n) => n.label)).toContain('New');
  });

  it('each page undoes its own edits independently', () => {
    const p1 = basePage('p1');
    const p2 = basePage('p2');
    const editor = mkEditor(p1);
    editor.addNode('ec', 'OnP1');
    editor.setPage(p2);
    editor.addNode('ec', 'OnP2');

    editor.undo();
    expect(p2.nodes.map((n) => n.label)).not.toContain('OnP2');
    expect(p1.nodes.map((n) => n.label)).toContain('OnP1');

    editor.setPage(p1);
    editor.undo();
    expect(p1.nodes.map((n) => n.label)).not.toContain('OnP1');
  });

  it('dropPageHistory forgets a deleted page’s stash', () => {
    const p1 = basePage('p1');
    const p2 = basePage('p2');
    const editor = mkEditor(p1);
    editor.addNode('ec', 'New');
    editor.setPage(p2);

    editor.dropPageHistory('p1');
    editor.setPage(p1);
    expect(editor.canUndo()).toBe(false);
  });
});

/* ── #215: delete cascade through flow paths / hops / policy markers ─────── */

function cascadePage(): Page {
  return {
    id: 'pc',
    name: 'Cascade',
    viewBox: '0 0 1000 700',
    nodes: [
      { id: 'a', type: 'ec', x: 100, y: 100, label: 'A' },
      { id: 'b', type: 'ec', x: 300, y: 100, label: 'B' },
      { id: 'c', type: 'ec', x: 500, y: 100, label: 'C' },
    ],
    links: [
      { id: 'ab', type: 'line', from: 'a', to: 'b' },
      { id: 'bc', type: 'line', from: 'b', to: 'c' },
      { id: 'a-an1', type: 'line', from: 'a', to: 'an1' },
    ],
    anchors: [{ id: 'an1', x: 200, y: 300 }],
    zones: [{ id: 'z1', nodes: ['a', 'b'], label: 'Zone' }],
    flowPaths: [
      {
        id: 'f1',
        waypoints: ['a', 'b', 'c'],
        hops: [
          { ref: 'b', linkId: 'ab' },
          { ref: 'c', linkId: 'bc' },
        ],
      },
      { id: 'f2', waypoints: ['a', 'an1'] },
    ],
    policyMarkers: [
      { id: 'm1', nodeId: 'a', type: 'inspect', flowPathId: 'f2' },
      { id: 'm2', nodeId: 'b', type: 'encrypt' },
    ],
  };
}

function wrap(page: Page): TopologyDocument {
  return { title: 'T', customNodes: [], pages: [structuredClone(page)] };
}

describe('deleteSelected cascade (#215, shared with remove_element)', () => {
  it('deleting a node cleans links, zones, flow paths, hops, and markers', () => {
    const editor = mkEditor(cascadePage());
    selectNodes(editor, ['b']);
    editor.deleteSelected();

    const page = editor.page;
    expect(page.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    expect(page.links.map((l) => l.id)).toEqual(['a-an1']);
    expect(page.zones[0]!.nodes).toEqual(['a']);
    // f1 was touched but keeps 2 waypoints; its hop at b is gone and the hop
    // that rode the removed link bc keeps its ref but loses the pointer.
    expect(page.flowPaths.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(page.flowPaths[0]!.waypoints).toEqual(['a', 'c']);
    expect(page.flowPaths[0]!.hops).toEqual([{ ref: 'c' }]);
    // The marker on the removed node is gone; the other is untouched.
    expect(page.policyMarkers.map((m) => m.id)).toEqual(['m1']);
    expect(page.policyMarkers[0]!.flowPathId).toBe('f2');
  });

  it('deleting an anchor drops a too-short flow path and its marker pointer', () => {
    const editor = mkEditor(cascadePage());
    (editor as unknown as { selAnchors: Set<string> }).selAnchors = new Set([
      'an1',
    ]);
    editor.deleteSelected();

    const page = editor.page;
    expect(page.anchors).toEqual([]);
    expect(page.links.map((l) => l.id)).toEqual(['ab', 'bc']);
    // f2 fell under two waypoints → removed; the marker loses its flowPathId.
    expect(page.flowPaths.map((f) => f.id)).toEqual(['f1']);
    expect(page.policyMarkers[0]!.flowPathId).toBeUndefined();
  });

  it('undo restores the cascaded page exactly', () => {
    const editor = mkEditor(cascadePage());
    const t0 = structuredClone(editor.page);
    selectNodes(editor, ['b']);
    editor.deleteSelected();
    expect(structuredClone(editor.page)).not.toEqual(t0);
    editor.undo();
    expect(structuredClone(editor.page)).toEqual(t0);
  });

  it('emitted operations reproduce the snapshot diff (referee)', () => {
    for (const target of ['node', 'anchor'] as const) {
      const editor = mkEditor(cascadePage());
      editor.takePendingOperations();
      if (target === 'node') selectNodes(editor, ['b']);
      else
        (editor as unknown as { selAnchors: Set<string> }).selAnchors = new Set(
          ['an1'],
        );

      const before = wrap(editor.page);
      editor.deleteSelected();
      const after = wrap(editor.page);
      const emitted = editor.takePendingOperations();
      expect(emitted.length).toBeGreaterThan(0);

      const viaEmitted = applyOperations(before, emitted);
      const viaDiff = applyOperations(before, diffDocuments(before, after));
      expect(viaEmitted).toEqual(viaDiff);
    }
  });
});
