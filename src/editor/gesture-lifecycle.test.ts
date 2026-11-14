/**
 * How a pointer gesture ends when it does not end with an ordinary release.
 *
 * - The release never reaches the page (the button came up over another
 *   window): the next pointermove has no button down, the window blurred, or
 *   the overlay lost pointer capture. The gesture is settled where it was.
 * - The system aborted the pointer (`pointercancel`), or the user pressed
 *   Escape: the gesture is taken back as if it had never started.
 * - Only the primary button starts a gesture at all.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Page } from '../pages/model.js';
import {
  blankPage,
  fireWindow,
  harness,
  installEditorGlobals,
  pointer,
  type Harness,
} from './test-harness.js';

beforeAll(installEditorGlobals);

function scene(): Page {
  const page = blankPage();
  page.nodes.push(
    { id: 'a', type: 'router', x: 300, y: 300, label: 'A' },
    { id: 'b', type: 'router', x: 600, y: 300, label: 'B' },
    { id: 'c', type: 'server', x: 460, y: 500, label: 'C' },
  );
  page.links.push(
    { id: 'ab', type: 'line', from: 'a', to: 'b', label: 'core' },
    { id: 'bc', type: 'line', from: 'b', to: 'c' },
  );
  return page;
}

const posA = (h: Harness): [number, number] => [
  h.editor.page.nodes[0]!.x,
  h.editor.page.nodes[0]!.y,
];

/** Press node a and drag it 80 right / 60 down, without releasing. */
function startNodeDrag(h: Harness): void {
  h.move(300, 300, { buttons: 0 });
  h.down(300, 300);
  h.move(340, 330);
  h.move(380, 360);
}

/** The ways a release can go missing. */
const missedRelease: [string, (h: Harness) => void][] = [
  [
    'a pointermove with no button down',
    (h) => h.move(700, 600, { buttons: 0 }),
  ],
  ['the window losing focus', () => fireWindow('blur')],
  [
    'the overlay losing pointer capture',
    (h) =>
      h.overlay.fire('lostpointercapture', pointer(380, 360, { buttons: 0 })),
  ],
];

describe('a release that never arrives settles the gesture (CODE-13)', () => {
  for (const [name, lose] of missedRelease) {
    it(`node drag: ${name} drops the node where it was`, () => {
      const h = harness(scene());
      startNodeDrag(h);
      h.editor.takePendingOperations();
      lose(h);
      expect(posA(h)).toEqual([380, 360]);
      // Committed like a release: one undo step, the move published.
      expect(h.editor.historyDepth()).toBe(1);
      expect(h.editor.takePendingOperations()).toMatchObject([
        { type: 'element.patch', elementId: 'a', patch: { set: { x: 380 } } },
      ]);
      expect(h.changes.count).toBe(1);
      // The pointer now only hovers: the node no longer follows it.
      h.move(800, 650, { buttons: 0 });
      h.move(820, 660, { buttons: 0 });
      expect(posA(h)).toEqual([380, 360]);
      h.editor.undo();
      expect(posA(h)).toEqual([300, 300]);
    });

    it(`marquee: ${name} ends the rubber band`, () => {
      const h = harness(scene());
      h.down(240, 240);
      h.move(400, 360);
      lose(h);
      expect(h.overlay.innerHTML).not.toContain('stroke-dasharray="5 4"');
      expect(h.editor.selectedNodeIds()).toEqual(['a']);
      h.move(700, 400, { buttons: 0 });
      expect(h.editor.selectedNodeIds()).toEqual(['a']);
    });

    it(`link drag from a dot: ${name} creates no link`, () => {
      const h = harness(scene());
      h.move(300, 300, { buttons: 0 });
      h.down(318, 300); // right-hand connection dot of a
      h.move(400, 300);
      h.move(600, 300); // over node b
      lose(h);
      expect(h.editor.page.links).toHaveLength(2);
      h.up(600, 300);
      expect(h.editor.page.links).toHaveLength(2);
    });

    it(`bend drag: ${name} keeps the bend where it was dragged`, () => {
      const h = harness(scene());
      h.editor.focusLink('ab');
      h.down(450, 300); // the "+" handle
      h.move(450, 340);
      h.move(450, 380);
      lose(h);
      expect(h.editor.page.links[0]!.waypoints).toEqual([{ x: 460, y: 380 }]);
      h.move(700, 600, { buttons: 0 });
      expect(h.editor.page.links[0]!.waypoints).toEqual([{ x: 460, y: 380 }]);
      expect(h.editor.historyDepth()).toBe(1);
    });

    it(`pan: ${name} stops panning`, () => {
      const h = harness(scene());
      h.down(500, 500, { button: 1, buttons: 4 });
      h.move(520, 520, { buttons: 4 });
      const view = h.editor.getView();
      lose(h);
      h.move(700, 300, { buttons: 0 });
      expect(h.editor.getView()).toEqual(view);
    });
  }
});

describe('pointercancel takes the gesture back (CODE-13)', () => {
  const cancel = (h: Harness): void =>
    h.overlay.fire('pointercancel', pointer(380, 360, { buttons: 0 }));

  it('a cancelled node drag puts the node back and leaves no history', () => {
    const h = harness(scene());
    startNodeDrag(h);
    cancel(h);
    expect(posA(h)).toEqual([300, 300]);
    expect(h.editor.canUndo()).toBe(false);
    expect(h.editor.takePendingOperations()).toEqual([]);
    h.move(700, 600, { buttons: 0 });
    expect(posA(h)).toEqual([300, 300]);
    // The node is still selected and can be dragged again.
    expect(h.editor.getSelectedNode()?.id).toBe('a');
    h.drag({ x: 300, y: 300 }, { x: 400, y: 300 });
    expect(posA(h)).toEqual([400, 300]);
  });

  it('a cancelled drag keeps the redo stack it found', () => {
    const h = harness(scene());
    h.editor.focusNode('b');
    h.editor.nudge(20, 0);
    h.editor.undo();
    expect(h.editor.canRedo()).toBe(true);
    startNodeDrag(h);
    cancel(h);
    expect(h.editor.canRedo()).toBe(true);
    h.editor.redo();
    expect(h.editor.page.nodes[1]!.x).toBe(620);
  });

  it('a cancelled bend insert leaves the link straight', () => {
    const h = harness(scene());
    h.editor.focusLink('ab');
    h.down(450, 300);
    h.move(450, 340);
    h.move(450, 380);
    cancel(h);
    expect(h.editor.page.links[0]!.waypoints).toBeUndefined();
    expect(h.editor.canUndo()).toBe(false);
  });

  it('a cancelled link drag creates nothing', () => {
    const h = harness(scene());
    h.move(300, 300, { buttons: 0 });
    h.down(318, 300);
    h.move(600, 300);
    cancel(h);
    h.up(600, 300);
    expect(h.editor.page.links).toHaveLength(2);
  });

  it('Escape (clearSelection) cancels a drag in flight and keeps the selection', () => {
    const h = harness(scene());
    startNodeDrag(h);
    h.editor.clearSelection();
    expect(posA(h)).toEqual([300, 300]);
    expect(h.editor.canUndo()).toBe(false);
    expect(h.editor.getSelectedNode()?.id).toBe('a');
    // With nothing in flight, Escape clears the selection as before.
    h.editor.clearSelection();
    expect(h.editor.getSelectedNode()).toBeNull();
  });
});

describe('only the primary button starts a gesture (CODE-14)', () => {
  const right = { button: 2, buttons: 2 };

  it('a right-button press-drag-release does not move a node', () => {
    const h = harness(scene());
    h.down(300, 300, right);
    h.move(340, 330, right);
    h.move(380, 360, right);
    h.up(380, 360, { button: 2 });
    expect(posA(h)).toEqual([300, 300]);
    expect(h.editor.canUndo()).toBe(false);
  });

  it('a right-button press starts no marquee and changes no selection', () => {
    const h = harness(scene());
    h.editor.focusNode('b');
    h.down(800, 600, right);
    h.move(200, 200, right);
    h.up(200, 200, { button: 2 });
    expect(h.editor.selectedNodeIds()).toEqual(['b']);
  });

  it('the anchor tool drops nothing on a right-click', () => {
    const h = harness(scene());
    h.editor.setTool('anchor');
    h.down(800, 600, right);
    h.up(800, 600, { button: 2 });
    expect(h.editor.page.anchors).toHaveLength(0);
  });

  it('the link tool does not arm its source on a right-click', () => {
    const h = harness(scene());
    h.editor.setTool('link');
    h.down(300, 300, right);
    h.up(300, 300, { button: 2 });
    h.click(460, 500); // one left click on c
    expect(h.editor.page.links).toHaveLength(2);
  });

  it('a right-click on one of several selected links keeps them all', () => {
    const h = harness(scene());
    h.click(450, 300); // link ab
    h.click(530, 400, { ctrlKey: true }); // + link bc
    expect(h.editor.selectedLinkIds()).toEqual(['ab', 'bc']);
    // The press, then the shell's context-menu pick at the same point.
    h.down(530, 400, right);
    h.up(530, 400, { button: 2 });
    expect(h.editor.pickAt(530, 400)).toEqual({ kind: 'link', id: 'bc' });
    expect(h.editor.selectedLinkIds().sort()).toEqual(['ab', 'bc']);
    // The link under the pointer is the one the menu and inspector act on.
    expect(h.editor.getSelectedLink()?.id).toBe('bc');
    h.editor.deleteSelected();
    expect(h.editor.page.links).toHaveLength(0);
  });

  it('a right-click on an unselected link selects just that link', () => {
    const h = harness(scene());
    h.click(450, 300);
    expect(h.editor.pickAt(530, 400)).toEqual({ kind: 'link', id: 'bc' });
    expect(h.editor.selectedLinkIds()).toEqual(['bc']);
  });

  it('a right-click on one of several selected nodes keeps them all', () => {
    const h = harness(scene());
    h.click(300, 300);
    h.click(600, 300, { shiftKey: true });
    h.down(600, 300, right);
    h.up(600, 300, { button: 2 });
    expect(h.editor.pickAt(600, 300)).toEqual({ kind: 'node', id: 'b' });
    expect(h.editor.selectedNodeIds()).toEqual(['a', 'b']);
  });
});

describe('a right-click keeps a selection it lands on (CODE-14)', () => {
  function withAnchorAndZone(): Harness {
    const page = scene();
    page.anchors.push({ id: 'an1', x: 800, y: 500 });
    page.zones.push({ id: 'z1', label: 'Zone', nodes: ['a', 'b'] });
    return harness(page);
  }

  it('an anchor in a selected block keeps the block, with the node menu', () => {
    const h = withAnchorAndZone();
    h.click(460, 500); // node c
    h.click(800, 500, { shiftKey: true }); // + the anchor
    expect(h.editor.selectionCount()).toBe(2);
    expect(h.editor.pickAt(800, 500)).toEqual({ kind: 'node', id: 'c' });
    expect(h.editor.selectionCount()).toBe(2);
  });

  it('an unselected anchor becomes the selection', () => {
    const h = withAnchorAndZone();
    h.click(300, 300);
    expect(h.editor.pickAt(800, 500)).toEqual({ kind: 'empty', id: null });
    expect(h.editor.getSelectedAnchor()?.id).toBe('an1');
    expect(h.editor.selectedNodeIds()).toEqual([]);
  });

  it('inside the selected zone the zone stays selected', () => {
    const h = withAnchorAndZone();
    h.editor.selectZone('z1');
    expect(h.editor.pickAt(450, 262)).toEqual({ kind: 'empty', id: null });
    expect(h.editor.getSelectedZone()?.id).toBe('z1');
  });

  it('on empty canvas everything is deselected, a zone included', () => {
    const h = withAnchorAndZone();
    h.editor.selectZone('z1');
    expect(h.editor.pickAt(850, 650)).toEqual({ kind: 'empty', id: null });
    expect(h.editor.getSelectedZone()).toBeNull();
  });
});

describe('a second finger takes the first finger’s drag back', () => {
  const finger = (id: number) => ({ pointerType: 'touch', pointerId: id });

  it('the dragged node returns, with no history, and the pinch zooms', () => {
    const h = harness(scene());
    h.down(300, 300, finger(11)); // finger 1 on node a
    h.move(333, 322, finger(11));
    h.move(361, 348, finger(11));
    expect(posA(h)).not.toEqual([300, 300]); // moving live under the finger
    h.down(500, 500, finger(12)); // finger 2 lands: this is a pinch now
    expect(posA(h)).toEqual([300, 300]);
    expect(h.editor.canUndo()).toBe(false);
    expect(h.editor.takePendingOperations()).toEqual([]);
    // Spreading the fingers zooms in (the view narrows); nothing moves.
    const before = h.editor.getView().w;
    h.move(600, 600, finger(12));
    expect(h.editor.getView().w).toBeLessThan(before);
    h.up(600, 600, finger(12));
    h.up(361, 348, finger(11));
    expect(posA(h)).toEqual([300, 300]);
    expect(h.editor.canUndo()).toBe(false);
    expect(h.changes.count).toBe(0);
  });

  it('a rubber band started by the first finger is dropped', () => {
    const h = harness(scene());
    h.down(240, 240, finger(11));
    h.move(400, 360, finger(11));
    h.down(700, 600, finger(12));
    h.up(700, 600, finger(12));
    h.up(400, 360, finger(11));
    expect(h.editor.selectedNodeIds()).toEqual([]);
    expect(h.overlay.innerHTML).not.toContain('stroke-dasharray="5 4"');
  });
});
