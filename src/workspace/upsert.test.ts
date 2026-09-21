import { describe, expect, it } from 'vitest';
import type { TopologyDocument } from '../pages/model.js';
import { normalizeOperations, isElementUpsert } from './upsert.js';

function doc(): TopologyDocument {
  return {
    title: 'T',
    customNodes: [],
    pages: [
      {
        id: 'p1',
        name: 'p1',
        viewBox: '0 0 1050 700',
        nodes: [
          { id: 'plain', type: 'ec', x: 1, y: 1 },
          {
            id: 'n-core1',
            type: 'router',
            x: 10,
            y: 10,
            label: 'core1',
            source: { system: 'netbox', kind: 'device', id: 'core1' },
          },
        ],
        links: [],
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
      },
    ],
  } as unknown as TopologyDocument;
}

const src = (id: string, fetchedAt = '2026-09-20T00:00:00Z') => ({
  system: 'netbox',
  kind: 'device',
  id,
  fetchedAt,
});

describe('element.upsert normalization (proposal 0006)', () => {
  it('patches a matching source, stripping id and refreshing fetchedAt', () => {
    const { operations, upserts } = normalizeOperations(doc(), [
      {
        type: 'element.upsert',
        pageId: 'p1',
        kind: 'nodes',
        source: src('core1', '2026-09-21T00:00:00Z'),
        element: { id: 'ignored', label: 'core1 (new)', x: 99 },
      },
    ]);
    expect(operations).toEqual([
      {
        type: 'element.patch',
        pageId: 'p1',
        kind: 'nodes',
        elementId: 'n-core1',
        patch: {
          set: {
            label: 'core1 (new)',
            x: 99,
            source: src('core1', '2026-09-21T00:00:00Z'),
          },
        },
      },
    ]);
    expect(upserts).toEqual([
      { index: 0, created: false, elementId: 'n-core1' },
    ]);
  });

  it('creates when nothing matches, honouring a requested id or minting one', () => {
    const { operations, upserts } = normalizeOperations(doc(), [
      {
        type: 'element.upsert',
        pageId: 'p1',
        kind: 'nodes',
        source: src('core2'),
        element: { id: 'n-core2', type: 'router', x: 1, y: 2 },
        afterElementId: null,
      },
      {
        type: 'element.upsert',
        pageId: 'p1',
        kind: 'nodes',
        source: src('core3'),
        element: { type: 'switch', x: 3, y: 4 },
      },
    ]);
    expect(operations[0]).toEqual({
      type: 'element.add',
      pageId: 'p1',
      kind: 'nodes',
      element: {
        type: 'router',
        x: 1,
        y: 2,
        id: 'n-core2',
        source: src('core2'),
      },
      afterElementId: null,
    });
    expect(operations[1]).toMatchObject({ type: 'element.add' });
    const minted = (operations[1] as unknown as { element: { id: string } })
      .element.id;
    expect(minted).toMatch(/^node-[0-9a-f]{8}$/);
    expect(upserts).toEqual([
      { index: 0, created: true, elementId: 'n-core2' },
      { index: 1, created: true, elementId: minted },
    ]);
  });

  it('is idempotent within one batch: a second upsert of the same source patches the first', () => {
    const { operations } = normalizeOperations(doc(), [
      {
        type: 'element.upsert',
        pageId: 'p1',
        kind: 'links',
        source: { system: 'netbox', kind: 'cable', id: 'c1' },
        element: { type: 'line', from: 'plain', to: 'n-core1' },
      },
      {
        type: 'element.upsert',
        pageId: 'p1',
        kind: 'links',
        source: { system: 'netbox', kind: 'cable', id: 'c1' },
        element: { label: 'Gi1 ↔ Gi2' },
      },
    ]);
    expect(operations[0]!.type).toBe('element.add');
    expect(operations[1]).toMatchObject({
      type: 'element.patch',
      elementId: (operations[0] as unknown as { element: { id: string } })
        .element.id,
    });
  });

  it('sees elements created by earlier ordinary ops in the same batch', () => {
    const { operations } = normalizeOperations(doc(), [
      {
        type: 'element.add',
        pageId: 'p1',
        kind: 'nodes',
        element: { id: 'n-x', type: 'ec', x: 0, y: 0, source: src('x') },
      },
      {
        type: 'element.upsert',
        pageId: 'p1',
        kind: 'nodes',
        source: src('x'),
        element: { label: 'X' },
      },
    ]);
    expect(operations[1]).toMatchObject({
      type: 'element.patch',
      elementId: 'n-x',
    });
  });

  it('passes ordinary operations through untouched', () => {
    const ordinary = {
      type: 'element.remove' as const,
      pageId: 'p1',
      kind: 'nodes' as const,
      elementId: 'plain',
    };
    const { operations, upserts } = normalizeOperations(doc(), [ordinary]);
    expect(operations).toEqual([ordinary]);
    expect(upserts).toEqual([]);
  });

  it('rejects anchors, bad sources, unknown pages, missing create fields, and id collisions', () => {
    const base = {
      type: 'element.upsert' as const,
      pageId: 'p1',
      source: src('q'),
    };
    expect(() =>
      normalizeOperations(doc(), [
        { ...base, kind: 'anchors' as never, element: { x: 1, y: 1 } },
      ]),
    ).toThrow(/anchors cannot carry a source/);
    expect(() =>
      normalizeOperations(doc(), [
        {
          ...base,
          kind: 'nodes',
          source: { system: 'netbox', kind: '', id: 'q' },
        },
      ]),
    ).toThrow(/source needs/);
    expect(() =>
      normalizeOperations(doc(), [
        {
          ...base,
          kind: 'nodes',
          pageId: 'nope',
          element: { type: 'ec', x: 1, y: 1 },
        },
      ]),
    ).toThrow(/unknown page/);
    expect(() =>
      normalizeOperations(doc(), [
        { ...base, kind: 'nodes', element: { label: 'no geometry' } },
      ]),
    ).toThrow(/requires: type, x, y/);
    expect(() =>
      normalizeOperations(doc(), [
        {
          ...base,
          kind: 'nodes',
          element: { id: 'plain', type: 'ec', x: 1, y: 1 },
        },
      ]),
    ).toThrow(/already exists .* without this source/);
    expect(isElementUpsert({ type: 'element.add' })).toBe(false);
    expect(isElementUpsert(base)).toBe(true);
  });
});
