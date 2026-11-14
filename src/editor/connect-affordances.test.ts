/**
 * Connection dots and quick-connect chevrons versus the node they belong to.
 *
 * The dots sit on a node's edge midpoints and the chevrons float just beyond
 * them, so both compete with the node's caption and — on a glyph that is
 * small on screen — with the node body itself. These tests drive real
 * pointer events through the overlay's listeners.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { nodeLabelRect } from '../render/label-placement.js';
import type { NodeConfig } from '../vendor/topology-ds.js';
import { blankPage, harness, installEditorGlobals } from './test-harness.js';

beforeAll(installEditorGlobals);

/** Centre of the label block drawn beside a node (below it by default). */
function captionCentre(n: NodeConfig): { x: number; y: number } {
  const r = nodeLabelRect(n)!;
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function onePage(node: NodeConfig, ...more: NodeConfig[]) {
  const page = blankPage();
  page.nodes.push(node, ...more);
  return page;
}

describe('a node caption owns its presses (LNK-02)', () => {
  // A Node Designer type: its caption sits low enough that the south
  // quick-connect chevron used to land on it.
  const lb = (): NodeConfig => ({
    id: 'lb',
    type: 'loadbalancer',
    x: 400,
    y: 300,
    label: 'Load Balancer',
  });
  // A classic type: its caption starts right under the glyph, where the
  // bottom connection dot used to swallow the press.
  const router = (): NodeConfig => ({
    id: 'r',
    type: 'router',
    x: 400,
    y: 300,
    label: 'Router',
  });

  it('a click on the caption selects the node and creates nothing', () => {
    const h = harness(onePage(lb()));
    const cap = captionCentre(h.editor.page.nodes[0]!);
    h.move(400, 300, { buttons: 0 }); // hover the node first, as a pointer does
    h.click(cap.x, cap.y);
    expect(h.editor.page.nodes).toHaveLength(1);
    expect(h.editor.page.links).toHaveLength(0);
    expect(h.editor.getSelectedNode()?.id).toBe('lb');
    expect(h.editor.canUndo()).toBe(false);
  });

  it('a double-click on the caption opens the label editor', () => {
    for (const node of [lb(), router()]) {
      const h = harness(onePage(node));
      const cap = captionCentre(h.editor.page.nodes[0]!);
      h.move(400, 300, { buttons: 0 });
      h.click(cap.x, cap.y);
      h.click(cap.x, cap.y);
      expect(h.requests.map((r) => [r.kind, r.id])).toEqual([
        ['node', node.id],
      ]);
      expect(h.editor.page.nodes).toHaveLength(1);
    }
  });

  it('dragging by the caption moves the node instead of drawing a link', () => {
    for (const node of [lb(), router()]) {
      const page = onePage(node, {
        id: 'other',
        type: 'router',
        x: 700,
        y: 500,
        label: 'Other',
      });
      const h = harness(page);
      const cap = captionCentre(page.nodes[0]!);
      h.move(400, 300, { buttons: 0 });
      h.drag(cap, { x: cap.x + 100, y: cap.y + 60 });
      expect(page.links).toHaveLength(0);
      expect(page.nodes[0]).toMatchObject({ x: 500, y: 360 });
    }
  });

  it('the pointer shows no connect cursor over the caption', () => {
    const h = harness(onePage(lb()));
    const cap = captionCentre(h.editor.page.nodes[0]!);
    h.move(400, 300, { buttons: 0 });
    h.move(cap.x, cap.y, { buttons: 0 });
    expect(h.overlay.style.cursor).toBe('');
  });

  it('the chevron on the caption side moves past the caption and still quick-connects', () => {
    const h = harness(onePage(lb()));
    const node = h.editor.page.nodes[0]!;
    const label = nodeLabelRect(node)!;
    const south = (
      h.editor as unknown as {
        chevrons(id: string): { x: number; y: number; dir: string }[];
      }
    )
      .chevrons('lb')
      .find((c) => c.dir === 's')!;
    // Its whole press area (±12 at this zoom) is clear of the caption block,
    // and it is drawn where it is pressed.
    expect(south.y - 12).toBeGreaterThanOrEqual(label.y + label.h);
    h.move(400, 300, { buttons: 0 });
    h.move(south.x, south.y, { buttons: 0 });
    expect(h.overlay.style.cursor).toBe('copy');
    expect(h.overlay.innerHTML).toContain(
      `translate(${south.x},${south.y}) rotate(180)`,
    );
    h.click(south.x, south.y);
    expect(h.editor.page.nodes).toHaveLength(2);
    expect(h.editor.page.links).toHaveLength(1);
    expect(h.editor.page.nodes[1]!.y).toBeGreaterThan(300);
  });

  it('the caption stays hovered all the way to its relocated chevron', () => {
    const h = harness(onePage(lb()));
    const label = nodeLabelRect(h.editor.page.nodes[0]!)!;
    const hover = (): string | null =>
      (h.editor as unknown as { hoverNode: string | null }).hoverNode;
    h.move(400, 300, { buttons: 0 });
    // Walk down from the glyph through the caption to well below it.
    for (let y = 300; y <= label.y + label.h + 14; y += 2) {
      h.move(400, y, { buttons: 0 });
      expect(hover(), `hover lost at y=${y}`).toBe('lb');
    }
  });

  it('a dot under the caption is not offered; the other three still draw links', () => {
    const page = onePage(router(), {
      id: 'other',
      type: 'router',
      x: 700,
      y: 300,
      label: 'Other',
    });
    const h = harness(page);
    const dots = (
      h.editor as unknown as {
        connectionDots(id: string): { x: number; y: number }[];
      }
    ).connectionDots('r');
    expect(dots).toHaveLength(3);
    // Drag from the right-hand dot (the glyph is 36 wide) to the other node.
    h.move(400, 300, { buttons: 0 });
    h.drag({ x: 420, y: 300 }, { x: 700, y: 300 });
    expect(page.links).toMatchObject([{ from: 'r', to: 'other' }]);
  });

  it('a caption placed on another side moves that side’s chevron instead', () => {
    const node: NodeConfig = { ...lb(), labelPlacement: 'n' };
    const h = harness(onePage(node));
    const label = nodeLabelRect(h.editor.page.nodes[0]!)!;
    const all = (
      h.editor as unknown as {
        chevrons(id: string): { x: number; y: number; dir: string }[];
      }
    ).chevrons('lb');
    const north = all.find((c) => c.dir === 'n')!;
    const south = all.find((c) => c.dir === 's')!;
    expect(north.y).toBeLessThan(label.y);
    // The south chevron is back at its usual distance from the glyph.
    expect(south.y).toBe(300 + 24 + 21);
    const cap = captionCentre(h.editor.page.nodes[0]!);
    h.move(400, 300, { buttons: 0 });
    h.click(cap.x, cap.y);
    expect(h.editor.page.nodes).toHaveLength(1);
  });
});

describe('connection dots leave the middle of a small node alone (LNK-03)', () => {
  // 44 × 16: at 100% the old ±9 px dot boxes covered its whole height.
  const thin = (): NodeConfig => ({
    id: 'sw',
    type: 'switch',
    x: 400,
    y: 300,
    label: 'SW',
  });
  const router = (x: number, y: number, id = 'r'): NodeConfig => ({
    id,
    type: 'router',
    x,
    y,
    label: id,
  });

  it('a thin node drags by its centre', () => {
    const h = harness(onePage(thin()));
    h.drag({ x: 400, y: 300 }, { x: 460, y: 340 });
    expect(h.editor.page.nodes[0]).toMatchObject({ x: 460, y: 340 });
    expect(h.editor.page.links).toHaveLength(0);
  });

  it('a double-click on the centre of a thin node renames it', () => {
    const h = harness(onePage(thin()));
    h.click(400, 300);
    h.click(400, 300);
    expect(h.requests.map((r) => [r.kind, r.id])).toEqual([['node', 'sw']]);
  });

  it('zoomed out to a third, a node still drags and renames by its centre', () => {
    // The 36 × 36 router is 12 px on screen; a dot is drawn 10 px across.
    const drag = harness(onePage(router(1500, 1000)), 3000);
    drag.drag({ x: 1500, y: 1000 }, { x: 1700, y: 1200 });
    expect(drag.editor.page.nodes[0]).toMatchObject({ x: 1700, y: 1200 });

    const rename = harness(onePage(router(1500, 1000)), 3000);
    rename.click(1500, 1000);
    rename.click(1500, 1000);
    expect(rename.requests.map((r) => r.kind)).toEqual(['node']);
  });

  it('on a normal-sized node the whole drawn dot starts a link, and so does a near miss outside', () => {
    // Router right edge is at x = 418; the dot is drawn 5 units around it.
    for (const pressX of [414, 418, 422, 426]) {
      const page = onePage(router(400, 300), router(700, 300, 'other'));
      const h = harness(page);
      h.drag({ x: pressX, y: 300 }, { x: 700, y: 300 });
      expect(page.links, `press at x=${pressX}`).toMatchObject([
        { from: 'r', to: 'other' },
      ]);
      expect(page.nodes[0]).toMatchObject({ x: 400, y: 300 });
    }
  });

  it('zoomed out, a dot is still grabbed from just outside the glyph', () => {
    const page = onePage(router(1500, 1000), router(2100, 1000, 'other'));
    const h = harness(page, 3000);
    h.drag({ x: 1530, y: 1000 }, { x: 2100, y: 1000 });
    expect(page.links).toMatchObject([{ from: 'r', to: 'other' }]);
  });

  it('a press inside another node goes to that node, not to a neighbour’s dot or chevron', () => {
    // `r` is selected, so its dots and chevrons are live; `near` sits where
    // r's east chevron floats (36 units right of r's edge at 100%).
    const page = onePage(router(400, 300), router(450, 300, 'near'));
    const h = harness(page);
    h.click(400, 300);
    expect(h.editor.getSelectedNode()?.id).toBe('r');
    // (440, 300) is inside `near` (its left edge is x = 432) and inside the
    // press area of r's east chevron (centre x = 439).
    h.drag({ x: 440, y: 300 }, { x: 530, y: 400 });
    expect(page.nodes).toHaveLength(2);
    expect(page.links).toHaveLength(0);
    expect(page.nodes[1]).toMatchObject({ id: 'near', x: 540, y: 400 });
  });
});
