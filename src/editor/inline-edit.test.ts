/**
 * Inline label editing (double-click) — the editor resolves a double-click
 * into an InlineEditRequest: hit-test node → link → zone → empty, select what
 * was hit (so the ordinary update paths target it), and hand the shell a
 * client-space anchor. Commit goes through updateNode/updateLink/
 * updateAnnotation, so undo + gesture-operation emission are inherited.
 *
 * Uses the same headless harness as editor.test.ts, extended with a null
 * getScreenCTM so client→user mapping falls back to identity (client
 * coordinates ARE page coordinates in these tests).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Editor, type InlineEditRequest } from './editor.js';
import type { Page } from '../pages/model.js';

function fakeSvg(): SVGSVGElement {
  const el = {
    innerHTML: '',
    style: {} as Record<string, string>,
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
    links: [{ id: 'ab', type: 'line', from: 'a', to: 'b', label: 'uplink' }],
    anchors: [],
    zones: [{ id: 'z1', label: 'Branch', nodes: ['a', 'b'] }],
    flowPaths: [],
    policyMarkers: [],
  };
}

function harness(page: Page): {
  editor: Editor;
  requests: InlineEditRequest[];
} {
  const editor = new Editor(fakeSvg(), fakeSvg(), page);
  const requests: InlineEditRequest[] = [];
  editor.setInlineEditHandler((req) => requests.push(req));
  return { editor, requests };
}

describe('inline edit hit resolution', () => {
  it('returns null (and stays silent) with no handler registered', () => {
    const editor = new Editor(fakeSvg(), fakeSvg(), basePage());
    expect(editor.requestInlineEditAt(100, 100)).toBeNull();
  });

  it('resolves a node hit, selects it, and reports its label', () => {
    const { editor, requests } = harness(basePage());
    expect(editor.requestInlineEditAt(100, 100)).toBe('node');
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req).toMatchObject({ kind: 'node', id: 'a', current: 'A' });
    // Anchor sits on the node's x, below its art.
    expect(req.clientX).toBe(100);
    expect(req.clientY).toBeGreaterThan(100);
    // The node is now the sole selection, so updateNode targets it.
    expect(editor.getSelectedNode()?.id).toBe('a');
  });

  it('resolves a link hit (between endpoints) and reports its label', () => {
    const { editor, requests } = harness(basePage());
    expect(editor.requestInlineEditAt(200, 100)).toBe('link');
    expect(requests[0]).toMatchObject({
      kind: 'link',
      id: 'ab',
      current: 'uplink',
    });
    expect(editor.getSelectedLink()?.id).toBe('ab');
  });

  it('resolves a zone hit on empty zone space', () => {
    const { editor, requests } = harness(basePage());
    // (150, 45): inside z1's padded region, off both nodes and the link.
    expect(editor.requestInlineEditAt(150, 45)).toBe('zone');
    expect(requests[0]).toMatchObject({
      kind: 'zone',
      id: 'z1',
      current: 'Branch',
    });
    expect(editor.getSelectedZone()?.id).toBe('z1');
  });

  it('reports blank canvas as an empty (quick-add) request', () => {
    const { editor, requests } = harness(basePage());
    expect(editor.requestInlineEditAt(700, 600)).toBe('empty');
    expect(requests[0]).toMatchObject({ kind: 'empty', id: null, current: '' });
    expect(requests[0]!.pageX).toBe(700);
    expect(requests[0]!.pageY).toBe(600);
  });
});

describe('inline edit commit paths', () => {
  it('node rename commits through updateNode with undo + emitted patch', () => {
    const { editor } = harness(basePage());
    editor.requestInlineEditAt(100, 100);
    editor.takePendingOperations(); // drop selection-time noise
    editor.updateNode({ label: 'Renamed' });
    expect(editor.page.nodes.find((n) => n.id === 'a')?.label).toBe('Renamed');
    const ops = editor.takePendingOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: 'element.patch',
      kind: 'nodes',
      elementId: 'a',
      patch: { set: { label: 'Renamed' } },
    });
    editor.undo();
    expect(editor.page.nodes.find((n) => n.id === 'a')?.label).toBe('A');
  });

  it('link rename commits through updateLink', () => {
    const { editor } = harness(basePage());
    editor.requestInlineEditAt(200, 100);
    editor.updateLink({ label: 'core' });
    expect(editor.page.links[0]!.label).toBe('core');
    editor.undo();
    expect(editor.page.links[0]!.label).toBe('uplink');
  });

  it('zone rename commits through updateAnnotation', () => {
    const { editor } = harness(basePage());
    editor.requestInlineEditAt(150, 45);
    editor.updateAnnotation('zones', 'z1', { label: 'HQ' });
    expect(editor.page.zones[0]!.label).toBe('HQ');
    editor.undo();
    expect(editor.page.zones[0]!.label).toBe('Branch');
  });
});
