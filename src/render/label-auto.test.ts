import { describe, it, expect } from 'vitest';
import { createDocument } from '../api/builder.js';
import { analyzeLayout } from '../api/layout.js';
import type { Page } from '../pages/model.js';
import { autoPlaceLabels } from './label-auto.js';
import { inspectPage } from './inspect.js';

/** A hub with four branches fanning out below it. */
function fan(): Page {
  const b = createDocument('Fan')
    .page({ name: 'Fan' })
    .node({ id: 'hub', type: 'ec', x: 500, y: 140, label: 'Hub' });
  [200, 400, 600, 800].forEach((x, i) =>
    b
      .node({ id: `b${i}`, type: 'ec', x, y: 480, label: `Branch ${i}` })
      .link({ id: `l${i}`, type: 'line', from: 'hub', to: `b${i}` }),
  );
  return b.build().pages[0]!;
}

const crossings = (page: Page): number =>
  inspectPage(page).findings.filter((f) =>
    /runs through the label of its node/.test(f.message),
  ).length;

describe('autoPlaceLabels', () => {
  it('lifts a hub label above the links fanning below it', () => {
    const page = fan();
    expect(crossings(page)).toBeGreaterThan(0);
    const r = autoPlaceLabels(page);
    expect(r.placements.hub).toBe('n');
    expect(page.nodes.find((n) => n.id === 'hub')?.labelPlacement).toBe('n');
    // Branches' links arrive from above: their labels stay below (absent).
    for (const id of ['b0', 'b1', 'b2', 'b3'])
      expect(page.nodes.find((n) => n.id === id)?.labelPlacement).toBe(
        undefined,
      );
    expect(r.changed).toBe(1);
    expect(crossings(page)).toBe(0);
  });

  it('is idempotent and deterministic', () => {
    const a = fan();
    autoPlaceLabels(a);
    expect(autoPlaceLabels(a).changed).toBe(0);
    const b = fan();
    autoPlaceLabels(b);
    expect(JSON.stringify(b.nodes)).toBe(JSON.stringify(a.nodes));
  });

  it('leaves hand-placed labels alone', () => {
    const page = fan();
    const hub = page.nodes.find((n) => n.id === 'hub')!;
    hub.labelOffset = 30;
    const r = autoPlaceLabels(page);
    expect(r.placements.hub).toBeUndefined();
    expect(hub.labelPlacement).toBeUndefined();
  });

  it('never trades a crossing for a layout-rule breach', () => {
    // Two nodes 70px apart with links below: the slots facing the
    // neighbour would crowd it, so neither label may turn toward the other.
    const page = createDocument('Tight')
      .page({ name: 'Tight' })
      .node({ id: 'a', type: 'ec', x: 400, y: 200, label: 'Alpha node' })
      .node({ id: 'b', type: 'ec', x: 470, y: 200, label: 'Bravo node' })
      .node({ id: 'c', type: 'ec', x: 435, y: 500, label: 'C' })
      .link({ id: 'ac', type: 'line', from: 'a', to: 'c' })
      .link({ id: 'bc', type: 'line', from: 'b', to: 'c' })
      .build().pages[0]!;
    const before = analyzeLayout({
      title: 't',
      pages: [structuredClone(page)],
      customNodes: [],
    }).length;
    autoPlaceLabels(page);
    const at = (id: string) =>
      page.nodes.find((n) => n.id === id)?.labelPlacement ?? 's';
    expect(['e', 'ne', 'se']).not.toContain(at('a'));
    expect(['w', 'nw', 'sw']).not.toContain(at('b'));
    expect(
      analyzeLayout({ title: 't', pages: [page], customNodes: [] }).length,
    ).toBeLessThanOrEqual(before);
  });

  it('can be limited to some nodes', () => {
    const page = fan();
    const r = autoPlaceLabels(page, { nodeIds: ['b0'] });
    expect(Object.keys(r.placements)).toEqual(['b0']);
    expect(page.nodes.find((n) => n.id === 'hub')?.labelPlacement).toBe(
      undefined,
    );
  });
});
