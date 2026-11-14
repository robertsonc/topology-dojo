/**
 * The selection model: nodes and anchors select together (they drag, nudge
 * and delete as one block); links and a zone are each their own family.
 * Exactly one family is selected at a time, whatever was used to select it,
 * so Delete and the inspector always agree with what the overlay shows.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Page } from '../pages/model.js';
import type { Editor } from './editor.js';
import {
  blankPage,
  fakeSvg,
  harness,
  installEditorGlobals,
  pointer,
  type Harness,
} from './test-harness.js';
import { Editor as EditorClass } from './editor.js';

beforeAll(installEditorGlobals);

function scene(): Page {
  const page = blankPage();
  page.nodes.push(
    { id: 'a', type: 'router', x: 300, y: 300, label: 'A' },
    { id: 'b', type: 'router', x: 600, y: 300, label: 'B' },
    { id: 'c', type: 'server', x: 450, y: 500, label: 'C' },
  );
  page.links.push(
    { id: 'ab', type: 'line', from: 'a', to: 'b' },
    { id: 'bc', type: 'line', from: 'b', to: 'c' },
    { id: 'c-an', type: 'line', from: 'c', to: 'an1' },
  );
  page.anchors.push({ id: 'an1', x: 450, y: 620 });
  page.zones.push({ id: 'z1', label: 'Zone', nodes: ['a', 'b'] });
  return page;
}

/** What is selected, by family (read straight from the editor's stores). */
function selected(editor: Editor): {
  nodes: string[];
  anchors: string[];
  links: string[];
  zone: string | null;
} {
  const priv = editor as unknown as {
    sel: Set<string>;
    selAnchors: Set<string>;
  };
  return {
    nodes: [...priv.sel].sort(),
    anchors: [...priv.selAnchors].sort(),
    links: editor.selectedLinkIds(),
    zone: editor.getSelectedZone()?.id ?? null,
  };
}

/** How many families hold something: the invariant is "at most one". */
function families(editor: Editor): number {
  const s = selected(editor);
  return (
    (s.nodes.length + s.anchors.length > 0 ? 1 : 0) +
    (s.links.length > 0 ? 1 : 0) +
    (s.zone !== null ? 1 : 0)
  );
}

const ids = (editor: Editor) => ({
  nodes: editor.page.nodes.map((n) => n.id),
  links: editor.page.links.map((l) => l.id),
  anchors: editor.page.anchors.map((a) => a.id),
  zones: editor.page.zones.map((z) => z.id),
});

/** Points on the scene (identity mapping: client = page). */
const ON_LINK_AB = { x: 450, y: 300 };
const ON_LINK_BC = { x: 525, y: 400 };
const IN_ZONE = { x: 450, y: 262 };
const EMPTY = { x: 850, y: 600 };

describe('Delete removes exactly what is selected (CODE-05)', () => {
  it('adding a node replaces a link selection', () => {
    const h = harness(scene());
    h.click(ON_LINK_AB.x, ON_LINK_AB.y);
    expect(selected(h.editor).links).toEqual(['ab']);
    h.editor.addNode('router');
    expect(selected(h.editor)).toMatchObject({ links: [], zone: null });
    expect(h.editor.selectionCount()).toBe(1);
    h.editor.deleteSelected();
    expect(ids(h.editor)).toEqual(ids(harness(scene()).editor));
  });

  it('duplicating a block selects the copies, not the original anchor', () => {
    const h = harness(scene());
    h.drag({ x: 380, y: 440 }, { x: 520, y: 660 }); // node c + anchor an1
    expect(selected(h.editor)).toMatchObject({
      nodes: ['c'],
      anchors: ['an1'],
    });
    h.editor.duplicateSelection();
    expect(selected(h.editor).anchors).not.toContain('an1');
    h.editor.deleteSelected();
    expect(ids(h.editor)).toEqual(ids(harness(scene()).editor));
  });

  it('jumping to a node drops a selected zone', () => {
    const h = harness(scene());
    h.click(IN_ZONE.x, IN_ZONE.y);
    expect(selected(h.editor).zone).toBe('z1');
    h.editor.focusNode('c');
    expect(selected(h.editor)).toEqual({
      nodes: ['c'],
      anchors: [],
      links: [],
      zone: null,
    });
    h.editor.deleteSelected();
    expect(ids(h.editor).zones).toEqual(['z1']);
    expect(ids(h.editor).nodes).toEqual(['a', 'b']);
  });

  it('pressing a node’s connection dot drops a link selection', () => {
    const h = harness(scene());
    h.click(ON_LINK_BC.x, ON_LINK_BC.y);
    // Hover node a, then press its right-hand dot without dragging.
    h.move(300, 300, { buttons: 0 });
    h.click(318, 300);
    expect(selected(h.editor)).toMatchObject({ nodes: ['a'], links: [] });
    h.editor.deleteSelected();
    expect(ids(h.editor).links).toContain('bc');
  });

  it('a click on empty canvas clears every family', () => {
    for (const select of [
      (h: Harness) => h.click(ON_LINK_AB.x, ON_LINK_AB.y),
      (h: Harness) => h.click(IN_ZONE.x, IN_ZONE.y),
      (h: Harness) => h.click(450, 620),
      (h: Harness) => h.click(300, 300),
    ]) {
      const h = harness(scene());
      select(h);
      expect(families(h.editor)).toBe(1);
      h.click(EMPTY.x, EMPTY.y);
      expect(families(h.editor)).toBe(0);
      const before = ids(h.editor);
      h.editor.deleteSelected();
      expect(ids(h.editor)).toEqual(before);
      expect(h.editor.canUndo()).toBe(false);
    }
  });
});

describe('every way of selecting leaves one family selected', () => {
  const previous: [string, (h: Harness) => void][] = [
    ['a link', (h) => h.click(ON_LINK_AB.x, ON_LINK_AB.y)],
    [
      'two links',
      (h) => {
        h.click(ON_LINK_AB.x, ON_LINK_AB.y);
        h.click(ON_LINK_BC.x, ON_LINK_BC.y, { ctrlKey: true });
      },
    ],
    ['a zone', (h) => h.click(IN_ZONE.x, IN_ZONE.y)],
    ['an anchor', (h) => h.click(450, 620)],
    [
      'a node + an anchor',
      (h) => h.drag({ x: 380, y: 440 }, { x: 520, y: 660 }),
    ],
  ];
  const actions: [string, (h: Harness) => void][] = [
    ['add a node', (h) => h.editor.addNode('router')],
    ['select all', (h) => h.editor.selectAll()],
    ['focus a node', (h) => h.editor.focusNode('b')],
    ['focus a link', (h) => h.editor.focusLink('bc')],
    ['select a zone', (h) => void h.editor.selectZone('z1')],
    ['select zone members', (h) => void h.editor.selectZoneMembers('z1')],
    ['duplicate the zone', (h) => h.editor.duplicateZone('z1')],
    ['quick-connect', (h) => void h.editor.quickConnect('a', 'n')],
    [
      'stamp a stencil',
      (h) =>
        h.editor.stampStencil(
          [{ id: 's', type: 'router', x: 0, y: 0, label: 'S' }],
          [],
        ),
    ],
    ['click a node', (h) => h.click(600, 300)],
    ['shift-click a node', (h) => h.click(600, 300, { shiftKey: true })],
    ['click a link', (h) => h.click(ON_LINK_BC.x, ON_LINK_BC.y)],
    [
      'shift-click a link',
      (h) => h.click(ON_LINK_BC.x, ON_LINK_BC.y, { shiftKey: true }),
    ],
    ['click an anchor', (h) => h.click(450, 620)],
    ['click a zone', (h) => h.click(IN_ZONE.x, IN_ZONE.y)],
    ['marquee', (h) => h.drag({ x: 250, y: 250 }, { x: 650, y: 350 })],
    [
      'shift-marquee',
      (h) => h.drag({ x: 250, y: 250 }, { x: 650, y: 350 }, { shiftKey: true }),
    ],
    ['right-click a node', (h) => void h.editor.pickAt(600, 300)],
    ['right-click a link', (h) => void h.editor.pickAt(525, 400)],
    ['right-click empty canvas', (h) => void h.editor.pickAt(EMPTY.x, EMPTY.y)],
    ['double-click a node', (h) => void h.editor.requestInlineEditAt(600, 300)],
    [
      'double-click a link',
      (h) => void h.editor.requestInlineEditAt(ON_LINK_BC.x, ON_LINK_BC.y),
    ],
    [
      'drop an anchor',
      (h) => {
        h.editor.setTool('anchor');
        h.click(EMPTY.x, EMPTY.y);
      },
    ],
    [
      'draw a link',
      (h) => {
        h.editor.setTool('link');
        h.click(300, 300);
        h.click(450, 500);
      },
    ],
    ['Escape', (h) => h.editor.clearSelection()],
  ];
  for (const [from, select] of previous)
    for (const [name, act] of actions)
      it(`${name}, with ${from} selected`, () => {
        const h = harness(scene());
        select(h);
        expect(families(h.editor)).toBe(1);
        act(h);
        expect(families(h.editor)).toBeLessThanOrEqual(1);
        // The inspector's single-anchor target mirrors a lone anchor.
        const s = selected(h.editor);
        expect(h.editor.getSelectedAnchor()?.id ?? null).toBe(
          s.nodes.length === 0 && s.anchors.length === 1 ? s.anchors[0] : null,
        );
      });
});

describe('the shell hears about every family that changed', () => {
  function wired(): {
    h: { editor: Editor; click(x: number, y: number): void };
    log: string[];
  } {
    const log: string[] = [];
    const overlay = fakeSvg();
    const editor = new EditorClass(
      fakeSvg(),
      overlay,
      scene(),
      () => {},
      (n) => log.push(`nodes:${n}`),
      (id) => log.push(`link:${id}`),
      (id) => log.push(`anchor:${id}`),
      () => {},
      (id) => log.push(`zone:${id}`),
    );
    (editor as unknown as { view: object }).view = {
      x: 0,
      y: 0,
      w: 1000,
      h: 700,
    };
    const click = (x: number, y: number): void => {
      overlay.fire('pointermove', pointer(x, y, { buttons: 0 }));
      overlay.fire('pointerdown', pointer(x, y));
      overlay.fire('pointerup', pointer(x, y, { buttons: 0 }));
    };
    return { h: { editor, click }, log };
  }

  it('adding a node tells the shell the link is no longer selected', () => {
    const { h, log } = wired();
    h.click(ON_LINK_AB.x, ON_LINK_AB.y);
    log.length = 0;
    h.editor.addNode('router');
    expect(log).toContain('link:null');
    expect(log).toContain('nodes:1');
  });

  it('jumping to a node tells the shell the zone is no longer selected', () => {
    const { h, log } = wired();
    h.click(IN_ZONE.x, IN_ZONE.y);
    expect(log).toContain('zone:z1');
    log.length = 0;
    h.editor.focusNode('c');
    expect(log).toContain('zone:null');
    expect(log).toContain('nodes:1');
  });

  it('selecting a link after an anchor clears the anchor inspector', () => {
    const { h, log } = wired();
    h.click(450, 620);
    expect(log).toContain('anchor:an1');
    log.length = 0;
    h.editor.focusLink('ab');
    expect(log).toContain('anchor:null');
    expect(log).toContain('link:ab');
  });
});

describe('an anchor placed with the Anchor tool is fully selected (CODE-11 / CAN-17)', () => {
  function dropAnchor(): Harness {
    const h = harness(scene());
    h.editor.setTool('anchor');
    h.click(EMPTY.x, EMPTY.y);
    h.editor.setTool('select');
    return h;
  }

  it('it counts as selected and the inspector shows it', () => {
    const h = dropAnchor();
    const placed = h.editor.page.anchors.at(-1)!;
    expect(h.editor.getSelectedAnchor()?.id).toBe(placed.id);
    // The status bar's "selected" count; it also gates the arrow keys.
    expect(h.editor.selectionCount()).toBe(1);
  });

  it('Delete removes it', () => {
    const h = dropAnchor();
    expect(h.editor.page.anchors).toHaveLength(2);
    h.editor.deleteSelected();
    expect(h.editor.page.anchors.map((a) => a.id)).toEqual(['an1']);
  });

  it('the arrow keys nudge it', () => {
    const h = dropAnchor();
    const before = { ...h.editor.page.anchors.at(-1)! };
    h.editor.nudge(10, 0);
    h.editor.nudge(0, -10);
    expect(h.editor.page.anchors.at(-1)).toMatchObject({
      x: before.x + 10,
      y: before.y - 10,
    });
  });

  it('it drags with the Select tool without a click to select it first', () => {
    const h = dropAnchor();
    const start = { ...h.editor.page.anchors.at(-1)! };
    h.drag(start, { x: start.x + 60, y: start.y - 40 });
    expect(h.editor.page.anchors.at(-1)).toMatchObject({
      x: start.x + 60,
      y: start.y - 40,
    });
  });
});

describe('selecting never reaches a hidden layer (CODE-06)', () => {
  /** The scene plus two switches and a link on a layer that is not drawn. */
  function layered(visible = false): Harness {
    const page = scene();
    page.nodes.push(
      { id: 'hid1', type: 'switch', x: 420, y: 560, label: 'H1', layer: 'u' },
      { id: 'hid2', type: 'switch', x: 500, y: 560, label: 'H2', layer: 'u' },
    );
    page.links.push({
      id: 'hl',
      type: 'line',
      from: 'hid1',
      to: 'hid2',
      layer: 'u',
    });
    // The hidden switches also hang off a visible node and sit in the zone.
    page.links.push({ id: 'c-h1', type: 'line', from: 'c', to: 'hid1' });
    page.zones[0]!.nodes.push('hid1');
    const h = harness(page);
    h.editor.setRenderOpts(() => ({
      layers: [{ id: 'u', defaultVisible: visible }],
    }));
    return h;
  }

  it('a marquee around a visible node leaves the hidden ones inside it alone', () => {
    const h = layered();
    h.drag({ x: 380, y: 450 }, { x: 540, y: 600 }); // around node c
    expect(selected(h.editor).nodes).toEqual(['c']);
    h.editor.deleteSelected();
    expect(ids(h.editor).nodes).toEqual(['a', 'b', 'hid1', 'hid2']);
    expect(ids(h.editor).links).toContain('hl');
  });

  it('select-all selects what is drawn, and Delete removes only that', () => {
    const h = layered();
    h.editor.selectAll();
    expect(selected(h.editor).nodes).toEqual(['a', 'b', 'c']);
    h.editor.deleteSelected();
    expect(ids(h.editor).nodes).toEqual(['hid1', 'hid2']);
  });

  it('select-by commands stay on the visible page', () => {
    const invert = layered();
    invert.editor.focusNode('a');
    invert.editor.invertSelection();
    expect(selected(invert.editor).nodes).toEqual(['b', 'c']);

    const grow = layered();
    grow.editor.focusNode('c');
    grow.editor.growConnected();
    expect(selected(grow.editor).nodes).toEqual(['b', 'c']);

    const zone = layered();
    zone.editor.selectZoneMembers('z1');
    expect(selected(zone.editor).nodes).toEqual(['a', 'b']);
  });

  it('once the layer is shown its nodes select like any other', () => {
    const h = layered(true);
    h.editor.selectAll();
    expect(selected(h.editor).nodes).toEqual(['a', 'b', 'c', 'hid1', 'hid2']);
    h.drag({ x: 380, y: 450 }, { x: 540, y: 600 });
    expect(selected(h.editor).nodes).toEqual(['c', 'hid1', 'hid2']);
  });
});
