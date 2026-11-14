/**
 * What "locked" protects. A locked node is not moved by Align / Distribute
 * (nor by drag or nudge, as before) and is not removed by Delete; a locked
 * link takes no bend or endpoint edits and is not removed by Delete either.
 * Ctrl+L toggles everything selected.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Page, TopologyDocument } from '../pages/model.js';
import { applyOperations, diffDocuments } from '../workspace/operations.js';
import {
  blankPage,
  harness,
  installEditorGlobals,
  type Harness,
} from './test-harness.js';

beforeAll(installEditorGlobals);

/** Four routers on an uneven diagonal; `locked` names the ones that are locked. */
function row(...locked: string[]): Page {
  const page = blankPage();
  const at: [string, number, number][] = [
    ['a', 100, 100],
    ['b', 180, 240],
    ['c', 420, 300],
    ['d', 700, 520],
  ];
  for (const [id, x, y] of at)
    page.nodes.push({
      id,
      type: 'router',
      x,
      y,
      label: id,
      ...(locked.includes(id) ? { locked: true } : {}),
    });
  return page;
}

const xs = (h: Harness): number[] => h.editor.page.nodes.map((n) => n.x);
const ys = (h: Harness): number[] => h.editor.page.nodes.map((n) => n.y);

describe('align and distribute skip locked nodes (CAN-15 / LNK-15)', () => {
  it('align moves the others and leaves a locked node where it is', () => {
    const h = harness(row('c'));
    h.editor.selectAll();
    h.editor.alignSelection('left');
    expect(xs(h)).toEqual([100, 100, 420, 100]);
    h.editor.alignSelection('bottom');
    expect(ys(h)).toEqual([520, 520, 300, 520]);
  });

  it('the others line up with a locked node that marks the edge', () => {
    const h = harness(row('a'));
    h.editor.selectAll();
    h.editor.alignSelection('left'); // a is the leftmost, and locked
    expect(xs(h)).toEqual([100, 100, 100, 100]);
  });

  it('distribute spreads the unlocked nodes between the fixed ones', () => {
    // a and d are the ends; c is locked at x = 420 and acts as a post:
    // b goes halfway between a and c.
    const h = harness(row('c'));
    h.editor.selectAll();
    h.editor.distributeSelection('h');
    expect(xs(h)).toEqual([100, 260, 420, 700]);
  });

  it('without locked nodes distribute spaces them evenly, as before', () => {
    const h = harness(row());
    h.editor.selectAll();
    h.editor.distributeSelection('h');
    expect(xs(h)).toEqual([100, 300, 500, 700]);
    h.editor.distributeSelection('v');
    expect(ys(h)).toEqual([100, 240, 380, 520]);
  });

  it('a locked end node is a fixed end like any other', () => {
    const h = harness(row('a', 'd'));
    h.editor.selectAll();
    h.editor.distributeSelection('h');
    expect(xs(h)).toEqual([100, 300, 500, 700]);
  });

  it('with nothing free to move, no undo step is pushed', () => {
    const h = harness(row('a', 'b', 'c', 'd'));
    h.editor.selectAll();
    h.editor.alignSelection('left');
    h.editor.distributeSelection('v');
    expect(xs(h)).toEqual([100, 180, 420, 700]);
    expect(h.editor.canUndo()).toBe(false);
  });

  it('emits patches for the nodes that moved only, reproducing the diff', () => {
    const wrap = (page: Page): TopologyDocument => ({
      title: 'T',
      customNodes: [],
      pages: [structuredClone(page)],
    });
    for (const run of [
      (h: Harness) => h.editor.alignSelection('left'),
      (h: Harness) => h.editor.distributeSelection('h'),
    ]) {
      const h = harness(row('c'));
      h.editor.selectAll();
      h.editor.takePendingOperations();
      const before = wrap(h.editor.page);
      run(h);
      const after = wrap(h.editor.page);
      const emitted = h.editor.takePendingOperations();
      expect(emitted.length).toBeGreaterThan(0);
      expect(JSON.stringify(emitted)).not.toContain('"elementId":"c"');
      expect(applyOperations(before, emitted)).toEqual(
        applyOperations(before, diffDocuments(before, after)),
      );
    }
  });
});

/* ── Delete ──────────────────────────────────────────────────────────────── */

function linked(): Page {
  const page = row('c');
  page.links.push(
    { id: 'ab', type: 'line', from: 'a', to: 'b' },
    { id: 'bc', type: 'line', from: 'b', to: 'c', locked: true },
    { id: 'cd', type: 'line', from: 'c', to: 'd', locked: true },
  );
  return page;
}

const nodeIds = (h: Harness): string[] => h.editor.page.nodes.map((n) => n.id);
const linkIds = (h: Harness): string[] => h.editor.page.links.map((l) => l.id);

describe('Delete leaves locked elements on the page (CAN-15)', () => {
  it('a locked node survives Delete and stays selected', () => {
    const h = harness(linked());
    h.editor.focusNode('a');
    h.click(420, 300, { shiftKey: true }); // + locked c
    h.editor.deleteSelected();
    expect(nodeIds(h)).toEqual(['b', 'c', 'd']);
    // It stays selected, so it is plain why it is still there.
    expect(h.editor.selectedNodeIds()).toEqual(['c']);
    h.editor.undo();
    expect(nodeIds(h)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('Delete on locked elements only does nothing at all', () => {
    const h = harness(linked());
    h.editor.focusNode('c');
    h.editor.deleteSelected();
    h.editor.focusLink('cd');
    h.editor.deleteSelected();
    expect(nodeIds(h)).toEqual(['a', 'b', 'c', 'd']);
    expect(linkIds(h)).toEqual(['ab', 'bc', 'cd']);
    expect(h.editor.canUndo()).toBe(false);
  });

  it('of several selected links the locked ones stay', () => {
    const h = harness(linked());
    h.click(140, 170); // ab: a (100,100) → b (180,240)
    h.click(300, 270, { ctrlKey: true }); // + bc: b (180,240) → c (420,300)
    expect(h.editor.selectedLinkIds()).toEqual(['ab', 'bc']);
    h.editor.deleteSelected();
    expect(linkIds(h)).toEqual(['bc', 'cd']);
    expect(h.editor.selectedLinkIds()).toEqual(['bc']);
  });

  it('a locked link still goes with an endpoint that is deleted', () => {
    const h = harness(linked());
    h.editor.focusNode('d'); // not locked; cd is
    h.editor.deleteSelected();
    expect(nodeIds(h)).toEqual(['a', 'b', 'c']);
    expect(linkIds(h)).toEqual(['ab', 'bc']);
  });

  it('cut copies a locked node but leaves it where it is', () => {
    const h = harness(linked());
    h.editor.selectAll();
    h.editor.cut();
    expect(nodeIds(h)).toEqual(['c']);
    h.editor.paste();
    expect(h.editor.page.nodes).toHaveLength(5);
  });

  it('unlocking makes it deletable again', () => {
    const h = harness(linked());
    h.editor.focusNode('c');
    h.editor.toggleLock();
    h.editor.deleteSelected();
    expect(nodeIds(h)).toEqual(['a', 'b', 'd']);
  });
});

/* ── locked links ────────────────────────────────────────────────────────── */

function bent(locked: boolean): Page {
  const page = blankPage();
  page.nodes.push(
    { id: 'a', type: 'router', x: 100, y: 100, label: 'A' },
    { id: 'b', type: 'router', x: 500, y: 100, label: 'B' },
    { id: 'c', type: 'router', x: 300, y: 400, label: 'C' },
  );
  page.links.push(
    {
      id: 'ab',
      type: 'line',
      from: 'a',
      to: 'b',
      waypoints: [{ x: 300, y: 200 }],
      ...(locked ? { locked: true } : {}),
    },
    { id: 'bc', type: 'line', from: 'b', to: 'c' },
  );
  return page;
}

describe('a locked link takes no bend or endpoint edits (LNK-15)', () => {
  it('shows no bend, "+" or end handles when selected', () => {
    const unlocked = harness(bent(false));
    unlocked.editor.focusLink('ab');
    expect(unlocked.overlay.innerHTML).toContain('data-wp-add=');
    expect(unlocked.overlay.innerHTML).toContain('data-wp="0"');
    expect(unlocked.overlay.innerHTML).toContain('data-link-end=');

    const h = harness(bent(true));
    h.editor.focusLink('ab');
    expect(h.overlay.innerHTML).not.toContain('data-wp-add=');
    expect(h.overlay.innerHTML).not.toContain('data-wp="0"');
    expect(h.overlay.innerHTML).not.toContain('data-link-end=');
  });

  it('its bend cannot be dragged', () => {
    const h = harness(bent(true));
    h.editor.focusLink('ab');
    h.drag({ x: 300, y: 200 }, { x: 300, y: 300 });
    expect(h.editor.page.links[0]!.waypoints).toEqual([{ x: 300, y: 200 }]);
  });

  it('no bend can be added where a "+" handle would be', () => {
    const h = harness(bent(true));
    h.editor.focusLink('ab');
    // Midpoint of the first segment a (100,100) → bend (300,200).
    h.drag({ x: 200, y: 150 }, { x: 200, y: 260 });
    expect(h.editor.page.links[0]!.waypoints).toEqual([{ x: 300, y: 200 }]);
    expect(h.editor.canUndo()).toBe(false);
  });

  it('a double-click on its bend does not remove it', () => {
    const h = harness(bent(true));
    h.editor.focusLink('ab');
    h.click(300, 200);
    h.click(300, 200);
    expect(h.editor.page.links[0]!.waypoints).toEqual([{ x: 300, y: 200 }]);
  });

  it('straighten leaves it alone and is not offered', () => {
    const h = harness(bent(true));
    h.editor.focusLink('ab');
    expect(h.editor.selectedLinkHasBends()).toBe(false);
    h.editor.straightenLink();
    expect(h.editor.page.links[0]!.waypoints).toEqual([{ x: 300, y: 200 }]);
    expect(h.editor.canUndo()).toBe(false);
  });

  it('an unlocked link still bends, straightens and loses bends as before', () => {
    const h = harness(bent(false));
    h.editor.focusLink('ab');
    expect(h.editor.selectedLinkHasBends()).toBe(true);
    h.drag({ x: 300, y: 200 }, { x: 300, y: 300 });
    expect(h.editor.page.links[0]!.waypoints).toEqual([{ x: 300, y: 300 }]);
    h.editor.straightenLink();
    expect(h.editor.page.links[0]!.waypoints).toBeUndefined();
  });
});

describe('Ctrl+L toggles every selected link (LNK-15)', () => {
  function twoLinks(): Harness {
    const h = harness(bent(false));
    h.editor.focusLink('ab');
    h.click(400, 250, { ctrlKey: true }); // + bc: b (500,100) → c (300,400)
    expect(h.editor.selectedLinkIds()).toEqual(['ab', 'bc']);
    return h;
  }
  const locks = (h: Harness): boolean[] =>
    h.editor.page.links.map((l) => l.locked === true);

  it('locks them all, as one undo step', () => {
    const h = twoLinks();
    expect(h.editor.selectionLocked()).toBe(false);
    h.editor.toggleLock();
    expect(locks(h)).toEqual([true, true]);
    expect(h.editor.selectionLocked()).toBe(true);
    h.editor.undo();
    expect(locks(h)).toEqual([false, false]);
  });

  it('a mixed selection locks the rest; all locked unlocks all', () => {
    const h = twoLinks();
    h.editor.page.links[1]!.locked = true;
    expect(h.editor.selectionLocked()).toBe(false);
    h.editor.toggleLock();
    expect(locks(h)).toEqual([true, true]);
    h.editor.toggleLock();
    expect(locks(h)).toEqual([false, false]);
  });

  it('emits a patch per link, reproducing the snapshot diff', () => {
    const h = twoLinks();
    h.editor.takePendingOperations();
    const wrap = (page: Page): TopologyDocument => ({
      title: 'T',
      customNodes: [],
      pages: [structuredClone(page)],
    });
    const before = wrap(h.editor.page);
    h.editor.toggleLock();
    const after = wrap(h.editor.page);
    const emitted = h.editor.takePendingOperations();
    expect(emitted).toHaveLength(2);
    expect(applyOperations(before, emitted)).toEqual(
      applyOperations(before, diffDocuments(before, after)),
    );
  });
});
