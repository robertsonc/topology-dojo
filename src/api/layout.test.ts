import { describe, it, expect } from 'vitest';
import { createDocument } from './builder.js';
import { analyzeLayout, isWellLaidOut, layoutGuidelines } from './layout.js';

const has = (probs: { message: string }[], re: RegExp): boolean =>
  probs.some((p) => re.test(p.message));

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
