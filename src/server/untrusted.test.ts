/**
 * A document is untrusted input: it can come from an opened file, an import or
 * a public share link. The renderer builds markup by interpolation, so these
 * tests feed it a document whose every string is a markup payload and check
 * that none of it reaches the SVG as markup, and that a value of the wrong
 * type cannot make the renderer throw.
 */
import { describe, expect, it } from 'vitest';
import { renderDocumentToSVG } from './render.js';
import { parseDoc } from '../pages/persist.js';
import {
  annotationCatalog,
  linkCatalog,
  nodeCatalog,
  type FieldSpec,
} from '../api/catalog.js';
import type { TopologyDocument } from '../pages/model.js';

/** Closes an attribute, opens an element, and reopens an attribute. */
const payload = (tag: string): string =>
  `x" data-pwn="${tag}"><pwn>${tag}</pwn><g y="`;

/** What got through as markup: injected elements, injected attributes. */
function injected(svg: string): string[] {
  return [
    ...[...svg.matchAll(/<pwn>([^<]*)<\/pwn>/g)].map((m) => `<pwn>${m[1]}`),
    ...[...svg.matchAll(/" data-pwn="([^"]*)"/g)].map((m) => `attr ${m[1]}`),
  ];
}

type El = Record<string, unknown>;

const STRUCTURAL = new Set([
  'id',
  'type',
  'x',
  'y',
  'from',
  'to',
  'nodes',
  'waypoints',
  'nodeId',
  'linkId',
  'flowPathId',
  'layer',
  'hidden',
  'locked',
  'parentZone',
]);

/** A valid, representative value for a catalog field. */
function sample(f: FieldSpec): unknown {
  switch (f.kind) {
    case 'enum':
      return f.options?.[f.options.length - 1];
    case 'number':
      return 12;
    case 'color':
      return '#ff0000';
    case 'boolean':
      return true;
    case 'record':
      return { k: 'v' };
    case 'string':
      return 'txt';
    default:
      return undefined;
  }
}

function filled(fields: readonly FieldSpec[]): El {
  const el: El = {};
  for (const f of fields) {
    if (STRUCTURAL.has(f.key)) continue;
    const v = sample(f);
    if (v !== undefined) el[f.key] = v;
  }
  return el;
}

function hostile(fields: readonly FieldSpec[], scope: string): El {
  const el: El = {};
  for (const f of fields) {
    if (STRUCTURAL.has(f.key)) continue;
    el[f.key] =
      f.kind === 'record'
        ? { k: payload(`${scope}.${f.key}`) }
        : f.kind === 'point'
          ? { x: payload(`${scope}.${f.key}.x`), y: 0 }
          : payload(`${scope}.${f.key}`);
  }
  return el;
}

const annotation = (kind: string): readonly FieldSpec[] =>
  annotationCatalog().find((a) => a.kind === kind)!.fields;

function page(over: Record<string, El[]>): TopologyDocument {
  return {
    title: 't',
    customNodes: [],
    pages: [
      {
        id: 'p1',
        name: 'Frame 1',
        viewBox: '0 0 1000 700',
        nodes: [
          { id: 'A', type: 'router', x: 200, y: 300, label: 'A' },
          { id: 'B', type: 'router', x: 600, y: 300, label: 'B' },
          { id: 'C', type: 'router', x: 600, y: 550, label: 'C' },
        ],
        links: [{ id: 'ab', type: 'line', from: 'A', to: 'B' }],
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
        ...over,
      },
    ],
  } as unknown as TopologyDocument;
}

/** One document where every field of every element type is a payload. */
function everythingHostile(): TopologyDocument {
  const nodes: El[] = [
    { id: 'A', type: 'router', x: 100, y: 3000, label: 'A' },
    { id: 'B', type: 'router', x: 500, y: 3000, label: 'B' },
    { id: 'C', type: 'router', x: 900, y: 3000, label: 'C' },
  ];
  nodeCatalog().forEach((t, i) =>
    nodes.push({
      ...hostile(t.fields, `node:${t.type}`),
      id: `n${i}`,
      type: t.type,
      x: 100 + (i % 12) * 130,
      y: 100 + Math.floor(i / 12) * 160,
    }),
  );
  const links: El[] = linkCatalog().map((t, i) => ({
    ...hostile(t.fields, `link:${t.type}`),
    id: `l${i}`,
    type: t.type,
    from: i % 2 ? 'A' : 'B',
    to: i % 2 ? 'B' : 'C',
  }));
  const doc = page({
    nodes,
    links,
    anchors: [{ id: 'k', x: `450${payload('anchor.x')}`, y: 480 }],
    zones: [{ ...hostile(annotation('zone'), 'zone'), id: 'z', nodes: ['A'] }],
    flowPaths: [
      {
        ...hostile(annotation('flowPath'), 'flow'),
        id: 'f',
        waypoints: ['A', 'B', 'C'],
      },
    ],
    policyMarkers: [
      {
        ...hostile(annotation('policyMarker'), 'marker'),
        id: 'm',
        nodeId: 'A',
      },
      {
        ...hostile(annotation('policyMarker'), 'marker'),
        id: 'm2',
        linkId: 'l0',
      },
    ],
  });
  doc.pages[0]!.viewBox = '0 0 1700 3200';
  doc.title = payload('title');
  (doc as unknown as El).layers = [
    { id: 'L1', name: payload('layer.name'), color: payload('layer.color') },
  ];
  (doc as unknown as El).legend = {
    show: true,
    title: payload('legend.title'),
  };
  (doc.pages[0]!.nodes[0] as unknown as El).layer = 'L1';
  return doc;
}

describe('a document cannot inject markup through the renderer', () => {
  it('holds when every field of every element type is a payload', () => {
    const doc = everythingHostile();
    expect(injected(renderDocumentToSVG(structuredClone(doc)))).toEqual([]);
    expect(
      injected(renderDocumentToSVG(structuredClone(doc), 0, { calm: true })),
    ).toEqual([]);
  });

  it('holds for the same document after the parse gate', () => {
    const parsed = parseDoc(JSON.stringify(everythingHostile()))!;
    expect(injected(renderDocumentToSVG(parsed))).toEqual([]);
  });

  it('holds for every catalog field on its own, among valid neighbours', () => {
    // A field alone, with every other field valid: sinks that are only reached
    // when a neighbouring option is set (an agent badge, a text box border).
    const leaks: string[] = [];
    const check = (name: string, doc: TopologyDocument): void => {
      for (const hit of injected(renderDocumentToSVG(doc)))
        leaks.push(`${name}: ${hit}`);
    };
    for (const t of nodeCatalog())
      for (const f of t.fields) {
        if (STRUCTURAL.has(f.key)) continue;
        check(
          `node:${t.type}.${f.key}`,
          page({
            nodes: [
              {
                ...filled(t.fields),
                id: 'A',
                type: t.type,
                x: 200,
                y: 300,
                [f.key]: payload(f.key),
              },
              { id: 'B', type: 'router', x: 600, y: 300, label: 'B' },
            ],
          }),
        );
      }
    for (const t of linkCatalog())
      for (const f of t.fields) {
        if (STRUCTURAL.has(f.key) || f.key === 'style') continue;
        check(
          `link:${t.type}.${f.key}`,
          page({
            links: [
              {
                ...filled(t.fields),
                style: undefined,
                id: 'ab',
                type: t.type,
                from: 'A',
                to: 'B',
                [f.key]: payload(f.key),
              },
            ],
          }),
        );
      }
    expect(leaks).toEqual([]);
  }, 60_000);

  it('holds for ids, which are written out as data attributes', () => {
    const id = (tag: string): string => payload(tag);
    const doc = page({
      nodes: [
        { id: id('node'), type: 'router', x: 200, y: 300, label: 'A' },
        { id: 'B', type: 'router', x: 600, y: 300, label: 'B' },
        {
          id: 'C',
          type: 'image',
          x: 600,
          y: 550,
          imageHref: 'https://x/y.png',
        },
      ],
      links: [
        { id: id('link'), type: 'line', from: id('node'), to: 'B' },
        { id: 'l2', type: 'tunnel', from: 'B', to: id('anchor') },
      ],
      anchors: [{ id: id('anchor'), x: 450, y: 480 }],
      zones: [{ id: id('zone'), label: 'Z', nodes: ['B'] }],
      flowPaths: [{ id: id('flow'), waypoints: [id('node'), 'B'], label: 'F' }],
      policyMarkers: [{ id: id('marker'), nodeId: 'B', type: 'inspect' }],
    });
    const svg = renderDocumentToSVG(doc);
    expect(injected(svg)).toEqual([]);
    // The id is still there, as data: escaped once, readable by the editor.
    expect(svg).toContain(
      'data-tds-node="x&quot; data-pwn=&quot;node&quot;&gt;&lt;pwn&gt;node',
    );
  });

  it('ignores panel art smuggled in a node config', () => {
    // Wire-sheet panel art is markup the renderer writes out as is; it must
    // come from the layout, never from the document.
    const doc = page({
      nodes: [
        {
          id: 'A',
          type: 'router',
          x: 200,
          y: 300,
          __wsArt: '<pwn>art</pwn>',
        },
      ],
      links: [],
    });
    expect(injected(renderDocumentToSVG(doc))).toEqual([]);
  });

  it('keeps a hostile viewBox out of the root element', () => {
    const doc = page({});
    doc.pages[0]!.viewBox = `0 0 1000 700${payload('viewBox')}`;
    const svg = renderDocumentToSVG(doc);
    expect(injected(svg)).toEqual([]);
    expect(
      svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="'),
    ).toBe(true);
  });
});

describe('free text is drawn as the text that was typed', () => {
  // Escaped once: a label with markup characters shows those characters.
  const text = 'a <b> & "c"';
  const once = 'a &lt;b&gt; &amp; &quot;c&quot;';

  it('node and link labels', () => {
    const svg = renderDocumentToSVG(
      page({
        nodes: [
          { id: 'A', type: 'router', x: 200, y: 300, label: text },
          { id: 'B', type: 'router', x: 600, y: 300, label: 'B' },
        ],
        links: [{ id: 'ab', type: 'line', from: 'A', to: 'B', label: text }],
      }),
    );
    expect(svg).toContain(once);
    expect(svg).not.toContain('&amp;lt;');
    expect(svg).not.toContain('&amp;quot;');
  });

  it('link end labels and a marker icon', () => {
    const svg = renderDocumentToSVG(
      page({
        links: [
          {
            id: 'ab',
            type: 'line',
            from: 'A',
            to: 'B',
            fromLabel: '<lan0>',
            toLabel: '"wan0"',
          },
        ],
        policyMarkers: [{ id: 'm', nodeId: 'A', type: 'inspect', icon: '<!>' }],
      }),
    );
    expect(svg).toContain('>&lt;lan0&gt;</text>');
    expect(svg).toContain('>&quot;wan0&quot;</text>');
    expect(svg).toContain('>&lt;!&gt;</text>');
    expect(svg).not.toContain('&amp;lt;');
  });

  it('an inline SVG image keeps its data URI', () => {
    const href =
      'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>';
    const svg = renderDocumentToSVG(
      page({
        nodes: [{ id: 'A', type: 'image', x: 200, y: 300, imageHref: href }],
        links: [],
      }),
    );
    // Escaped once for the attribute; a browser decodes it back to `href`.
    expect(svg).toContain(
      'href="data:image/svg+xml;utf8,&lt;svg xmlns=&quot;http://www.w3.org/2000/svg&quot;/&gt;"',
    );
  });
});

describe('a value of the wrong type cannot crash the renderer', () => {
  it.each([
    [
      'a string flow speed',
      {
        links: [
          { id: 'ab', type: 'tunnel', from: 'A', to: 'B', flowSpeed: 'fast' },
        ],
      },
    ],
    [
      'a string particle count',
      {
        links: [
          { id: 'ab', type: 'flow', from: 'A', to: 'B', flowParticles: 'many' },
        ],
      },
    ],
    [
      'a string span list',
      {
        nodes: [
          { id: 'A', type: 'overlayCloud', x: 200, y: 300, spans: 'B' },
          { id: 'B', type: 'router', x: 600, y: 300 },
        ],
        links: [],
      },
    ],
  ] as [string, Record<string, El[]>][])('%s', (_name, over) => {
    expect(() => renderDocumentToSVG(page(over))).not.toThrow();
  });
});
