/**
 * Bend (waypoint) handles on the selected link: the "+" handle on each
 * segment adds a bend when it is DRAGGED, a square handle moves an existing
 * bend, a double-click on a square removes it. A plain click on any of them
 * changes nothing.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Page } from '../pages/model.js';
import { Editor } from './editor.js';
import {
  blankPage,
  fakeSvg,
  harness,
  installEditorGlobals,
  pointer,
} from './test-harness.js';

beforeAll(installEditorGlobals);

function linkPage(): Page {
  const page = blankPage();
  page.nodes.push(
    { id: 'a', type: 'ec', x: 100, y: 100, label: 'A' },
    { id: 'b', type: 'ec', x: 500, y: 100, label: 'B' },
  );
  page.links.push({ id: 'ab', type: 'line', from: 'a', to: 'b' });
  return page;
}

/** The "+" handle of a straight a → b link sits on its midpoint. */
const PLUS = { x: 300, y: 100 };

describe('the "+" handle adds a bend only when dragged (LNK-09)', () => {
  it('a plain click on "+" changes nothing', () => {
    const h = harness(linkPage());
    h.editor.focusLink('ab');
    h.editor.takePendingOperations();
    const changes = h.changes.count;
    h.click(PLUS.x, PLUS.y);
    expect(h.editor.page.links[0]!.waypoints).toBeUndefined();
    expect(h.editor.canUndo()).toBe(false);
    expect(h.editor.takePendingOperations()).toEqual([]);
    expect(h.changes.count).toBe(changes);
    expect(h.editor.getSelectedLink()?.id).toBe('ab');
  });

  it('a press that only jitters by a couple of pixels adds nothing', () => {
    const h = harness(linkPage());
    h.editor.focusLink('ab');
    h.down(PLUS.x, PLUS.y);
    h.move(PLUS.x + 2, PLUS.y + 1);
    h.up(PLUS.x + 2, PLUS.y + 1);
    expect(h.editor.page.links[0]!.waypoints).toBeUndefined();
    expect(h.editor.canUndo()).toBe(false);
  });

  it('dragging "+" inserts one bend that follows the pointer, as one undo step', () => {
    const h = harness(linkPage());
    h.editor.focusLink('ab');
    h.drag(PLUS, { x: 300, y: 180 });
    expect(h.editor.page.links[0]!.waypoints).toEqual([{ x: 300, y: 180 }]);
    expect(h.editor.historyDepth()).toBe(1);
    h.editor.undo();
    expect(h.editor.page.links[0]!.waypoints).toBeUndefined();
  });

  it('a second bend goes into the segment whose "+" was dragged', () => {
    const page = linkPage();
    page.links[0]!.waypoints = [{ x: 300, y: 200 }];
    const h = harness(page);
    h.editor.focusLink('ab');
    // Second segment: (300,200) → b (500,100); its "+" is at (400,150).
    h.drag({ x: 400, y: 150 }, { x: 420, y: 60 });
    expect(page.links[0]!.waypoints).toEqual([
      { x: 300, y: 200 },
      { x: 420, y: 60 },
    ]);
  });

  it('a double-click on "+" opens the link label editor and adds no bend', () => {
    const h = harness(linkPage());
    h.editor.focusLink('ab');
    h.click(PLUS.x, PLUS.y);
    h.click(PLUS.x, PLUS.y);
    expect(h.requests.map((r) => [r.kind, r.id])).toEqual([['link', 'ab']]);
    expect(h.editor.page.links[0]!.waypoints).toBeUndefined();
    expect(h.editor.canUndo()).toBe(false);
  });
});

describe('existing bend handles', () => {
  function bentPage(): Page {
    const page = linkPage();
    // Deliberately off the 20-unit grid: a stray snap would show.
    page.links[0]!.waypoints = [{ x: 305, y: 193 }];
    return page;
  }

  it('a click on a bend handle does not move it', () => {
    const h = harness(bentPage());
    h.editor.focusLink('ab');
    h.down(305, 193);
    h.move(306, 194);
    h.up(306, 194);
    expect(h.editor.page.links[0]!.waypoints).toEqual([{ x: 305, y: 193 }]);
    expect(h.editor.canUndo()).toBe(false);
  });

  it('dragging a bend handle moves it (snapped), as one undo step', () => {
    const h = harness(bentPage());
    h.editor.focusLink('ab');
    h.drag({ x: 305, y: 193 }, { x: 341, y: 262 });
    expect(h.editor.page.links[0]!.waypoints).toEqual([{ x: 340, y: 260 }]);
    expect(h.editor.historyDepth()).toBe(1);
  });

  it('a double-click on a bend handle removes the bend', () => {
    const h = harness(bentPage());
    h.editor.focusLink('ab');
    h.click(305, 193);
    h.click(305, 193);
    expect(h.editor.page.links[0]!.waypoints).toBeUndefined();
    expect(h.requests).toEqual([]);
  });

  it('the shell is told when a bend is added, moved or removed', () => {
    // The inspector shows the bend count and a "straighten" button: it
    // re-renders on the link-selection callback.
    const page = bentPage();
    const overlay = fakeSvg();
    let refreshes = 0;
    const editor = new Editor(
      fakeSvg(),
      overlay,
      page,
      () => {},
      () => {},
      () => refreshes++,
    );
    const fire = (type: string, x: number, y: number, buttons = 1): void =>
      overlay.fire(type, pointer(x, y, { buttons }));
    editor.focusLink('ab');
    refreshes = 0;
    fire('pointerdown', 305, 193);
    fire('pointermove', 320, 240);
    fire('pointerup', 320, 240, 0);
    expect(refreshes).toBe(1);
    fire('pointerdown', 320, 240);
    fire('pointerup', 320, 240, 0);
    fire('pointerdown', 320, 240);
    fire('pointerup', 320, 240, 0);
    expect(page.links[0]!.waypoints).toBeUndefined();
    expect(refreshes).toBe(2);
  });
});

describe('"+" handles sit on the route as drawn', () => {
  /** Tell the editor what the art layer "rendered" for a link. */
  function setShape(
    h: ReturnType<typeof harness>,
    id: string,
    shape: { x: number; y: number }[][],
  ): void {
    (
      h.editor as unknown as {
        linkShapes: Map<string, { x: number; y: number }[][] | null>;
      }
    ).linkShapes.set(id, shape);
  }
  const plusHandles = (h: ReturnType<typeof harness>): [number, number][] =>
    [
      ...h.overlay.innerHTML.matchAll(
        /data-wp-add="\d+" cx="([-\d.]+)" cy="([-\d.]+)"/g,
      ),
    ].map((m) => [Number(m[1]), Number(m[2])]);

  it('an orthogonal route carries its "+" on the drawn elbow path, not the diagonal', () => {
    const page = linkPage();
    page.nodes[1]!.y = 300; // a (100,100) → b (500,300)
    page.links[0]!.lineStyle = 'orthogonal';
    const h = harness(page);
    h.editor.focusLink('ab');
    // Drawn as right 200, down 200, right 200 (600 long): halfway is on the
    // vertical leg at (300,200). The straight diagonal's midpoint happens
    // to coincide, so shift the elbow to make them differ.
    setShape(h, 'ab', [
      [
        { x: 128, y: 100 },
        { x: 400, y: 100 },
        { x: 400, y: 300 },
        { x: 472, y: 300 },
      ],
    ]);
    h.editor.redrawOverlay();
    // 272 + 200 + 72 = 544 long; halfway (272) is the first corner.
    expect(plusHandles(h)).toEqual([[400, 100]]);
    // Dragging from there adds the bend.
    h.drag({ x: 400, y: 100 }, { x: 440, y: 60 });
    expect(page.links[0]!.waypoints).toEqual([{ x: 440, y: 60 }]);
  });

  it('with bends, each "+" sits on the drawn route between its two ends', () => {
    const page = linkPage(); // a (100,100) → wp (300,200) → b (500,100)
    page.links[0]!.waypoints = [{ x: 300, y: 200 }];
    page.links[0]!.lineStyle = 'orthogonal';
    const h = harness(page);
    h.editor.focusLink('ab');
    setShape(h, 'ab', [
      [
        { x: 128, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 200 },
        { x: 500, y: 200 },
        { x: 500, y: 118 },
      ],
    ]);
    h.editor.redrawOverlay();
    // First segment runs 172 right then 100 down (272): halfway is (264,100).
    // Second runs 200 right then 82 up (282): halfway is (441,200).
    expect(plusHandles(h)).toEqual([
      [264, 100],
      [441, 200],
    ]);
  });

  it('falls back to segment midpoints when the route cannot be measured', () => {
    const h = harness(linkPage());
    h.editor.focusLink('ab');
    expect(plusHandles(h)).toEqual([[300, 100]]);
  });
});
