/**
 * Quick-connect (Phase 1.2) — chevron click / drag-to-empty picker commits:
 * `quickConnect(from, dir)` and `quickConnectTo(from, type, x, y)` create a
 * node + a link back to the source as ONE undo step and one gesture batch,
 * select the new node, and hand it to the inline label editor.
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
    nodes: [{ id: 'a', type: 'firewall', x: 200, y: 300, label: 'FW' }],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  };
}

describe('quickConnect (chevron click)', () => {
  it('creates a same-type node east of the source, linked back', () => {
    const editor = new Editor(fakeSvg(), fakeSvg(), basePage());
    const nid = editor.quickConnect('a', 'e');
    expect(nid).toBeTruthy();
    expect(editor.page.nodes).toHaveLength(2);
    const added = editor.page.nodes.find((n) => n.id === nid)!;
    expect(added.type).toBe('firewall');
    expect(added.x).toBeGreaterThan(200);
    expect(added.y).toBe(300);
    expect(editor.page.links).toHaveLength(1);
    expect(editor.page.links[0]).toMatchObject({ from: 'a', to: nid });
    // The new node is the selection (so typing a label lands on it).
    expect(editor.getSelectedNode()?.id).toBe(nid);
  });

  it('creates north/south/west with sensible geometry', () => {
    const editor = new Editor(fakeSvg(), fakeSvg(), basePage());
    const byId = (id: string | null) =>
      editor.page.nodes.find((m) => m.id === id)!;
    const n = byId(editor.quickConnect('a', 'n'));
    expect(n.y).toBeLessThan(300);
    const s = byId(editor.quickConnect('a', 's'));
    expect(s.y).toBeGreaterThan(300);
    const w = byId(editor.quickConnect('a', 'w'));
    expect(w.x).toBeLessThan(200);
  });

  it('steps past an occupied spot instead of stacking on it', () => {
    const page = basePage();
    const editor = new Editor(fakeSvg(), fakeSvg(), page);
    const first = editor.quickConnect('a', 'e')!;
    const fx = editor.page.nodes.find((n) => n.id === first)!.x;
    const second = editor.quickConnect('a', 'e')!;
    const sx = editor.page.nodes.find((n) => n.id === second)!.x;
    expect(sx).toBeGreaterThan(fx);
  });

  it('is one undo step (node + link revert together)', () => {
    const editor = new Editor(fakeSvg(), fakeSvg(), basePage());
    editor.quickConnect('a', 'e');
    expect(editor.page.nodes).toHaveLength(2);
    expect(editor.page.links).toHaveLength(1);
    editor.undo();
    expect(editor.page.nodes).toHaveLength(1);
    expect(editor.page.links).toHaveLength(0);
  });

  it('emits one gesture batch: element.add node + element.add link', () => {
    const editor = new Editor(fakeSvg(), fakeSvg(), basePage());
    editor.takePendingOperations();
    const nid = editor.quickConnect('a', 'e');
    const ops = editor.takePendingOperations();
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ type: 'element.add', kind: 'nodes' });
    expect(ops[1]).toMatchObject({ type: 'element.add', kind: 'links' });
    expect((ops[0] as { element: { id: string } }).element.id).toBe(nid);
  });

  it('opens the inline label editor on the fresh node', () => {
    const editor = new Editor(fakeSvg(), fakeSvg(), basePage());
    const reqs: InlineEditRequest[] = [];
    editor.setInlineEditHandler((r) => reqs.push(r));
    const nid = editor.quickConnect('a', 'e');
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ kind: 'node', id: nid });
  });
});

describe('quickConnectTo (drag-to-empty picker)', () => {
  it('creates the picked type at the drop point, linked back', () => {
    const editor = new Editor(fakeSvg(), fakeSvg(), basePage());
    const nid = editor.quickConnectTo('a', 'database', 600, 500)!;
    const added = editor.page.nodes.find((n) => n.id === nid)!;
    expect(added.type).toBe('database');
    expect(added).toMatchObject({ x: 600, y: 500, label: 'Database' });
    expect(editor.page.links[0]).toMatchObject({ from: 'a', to: nid });
  });

  it('returns null (no mutation) for an unknown source node', () => {
    const editor = new Editor(fakeSvg(), fakeSvg(), basePage());
    expect(editor.quickConnectTo('nope', 'host', 100, 100)).toBeNull();
    expect(editor.page.nodes).toHaveLength(1);
    expect(editor.page.links).toHaveLength(0);
  });
});
