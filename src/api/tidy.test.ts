import { describe, it, expect } from 'vitest';
import { createDocument } from './builder.js';
import { analyzeLayout } from './layout.js';
import { tidyDocument, tidyLayout, tidyPage } from './tidy.js';

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
