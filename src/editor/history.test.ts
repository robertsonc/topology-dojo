/**
 * Undo / redo around the edges: what happens to the selection, to a gesture
 * in flight, to history entries that changed nothing, and to page settings
 * that are edited outside history (name, canvas size).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Page } from '../pages/model.js';
import { blankPage, harness, installEditorGlobals } from './test-harness.js';

beforeAll(installEditorGlobals);
afterEach(() => vi.useRealTimers());

function scene(): Page {
  const page = blankPage();
  page.nodes.push(
    { id: 'a', type: 'router', x: 300, y: 300, label: 'A' },
    { id: 'b', type: 'router', x: 600, y: 300, label: 'B' },
    { id: 'c', type: 'server', x: 460, y: 500, label: 'C' },
  );
  page.links.push({ id: 'ab', type: 'line', from: 'a', to: 'b' });
  page.anchors.push({ id: 'an1', x: 800, y: 500 });
  page.zones.push({ id: 'z1', label: 'Zone', nodes: ['a', 'b'] });
  return page;
}

describe('undo and redo keep the selection (CAN-16)', () => {
  it('a nudged node stays selected through undo and redo', () => {
    const h = harness(scene());
    h.editor.focusNode('a');
    h.editor.nudge(10, 0);
    h.editor.undo();
    expect(h.editor.selectedNodeIds()).toEqual(['a']);
    // The arrow keys keep nudging instead of falling through to "flip page".
    expect(h.editor.selectionCount()).toBe(1);
    h.editor.redo();
    expect(h.editor.selectedNodeIds()).toEqual(['a']);
    expect(h.editor.page.nodes[0]!.x).toBe(310);
  });

  it('a selected link, anchor or zone survives undo of an edit to it', () => {
    const link = harness(scene());
    link.editor.focusLink('ab');
    link.editor.updateLink({ type: 'tunnel' });
    link.editor.undo();
    expect(link.editor.getSelectedLink()?.id).toBe('ab');

    const anchor = harness(scene());
    anchor.click(800, 500);
    anchor.editor.nudge(10, 0);
    anchor.editor.undo();
    expect(anchor.editor.getSelectedAnchor()?.id).toBe('an1');

    const zone = harness(scene());
    zone.editor.selectZone('z1');
    zone.editor.updateAnnotation('zones', 'z1', { label: 'Region' });
    zone.editor.undo();
    expect(zone.editor.getSelectedZone()?.id).toBe('z1');
  });

  it('only what no longer exists is dropped', () => {
    const h = harness(scene());
    h.editor.focusNode('a');
    h.editor.duplicateSelection(); // the copy is now the selection
    expect(h.editor.selectionCount()).toBe(1);
    h.editor.undo();
    expect(h.editor.selectionCount()).toBe(0);
    expect(h.editor.getSelectedNode()).toBeNull();
  });

  it('undoing a link creation leaves no phantom link selected', () => {
    const h = harness(scene());
    h.editor.setTool('link');
    h.click(300, 300);
    h.click(460, 500);
    h.editor.setTool('select');
    expect(h.editor.selectedLinkIds()).toHaveLength(1);
    h.editor.undo();
    expect(h.editor.selectedLinkIds()).toEqual([]);
    expect(h.editor.selectionCount()).toBe(0);
    expect(h.editor.getSelectedLink()).toBeNull();
  });

  it('a multi-selection keeps its surviving members', () => {
    const h = harness(scene());
    h.editor.focusNode('a');
    h.editor.duplicateSelection();
    const copy = h.editor.selectedNodeIds()[0]!;
    h.click(600, 300, { shiftKey: true }); // copy + b
    expect(h.editor.selectedNodeIds().sort()).toEqual([copy, 'b'].sort());
    h.editor.undo(); // the copy vanishes
    expect(h.editor.selectedNodeIds()).toEqual(['b']);
  });
});

describe('undo and redo wait for a gesture in flight (CAN-16)', () => {
  it('Ctrl+Z in the middle of a drag is ignored', () => {
    const h = harness(scene());
    h.editor.focusNode('b');
    h.editor.nudge(20, 0); // one earlier undo step
    h.move(300, 300, { buttons: 0 });
    h.down(300, 300);
    h.move(340, 340);
    h.editor.undo();
    h.move(380, 360);
    h.up(380, 360);
    expect(h.editor.page.nodes[0]).toMatchObject({ x: 380, y: 360 });
    expect(h.editor.page.nodes[1]!.x).toBe(620);
    // History is intact: the drag is one step, the nudge the one before.
    expect(h.editor.historyDepth()).toBe(2);
    h.editor.undo();
    expect(h.editor.page.nodes[0]).toMatchObject({ x: 300, y: 300 });
    expect(h.editor.page.nodes[1]!.x).toBe(620);
    h.editor.undo();
    expect(h.editor.page.nodes[1]!.x).toBe(600);
    h.editor.redo();
    h.editor.redo();
    expect(h.editor.page.nodes[0]).toMatchObject({ x: 380, y: 360 });
  });

  it('redo is ignored while a button is held, even before the drag moves', () => {
    const h = harness(scene());
    h.editor.focusNode('b');
    h.editor.nudge(20, 0);
    h.editor.undo();
    h.move(300, 300, { buttons: 0 });
    h.down(300, 300);
    h.editor.redo();
    expect(h.editor.page.nodes[1]!.x).toBe(600);
    h.up(300, 300);
    h.editor.redo();
    expect(h.editor.page.nodes[1]!.x).toBe(620);
  });

  it('undo works again as soon as the gesture ends', () => {
    const h = harness(scene());
    h.drag({ x: 300, y: 300 }, { x: 380, y: 360 });
    h.editor.undo();
    expect(h.editor.page.nodes[0]).toMatchObject({ x: 300, y: 300 });
  });
});

describe('history holds only steps that changed something (CODE-08 / CODE-16)', () => {
  it('Delete with nothing left to delete keeps redo', () => {
    const h = harness(scene());
    h.editor.setTool('link');
    h.click(300, 300);
    h.click(460, 500);
    h.editor.setTool('select');
    h.editor.undo(); // the new link is gone, and no longer selected
    expect(h.editor.canRedo()).toBe(true);
    h.editor.deleteSelected();
    expect(h.editor.canRedo()).toBe(true);
    expect(h.editor.historyDepth()).toBe(0);
    h.editor.redo();
    expect(h.editor.page.links).toHaveLength(2);
  });

  it('Delete on a selection that is already gone pushes nothing', () => {
    const h = harness(scene());
    h.editor.focusNode('a');
    // The node disappears behind the editor's back (another client's edit).
    h.editor.page.nodes = h.editor.page.nodes.filter((n) => n.id !== 'a');
    h.editor.deleteSelected();
    expect(h.editor.canUndo()).toBe(false);
  });

  it('a tidy, balance or layout that moves nothing keeps redo', () => {
    for (const run of [
      (h: ReturnType<typeof harness>) => h.editor.tidy(),
      (h: ReturnType<typeof harness>) => h.editor.balance(),
      (h: ReturnType<typeof harness>) => h.editor.layout({ algorithm: 'grid' }),
      (h: ReturnType<typeof harness>) => h.editor.autoLabels(),
    ]) {
      const h = harness(scene());
      run(h); // settle the layout first
      run(h);
      const depth = h.editor.historyDepth();
      h.editor.focusNode('a');
      h.editor.nudge(20, 0);
      h.editor.undo();
      expect(h.editor.canRedo()).toBe(true);
      run(h); // nothing left to move
      expect(h.editor.historyDepth()).toBe(depth);
      expect(h.editor.canRedo()).toBe(true);
    }
  });

  it('align and distribute that move nothing push nothing', () => {
    const h = harness(scene());
    h.editor.selectAll();
    h.editor.alignSelection('top');
    const depth = h.editor.historyDepth();
    h.editor.alignSelection('top'); // already aligned
    expect(h.editor.historyDepth()).toBe(depth);
  });

  it('nudge → undo → nudge inside the coalescing window is undoable', () => {
    vi.useFakeTimers();
    const h = harness(scene());
    h.editor.focusNode('a');
    h.editor.nudge(10, 0);
    vi.advanceTimersByTime(100);
    h.editor.undo();
    expect(h.editor.page.nodes[0]!.x).toBe(300);
    vi.advanceTimersByTime(100); // still within the 500 ms window
    h.editor.nudge(10, 0);
    expect(h.editor.page.nodes[0]!.x).toBe(310);
    expect(h.editor.canUndo()).toBe(true);
    h.editor.undo();
    expect(h.editor.page.nodes[0]!.x).toBe(300);
  });

  it('a held arrow key is still one undo step', () => {
    vi.useFakeTimers();
    const h = harness(scene());
    h.editor.focusNode('a');
    for (let i = 0; i < 5; i++) {
      h.editor.nudge(1, 0);
      vi.advanceTimersByTime(40);
    }
    expect(h.editor.historyDepth()).toBe(1);
    vi.advanceTimersByTime(600);
    h.editor.nudge(1, 0);
    expect(h.editor.historyDepth()).toBe(2);
  });
});

describe('undo leaves page settings edited outside history alone (CODE-09)', () => {
  it('a later page rename survives undoing an earlier edit', () => {
    const h = harness(scene());
    h.editor.addNode('router');
    h.editor.renamePage('Core site');
    h.editor.undo();
    expect(h.editor.page.nodes).toHaveLength(3);
    expect(h.editor.page.name).toBe('Core site');
    h.editor.redo();
    expect(h.editor.page.nodes).toHaveLength(4);
    expect(h.editor.page.name).toBe('Core site');
  });

  it('a rename made by the shell directly on the page survives too', () => {
    const h = harness(scene());
    h.editor.addNode('router');
    h.editor.page.name = 'Filmstrip rename';
    h.editor.undo();
    expect(h.editor.page.name).toBe('Filmstrip rename');
  });

  it('a later canvas resize survives undoing an earlier edit', () => {
    const h = harness(scene());
    h.editor.addNode('router');
    h.editor.setViewBox('0 0 1600 900');
    h.editor.undo();
    expect(h.editor.page.nodes).toHaveLength(3);
    expect(h.editor.page.viewBox).toBe('0 0 1600 900');
    h.editor.redo();
    expect(h.editor.page.viewBox).toBe('0 0 1600 900');
  });

  it('wire-sheet view settings set outside the editor survive undo', () => {
    const h = harness(scene());
    h.editor.addNode('router');
    h.editor.page.view = 'wiresheet';
    h.editor.page.panelScale = 4;
    h.editor.undo();
    expect(h.editor.page.view).toBe('wiresheet');
    expect(h.editor.page.panelScale).toBe(4);
  });

  it('"fit page to content" is still undoable, canvas size included', () => {
    const h = harness(scene());
    const before = h.editor.page.viewBox;
    h.editor.fitPageToContent();
    const fitted = h.editor.page.viewBox;
    expect(fitted).not.toBe(before);
    h.editor.undo();
    expect(h.editor.page.viewBox).toBe(before);
    h.editor.redo();
    expect(h.editor.page.viewBox).toBe(fitted);
  });

  it('undoing a tidy that grew the page shrinks it back', () => {
    const page = scene();
    page.nodes.push({ id: 'far', type: 'router', x: 300, y: 300, label: 'F' });
    page.viewBox = '0 0 400 400';
    const h = harness(page);
    h.editor.tidy();
    const grown = h.editor.page.viewBox;
    expect(grown).not.toBe('0 0 400 400');
    h.editor.undo();
    expect(h.editor.page.viewBox).toBe('0 0 400 400');
    h.editor.redo();
    expect(h.editor.page.viewBox).toBe(grown);
  });

  it('settings that are part of history still undo', () => {
    const h = harness(scene());
    h.editor.updatePageProps({ caption: 'Step 1' });
    h.editor.renamePage('Renamed');
    h.editor.undo();
    expect(h.editor.page.caption).toBeUndefined();
    expect(h.editor.page.name).toBe('Renamed');
  });
});
