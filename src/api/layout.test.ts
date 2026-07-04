import { describe, it, expect } from 'vitest';
import { createDocument } from './builder.js';
import {
  analyzeLayout,
  isValidViewBox,
  isWellLaidOut,
  layoutGuidelines,
  parseViewBox,
} from './layout.js';
import { tidyPage } from './tidy.js';

const has = (probs: { message: string }[], re: RegExp): boolean =>
  probs.some((p) => re.test(p.message));

describe('parseViewBox / isValidViewBox', () => {
  it('parses a well-formed viewBox', () => {
    expect(parseViewBox('0 0 800 600')).toEqual([0, 0, 800, 600]);
  });

  it('never yields NaN or non-positive extent on malformed input', () => {
    for (const vb of ['0 0 800px 600px', '0 0 0 0', '', 'garbage', '1 2']) {
      const [x, y, w, h] = parseViewBox(vb);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
    }
  });

  it('validates viewBox shape', () => {
    expect(isValidViewBox('0 0 1050 700')).toBe(true);
    expect(isValidViewBox('0 0 800px 600px')).toBe(false);
    expect(isValidViewBox('0 0 0 0')).toBe(false);
    expect(isValidViewBox('0 0 -5 700')).toBe(false);
    expect(isValidViewBox('1 2 3')).toBe(false);
  });

  it('tidy keeps node coordinates finite even with a malformed page viewBox', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 200 })
      .node({ id: 'b', type: 'ec', x: 300, y: 210 })
      .build();
    doc.pages[0]!.viewBox = '0 0 800px 600px'; // hostile / hand-edited
    tidyPage(doc.pages[0]!);
    for (const n of doc.pages[0]!.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });
});

describe('layout guidelines', () => {
  it('exposes machine-readable rules + human guidance', () => {
    const g = layoutGuidelines();
    expect(g.rules.gridStep).toBeGreaterThan(0);
    expect(g.rules.minNodeGap).toBeGreaterThan(0);
    expect(g.guidance.length).toBeGreaterThan(3);
    expect(g.guidance.join(' ')).toMatch(/grid/i);
  });
});

describe('analyzeLayout', () => {
  it('passes a well-spaced topology', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 200, label: 'A' })
      .node({ id: 'b', type: 'ec', x: 500, y: 200, label: 'B' })
      .node({ id: 'c', type: 'ec', x: 200, y: 450, label: 'C' })
      .build();
    expect(analyzeLayout(doc)).toEqual([]);
    expect(isWellLaidOut(doc)).toBe(true);
  });

  it('flags overlapping nodes', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 200, label: 'A' })
      .node({ id: 'b', type: 'ec', x: 205, y: 203, label: 'B' })
      .build();
    const probs = analyzeLayout(doc);
    expect(has(probs, /"a" and "b" overlap/)).toBe(true);
    expect(probs.every((p) => p.level === 'warning')).toBe(true);
    expect(isWellLaidOut(doc)).toBe(false);
  });

  it('flags crowded (too-close) nodes short of overlap', () => {
    // ec half-width is 28; centers 260 apart minus footprints leaves <24px gap.
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 200 })
      .node({ id: 'b', type: 'ec', x: 262, y: 200 })
      .build();
    expect(has(analyzeLayout(doc), /too close/)).toBe(true);
  });

  it('flags nodes past the page edge', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'edge', type: 'cloud', x: 10, y: 350, label: 'X' })
      .build();
    expect(has(analyzeLayout(doc), /past the page edge/)).toBe(true);
  });

  it('flags a zone that visually contains a non-member node', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'm1', type: 'ec', x: 200, y: 200 })
      .node({ id: 'm2', type: 'ec', x: 300, y: 200 })
      .node({ id: 'intruder', type: 'ec', x: 250, y: 230 }) // sits inside the zone box
      .zone({ id: 'z', nodes: ['m1', 'm2'], label: 'Z' })
      .build();
    expect(
      has(
        analyzeLayout(doc),
        /zone "z" visually contains non-member node "intruder"/,
      ),
    ).toBe(true);
  });

  it('does not flag a member node inside its own zone', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'm1', type: 'ec', x: 200, y: 200 })
      .node({ id: 'm2', type: 'ec', x: 360, y: 200 })
      .zone({ id: 'z', nodes: ['m1', 'm2'], label: 'Z' })
      .build();
    expect(has(analyzeLayout(doc), /zone "z" visually contains/)).toBe(false);
  });

  it('flags two un-nested zones that overlap, but allows nesting', () => {
    // Nodes spaced so their footprints don't overlap — isolating zone behavior
    // (each zone's 40px-padded box still overlaps the other's).
    const overlapping = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 200 })
      .node({ id: 'b', type: 'ec', x: 300, y: 200 })
      .zone({ id: 'z1', nodes: ['a'] })
      .zone({ id: 'z2', nodes: ['b'] })
      .build();
    expect(has(analyzeLayout(overlapping), /zones "z1" and "z2" overlap/)).toBe(
      true,
    );

    const nested = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 200 })
      .node({ id: 'b', type: 'ec', x: 300, y: 200 })
      .zone({ id: 'outer', nodes: ['a'] })
      .zone({ id: 'inner', nodes: ['b'], parentZone: 'outer' })
      .build();
    expect(has(analyzeLayout(nested), /overlap/)).toBe(false);
  });
});
