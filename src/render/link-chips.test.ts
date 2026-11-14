/**
 * `link-chips.ts` mirrors the engine's label chips. These tests render every
 * chip type and compare the rectangle the engine drew with the one the mirror
 * predicts, so the two cannot drift apart unnoticed.
 */
import { describe, expect, it } from 'vitest';
import { renderDocumentToSVG } from '../server/render.js';
import { linkChipRect, type ChipLink } from './link-chips.js';
import { engineHitBoxes, linkEndpoints } from './link-attach.js';
import { inspectPage } from './inspect.js';
import type { Page, TopologyDocument } from '../pages/model.js';

const LABEL = 'LBL';

function page(
  link: Record<string, unknown>,
  to: { x: number; y: number },
): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 1400 1000',
    nodes: [
      { id: 'A', type: 'router', x: 600, y: 500, label: 'A' },
      { id: 'B', type: 'router', x: to.x, y: to.y, label: 'B' },
    ],
    links: [{ id: 'ab', from: 'A', to: 'B', label: LABEL, ...link }],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  } as unknown as Page;
}

const doc = (p: Page): TopologyDocument =>
  ({ title: 't', customNodes: [], pages: [p] }) as TopologyDocument;

/** The glass chip the engine drew behind the label text, in page space. */
function drawnChip(svg: string): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const text = svg.indexOf(`>${LABEL}</text>`);
  expect(text, 'label text is drawn').toBeGreaterThan(-1);
  const before = svg.slice(0, text);
  const all = [
    ...before.matchAll(
      /<rect x="([-\d.e]+)" y="([-\d.e]+)" width="([-\d.e]+)" height="([-\d.e]+)" rx="[\d.]+" fill="url\(#tds-labelGlass\)"/g,
    ),
  ];
  const m = all[all.length - 1]!;
  let r = { x: +m[1]!, y: +m[2]!, w: +m[3]!, h: +m[4]! };
  // A scaled label is wrapped in translate(c) scale(s) translate(-c).
  const g =
    /<g transform="translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\) translate\([^)]*\)">(?:(?!<\/g>).)*$/s.exec(
      before,
    );
  if (g) {
    const [cx, cy, s] = [+g[1]!, +g[2]!, +g[3]!];
    r = {
      x: cx + (r.x - cx) * s,
      y: cy + (r.y - cy) * s,
      w: r.w * s,
      h: r.h * s,
    };
  }
  return r;
}

const ENDS: [string, { x: number; y: number }][] = [
  ['east', { x: 1000, y: 500 }],
  ['west', { x: 200, y: 500 }],
  ['south', { x: 600, y: 900 }],
  ['north', { x: 600, y: 100 }],
  ['south-east', { x: 950, y: 800 }],
  ['north-west', { x: 250, y: 180 }],
];

const VARIANTS: [string, Record<string, unknown>][] = [
  ['default', {}],
  ['offset', { labelOffset: { x: 37, y: -22 } }],
  ['scaled', { labelScale: 1.5 }],
  ['offset and scaled', { labelOffset: { x: -18, y: 41 }, labelScale: 0.75 }],
];

const TYPES: [string, Record<string, unknown>][] = [
  ['tunnel', { type: 'tunnel' }],
  ['wireguard', { type: 'wireguard' }],
  [
    'wireguard with a bend',
    { type: 'wireguard', waypoints: [{ x: 620, y: 300 }] },
  ],
  ['flow', { type: 'flow' }],
  ['flow pinned by labelPos', { type: 'flow', labelPos: { x: 300, y: 250 } }],
  ['packet', { type: 'packet' }],
  ['packet with a sublabel', { type: 'packet', sublabel: 'sub' }],
  ['wifi', { type: 'wifi' }],
  ['poe', { type: 'poe' }],
  ['optical', { type: 'optical' }],
];

describe('linkChipRect matches the chip the engine draws', () => {
  for (const [typeName, typeCfg] of TYPES)
    it(typeName, () => {
      for (const [dirName, to] of ENDS)
        for (const [variantName, variant] of VARIANTS) {
          const p = page({ ...typeCfg, ...variant }, to);
          const link = p.links[0]!;
          const ends = linkEndpoints(p, link, { hitBoxes: engineHitBoxes() })!;
          const predicted = linkChipRect(
            link as unknown as ChipLink,
            ends.from,
            ends.to,
          );
          const drawn = drawnChip(renderDocumentToSVG(doc(p)));
          const where = `${typeName} / ${dirName} / ${variantName}`;
          expect(predicted, where).toBeTruthy();
          const r = predicted as { x: number; y: number; w: number; h: number };
          expect(r.x, `${where} x`).toBeCloseTo(drawn.x, 1);
          expect(r.y, `${where} y`).toBeCloseTo(drawn.y, 1);
          expect(r.w, `${where} w`).toBeCloseTo(drawn.w, 1);
          expect(r.h, `${where} h`).toBeCloseTo(drawn.h, 1);
        }
    });

  it('a blocked link draws no centre label, and a line link is not a chip', () => {
    const at = { x: 0, y: 0 };
    expect(linkChipRect({ type: 'blocked', label: 'x' }, at, at)).toBeNull();
    expect(linkChipRect({ type: 'line', label: 'x' }, at, at)).toBeUndefined();
    const p = page({ type: 'blocked' }, { x: 1000, y: 500 });
    expect(renderDocumentToSVG(doc(p))).not.toContain(`>${LABEL}</text>`);
  });
});

describe('labelOffset is a page-space shift for every link type', () => {
  // The drag gesture, the Properties compass and the MCP tools all speak page
  // x/y. A label moved "down 40" must move down, whichever way the link runs.
  for (const [typeName, typeCfg] of TYPES)
    it(typeName, () => {
      for (const [dirName, to] of ENDS) {
        const at = (offset?: {
          x: number;
          y: number;
        }): { x: number; y: number } => {
          const p = page(
            { ...typeCfg, ...(offset ? { labelOffset: offset } : {}) },
            to,
          );
          const r = drawnChip(renderDocumentToSVG(doc(p)));
          return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
        };
        const home = at();
        const moved = at({ x: 25, y: 40 });
        expect(moved.x - home.x, `${typeName} / ${dirName} x`).toBeCloseTo(
          25,
          1,
        );
        expect(moved.y - home.y, `${typeName} / ${dirName} y`).toBeCloseTo(
          40,
          1,
        );
      }
    });
});

describe('the inspector sees a chip where it is drawn', () => {
  const findings = (p: Page): string[] =>
    inspectPage(p).findings.map((f) => f.message);

  it('reports a tunnel label that sits on a third node', () => {
    // A left-to-right tunnel's chip sits ABOVE the wire. A node placed there
    // is covered by it; the old model looked below the wire and saw nothing.
    const p = page({ type: 'tunnel' }, { x: 1000, y: 500 });
    p.nodes.push({
      id: 'C',
      type: 'router',
      x: 800,
      y: 478,
      label: 'C',
    } as never);
    expect(
      findings(p).some((m) => /label of link "ab".*sits on node "C"/.test(m)),
    ).toBe(true);
  });

  it('does not report a node on the side the chip is not on', () => {
    const p = page({ type: 'tunnel' }, { x: 1000, y: 500 });
    p.nodes.push({
      id: 'C',
      type: 'router',
      x: 800,
      y: 560,
      label: 'C',
    } as never);
    expect(
      findings(p).some((m) => /label of link "ab".*sits on node "C"/.test(m)),
    ).toBe(false);
  });

  it('follows a page-space labelOffset', () => {
    // Moved 80 down, the chip now covers the node under the wire.
    const p = page(
      { type: 'tunnel', labelOffset: { x: 0, y: 80 } },
      { x: 1000, y: 500 },
    );
    p.nodes.push({
      id: 'C',
      type: 'router',
      x: 800,
      y: 560,
      label: 'C',
    } as never);
    expect(
      findings(p).some((m) => /label of link "ab".*sits on node "C"/.test(m)),
    ).toBe(true);
  });
});
