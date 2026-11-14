import { describe, expect, it } from 'vitest';
import type { Page } from '../pages/model.js';
import { FIND_LIMIT, findInDocument } from './find.js';

const page = (over: Partial<Page>): Page =>
  ({
    id: 'p',
    name: 'Frame',
    viewBox: '0 0 1000 700',
    nodes: [],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
    ...over,
  }) as Page;

const branch = page({
  nodes: [
    { id: 'ec1', type: 'ec', x: 0, y: 0, label: 'EC-Branch' },
    {
      id: 'fw1',
      type: 'firewall',
      x: 0,
      y: 0,
      label: 'SRX',
      sublabel: 'Edge firewall',
      meta: { mgmt: '10.1.1.1', serial: 'CX123' },
    },
    { id: 'nolabel', type: 'router', x: 0, y: 0 },
  ],
  links: [
    {
      id: 'l1',
      type: 'line',
      from: 'ec1',
      to: 'fw1',
      label: 'uplink',
      fromLabel: 'ge-0/0/1',
      toLabel: 'lan0',
    },
    { id: 'l2', type: 'tunnel', from: 'ec1', to: 'nolabel' },
  ],
  zones: [{ id: 'z1', label: 'Branch site', nodes: ['ec1'] }],
});
const hub = page({
  nodes: [{ id: 'hub', type: 'ec', x: 0, y: 0, label: 'EC-Hub' }],
  links: [],
  zones: [{ id: 'dmz', label: 'DMZ', nodes: ['hub'] }],
});
const doc = [branch, hub];

const rows = (q: string, current = 0) =>
  findInDocument(doc, q, current).map(
    (m) => `${m.pageIndex}:${m.kind}:${m.id}`,
  );

describe('findInDocument', () => {
  it('an empty query lists the nodes of the current frame', () => {
    expect(rows('')).toEqual(['0:node:ec1', '0:node:fw1', '0:node:nolabel']);
    expect(rows('  ', 1)).toEqual(['1:node:hub']);
  });

  it('finds a node by label, id or type, ignoring case', () => {
    expect(rows('srx')).toEqual(['0:node:fw1']);
    expect(rows('FW1')).toEqual(['0:node:fw1']);
    expect(rows('firewall')).toEqual(['0:node:fw1']);
  });

  it('finds a node by its sublabel or its metadata, and says why', () => {
    expect(findInDocument(doc, 'edge fire', 0)[0]).toMatchObject({
      id: 'fw1',
      detail: 'firewall · Edge firewall',
    });
    expect(findInDocument(doc, '10.1.1', 0)[0]).toMatchObject({
      id: 'fw1',
      detail: 'firewall · mgmt: 10.1.1.1',
    });
    expect(findInDocument(doc, 'serial', 0)[0]).toMatchObject({
      detail: 'firewall · serial: CX123',
    });
  });

  it('finds links by label, port label, id and type', () => {
    expect(rows('uplink')).toEqual(['0:link:l1']);
    expect(findInDocument(doc, 'ge-0/0', 0)[0]).toMatchObject({
      kind: 'link',
      id: 'l1',
      label: 'uplink',
      detail: 'line link · ge-0/0/1',
    });
    expect(findInDocument(doc, 'lan0', 0)[0]).toMatchObject({
      detail: 'line link · lan0',
    });
    expect(rows('tunnel')).toEqual(['0:link:l2']);
  });

  it('names an unlabelled link by its two ends', () => {
    expect(findInDocument(doc, 'l2', 0)[0]).toMatchObject({
      label: 'EC-Branch — nolabel',
      detail: 'tunnel link',
    });
  });

  it('finds zones by label or id', () => {
    expect(rows('branch site')).toEqual(['0:zone:z1']);
    expect(rows('dmz')).toEqual(['1:zone:dmz']);
  });

  it('searches every frame, the current one first', () => {
    expect(rows('ec')).toEqual(['0:node:ec1', '1:node:hub']);
    expect(rows('ec', 1)).toEqual(['1:node:hub', '0:node:ec1']);
  });

  it('lists a frame as nodes, then links, then zones', () => {
    // "1" is in the id of two nodes, a link and a zone of the first frame.
    expect(rows('1')).toEqual([
      '0:node:ec1',
      '0:node:fw1',
      '0:link:l1',
      '0:zone:z1',
    ]);
  });

  it('gives a node without a label a stand-in name', () => {
    expect(findInDocument(doc, 'nolabel', 0)[0]).toMatchObject({
      label: '(no label)',
      detail: 'router',
    });
  });

  it('keeps a label with line breaks on one line', () => {
    const p = page({
      nodes: [{ id: 'a', type: 'router', x: 0, y: 0, label: 'Core\nrouter' }],
    });
    expect(findInDocument([p], 'core', 0)[0]!.label).toBe('Core router');
  });

  it('stops at the limit', () => {
    const many = page({
      nodes: Array.from({ length: 80 }, (_, i) => ({
        id: `n${i}`,
        type: 'router',
        x: 0,
        y: 0,
        label: `Router ${i}`,
      })),
    });
    expect(findInDocument([many, many], 'router', 0)).toHaveLength(FIND_LIMIT);
    expect(findInDocument([many], '', 0)).toHaveLength(FIND_LIMIT);
  });

  it('tolerates a current frame that is not there, and odd metadata', () => {
    expect(rows('srx', 7)).toEqual(['0:node:fw1']);
    const p = page({
      nodes: [
        {
          id: 'a',
          type: 'router',
          x: 0,
          y: 0,
          label: 'A',
          meta: { nested: { deep: 'x' }, n: 7 } as never,
        },
      ],
    });
    expect(findInDocument([p], 'deep', 0)).toEqual([]);
    expect(findInDocument([p], '7', 0)[0]).toMatchObject({
      detail: 'router · n: 7',
    });
  });
});
