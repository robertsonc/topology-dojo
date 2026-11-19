import { describe, expect, it } from 'vitest';
import {
  FIT_GAP,
  editorInsets,
  fitInsets,
  leftInsetShift,
} from './fit-insets.js';

/** The canvas area at 1280×720, between the docked library (the rail is
 * 44px, the library 208px), the docked properties panel and the pages bar. */
const canvas = { left: 252, top: 44, right: 1005, bottom: 652 };
/** The library docked just left of the canvas. */
const docked = { left: 44, top: 44, right: 252, bottom: 652 };
/** A library floating over the canvas's left edge (the phone drawer). */
const palette = { left: 252, top: 44, right: 426, bottom: 652 };
const inspector = { left: 1005, top: 44, right: 1268, bottom: 652 };
/** The zoom control alone in the bottom-right corner: low and wide. */
const zoom = { left: 846, top: 606, right: 995, bottom: 642 };
/** The zoom control with the minimap card above it: tall. */
const zoomAndMap = { left: 813, top: 450, right: 995, bottom: 642 };

describe('fitInsets', () => {
  it('reserves the left edge for a node library over the canvas', () => {
    const insets = fitInsets({ canvas, palette });
    expect(insets.left).toBe(174 + FIT_GAP);
  });

  it('keeps a gap to a node library docked beside the canvas', () => {
    expect(fitInsets({ canvas, palette: docked }).left).toBe(FIT_GAP);
  });

  it('reserves nothing on the left when the node library is collapsed', () => {
    expect(fitInsets({ canvas, palette: null }).left).toBe(0);
    expect(fitInsets({ canvas }).left).toBe(0);
  });

  it('measures the left inset from the canvas edge, not the window edge', () => {
    const shifted = { ...canvas, left: 292, right: 1045 };
    const rail = { ...palette, left: 292, right: 466 };
    expect(fitInsets({ canvas: shifted, palette: rail }).left).toBe(
      174 + FIT_GAP,
    );
  });

  it('keeps a gap to a properties panel docked beside the canvas', () => {
    expect(fitInsets({ canvas, inspector }).right).toBe(FIT_GAP);
  });

  it('reserves the part of the canvas a properties drawer covers', () => {
    // Phone layout: the drawer floats over the canvas's right side.
    const phone = { left: 0, top: 68, right: 390, bottom: 792 };
    const drawer = { left: 150, top: 68, right: 390, bottom: 792 };
    // 240px covered + the gap is over the 60% cap for a 390px canvas.
    expect(fitInsets({ canvas: phone, inspector: drawer }).right).toBe(
      390 * 0.6,
    );
  });

  it('clears the zoom control with a band at the bottom', () => {
    // 46px of a 608px-tall canvas costs less than 171px of a 753px width.
    const insets = fitInsets({ canvas, corner: zoom });
    expect(insets.bottom).toBe(652 - 606 + FIT_GAP);
    expect(insets.right).toBe(0);
    expect(fitInsets({ canvas, corner: null })).toEqual({
      left: 0,
      right: 0,
      bottom: 0,
    });
  });

  it('clears the minimap card above the zoom control with a strip on the right', () => {
    // 204px of 753px wide costs less than 214px of 608px tall.
    const insets = fitInsets({ canvas, corner: zoomAndMap });
    expect(insets.right).toBe(1005 - 813 + FIT_GAP);
    expect(insets.bottom).toBe(0);
  });

  it('keeps the wider of the two right insets when the corner and a drawer share the edge', () => {
    const drawer = { left: 900, top: 44, right: 1005, bottom: 652 };
    const insets = fitInsets({ canvas, inspector: drawer, corner: zoomAndMap });
    expect(insets.right).toBe(1005 - 813 + FIT_GAP);
  });

  it('never gives the side panels more than 60% of the width between them', () => {
    const narrow = { left: 0, top: 0, right: 390, bottom: 700 };
    const rail = { left: 12, top: 12, right: 174, bottom: 688 };
    const drawer = { left: 250, top: 0, right: 390, bottom: 700 };
    const insets = fitInsets({
      canvas: narrow,
      palette: rail,
      inspector: drawer,
    });
    expect(insets.left + insets.right).toBeCloseTo(390 * 0.6);
    // Both give way in proportion: the wider claim keeps the wider share.
    expect(insets.left / insets.right).toBeCloseTo(186 / 152);
  });

  it('never gives the bottom band more than 60% of the height', () => {
    const short = { left: 0, top: 0, right: 800, bottom: 100 };
    const card = { left: 0, top: 30, right: 800, bottom: 90 };
    expect(fitInsets({ canvas: short, corner: card }).bottom).toBe(60);
  });

  it('ignores a panel that lies wholly outside the canvas', () => {
    const farLeft = { left: -400, top: 44, right: -300, bottom: 600 };
    expect(fitInsets({ canvas, palette: farLeft }).left).toBe(0);
  });
});

describe('editorInsets', () => {
  it('folds the left inset into the right one, which the editor understands', () => {
    expect(editorInsets({ left: 186, right: 12, bottom: 84 })).toEqual({
      right: 198,
      bottom: 84,
    });
  });
});

describe('leftInsetShift', () => {
  it('converts the left inset from pixels to page units at the fit scale', () => {
    // A 2010-unit view across a 1005px canvas is 2 units per pixel.
    expect(leftInsetShift(2010, 1005, 186)).toBe(372);
  });

  it('is zero without a left inset or before the canvas is laid out', () => {
    expect(leftInsetShift(2010, 1005, 0)).toBe(0);
    expect(leftInsetShift(2010, 0, 186)).toBe(0);
  });

  it('puts the content centre in the middle of the visible width', () => {
    // The editor centres content in the width left after the folded right
    // inset, measured from the left edge. After the shift the content is
    // centred between the two panels.
    const width = 1005;
    const insets = { left: 186, right: 12, bottom: 0 };
    const folded = editorInsets(insets);
    const scale = 1.5; // page units per pixel
    const contentCentre = 500;
    const viewX = contentCentre - ((width - folded.right) / 2) * scale;
    const shifted = viewX - leftInsetShift(width * scale, width, insets.left);
    const centrePx = (contentCentre - shifted) / scale;
    expect(centrePx).toBeCloseTo(
      insets.left + (width - insets.left - insets.right) / 2,
    );
  });
});
