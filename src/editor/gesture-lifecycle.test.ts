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
