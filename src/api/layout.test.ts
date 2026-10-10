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
import { nodeBounds } from './geometry.js';
import { nodeFootprint } from './layout.js';

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

describe('self-labelled node footprints (#253)', () => {
  const LONG =
    'Key: solid = underlay, dashed = overlay tunnel, red = blocked by policy, green = allowed';

  it('sizes a wide text box by its wrap width, not its label length', () => {
    // 88 chars × 6px would be a 528px footprint; the box is 220px wide and
    // wraps, so the switch 190px away and the page edge are both clear.
    const doc = createDocument()
      .page()
      .node({
        id: 'key',
        type: 'text',
        x: 150,
        y: 560,
        width: 220,
        label: LONG,
      })
      .node({ id: 'sw1', type: 'switch', x: 360, y: 560, label: 'core-sw' })
      .build();
    const probs = analyzeLayout(doc);
    expect(has(probs, /"key".*page edge/)).toBe(false);
    expect(has(probs, /"key" and "sw1"/)).toBe(false);
  });

  it('sizes a callout by its declared width and wrapped height', () => {
    const doc = createDocument()
      .page()
      .node({
        id: 'note',
        type: 'callout',
        x: 500,
        y: 560,
        width: 180,
        label: LONG,
      })
      .node({ id: 'sw1', type: 'switch', x: 360, y: 560, label: 'core-sw' })
      .node({ id: 'd1', type: 'server', x: 700, y: 560, label: 'd1' })
      .build();
    const probs = analyzeLayout(doc);
    expect(has(probs, /"note".*page edge/)).toBe(false);
    expect(has(probs, /"sw1" and "note"|"note" and "sw1"/)).toBe(false);
    expect(has(probs, /"note" and "d1"|"d1" and "note"/)).toBe(false);
  });

  it('counts a callout body into its footprint (#259)', () => {
    // ~310 chars at 180px wraps to well over a dozen lines.
    const BODY = Array.from(
      { length: 5 },
      (_, i) =>
        `Step ${i + 1}: drain the standby, verify tunnels, then fail back.`,
    ).join(' ');
    const note = {
      id: 'note',
      type: 'callout',
      x: 500,
      y: 350,
      width: 180,
      label: LONG,
      body: BODY,
    };
    const { body: _omit, ...plain } = note;
    const tall = nodeBounds(note);
    expect(tall.h).toBeGreaterThan(nodeBounds(plain).h + 100);
    expect(tall.w).toBe(180);

    // Neighbours visibly beside the note stay clear, however long the body.
    const clear = createDocument()
      .page()
      .node(note)
      .node({ id: 'sw1', type: 'switch', x: 300, y: 350, label: 'core-sw' })
      .node({ id: 'd1', type: 'server', x: 700, y: 350, label: 'd1' })
      .build();
    const ok = analyzeLayout(clear);
    expect(has(ok, /"note".*page edge/)).toBe(false);
    expect(has(ok, /"note"/)).toBe(false);

    // A node sitting under the body's lower lines is a real overlap — and
    // only because of the body: the same spot is clear without it.
    const underY = Math.round(350 + tall.h / 2 - 10);
    const hit = createDocument()
      .page()
      .node(note)
      .node({ id: 'd1', type: 'server', x: 500, y: underY, label: 'd1' })
      .build();
    expect(has(analyzeLayout(hit), /"note" and "d1"|"d1" and "note"/)).toBe(
      true,
    );
    const miss = createDocument()
      .page()
      .node(plain)
      .node({ id: 'd1', type: 'server', x: 500, y: underY, label: 'd1' })
      .build();
    expect(has(analyzeLayout(miss), /"note"/)).toBe(false);
  });

  it('does not place a text box inside a zone it merely sits near', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'ec', type: 'ec', x: 200, y: 200, label: 'ec' })
      .node({
        id: 'key',
        type: 'text',
        x: 500,
        y: 200,
        width: 200,
        label: LONG,
      })
      .zone({ id: 'z', label: 'Edge', nodes: ['ec'] })
      .build();
    expect(has(analyzeLayout(doc), /zone "z".*"key"/)).toBe(false);
  });

  it('still widens a classic node footprint by its below-node label', () => {
    const doc = createDocument()
      .page()
      .node({
        id: 'a',
        type: 'ec',
        x: 300,
        y: 300,
        label: 'edge-router-fallback-2',
      })
      .node({ id: 'b', type: 'ec', x: 400, y: 300, label: 'b' })
      .build();
    expect(has(analyzeLayout(doc), /"a" and "b"/)).toBe(true);
  });
});

describe('node label lines in footprints and zone boxes (#271)', () => {
  const SUB40 = 'QFX5120-32C 10.51.108.51 rack 12 slot 04';

  it('grows a footprint by each extra sublabel line', () => {
    const one = nodeFootprint({
      id: 'a',
      type: 'ec',
      x: 300,
      y: 300,
      label: 'A',
      sublabel: 'srx',
    });
    const two = nodeFootprint({
      id: 'a',
      type: 'ec',
      x: 300,
      y: 300,
      label: 'A',
      sublabel: SUB40,
    });
    expect(two.y).toBe(one.y);
    expect(two.h - one.h).toBe(9); // one more 7.5px sublabel line
    expect(two.w).toBeGreaterThan(one.w); // the wrapped line is wider than 'A'
  });

  it('flags a neighbour under the second sublabel line and not a clear one', () => {
    // a's block ends at y=339 with one sublabel line and y=348 with two; b's
    // glyph starts at y=345 (ec hh=18) — under the second line only.
    const under = createDocument()
      .page()
      .node({
        id: 'a',
        type: 'ec',
        x: 300,
        y: 300,
        label: 'A',
        sublabel: SUB40,
      })
      .node({ id: 'b', type: 'ec', x: 300, y: 363, label: 'B' })
      .build();
    expect(has(analyzeLayout(under), /nodes "a" and "b" overlap/)).toBe(true);
    const oneLine = createDocument()
      .page()
      .node({
        id: 'a',
        type: 'ec',
        x: 300,
        y: 300,
        label: 'A',
        sublabel: 'srx',
      })
      .node({ id: 'b', type: 'ec', x: 300, y: 363, label: 'B' })
      .build();
    expect(has(analyzeLayout(oneLine), /nodes "a" and "b" overlap/)).toBe(
      false,
    );
    const clear = createDocument()
      .page()
      .node({
        id: 'a',
        type: 'ec',
        x: 300,
        y: 300,
        label: 'A',
        sublabel: SUB40,
      })
      .node({ id: 'b', type: 'ec', x: 300, y: 420, label: 'B' })
      .build();
    expect(has(analyzeLayout(clear), /"a" and "b"/)).toBe(false);
  });

  it('reports a non-member node inside the box a west-placed label grew', () => {
    // The member's label block reaches x≈358; the zone now starts 40px left
    // of it (≈318), swallowing a node at x=300 that the old ±40 box (420)
    // never reached.
    const doc = createDocument()
      .page()
      .node({
        id: 'm',
        type: 'ec',
        x: 500,
        y: 350,
        label: 'sw-dc-01',
        sublabel: SUB40,
        labelPlacement: 'w',
      })
      .node({ id: 'other', type: 'ec', x: 300, y: 350, label: 'o' })
      .zone({ id: 'z', nodes: ['m'], label: 'Z' })
      .build();
    expect(
      has(
        analyzeLayout(doc),
        /zone "z" visually contains non-member node "other"/,
      ),
    ).toBe(true);
    const plain = createDocument()
      .page()
      .node({ id: 'm', type: 'ec', x: 500, y: 350, label: 'sw-dc-01' })
      .node({ id: 'other', type: 'ec', x: 300, y: 350, label: 'o' })
      .zone({ id: 'z', nodes: ['m'], label: 'Z' })
      .build();
    expect(has(analyzeLayout(plain), /visually contains/)).toBe(false);
  });
});
