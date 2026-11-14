/**
 * `parseDoc` is the one gate every document passes. These tests pin what it
 * guarantees about TYPES (so nothing behind it has to check again), and that
 * the guarantee costs a well-formed document nothing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDoc, serializeDoc } from './persist.js';
import { sampleDocument } from './model.js';
import { declaredKinds } from './typed-fields.js';
import { buildTemplate, listTemplates } from '../api/templates.js';
import {
  BRANCH_LAN,
  CLOUD_HUBS,
  DETAIL_LEVELS,
  SDWAN_VENDORS,
  SSE_MODES,
  generateSdwan,
} from '../connect/generate.js';

type El = Record<string, unknown>;

function parsePage(over: Record<string, unknown>): {
  nodes: El[];
  links: El[];
  anchors: El[];
  zones: El[];
  flowPaths: El[];
  policyMarkers: El[];
  viewBox: string;
} {
  const doc = parseDoc({
    title: 't',
    customNodes: [],
    pages: [
      {
        id: 'p1',
        name: 'Frame 1',
        viewBox: '0 0 1000 700',
        nodes: [],
        links: [],
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
        ...over,
      },
    ],
  });
  expect(doc).not.toBeNull();
  return doc!.pages[0] as never;
}

describe('parseDoc: every element is a usable object with a string id', () => {
  it('drops members that are not objects', () => {
    const page = parsePage({
      nodes: [null, 7, 'x', [], { id: 'a', type: 'router', x: 1, y: 2 }],
      links: [null],
      zones: [undefined, { id: 'z', nodes: [] }],
    });
    expect(page.nodes.map((n) => n.id)).toEqual(['a']);
    expect(page.links).toEqual([]);
    expect(page.zones.map((z) => z.id)).toEqual(['z']);
  });

  it('writes a numeric id as a string, and the references to it', () => {
    const page = parsePage({
      nodes: [
        { id: 1, type: 'router', x: 0, y: 0 },
        { id: 2, type: 'router', x: 100, y: 0 },
      ],
      links: [{ id: 10, type: 'line', from: 1, to: 2 }],
      zones: [{ id: 20, nodes: [1, 2] }],
      flowPaths: [{ id: 30, waypoints: [1, 2] }],
      policyMarkers: [{ id: 40, type: 'inspect', nodeId: 1 }],
    });
    expect(page.nodes.map((n) => n.id)).toEqual(['1', '2']);
    expect(page.links[0]).toMatchObject({ id: '10', from: '1', to: '2' });
    expect(page.zones[0]).toMatchObject({ id: '20', nodes: ['1', '2'] });
    expect(page.flowPaths[0]).toMatchObject({
      id: '30',
      waypoints: ['1', '2'],
    });
    expect(page.policyMarkers[0]).toMatchObject({ id: '40', nodeId: '1' });
  });

  it('drops an element whose id is not an id at all', () => {
    const page = parsePage({
      nodes: [
        { id: { nested: true }, type: 'router', x: 0, y: 0 },
        { type: 'router', x: 0, y: 0 },
        { id: 'ok', type: 'router', x: 0, y: 0 },
      ],
    });
    expect(page.nodes.map((n) => n.id)).toEqual(['ok']);
  });

  it('drops a link whose end is not an id', () => {
    const page = parsePage({
      nodes: [{ id: 'a', type: 'router', x: 0, y: 0 }],
      links: [
        { id: 'l1', type: 'line', from: 'a', to: { x: 1 } },
        { id: 'l2', type: 'line', from: 'a', to: 'a' },
      ],
    });
    expect(page.links.map((l) => l.id)).toEqual(['l2']);
  });
});

describe('parseDoc: a field is the kind the catalog declares, or absent', () => {
  it('numbers are finite numbers', () => {
    const [n] = parsePage({
      nodes: [
        {
          id: 'a',
          type: 'text',
          x: '300',
          y: 'not a number',
          opacity: '0.5',
          fontSize: '12"><script>',
          labelWidth: Number.NaN,
        },
      ],
    }).nodes;
    expect(n).toMatchObject({ x: 300, y: 0, opacity: 0.5 });
    expect(n).not.toHaveProperty('fontSize');
    expect(n).not.toHaveProperty('labelWidth');
  });

  it('a link flow setting that is not a number is dropped', () => {
    const [l] = parsePage({
      nodes: [
        { id: 'a', type: 'router', x: 0, y: 0 },
        { id: 'b', type: 'router', x: 100, y: 0 },
      ],
      links: [
        {
          id: 'l',
          type: 'tunnel',
          from: 'a',
          to: 'b',
          flowSpeed: 'fast',
          flowParticles: 4,
          strokeWidth: '3',
        },
      ],
    }).links;
    expect(l).not.toHaveProperty('flowSpeed');
    expect(l).toMatchObject({ flowParticles: 4, strokeWidth: 3 });
  });

  it('every colour field is a safe colour', () => {
    const bad = 'red"><image href=x onerror=alert(1)>';
    const [n] = parsePage({
      nodes: [
        {
          id: 'a',
          type: 'text',
          x: 0,
          y: 0,
          color: bad,
          fill: bad,
          borderColor: bad,
          agentColor: bad,
          labelColor: '#ff0000',
        },
      ],
    }).nodes;
    for (const key of ['color', 'fill', 'borderColor', 'agentColor'])
      expect(n).not.toHaveProperty(key);
    expect(n).toMatchObject({ labelColor: '#ff0000' });
  });

  it('booleans, enums, points and bend lists', () => {
    const page = parsePage({
      nodes: [
        { id: 'a', type: 'router', x: 0, y: 0, locked: 'yes', status: 'up"x' },
        { id: 'b', type: 'router', x: 100, y: 0, locked: true, status: 'up' },
      ],
      links: [
        {
          id: 'l',
          type: 'line',
          from: 'a',
          to: 'b',
          dashed: 1,
          labelOffset: { x: '4', y: 'oops' },
          waypoints: [
            { x: 10, y: 20 },
            { x: 'bad', y: 1 },
            null,
            { x: '30', y: 40 },
          ],
        },
      ],
    });
    expect(page.nodes[0]).not.toHaveProperty('locked');
    expect(page.nodes[0]).not.toHaveProperty('status');
    expect(page.nodes[1]).toMatchObject({ locked: true, status: 'up' });
    const [l] = page.links;
    expect(l).not.toHaveProperty('dashed');
    expect(l).not.toHaveProperty('labelOffset');
    expect(l!.waypoints).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
  });

  it('an anchor position is numbers', () => {
    const { anchors } = parsePage({
      anchors: [{ id: 'k', x: '450"><image onerror=x>', y: '480' }],
    });
    expect(anchors).toEqual([{ id: 'k', x: 0, y: 480 }]);
  });

  it('leaves fields the catalog does not list alone', () => {
    const [n] = parsePage({
      nodes: [{ id: 'a', type: 'router', x: 0, y: 0, futureField: { a: 1 } }],
    }).nodes;
    expect(n).toMatchObject({ futureField: { a: 1 } });
  });

  it('a field has one kind across every type of its scope', () => {
    // typed-fields.ts checks an element against the union of its scope's
    // fields, which is only sound while no key means two different things.
    const conflicts = [...declaredKinds()]
      .filter(([, kinds]) => kinds.size > 1)
      .map(([key, kinds]) => `${key}: ${[...kinds].join(' | ')}`);
    expect(conflicts).toEqual([]);
  });
});

describe('parseDoc: page and layer settings', () => {
  it.each([
    ['0 0 1050 700', '0 0 1050 700'],
    ['  0   0  1050 700 ', '0 0 1050 700'],
    ['0,0,1050,700', '0 0 1050 700'],
    ['-200 -100 1600.5 900', '-200 -100 1600.5 900'],
    ['0 0 1050 700"><script>', '0 0 1050 700'],
    ['0 0 -5 0', '0 0 1050 700'],
    ['nonsense', '0 0 1050 700'],
  ])('viewBox %j is stored as %j', (given, stored) => {
    expect(parsePage({ viewBox: given }).viewBox).toBe(stored);
  });

  it('a viewBox that is not a string becomes the default frame', () => {
    expect(parsePage({ viewBox: { x: 0 } }).viewBox).toBe('0 0 1050 700');
  });

  it('a layer colour is a safe colour and its opacity a number', () => {
    const doc = parseDoc({
      title: 't',
      customNodes: [],
      layers: [
        { id: 'L1', color: 'red"><pwn>', opacity: '0.5' },
        { id: 'L2', color: '#00ff00', opacity: 'half' },
      ],
      pages: [{ id: 'p', name: 'F', viewBox: '0 0 10 10' }],
    })!;
    expect(doc.layers).toEqual([
      { id: 'L1', opacity: 0.5 },
      { id: 'L2', color: '#00ff00' },
    ]);
  });
});

describe('parseDoc: a well-formed document comes through unchanged', () => {
  // The type gate must be invisible to every document the product itself
  // makes: serialize → parse → serialize is the identity.
  const roundTrips = (name: string, json: string): void => {
    const first = parseDoc(json);
    expect(first, name).not.toBeNull();
    const once = serializeDoc(first!);
    expect(serializeDoc(parseDoc(once)!), name).toBe(once);
    expect(JSON.parse(once), name).toEqual(
      JSON.parse(serializeDoc(parseDoc(JSON.parse(json))!)),
    );
  };

  /** Parsing must not change a document the product made itself. */
  const unchanged = (name: string, doc: unknown): void => {
    const before = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    const after = JSON.parse(serializeDoc(parseDoc(JSON.stringify(doc))!));
    expect(after.pages, name).toEqual(before.pages);
  };

  it('the sample scene', () => {
    unchanged('sample', sampleDocument());
  });

  it.each(listTemplates().map((t) => t.id))('template %s', (id) => {
    unchanged(id, buildTemplate(id));
  });

  it('generated SD-WAN fabrics', () => {
    for (const vendor of SDWAN_VENDORS)
      for (const detail of DETAIL_LEVELS)
        for (const sse of SSE_MODES)
          unchanged(
            `${vendor}/${detail}/${sse}`,
            generateSdwan({
              vendor,
              detail,
              sse,
              regions: 2,
              hubsPerRegion: 2,
              branchesPerRegion: 3,
              branchHa: true,
              branchLan: BRANCH_LAN[BRANCH_LAN.length - 1],
              cloudHub: CLOUD_HUBS[CLOUD_HUBS.length - 1],
              mapBackdrop: true,
            }).doc,
          );
  });

  it('the browser-test fixtures', () => {
    const dir = fileURLToPath(new URL('../../e2e/fixtures/', import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) roundTrips(f, readFileSync(dir + f, 'utf8'));
  });
});
