import { describe, it, expect } from 'vitest';
import { createDocument } from './builder.js';
import { analyzeLayout } from './layout.js';
import { autoLayout, layoutPage } from './autolayout.js';

const overlaps = (doc: Parameters<typeof analyzeLayout>[0]): number =>
  analyzeLayout(doc).filter((p) => /overlap|too close/.test(p.message)).length;

const piled = () => {
  const d = createDocument().page();
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f'])
    d.node({ id, type: 'ec', x: 200, y: 200, label: id.toUpperCase() });
  return d.build();
};

describe('auto-layout', () => {
  it('grid arranges piled nodes without overlap', () => {
    const doc = piled();
    expect(overlaps(doc)).toBeGreaterThan(0);
    const moved = layoutPage(doc.pages[0]!, { algorithm: 'grid' });
    expect(moved).toBeGreaterThan(0);
    expect(overlaps(doc)).toBe(0);
  });

  it('circular arranges piled nodes without overlap', () => {
    const doc = piled();
    layoutPage(doc.pages[0]!, { algorithm: 'circular' });
    expect(overlaps(doc)).toBe(0);
  });

  it('hierarchical orders a chain by link direction (TB → increasing y)', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 100, y: 100 })
      .node({ id: 'b', type: 'ec', x: 110, y: 100 })
      .node({ id: 'c', type: 'ec', x: 120, y: 100 })
      .link({ id: 'l1', type: 'line', from: 'a', to: 'b' })
      .link({ id: 'l2', type: 'line', from: 'b', to: 'c' })
      .build();
    layoutPage(doc.pages[0]!, { algorithm: 'hierarchical', direction: 'TB' });
    const y = (id: string) => doc.pages[0]!.nodes.find((n) => n.id === id)!.y;
    expect(y('a')).toBeLessThan(y('b'));
    expect(y('b')).toBeLessThan(y('c'));
    expect(overlaps(doc)).toBe(0);
  });

  it('hierarchical LR orders a chain by increasing x', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 100, y: 100 })
      .node({ id: 'b', type: 'ec', x: 110, y: 100 })
      .link({ id: 'l', type: 'line', from: 'a', to: 'b' })
      .build();
    layoutPage(doc.pages[0]!, { algorithm: 'hierarchical', direction: 'LR' });
    const n = (id: string) => doc.pages[0]!.nodes.find((x) => x.id === id)!;
    expect(n('a').x).toBeLessThan(n('b').x);
  });

  it('force is deterministic and overlap-free', () => {
    const a = autoLayout(piled(), { algorithm: 'force' });
    const b = autoLayout(piled(), { algorithm: 'force' });
    expect(JSON.stringify(a.pages[0]!.nodes)).toBe(
      JSON.stringify(b.pages[0]!.nodes),
    ); // deterministic
    expect(overlaps(a)).toBe(0);
  });

  it('autoLayout is pure and a single node is a no-op', () => {
    const doc = piled();
    const before = JSON.stringify(doc);
    autoLayout(doc, { algorithm: 'grid' });
    expect(JSON.stringify(doc)).toBe(before); // original untouched

    const one = createDocument()
      .page()
      .node({ id: 'solo', type: 'ec', x: 123, y: 456 })
      .build();
    expect(layoutPage(one.pages[0]!, { algorithm: 'grid' })).toBe(0);
  });
});
