/**
 * Node label wrapping + `labelWidth`, and the zone box growing around member
 * labels (#271).
 *
 * The engine (public/vendor/topology-ds.js `_renderNodeLabel` / `_zoneBox`)
 * and the TypeScript mirrors (`render/node-labels`, `render/label-placement`,
 * `render/zone-box`) must agree: the inspector, the layout analyzer and the
 * editor all size the drawn block from the TS side.
 */
import { describe, it, expect } from 'vitest';
import { renderPageToSVG } from '../server/render.js';
import { inspectPage } from './inspect.js';
import { nodeLabelPos, nodeLabelRect } from './label-placement.js';
import { nodeLabelLines } from './node-labels.js';
import { zoneBox } from './zone-box.js';
import { zoneBox as layoutZoneBox } from '../api/layout.js';
import { zoneBounds as editorZoneBounds } from '../editor/geometry.js';
import { parseDoc } from '../pages/persist.js';
import type { Page } from '../pages/model.js';
import type { NodeConfig, ZoneConfig } from '../vendor/topology-ds.js';

/** 40 characters, with spaces so the greedy wrap has somewhere to break. */
const SUB40 = 'QFX5120-32C 10.51.108.51 rack 12 slot 04';
/** 30 characters. */
const LABEL30 = 'edge-router-fallback-2 site-b1';

function pageWith(
  node: Record<string, unknown>,
  extra: Partial<Page> = {},
): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 1050 700',
    nodes: [{ id: 'n', type: 'firewall', x: 300, y: 300, ...node }],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
    ...extra,
  } as unknown as Page;
}

/** Every `<text>` in paint order as {x, y, size, content}. */
function texts(
  svg: string,
): { x: number; y: number; size: number; content: string }[] {
  const out: { x: number; y: number; size: number; content: string }[] = [];
  const re =
    /<text x="([\d.-]+)" y="([\d.-]+)" text-anchor="\w+" fill="[^"]*" font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g;
  for (const m of svg.matchAll(re))
    out.push({ x: +m[1]!, y: +m[2]!, size: +m[3]!, content: m[4]! });
  return out;
}

/** The first drawn zone `<rect>`. */
function zoneRectOf(svg: string): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const m = svg.match(
    /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" rx="8"/,
  )!;
  expect(m, 'zone rect drawn').not.toBeNull();
  return { x: +m[1]!, y: +m[2]!, w: +m[3]!, h: +m[4]! };
}

describe('node label lines (#271)', () => {
  it('fixtures are the lengths the tests claim', () => {
    expect(SUB40.length).toBe(40);
    expect(LABEL30.length).toBe(30);
  });

  it('wraps a 40-char sublabel to two 7.5px lines without labelWidth', () => {
    const svg = renderPageToSVG(pageWith({ label: 'FW', sublabel: SUB40 }));
    const subs = texts(svg).filter((t) => t.size === 7.5);
    expect(subs.map((t) => t.content)).toEqual(
      nodeLabelLines({ sublabel: SUB40 }).sublabel,
    );
    expect(subs).toHaveLength(2);
    expect(subs[0]!.y).toBe(324 + 13);
    expect(subs[1]!.y).toBe(324 + 13 + 9);
    expect(subs.map((t) => t.content).join(' ')).toBe(SUB40); // nothing cut
  });

  it('wraps a 30-char label to two lines with labelWidth, no ellipsis', () => {
    const svg = renderPageToSVG(
      pageWith({ label: LABEL30, labelWidth: 120, sublabel: 'srx' }),
    );
    const labels = texts(svg).filter((t) => t.size === 10);
    expect(labels).toHaveLength(2);
    expect(labels[0]!.y).toBe(324);
    expect(labels[1]!.y).toBe(336);
    expect(labels.map((t) => t.content).join(' ')).toBe(LABEL30);
    expect(svg).not.toContain('…');
    // The sublabel starts under the LAST label line.
    const sub = texts(svg).find((t) => t.size === 7.5)!;
    expect(sub.y).toBe(336 + 13);
  });

  it('keeps the 24-char truncation byte-identical without labelWidth', () => {
    const label = 'edge-router-fallback-2-abc'; // 26 chars
    const svg = renderPageToSVG(pageWith({ label, sublabel: 'srx' }));
    // The exact markup `_renderNodeLabel` produced before #271.
    expect(svg).toContain(
      '<text x="300" y="324" text-anchor="middle" fill="#e6e8e9" font-size="10" font-weight="600">edge-router-fallback-2-a…</text>' +
        '<text x="300" y="337" text-anchor="middle" fill="#7d8a92" font-size="7.5">srx</text>',
    );
  });

  it('cuts a sublabel past two lines with an ellipsis on the second', () => {
    const long = `${SUB40} ${SUB40}`;
    const lines = nodeLabelLines({ sublabel: long }).sublabel;
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
    const svg = renderPageToSVG(pageWith({ label: 'FW', sublabel: long }));
    expect(texts(svg).filter((t) => t.size === 7.5)).toHaveLength(2);
  });

  it('shifts a north-placed block up by the extra lines', () => {
    const one = texts(
      renderPageToSVG(
        pageWith({ label: 'FW', sublabel: 'srx', labelPlacement: 'n' }),
      ),
    );
    const two = texts(
      renderPageToSVG(
        pageWith({ label: 'FW', sublabel: SUB40, labelPlacement: 'n' }),
      ),
    );
    const label = (ts: typeof one): number =>
      ts.find((t) => t.content === 'FW')!.y;
    // One extra sublabel line (9px) lifts the label by 9; the last sublabel
    // line lands where the single one sat.
    expect(label(two)).toBe(label(one) - 9);
    expect(two.filter((t) => t.size === 7.5).at(-1)!.y).toBe(
      one.find((t) => t.size === 7.5)!.y,
    );
    // A wrapped label (12px line) lifts it by 12 more.
    const wrapped = texts(
      renderPageToSVG(
        pageWith({
          label: LABEL30,
          labelWidth: 120,
          sublabel: SUB40,
          labelPlacement: 'n',
        }),
      ),
    );
    expect(wrapped.find((t) => t.size === 10)!.y).toBe(label(two) - 12);
  });

  it('mirrors the engine baseline for wrapped blocks on every compass code', () => {
    for (const code of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
      const node = {
        id: 'n',
        type: 'router',
        x: 400,
        y: 200,
        label: LABEL30,
        labelWidth: 120,
        sublabel: SUB40,
        labelPlacement: code,
      } as NodeConfig;
      const first = texts(renderPageToSVG(pageWith(node))).find(
        (t) => t.size === 10,
      )!;
      const lp = nodeLabelPos(node);
      expect({ x: first.x, y: first.y }, code).toEqual({ x: lp.x, y: lp.y });
    }
  });

  it('sizes the label rect from the real line count and wrapped width', () => {
    const plain = nodeLabelRect({
      id: 'n',
      type: 'firewall',
      x: 300,
      y: 300,
      label: 'FW',
      sublabel: 'srx',
    })!;
    expect(plain.h).toBe(12 + 13); // one label + one sublabel line (as before)
    const tall = nodeLabelRect({
      id: 'n',
      type: 'firewall',
      x: 300,
      y: 300,
      label: 'FW',
      sublabel: SUB40,
    })!;
    expect(tall.h).toBe(12 + 13 + 9);
    const longest = Math.max(
      ...nodeLabelLines({ sublabel: SUB40 }).sublabel.map((l) => l.length),
    );
    expect(tall.w).toBe(longest * 4.5);
    const wrapped = nodeLabelRect({
      id: 'n',
      type: 'firewall',
      x: 300,
      y: 300,
      label: LABEL30,
      labelWidth: 120,
    })!;
    expect(wrapped.h).toBe(12 + 12);
    // Width is the longest drawn line × 6 — here the 22-char first word,
    // which the greedy wrap lets overflow the 20-char width rather than
    // breaking it mid-word (the same rule wire labels follow).
    const lines = nodeLabelLines({ label: LABEL30, labelWidth: 120 }).label;
    expect(lines).toEqual(['edge-router-fallback-2', 'site-b1']);
    expect(wrapped.w).toBe(22 * 6);
  });
});

describe('zone box includes member labels (#271)', () => {
  const zone = { id: 'z', label: 'Z', nodes: ['m'] } as ZoneConfig;

  function zonePage(member: Record<string, unknown>): Page {
    return pageWith(
      { id: 'm', type: 'ec', x: 500, y: 350, ...member },
      { zones: [zone] },
    );
  }

  it('grows the rendered zone around a west-placed 40-char sublabel, and every mirror agrees', () => {
    const page = zonePage({
      label: 'sw-dc-01',
      sublabel: SUB40,
      labelPlacement: 'w',
    });
    const rect = zoneRectOf(renderPageToSVG(page));
    const lr = nodeLabelRect(page.nodes[0]!)!;
    expect(lr.x).toBeLessThan(500 - 40); // the label really does escape the old box
    expect(rect.x).toBeLessThanOrEqual(lr.x);
    expect(rect.y).toBeLessThanOrEqual(lr.y);
    expect(rect.y + rect.h).toBeGreaterThanOrEqual(lr.y + lr.h);
    // Shared mirror, layout analyzer, editor and inspector: the same rect.
    const shared = zoneBox(page, zone)!;
    expect(shared).toEqual(rect);
    expect(layoutZoneBox(page, zone)).toEqual(rect);
    expect(editorZoneBounds(page, zone)).toEqual(rect);
    // The zone encloses its only member, so the inspector's content bounds
    // are exactly its (rounded) zone box.
    const r = (v: number): number => Math.round(v);
    expect(inspectPage(page).contentBounds).toEqual({
      x: r(rect.x),
      y: r(rect.y),
      w: r(rect.w),
      h: r(rect.h),
    });
  });

  it('leaves a zone with a short centred label exactly as before', () => {
    const page = zonePage({ label: 'Member' });
    const rect = zoneRectOf(renderPageToSVG(page));
    // ±40/±30 around (500, 350) + 40 padding — the pre-#271 numbers.
    expect(rect).toEqual({ x: 420, y: 280, w: 160, h: 140 });
    expect(zoneBox(page, zone)).toEqual(rect);
    expect(layoutZoneBox(page, zone)).toEqual(rect);
    expect(editorZoneBounds(page, zone)).toEqual(rect);
  });

  it('grows under a two-line sublabel on the classic placement', () => {
    const page = zonePage({ label: 'Member', sublabel: SUB40 });
    const rect = zoneRectOf(renderPageToSVG(page));
    const lr = nodeLabelRect(page.nodes[0]!)!;
    expect(lr.y + lr.h).toBeGreaterThan(350 + 30);
    expect(rect.y + rect.h).toBe(lr.y + lr.h + 40);
    expect(zoneBox(page, zone)).toEqual(rect);
  });

  it('does not add a label rect for types that draw their own label', () => {
    const page = zonePage({ type: 'text', label: SUB40, sublabel: SUB40 });
    const rect = zoneRectOf(renderPageToSVG(page));
    expect(nodeLabelRect(page.nodes[0]!)).toBeNull();
    expect(zoneBox(page, zone)).toEqual(rect);
  });
});

describe('node labelWidth persistence (#271)', () => {
  it('clamps a node labelWidth into [40, 600] on parse and drops junk', () => {
    const nodes = [
      { id: 'lo', type: 'ec', x: 1, y: 2, labelWidth: 5 },
      { id: 'hi', type: 'ec', x: 1, y: 2, labelWidth: 5000 },
      { id: 'ok', type: 'ec', x: 1, y: 2, labelWidth: 120 },
      { id: 'junk', type: 'ec', x: 1, y: 2, labelWidth: 'wide' },
    ];
    const doc = parseDoc(JSON.stringify({ title: 't', pages: [{ nodes }] }))!;
    const by = (id: string): NodeConfig =>
      doc.pages[0]!.nodes.find((n) => n.id === id)!;
    expect(by('lo').labelWidth).toBe(40);
    expect(by('hi').labelWidth).toBe(600);
    expect(by('ok').labelWidth).toBe(120);
    expect('labelWidth' in by('junk')).toBe(false);
  });
});
