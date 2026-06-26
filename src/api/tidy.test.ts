import { describe, it, expect } from 'vitest';
import { createDocument } from './builder.js';
import { analyzeLayout } from './layout.js';
import {
  balanceLayout,
  balancePage,
  tidyDocument,
  tidyLayout,
  tidyPage,
} from './tidy.js';

const overlapWarnings = (doc: Parameters<typeof analyzeLayout>[0]): number =>
  analyzeLayout(doc).filter((p) => /overlap|too close/.test(p.message)).length;

describe('tidy (auto-layout)', () => {
  it('separates overlapping nodes until the layout is clean', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 300, y: 300, label: 'A' })
      .node({ id: 'b', type: 'ec', x: 305, y: 303, label: 'B' })
      .node({ id: 'c', type: 'ec', x: 298, y: 308, label: 'C' })
      .build();
    expect(overlapWarnings(doc)).toBeGreaterThan(0);
    const res = tidyDocument(doc);
    expect(res.before).toBeGreaterThan(0);
    expect(res.after).toBe(0);
    expect(res.movedNodes).toBeGreaterThan(0);
    expect(overlapWarnings(doc)).toBe(0);
  });

  it('pulls an off-page node back inside the margin', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'edge', type: 'cloud', x: 8, y: 350, label: 'X' })
      .build();
    expect(
      analyzeLayout(doc).some((p) => /past the page edge/.test(p.message)),
    ).toBe(true);
    tidyDocument(doc);
    expect(
      analyzeLayout(doc).some((p) => /past the page edge/.test(p.message)),
    ).toBe(false);
  });

  it('leaves an already-clean, grid-aligned layout unchanged', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 200, label: 'A' })
      .node({ id: 'b', type: 'ec', x: 500, y: 200, label: 'B' })
      .node({ id: 'c', type: 'ec', x: 200, y: 460, label: 'C' })
      .build();
    expect(tidyDocument(doc).movedNodes).toBe(0);
  });

  it('snaps off-grid nodes onto the grid', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 207, y: 193, label: 'A' })
      .build();
    tidyPage(doc.pages[0]!);
    expect(doc.pages[0]!.nodes[0]!.x % 20).toBe(0);
    expect(doc.pages[0]!.nodes[0]!.y % 20).toBe(0);
  });

  it('balance aligns nearly-shared rows and columns onto a common axis', () => {
    const doc = createDocument()
      .page()
      // a "row" of two ECs at almost-equal y; a third roughly under the first.
      .node({ id: 'a', type: 'ec', x: 300, y: 252 })
      .node({ id: 'b', type: 'ec', x: 600, y: 247 })
      .node({ id: 'c', type: 'ec', x: 303, y: 460 })
      .build();
    balancePage(doc.pages[0]!, { center: false });
    const [a, b, c] = doc.pages[0]!.nodes;
    expect(a!.y).toBe(b!.y); // the two near-equal y's snap to one row
    expect(a!.x).toBe(c!.x); // a and c snap to one column
    expect(c!.y).not.toBe(a!.y); // the far-apart row is left distinct
  });

  it('balance centres the layout’s bounding box in the page', () => {
    const doc = createDocument()
      .page() // default 1050×700 viewBox
      .node({ id: 'a', type: 'ec', x: 120, y: 120 })
      .node({ id: 'b', type: 'ec', x: 260, y: 240 })
      .build();
    balancePage(doc.pages[0]!);
    const xs = doc.pages[0]!.nodes.map((n) => n.x);
    const ys = doc.pages[0]!.nodes.map((n) => n.y);
    // The node-centre midpoint should land near the page centre (525,350).
    expect(
      Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 525),
    ).toBeLessThan(40);
    expect(
      Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 350),
    ).toBeLessThan(40);
  });

  it('balanceLayout is pure and leaves no overlaps', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 300, y: 300 })
      .node({ id: 'b', type: 'ec', x: 305, y: 302 })
      .node({ id: 'c', type: 'ec', x: 600, y: 300 })
      .build();
    const before = JSON.stringify(doc);
    const out = balanceLayout(doc);
    expect(JSON.stringify(doc)).toBe(before); // original untouched
    expect(overlapWarnings(out)).toBe(0);
  });

  it('tidyLayout is pure — it returns a clean copy, original untouched', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 300, y: 300 })
      .node({ id: 'b', type: 'ec', x: 304, y: 301 })
      .build();
    const before = JSON.stringify(doc);
    const tidied = tidyLayout(doc);
    expect(JSON.stringify(doc)).toBe(before); // original unchanged
    expect(overlapWarnings(tidied)).toBe(0); // copy is clean
  });
});
