import { describe, it, expect } from 'vitest';
import { createDocument } from './builder.js';
import { removeElement, updateElement, upsertBySource } from './edit.js';
import { validateDocument } from './validate.js';
import type { Page, TopologyDocument } from '../pages/model.js';

/** A small fabric page: two sites, a tunnel, a zone, a flow, a marker. */
function fabric(): { doc: TopologyDocument; page: Page } {
  const doc = createDocument('Fabric')
    .page()
    .node({ id: 'a', type: 'ec', x: 150, y: 200, label: 'Branch' })
    .node({ id: 'b', type: 'ec', x: 650, y: 200, label: 'Hub' })
    .node({ id: 'fw', type: 'firewall', x: 400, y: 400 })
    .link({ id: 'tun', type: 'tunnel', from: 'a', to: 'b' })
    .link({ id: 'lan', type: 'line', from: 'a', to: 'fw' })
    .zone({ id: 'z', nodes: ['a', 'fw'], label: 'Branch site' })
    .flowPath({ id: 'fp', waypoints: ['a', 'b'] })
    .policyMarker({ id: 'm', nodeId: 'fw', type: 'inspect', flowPathId: 'fp' })
    .build();
  return { doc, page: doc.pages[0]! };
}

describe('edit ops', () => {
  it('updateElement merges fields, clears on null, protects id', () => {
    const { page } = fabric();
    const { kind, element } = updateElement(page, 'a', {
      label: 'Branch-01',
      x: 170,
      sublabel: null, // absent → no-op delete
      layer: 'over',
    });
    expect(kind).toBe('node');
    expect(element.label).toBe('Branch-01');
    expect(element.x).toBe(170);
    expect(element.layer).toBe('over');

    updateElement(page, 'a', { layer: null });
    expect(page.nodes[0]!.layer).toBeUndefined();

    // Works across collections by bare id.
    updateElement(page, 'tun', { color: '#01a982' });
    expect(page.links.find((l) => l.id === 'tun')?.color).toBe('#01a982');
    updateElement(page, 'fp', { animation: 'particles' });
    expect(page.flowPaths[0]!.animation).toBe('particles');

    expect(() => updateElement(page, 'ghost', {})).toThrow(/unknown element/);
    expect(() => updateElement(page, 'a', { id: 'a2' })).toThrow(
      /id cannot be changed/,
    );
  });

  it('updateElement refuses to delete or malform structurally-required fields', () => {
    const { page } = fabric();
    // Deleting a required field (would corrupt the document / crash rehydrate).
    expect(() => updateElement(page, 'z', { nodes: null })).toThrow(
      /required zone field "nodes"/,
    );
    expect(() => updateElement(page, 'a', { x: null })).toThrow(
      /required node field "x"/,
    );
    expect(() => updateElement(page, 'fp', { waypoints: null })).toThrow(
      /required flowPath field "waypoints"/,
    );
    // Setting a required field to the wrong shape is rejected too.
    expect(() => updateElement(page, 'z', { nodes: 'oops' })).toThrow(
      /must be an array/,
    );
    expect(() => updateElement(page, 'a', { x: NaN })).toThrow(
      /must be a finite number/,
    );
    // The zone's membership is left intact after the rejected patches.
    expect(page.zones[0]!.nodes).toEqual(['a', 'fw']);
  });

  it('removeElement cascades: links, markers, memberships, waypoints', () => {
    const { doc, page } = fabric();
    const res = removeElement(page, 'a');
    expect(res.removed).toBe('node');
    expect(res.cascaded.links).toBe(2); // tun + lan both touched 'a'
    expect(res.cascaded.zoneMemberships).toBe(1);
    expect(res.cascaded.waypoints).toBe(1);
    expect(res.cascaded.flowPaths).toBe(1); // fp fell below 2 waypoints
    expect(page.links).toHaveLength(0);
    expect(page.flowPaths).toHaveLength(0);
    expect(page.zones[0]!.nodes).toEqual(['fw']);
    // Marker survives (it was on fw) but loses its dangling flowPathId.
    expect(page.policyMarkers[0]!.flowPathId).toBeUndefined();
    // The cleaned-up document still validates with no errors.
    expect(validateDocument(doc).filter((p) => p.level === 'error')).toEqual(
      [],
    );
  });

  it('removeElement without cascade leaves dangling refs for validate', () => {
    const { doc, page } = fabric();
    removeElement(page, 'a', { cascade: false });
    expect(page.links).toHaveLength(2); // dangling endpoints kept
    const errors = validateDocument(doc).filter((p) => p.level === 'error');
    expect(errors.some((p) => /references missing "a"/.test(p.message))).toBe(
      true,
    );
  });

  it('removeElement only drops flow paths the removal actually touched', () => {
    const { page } = fabric();
    // A pre-existing too-short path not involving the removed node survives.
    page.flowPaths.push({ id: 'short', waypoints: ['b'] });
    removeElement(page, 'fw');
    expect(page.flowPaths.some((f) => f.id === 'short')).toBe(true);
    expect(page.flowPaths.some((f) => f.id === 'fp')).toBe(true); // untouched
  });

  it('removing a zone clears parentZone on children', () => {
    const { page } = fabric();
    page.zones.push({ id: 'child', nodes: ['b'], parentZone: 'z' });
    const res = removeElement(page, 'z');
    expect(res.cascaded.childZones).toBe(1);
    expect(page.zones[0]!.parentZone).toBeUndefined();
  });

  it('upsertBySource creates, then converges on the same identity', () => {
    const { page } = fabric();
    const src = { system: 'edgeconnect', kind: 'appliance', id: 'nePk:77.NE' };
    const first = upsertBySource(
      page,
      'node',
      { ...src, fetchedAt: 't0' },
      {
        type: 'ec',
        x: 300,
        y: 300,
        label: 'EC-77',
      },
    );
    expect(first.created).toBe(true);
    const nodeId = first.element.id as string;
    expect(page.nodes).toHaveLength(4);

    // Same identity again → update in place, no duplicate, source refreshed.
    const second = upsertBySource(
      page,
      'node',
      { ...src, fetchedAt: 't1' },
      {
        label: 'EC-77 (HA)',
      },
    );
    expect(second.created).toBe(false);
    expect(second.element.id).toBe(nodeId);
    expect(page.nodes).toHaveLength(4);
    expect(page.nodes.find((n) => n.id === nodeId)?.label).toBe('EC-77 (HA)');
    expect(page.nodes.find((n) => n.id === nodeId)?.source?.fetchedAt).toBe(
      't1',
    );

    // A different kind with the same id is a different identity.
    const tunnel = upsertBySource(
      page,
      'link',
      { system: 'edgeconnect', kind: 'tunnel', id: 'nePk:77.NE' },
      { type: 'tunnel', from: 'a', to: nodeId },
    );
    expect(tunnel.created).toBe(true);
  });

  it('upsertBySource enforces per-kind create requirements', () => {
    const { page } = fabric();
    expect(() =>
      upsertBySource(
        page,
        'node',
        { system: 's', kind: 'k', id: '1' },
        { label: 'no position' },
      ),
    ).toThrow(/requires: type, x, y/);
    expect(() =>
      upsertBySource(page, 'link', { system: 's', kind: 'k', id: '2' }, {}),
    ).toThrow(/requires: type, from, to/);
  });

  it('validate flags malformed sources and duplicate identities', () => {
    const { doc, page } = fabric();
    updateElement(page, 'a', {
      source: { system: 'edgeconnect', kind: 'appliance', id: 'x1' },
    });
    updateElement(page, 'b', {
      source: { system: 'edgeconnect', kind: 'appliance', id: 'x1' },
    });
    updateElement(page, 'fw', { source: { system: '', kind: 'fw' } });
    const problems = validateDocument(doc);
    expect(
      problems.some(
        (p) => p.level === 'warning' && /duplicate source/.test(p.message),
      ),
    ).toBe(true);
    expect(
      problems.some(
        (p) => p.level === 'error' && /source\.system must be/.test(p.message),
      ),
    ).toBe(true);
    expect(
      problems.some(
        (p) => p.level === 'error' && /source\.id must be/.test(p.message),
      ),
    ).toBe(true);
  });
});
