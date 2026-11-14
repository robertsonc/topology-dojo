/**
 * The commands the shell binds to keys, menus and drop targets: absolute
 * zoom and "zoom to selection", the pointer's page position, paste at a
 * point / in place, add a node at a point, insert a node on a link, rename
 * what is selected, select by id, and replace the emphasis list.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Page } from '../pages/model.js';
import type { LinkConfig } from '../vendor/topology-ds.js';
import { nodeBounds, nodeCaptionRect } from './geometry.js';
import {
  blankPage,
  expectPublished,
  fakeSvg,
  harness,
  installEditorGlobals,
  pointer,
  type Harness,
} from './test-harness.js';
import { Editor } from './editor.js';

beforeAll(installEditorGlobals);

function scene(): Page {
  const page = blankPage();
  page.nodes.push(
    { id: 'a', type: 'router', x: 200, y: 300, label: 'A' },
    { id: 'b', type: 'router', x: 600, y: 300, label: 'B' },
    { id: 'c', type: 'server', x: 400, y: 500, label: 'C' },
  );
  page.links.push(
    { id: 'ab', type: 'line', from: 'a', to: 'b', label: 'core' },
    { id: 'bc', type: 'line', from: 'b', to: 'c' },
  );
  page.anchors.push({ id: 'an1', x: 800, y: 500 });
  page.zones.push({ id: 'z1', label: 'Zone', nodes: ['a', 'b'] });
  return page;
}

const centre = (h: Harness): { x: number; y: number } => {
  const v = h.editor.getView();
  return { x: v.x + v.w / 2, y: v.y + v.h / 2 };
};

const at = (h: Harness, id: string): [number, number] => {
  const el =
    h.editor.page.nodes.find((n) => n.id === id) ??
    h.editor.page.anchors.find((a) => a.id === id)!;
  return [el.x, el.y];
};

/* ── view ────────────────────────────────────────────────────────────────── */

describe('zoomTo sets an absolute zoom', () => {
  it('100% shows one page unit per pixel and keeps the centre of the view', () => {
    // The canvas is 1000 × 700 px; start zoomed out to a third.
    const h = harness(scene(), 3000);
    const before = centre(h);
    h.editor.zoomTo(1);
    expect(h.editor.getView()).toMatchObject({ w: 1000, h: 700 });
    expect(centre(h)).toEqual(before);
    expect(h.editor.zoom()).toBe(1);
  });

  it('zoom() reports the scale zoomTo was given', () => {
    const h = harness(scene());
    for (const scale of [0.25, 0.5, 2, 4]) {
      h.editor.zoomTo(scale);
      expect(h.editor.zoom()).toBeCloseTo(scale, 6);
      expect(h.editor.getView().w).toBeCloseTo(1000 / scale, 6);
    }
  });

  it('stops at the limits the wheel and the zoom buttons stop at', () => {
    const h = harness(scene());
    h.editor.zoomTo(1000);
    expect(h.editor.getView().w).toBe(80);
    for (let i = 0; i < 40; i++) h.editor.zoomIn();
    expect(h.editor.getView().w).toBe(80);
    h.editor.zoomTo(0.0001);
    expect(h.editor.getView().w).toBe(8000);
    for (let i = 0; i < 40; i++) h.editor.zoomOut();
    expect(h.editor.getView().w).toBe(8000);
  });

  it('ignores a scale that is not a positive number', () => {
    const h = harness(scene());
    const before = h.editor.getView();
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      h.editor.zoomTo(bad);
    expect(h.editor.getView()).toEqual(before);
  });

  it('tells the shell the view changed', () => {
    let views = 0;
    const editor = new Editor(
      fakeSvg(),
      fakeSvg(),
      scene(),
      undefined,
      undefined,
      undefined,
      undefined,
      () => views++,
    );
    views = 0;
    editor.zoomTo(2);
    expect(views).toBe(1);
  });
});

describe('zoomToSelection frames what is selected', () => {
  it('does nothing and says so when nothing is selected', () => {
    const h = harness(scene(), 3000);
    const before = h.editor.getView();
    expect(h.editor.zoomToSelection()).toBe(false);
    expect(h.editor.getView()).toEqual(before);
  });

  it('one node is centred at 100%, never blown up past it', () => {
    const h = harness(scene(), 3000);
    h.editor.selectElement('node', 'a');
    expect(h.editor.zoomToSelection()).toBe(true);
    expect(h.editor.zoom()).toBe(1);
    // Centred on the node as drawn: glyph plus caption.
    const node = h.editor.page.nodes[0]!;
    const glyph = nodeBounds(node);
    const caption = nodeCaptionRect(node, 0)!;
    const top = Math.min(glyph.y, caption.y);
    const bottom = Math.max(glyph.y + glyph.h, caption.y + caption.h);
    expect(centre(h).x).toBeCloseTo(200, 6);
    expect(centre(h).y).toBeCloseTo((top + bottom) / 2, 6);
  });

  it('a spread-out selection zooms out until all of it shows, with a margin', () => {
    const page = scene();
    page.nodes.push({
      id: 'far',
      type: 'router',
      x: 4200,
      y: 2600,
      label: 'F',
    });
    const h = harness(page);
    h.editor.selectAll();
    expect(h.editor.zoomToSelection()).toBe(true);
    const v = h.editor.getView();
    expect(h.editor.zoom()).toBeLessThan(1);
    for (const n of h.editor.page.nodes) {
      const b = nodeBounds(n);
      expect(b.x).toBeGreaterThan(v.x + 30);
      expect(b.y).toBeGreaterThan(v.y + 30);
      expect(b.x + b.w).toBeLessThan(v.x + v.w - 30);
      expect(b.y + b.h).toBeLessThan(v.y + v.h - 30);
    }
  });

  it('frames a selected link, an anchor and a zone', () => {
    const link = harness(scene(), 3000);
    link.editor.selectElement('link', 'bc');
    expect(link.editor.zoomToSelection()).toBe(true);
    expect(centre(link)).toEqual({ x: 500, y: 400 });

    const anchor = harness(scene(), 3000);
    anchor.editor.selectElement('anchor', 'an1');
    expect(anchor.editor.zoomToSelection()).toBe(true);
    expect(centre(anchor)).toEqual({ x: 800, y: 500 });
    expect(anchor.editor.zoom()).toBe(1);

    const zone = harness(scene(), 3000);
    zone.editor.selectElement('zone', 'z1');
    expect(zone.editor.zoomToSelection()).toBe(true);
    expect(centre(zone).x).toBeCloseTo(400, 6);
  });

  it('keeps the selection clear of a panel covering part of the canvas', () => {
    const h = harness(scene(), 3000);
    h.editor.setViewInsets(() => ({ right: 400, bottom: 0 }));
    h.editor.selectElement('anchor', 'an1');
    h.editor.zoomToSelection();
    // The visible canvas is the left 600 px: its middle is at x = 300.
    expect(800 - h.editor.getView().x).toBeCloseTo(300, 6);
  });
});

describe('wheel mode', () => {
  it('starts as auto and remembers what it is set to', () => {
    const h = harness(scene());
    expect(h.editor.getWheelMode()).toBe('auto');
    h.editor.setWheelMode('pan');
    expect(h.editor.getWheelMode()).toBe('pan');
    h.editor.setWheelMode('zoom');
    expect(h.editor.getWheelMode()).toBe('zoom');
  });

  /** A wheel event over the canvas at (500, 350), the middle of the view. */
  const wheelAt = (
    h: Harness,
    over: Record<string, unknown>,
    timeStamp = 0,
  ): void =>
    h.overlay.fire('wheel', {
      clientX: 500,
      clientY: 350,
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      timeStamp,
      preventDefault() {},
      ...over,
    });
  const NOTCH = { deltaY: 100, wheelDeltaY: -120 };
  const SLIDE = { deltaX: 20, deltaY: 40, wheelDeltaY: -120 };

  it('auto: a mouse wheel zooms at the cursor', () => {
    const h = harness(scene());
    const before = h.editor.getView();
    wheelAt(h, NOTCH);
    const after = h.editor.getView();
    expect(after.w).toBeGreaterThan(before.w); // wheel down = zoom out
    // The point under the cursor stays put.
    expect(after.x + after.w / 2).toBeCloseTo(before.x + before.w / 2, 6);
    expect(after.y + after.h / 2).toBeCloseTo(before.y + before.h / 2, 6);
  });

  it('auto: a trackpad slide scrolls the view and leaves the zoom alone', () => {
    const h = harness(scene());
    const before = h.editor.getView();
    wheelAt(h, SLIDE);
    // One page unit per pixel in this harness: the view moves by the travel.
    expect(h.editor.getView()).toEqual({
      ...before,
      x: before.x + 20,
      y: before.y + 40,
    });
  });

  it('pans by page units, so a slide covers the same distance on screen at any zoom', () => {
    const h = harness(scene(), 2000); // zoomed out: two page units per pixel
    const before = h.editor.getView();
    wheelAt(h, SLIDE);
    expect(h.editor.getView().x).toBeCloseTo(before.x + 40, 6);
    expect(h.editor.getView().y).toBeCloseTo(before.y + 80, 6);
  });

  it('keeps one reading for a whole gesture', () => {
    const h = harness(scene());
    const before = h.editor.getView();
    // A slide whose later events happen to look like wheel notches…
    wheelAt(h, SLIDE, 1000);
    wheelAt(h, NOTCH, 1050);
    wheelAt(h, NOTCH, 1100);
    // …still pans: the zoom never changed.
    expect(h.editor.getView().w).toBe(before.w);
    expect(h.editor.getView().y).toBe(before.y + 240);
    // A wheel turned after a pause is read afresh.
    wheelAt(h, NOTCH, 2000);
    expect(h.editor.getView().w).toBeGreaterThan(before.w);
  });

  it('a pinch zooms in any mode; Shift + wheel pans sideways', () => {
    for (const mode of ['auto', 'zoom', 'pan'] as const) {
      const h = harness(scene());
      h.editor.setWheelMode(mode);
      const before = h.editor.getView();
      wheelAt(h, { deltaY: -10, ctrlKey: true, wheelDeltaY: 30 }, 0);
      expect(h.editor.getView().w).toBeLessThan(before.w); // pinch out = zoom in
      const zoomed = h.editor.getView();
      wheelAt(h, { ...NOTCH, shiftKey: true }, 5000);
      expect(h.editor.getView().w).toBe(zoomed.w);
      expect(h.editor.getView().x).toBeGreaterThan(zoomed.x);
      expect(h.editor.getView().y).toBe(zoomed.y);
    }
  });

  it('mode pan: a mouse wheel scrolls; mode zoom: a trackpad slide zooms', () => {
    const pan = harness(scene());
    pan.editor.setWheelMode('pan');
    const p0 = pan.editor.getView();
    wheelAt(pan, NOTCH);
    expect(pan.editor.getView()).toEqual({ ...p0, y: p0.y + 100 });

    const zoom = harness(scene());
    zoom.editor.setWheelMode('zoom');
    const z0 = zoom.editor.getView();
    wheelAt(zoom, SLIDE);
    expect(zoom.editor.getView().w).toBeGreaterThan(z0.w);
  });

  it('stops at the same limits as the zoom buttons', () => {
    const h = harness(scene());
    for (let i = 0; i < 80; i++) wheelAt(h, NOTCH, i * 1000);
    expect(h.editor.getView().w).toBe(8000);
    for (let i = 0; i < 160; i++)
      wheelAt(h, { deltaY: -100, wheelDeltaY: 120 }, 1e6 + i * 1000);
    expect(h.editor.getView().w).toBe(80);
  });
});

/* ── drop target ─────────────────────────────────────────────────────────── */

describe('setDropLink marks the link a drop would land on', () => {
  const marked = (h: Harness): string[] =>
    [...h.overlay.innerHTML.matchAll(/data-drop-link="([^"]+)"/g)].map(
      (m) => m[1]!,
    );

  it('draws the mark along the link and takes it away again', () => {
    const h = harness(scene());
    expect(marked(h)).toEqual([]);
    h.editor.setDropLink('ab');
    expect(marked(h)).toEqual(['ab']);
    h.editor.setDropLink('bc');
    expect(marked(h)).toEqual(['bc']);
    h.editor.setDropLink(null);
    expect(marked(h)).toEqual([]);
  });

  it('selects nothing, changes nothing and has nothing to undo', () => {
    const h = harness(scene());
    const before = JSON.stringify(h.editor.page);
    h.editor.setDropLink('ab');
    expect(h.editor.selectionCount()).toBe(0);
    expect(h.editor.getSelectedLink()).toBeNull();
    expect(JSON.stringify(h.editor.page)).toBe(before);
    expect(h.changes.count).toBe(0);
    expect(h.editor.canUndo()).toBe(false);
  });

  it('draws nothing for a link the page does not have, and is cleared by a page switch', () => {
    const h = harness(scene());
    h.editor.setDropLink('nope');
    expect(marked(h)).toEqual([]);
    h.editor.setDropLink('ab');
    h.editor.setPage(scene());
    expect(marked(h)).toEqual([]);
  });

  it('writes a hostile link id as text, not markup', () => {
    const page = scene();
    page.links[0]!.id = 'x"><image onerror="1"/>';
    const h = harness(page);
    h.editor.setDropLink('x"><image onerror="1"/>');
    expect(h.overlay.innerHTML).not.toContain('<image');
    expect(h.overlay.innerHTML).toContain('data-drop-link="x&quot;');
  });
});

/* ── coordinates ─────────────────────────────────────────────────────────── */

describe('clientToPage', () => {
  it('clientToPage converts a viewport point', () => {
    const h = harness(scene());
    expect(h.editor.clientToPage(123, 456)).toEqual({ x: 123, y: 456 });
  });
});

/* ── paste ───────────────────────────────────────────────────────────────── */

describe('paste places the copies where it is told to', () => {
  /** Copy nodes a and b (centre of the block: 400, 300). */
  function copied(): Harness {
    const h = harness(scene());
    h.editor.selectElement('node', 'a');
    h.click(600, 300, { shiftKey: true });
    h.editor.copySelection();
    return h;
  }
  const copies = (h: Harness): [number, number][] =>
    h.editor.page.nodes.slice(3).map((n) => [n.x, n.y]);

  it('at a point: the block is centred there, on the grid', () => {
    const h = copied();
    h.editor.paste({ at: { x: 703, y: 596 } });
    // The block moves by whole grid steps: 300 right, 300 down.
    expect(copies(h)).toEqual([
      [500, 600],
      [900, 600],
    ]);
    // The link between the two came along, and the copies are selected.
    expect(h.editor.page.links).toHaveLength(3);
    expect(h.editor.selectedNodeIds()).toHaveLength(2);
    expect(h.editor.selectedNodeIds()).not.toContain('a');
  });

  it('at a point with snapping off: centred to the unit', () => {
    const h = copied();
    h.editor.toggleSnap();
    h.editor.paste({ at: { x: 703, y: 596 } });
    expect(copies(h)).toEqual([
      [503, 596],
      [903, 596],
    ]);
  });

  it('in place: the original coordinates, with no offset', () => {
    const h = copied();
    h.editor.paste({ inPlace: true });
    expect(copies(h)).toEqual([
      [200, 300],
      [600, 300],
    ]);
    // Onto another page too, which is what it is for.
    const p2 = blankPage('p2');
    h.editor.setPage(p2);
    h.editor.paste({ inPlace: true });
    expect(p2.nodes.map((n) => [n.x, n.y])).toEqual([
      [200, 300],
      [600, 300],
    ]);
  });

  it('with no target: a step from the original, stepping on when taken', () => {
    const h = copied();
    h.editor.paste();
    h.editor.paste();
    expect(copies(h)).toEqual([
      [224, 324],
      [624, 324],
      [248, 348],
      [648, 348],
    ]);
  });

  it('with the original out of view: the middle of the view', () => {
    const h = copied();
    h.editor.panTo(1500, 1040); // nothing of the original is in view
    h.editor.paste();
    expect(copies(h)).toEqual([
      [1300, 1040],
      [1700, 1040],
    ]);
  });

  it('repeated pastes at one spot step on instead of stacking', () => {
    const h = copied();
    h.editor.paste({ at: { x: 700, y: 600 } });
    h.editor.paste({ at: { x: 700, y: 600 } });
    h.editor.paste({ at: { x: 700, y: 600 } });
    expect(copies(h).filter((_, i) => i % 2 === 0)).toEqual([
      [500, 600],
      [524, 624],
      [548, 648],
    ]);
  });

  it('a paste right onto the original steps off it', () => {
    const h = copied();
    h.editor.paste({ at: { x: 400, y: 300 } });
    expect(copies(h)).toEqual([
      [224, 324],
      [624, 324],
    ]);
  });

  it('is one undo step and publishes what it added', () => {
    for (const opts of [{ at: { x: 700, y: 600 } }, { inPlace: true }, {}]) {
      const h = copied();
      const depth = h.editor.historyDepth();
      expectPublished(h.editor, () => h.editor.paste(opts));
      expect(h.editor.historyDepth()).toBe(depth + 1);
      h.editor.undo();
      expect(h.editor.page.nodes).toHaveLength(3);
      expect(h.editor.page.links).toHaveLength(2);
    }
  });

  it('with an empty clipboard nothing happens', () => {
    const h = harness(scene());
    h.editor.paste({ at: { x: 100, y: 100 } });
    h.editor.paste({ inPlace: true });
    expect(h.editor.page.nodes).toHaveLength(3);
    expect(h.editor.canUndo()).toBe(false);
  });
});

/* ── add / insert ────────────────────────────────────────────────────────── */

describe('addNodeAt puts a node where the user dropped it', () => {
  it('snaps to the grid like a drag, selects the node and returns its id', () => {
    const h = harness(scene());
    const id = h.editor.addNodeAt('switch', { x: 707, y: 113 });
    const node = h.editor.page.nodes.at(-1)!;
    expect(node).toMatchObject({ id, type: 'switch', x: 700, y: 120 });
    expect(node.label).toBe('Switch');
    expect(h.editor.selectedNodeIds()).toEqual([id]);
  });

  it('keeps the exact point with snapping off, and takes a label', () => {
    const h = harness(scene());
    h.editor.toggleSnap();
    h.editor.addNodeAt('switch', { x: 707.4, y: 113.2 }, 'Core 1');
    expect(h.editor.page.nodes.at(-1)).toMatchObject({
      x: 707,
      y: 113,
      label: 'Core 1',
    });
  });

  it('takes further fields, and the point wins over a position in them', () => {
    const h = harness(scene());
    const id = h.editor.addNodeAt('ec', { x: 300, y: 200 }, undefined, {
      variant: 'axis',
      x: 1,
      y: 2,
    } as never);
    expect(h.editor.page.nodes.find((n) => n.id === id)).toMatchObject({
      type: 'ec',
      variant: 'axis',
      x: 300,
      y: 200,
    });
  });

  it('lands exactly on the point even when a node is already there', () => {
    const h = harness(scene());
    h.editor.addNodeAt('switch', { x: 200, y: 300 });
    expect(at(h, h.editor.page.nodes.at(-1)!.id)).toEqual([200, 300]);
  });

  it('is one undo step and publishes the add', () => {
    const h = harness(scene());
    const ops = expectPublished(h.editor, () => {
      h.editor.addNodeAt('switch', { x: 700, y: 120 });
    });
    expect(ops).toMatchObject([{ type: 'element.add', kind: 'nodes' }]);
    expect(h.editor.historyDepth()).toBe(1);
    h.editor.undo();
    expect(h.editor.page.nodes).toHaveLength(3);
  });
});

describe('linkAtClient finds the link under a point', () => {
  it('reports a link along its route and nothing off it', () => {
    const h = harness(scene());
    expect(h.editor.linkAtClient(400, 300)).toBe('ab');
    expect(h.editor.linkAtClient(400, 304)).toBe('ab');
    expect(h.editor.linkAtClient(500, 400)).toBe('bc');
    expect(h.editor.linkAtClient(400, 340)).toBeNull();
    expect(h.editor.linkAtClient(900, 100)).toBeNull();
  });

  it('a point on a node or an anchor is not on the links under it', () => {
    const page = scene();
    page.links.push({ id: 'c-an', type: 'line', from: 'c', to: 'an1' });
    const h = harness(page);
    expect(h.editor.linkAtClient(200, 300)).toBeNull(); // node a
    expect(h.editor.linkAtClient(800, 500)).toBeNull(); // the anchor
    expect(h.editor.linkAtClient(600, 500)).toBe('c-an');
  });

  it('a link on a hidden layer is not there', () => {
    const page = scene();
    page.links[0]!.layer = 'underlay';
    const h = harness(page);
    h.editor.setRenderOpts(() => ({
      layers: [{ id: 'underlay', defaultVisible: false }],
    }));
    expect(h.editor.linkAtClient(400, 300)).toBeNull();
  });

  it('selects nothing', () => {
    const h = harness(scene());
    h.editor.linkAtClient(400, 300);
    expect(h.editor.selectionCount()).toBe(0);
  });
});

describe('insertNodeOnLink splits the link around a new node', () => {
  const linkIds = (h: Harness): string[] =>
    h.editor.page.links.map((l) => l.id);

  it('A—B becomes A—new—B, with the new node on the grid and selected', () => {
    const h = harness(scene());
    const id = h.editor.insertNodeOnLink('ab', 'firewall', { x: 407, y: 296 })!;
    expect(h.editor.page.nodes.at(-1)).toMatchObject({
      id,
      type: 'firewall',
      x: 400,
      y: 300,
    });
    const [first, second] = h.editor.page.links as [LinkConfig, LinkConfig];
    // The original link is the first half and keeps its id.
    expect(first).toMatchObject({ id: 'ab', from: 'a', to: id });
    expect(second).toMatchObject({ from: id, to: 'b', type: 'line' });
    expect(second.id).not.toBe('ab');
    // The second half sits right above the first in the drawing order.
    expect(linkIds(h)).toEqual(['ab', second.id, 'bc']);
    expect(h.editor.selectedNodeIds()).toEqual([id]);
  });

  it('both halves keep the look; each end keeps its own data', () => {
    const page = scene();
    Object.assign(page.links[0]!, {
      type: 'tunnel',
      style: 'wan',
      color: '#ff8800',
      layer: 'overlay',
      lineStyle: 'orthogonal',
      dashed: true,
      bandwidth: '10G',
      fromLabel: 'ge-0/0/1',
      toLabel: 'ge-0/0/2',
      fromInterface: 'lan0',
      toInterface: 'wan0',
      fromPort: 'e',
      toPort: 'w',
      fromLabelOffset: { x: 4, y: -6 },
      toLabelOffset: { x: -4, y: 6 },
      toBundle: 'ae1',
      labelOffset: { x: 0, y: -14 },
      labelWidth: 120,
      source: { system: 'netbox', id: 'cable-7' },
      tooltip: 'uplink',
    });
    const h = harness(page);
    const id = h.editor.insertNodeOnLink('ab', 'firewall', { x: 400, y: 300 })!;
    const [first, second] = h.editor.page.links as [LinkConfig, LinkConfig];
    const look = {
      type: 'tunnel',
      style: 'wan',
      color: '#ff8800',
      layer: 'overlay',
      lineStyle: 'orthogonal',
      dashed: true,
      bandwidth: '10G',
      tooltip: 'uplink',
    };
    expect(first).toEqual({
      id: 'ab',
      from: 'a',
      to: id,
      ...look,
      // The centre label and everything about the `from` end stay here.
      label: 'core',
      labelOffset: { x: 0, y: -14 },
      labelWidth: 120,
      fromLabel: 'ge-0/0/1',
      fromInterface: 'lan0',
      fromPort: 'e',
      fromLabelOffset: { x: 4, y: -6 },
      source: { system: 'netbox', id: 'cable-7' },
    });
    expect(second).toEqual({
      id: second.id,
      from: id,
      to: 'b',
      ...look,
      // Everything about the `to` end went with it.
      toLabel: 'ge-0/0/2',
      toInterface: 'wan0',
      toPort: 'w',
      toLabelOffset: { x: -4, y: 6 },
      toBundle: 'ae1',
    });
  });

  it('bends before the point stay on the first half, the rest go to the second', () => {
    const bent = (): Page => {
      const page = scene();
      // a (200,300) → (200,100) → (400,100) → (600,100) → b (600,300)
      page.links[0]!.waypoints = [
        { x: 200, y: 100 },
        { x: 400, y: 100 },
        { x: 600, y: 100 },
      ];
      return page;
    };
    const halves = (h: Harness) =>
      h.editor.page.links.slice(0, 2).map((l) => l.waypoints);

    const middle = harness(bent());
    middle.editor.insertNodeOnLink('ab', 'switch', { x: 300, y: 100 });
    expect(halves(middle)).toEqual([
      [{ x: 200, y: 100 }],
      [
        { x: 400, y: 100 },
        { x: 600, y: 100 },
      ],
    ]);

    const start = harness(bent());
    start.editor.insertNodeOnLink('ab', 'switch', { x: 200, y: 200 });
    expect(halves(start)[0]).toBeUndefined();
    expect('waypoints' in start.editor.page.links[0]!).toBe(false);
    expect(halves(start)[1]).toHaveLength(3);

    const end = harness(bent());
    end.editor.insertNodeOnLink('ab', 'switch', { x: 600, y: 200 });
    expect(halves(end)[0]).toHaveLength(3);
    expect('waypoints' in end.editor.page.links[1]!).toBe(false);
  });

  it('is one undo step that restores the link exactly', () => {
    const h = harness(scene());
    const before = structuredClone(h.editor.page);
    h.editor.insertNodeOnLink('ab', 'firewall', { x: 400, y: 300 });
    expect(h.editor.historyDepth()).toBe(1);
    h.editor.undo();
    expect(structuredClone(h.editor.page)).toEqual(before);
    h.editor.redo();
    expect(h.editor.page.links).toHaveLength(3);
  });

  it('publishes operations that reproduce the change', () => {
    const page = scene();
    Object.assign(page.links[0]!, {
      toLabel: 'ge-0/0/2',
      toPort: 'w',
      waypoints: [
        { x: 300, y: 200 },
        { x: 500, y: 200 },
      ],
    });
    page.emphasis = ['ab'];
    const h = harness(page);
    const ops = expectPublished(h.editor, () => {
      h.editor.insertNodeOnLink('ab', 'firewall', { x: 400, y: 200 });
    });
    expect(ops.map((op) => op.type)).toEqual([
      'element.add',
      'element.patch',
      'element.add',
      'page.patch',
    ]);
  });

  it('a spotlighted link stays spotlighted from end to end', () => {
    const page = scene();
    page.emphasis = ['a', 'ab'];
    const h = harness(page);
    const id = h.editor.insertNodeOnLink('ab', 'firewall', { x: 400, y: 300 })!;
    expect(h.editor.getEmphasis()).toEqual([
      'a',
      'ab',
      id,
      h.editor.page.links[1]!.id,
    ]);
    // A link that was not spotlighted adds nothing to the list.
    const plain = harness(scene());
    plain.editor.setEmphasis(['a']);
    plain.editor.insertNodeOnLink('ab', 'firewall', { x: 400, y: 300 });
    expect(plain.editor.getEmphasis()).toEqual(['a']);
  });

  it('a link that ends on an anchor splits the same way', () => {
    const page = scene();
    page.links.push({ id: 'c-an', type: 'line', from: 'c', to: 'an1' });
    const h = harness(page);
    const id = h.editor.insertNodeOnLink('c-an', 'switch', { x: 600, y: 500 })!;
    expect(h.editor.page.links.slice(2)).toMatchObject([
      { id: 'c-an', from: 'c', to: id },
      { from: id, to: 'an1' },
    ]);
  });

  it('gives the new node the further fields it was asked for', () => {
    const h = harness(scene());
    const id = h.editor.insertNodeOnLink('ab', 'ec', { x: 400, y: 300 }, {
      variant: 'axis',
    } as never)!;
    expect(h.editor.page.nodes.find((n) => n.id === id)).toMatchObject({
      type: 'ec',
      variant: 'axis',
      x: 400,
      y: 300,
    });
  });

  it('refuses a locked link and a link that does not exist', () => {
    const page = scene();
    page.links[0]!.locked = true;
    const h = harness(page);
    expect(
      h.editor.insertNodeOnLink('ab', 'switch', { x: 400, y: 300 }),
    ).toBeNull();
    expect(
      h.editor.insertNodeOnLink('nope', 'switch', { x: 400, y: 300 }),
    ).toBeNull();
    expect(h.editor.page.nodes).toHaveLength(3);
    expect(h.editor.page.links).toHaveLength(2);
    expect(h.editor.canUndo()).toBe(false);
    expect(h.editor.takePendingOperations()).toEqual([]);
  });
});

/* ── rename ──────────────────────────────────────────────────────────────── */

describe('beginRename opens the label editor on the selection', () => {
  it('for the one selected node, as a double-click on it does', () => {
    const viaKey = harness(scene());
    viaKey.editor.selectElement('node', 'b');
    expect(viaKey.editor.beginRename()).toBe(true);

    const viaClick = harness(scene());
    viaClick.editor.requestInlineEditAt(600, 300);

    expect(viaKey.requests).toHaveLength(1);
    expect(viaKey.requests[0]).toMatchObject({
      kind: 'node',
      id: 'b',
      current: 'B',
    });
    // Anchored where the double-click anchors it.
    expect(viaKey.requests[0]!.clientX).toBe(viaClick.requests[0]!.clientX);
    expect(viaKey.requests[0]!.clientY).toBe(viaClick.requests[0]!.clientY);
  });

  it('for the one selected link: its centre label', () => {
    const h = harness(scene());
    h.editor.selectElement('link', 'ab');
    expect(h.editor.beginRename()).toBe(true);
    expect(h.requests[0]).toMatchObject({
      kind: 'link',
      id: 'ab',
      current: 'core',
      clientX: 400,
      clientY: 300,
    });
  });

  it('for the selected zone', () => {
    const h = harness(scene());
    h.editor.selectElement('zone', 'z1');
    expect(h.editor.beginRename()).toBe(true);
    expect(h.requests[0]).toMatchObject({
      kind: 'zone',
      id: 'z1',
      current: 'Zone',
    });
  });

  it('the rename it opens commits through renameElement', () => {
    const h = harness(scene());
    h.editor.selectElement('node', 'b');
    h.editor.beginRename();
    const req = h.requests[0]!;
    h.editor.renameElement('node', req.id!, 'Border');
    expect(h.editor.page.nodes[1]!.label).toBe('Border');
  });

  it('says no for anything that is not exactly one node, link or zone', () => {
    const none = harness(scene());
    expect(none.editor.beginRename()).toBe(false);

    const two = harness(scene());
    two.editor.selectAll();
    expect(two.editor.beginRename()).toBe(false);

    const twoLinks = harness(scene());
    twoLinks.click(400, 300);
    twoLinks.click(500, 400, { ctrlKey: true });
    expect(twoLinks.editor.selectedLinkIds()).toHaveLength(2);
    expect(twoLinks.editor.beginRename()).toBe(false);

    const anchor = harness(scene());
    anchor.editor.selectElement('anchor', 'an1');
    expect(anchor.editor.beginRename()).toBe(false);

    const nodeAndAnchor = harness(scene());
    nodeAndAnchor.editor.selectElement('node', 'c');
    nodeAndAnchor.click(800, 500, { shiftKey: true });
    expect(nodeAndAnchor.editor.selectionCount()).toBe(2);
    expect(nodeAndAnchor.editor.beginRename()).toBe(false);

    for (const h of [none, two, twoLinks, anchor, nodeAndAnchor])
      expect(h.requests).toHaveLength(0);
  });

  it('says no when the shell registered no label editor', () => {
    const h = harness(scene());
    h.editor.setInlineEditHandler(null);
    h.editor.selectElement('node', 'b');
    expect(h.editor.beginRename()).toBe(false);
  });
});

/* ── select by id ────────────────────────────────────────────────────────── */

describe('selectElement selects one element by id', () => {
  it('selects a node, a link, a zone or an anchor, replacing the selection', () => {
    const h = harness(scene());
    expect(h.editor.selectElement('node', 'c')).toBe(true);
    expect(h.editor.selectedNodeIds()).toEqual(['c']);
    expect(h.editor.selectElement('link', 'bc')).toBe(true);
    expect(h.editor.selectedLinkIds()).toEqual(['bc']);
    expect(h.editor.selectedNodeIds()).toEqual([]);
    expect(h.editor.selectElement('zone', 'z1')).toBe(true);
    expect(h.editor.getSelectedZone()?.id).toBe('z1');
    expect(h.editor.selectedLinkIds()).toEqual([]);
    expect(h.editor.selectElement('anchor', 'an1')).toBe(true);
    expect(h.editor.getSelectedAnchor()?.id).toBe('an1');
    expect(h.editor.getSelectedZone()).toBeNull();
  });

  it('leaves the view alone unless asked to centre', () => {
    const h = harness(scene());
    const before = h.editor.getView();
    h.editor.selectElement('node', 'c');
    expect(h.editor.getView()).toEqual(before);
    h.editor.selectElement('node', 'c', { center: true });
    expect(centre(h)).toEqual({ x: 400, y: 500 });
    expect(h.editor.getView().w).toBe(before.w); // same zoom
    h.editor.selectElement('link', 'ab', { center: true });
    expect(centre(h)).toEqual({ x: 400, y: 300 });
    h.editor.selectElement('anchor', 'an1', { center: true });
    expect(centre(h)).toEqual({ x: 800, y: 500 });
    h.editor.selectElement('zone', 'z1', { center: true });
    expect(centre(h).x).toBeCloseTo(400, 6);
  });

  it('an id the page does not have changes nothing', () => {
    const h = harness(scene());
    h.editor.selectElement('node', 'a');
    for (const kind of ['node', 'link', 'zone', 'anchor'] as const)
      expect(h.editor.selectElement(kind, 'missing', { center: true })).toBe(
        false,
      );
    // An id of another kind is not a match either.
    expect(h.editor.selectElement('link', 'a')).toBe(false);
    expect(h.editor.selectedNodeIds()).toEqual(['a']);
  });

  it('tells the shell what is now selected', () => {
    const log: string[] = [];
    const overlay = fakeSvg();
    const editor = new Editor(
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
    editor.selectElement('link', 'ab');
    expect(log).toContain('link:ab');
    editor.selectElement('zone', 'z1');
    expect(log).toContain('link:null');
    expect(log).toContain('zone:z1');
    editor.selectElement('anchor', 'an1');
    expect(log).toContain('anchor:an1');
    overlay.fire('pointermove', pointer(0, 0, { buttons: 0 }));
  });
});

/* ── emphasis ────────────────────────────────────────────────────────────── */

describe('setEmphasis replaces the frame’s emphasis list', () => {
  it('sets the list, and an empty one turns emphasis off', () => {
    const h = harness(scene());
    h.editor.setEmphasis(['a', 'ab']);
    expect(h.editor.getEmphasis()).toEqual(['a', 'ab']);
    h.editor.setEmphasis(['c']);
    expect(h.editor.getEmphasis()).toEqual(['c']);
    h.editor.setEmphasis([]);
    expect(h.editor.getEmphasis()).toEqual([]);
    expect('emphasis' in h.editor.page).toBe(false);
  });

  it('drops ids that are not a node or a link of this page, and repeats', () => {
    const h = harness(scene());
    h.editor.setEmphasis(['a', 'ghost', 'ab', 'a', 'z1', 'an1']);
    expect(h.editor.getEmphasis()).toEqual(['a', 'ab']);
    // Only unknown ids: the same as clearing.
    h.editor.setEmphasis(['ghost']);
    expect(h.editor.getEmphasis()).toEqual([]);
  });

  it('each change is one undo step; no change is none', () => {
    const h = harness(scene());
    h.editor.setEmphasis(['a']);
    h.editor.setEmphasis(['a', 'b']);
    expect(h.editor.historyDepth()).toBe(2);
    h.editor.setEmphasis(['a', 'b']);
    h.editor.setEmphasis(['a', 'b', 'ghost']);
    expect(h.editor.historyDepth()).toBe(2);
    h.editor.undo();
    expect(h.editor.getEmphasis()).toEqual(['a']);
    h.editor.undo();
    expect(h.editor.getEmphasis()).toEqual([]);
    h.editor.setEmphasis([]);
    expect(h.editor.historyDepth()).toBe(0);
    h.editor.redo();
    expect(h.editor.getEmphasis()).toEqual(['a']);
  });

  it('publishes a page patch that reproduces the change', () => {
    const h = harness(scene());
    const set = expectPublished(h.editor, () => {
      h.editor.setEmphasis(['a', 'ab']);
    });
    expect(set).toEqual([
      {
        type: 'page.patch',
        pageId: 'p1',
        patch: { set: { emphasis: ['a', 'ab'] } },
      },
    ]);
    const cleared = expectPublished(h.editor, () => {
      h.editor.setEmphasis([]);
    });
    expect(cleared).toEqual([
      { type: 'page.patch', pageId: 'p1', patch: { unset: ['emphasis'] } },
    ]);
    // The older emphasis commands publish the same way.
    expectPublished(h.editor, () => h.editor.toggleEmphasis('b'));
    h.editor.selectElement('node', 'c');
    expectPublished(h.editor, () => h.editor.emphasizeSelection());
    expectPublished(h.editor, () => h.editor.clearEmphasis());
  });
});
