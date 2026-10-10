/**
 * Link anchor box (experimental) — engine ↔ TypeScript mirror equivalence,
 * plus the feature's own contracts: byte-identical output when the options
 * are absent, deterministic distribute ordering, offset clamping and the
 * degenerate shrink order. The vendored engine is the source of truth: every
 * fixture is pushed through `_linkGeometry` and `render/link-attach` must
 * return the same endpoints within 0.01px.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { ensureShim, type EngineStatic } from './core.js';
import {
  anchorBox,
  createAttachContext,
  effectiveLinkAttach,
  engineHitBoxes,
  linkEndpoints,
  type Pt,
} from './link-attach.js';
import { renderDocumentToSVG, renderPageToSVG } from '../server/render.js';
import { parseDoc, serializeDoc } from '../pages/persist.js';
import { sampleDocument, type Page } from '../pages/model.js';
import { customHitBox } from '../nodes/render.js';
import { STOCK_NODE_SPECS } from '../nodes/stock.js';
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';
import { getLinkType, getNodeType } from '../api/catalog.js';
import { validateDocument } from '../api/validate.js';
import { inspectPage } from './inspect.js';

/* ── engine harness ────────────────────────────────────────────────── */

interface GeometryEngine {
  linkAttach?: unknown;
  node(id: string, cfg: Record<string, unknown>): void;
  link(id: string, cfg: Record<string, unknown>): void;
  anchor(id: string, pos: Pt): void;
  _links: Map<string, LinkConfig>;
  _linkGeometry(cfg: LinkConfig): { from: Pt; to: Pt };
}

function loadEngine(): EngineStatic {
  ensureShim();
  const require = createRequire(import.meta.url);
  const mod = require('../../public/vendor/topology-ds.js') as unknown;
  const E = ((mod as { default?: EngineStatic }).default ??
    mod) as EngineStatic;
  // The stock cloud pack, registered the way render/core does it (hit boxes
  // are what attachment reads; the art is irrelevant here).
  for (const spec of STOCK_NODE_SPECS)
    E.registerNodeType(spec.typeName, {
      render: () => '',
      defaults: {},
      hitBox: customHitBox(spec),
    });
  return E;
}
const Engine = loadEngine();

/** The engine's drawn endpoints for every link on a page. */
function engineEndpoints(page: Page): Map<string, { from: Pt; to: Pt }> {
  const topo = new Engine({
    viewBox: page.viewBox,
  }) as unknown as GeometryEngine;
  topo.linkAttach = page.linkAttach ?? null;
  for (const a of page.anchors) topo.anchor(a.id, { x: a.x, y: a.y });
  for (const n of page.nodes) {
    const { id, ...cfg } = n;
    topo.node(id, cfg);
  }
  for (const l of page.links) {
    const { id, ...cfg } = l;
    topo.link(id, cfg);
  }
  const out = new Map<string, { from: Pt; to: Pt }>();
  for (const [id, cfg] of topo._links) {
    const g = topo._linkGeometry(cfg);
    out.set(id, { from: { ...g.from }, to: { ...g.to } });
  }
  return out;
}

function expectMirrorAgrees(page: Page): void {
  const engine = engineEndpoints(page);
  const ctx = createAttachContext(page, { hitBoxes: engineHitBoxes() });
  expect(engine.size).toBe(page.links.length);
  for (const l of page.links) {
    const e = engine.get(l.id)!;
    const m = ctx.endpoints(l);
    expect(m, `link ${l.id}`).not.toBeNull();
    for (const end of ['from', 'to'] as const) {
      expect(
        Math.abs(m![end].x - e[end].x),
        `${l.id}.${end}.x mirror=${m![end].x} engine=${e[end].x}`,
      ).toBeLessThanOrEqual(0.01);
      expect(
        Math.abs(m![end].y - e[end].y),
        `${l.id}.${end}.y mirror=${m![end].y} engine=${e[end].y}`,
      ).toBeLessThanOrEqual(0.01);
    }
  }
}

/* ── fixtures ──────────────────────────────────────────────────────── */

function page(partial: Partial<Page>): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 1050 700',
    nodes: [],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
    ...partial,
  };
}
const node = (
  id: string,
  type: string,
  x: number,
  y: number,
  extra: Partial<NodeConfig> = {},
): NodeConfig => ({ id, type, x, y, label: id, ...extra });
const link = (
  id: string,
  from: string,
  to: string,
  extra: Partial<LinkConfig> = {},
): LinkConfig => ({ id, type: 'line', from, to, ...extra });

/** A hub with links leaving every side, mixed ports, siblings and waypoints. */
function hubPage(extra: Partial<Page> = {}): Page {
  return page({
    nodes: [
      node('hub', 'ec', 500, 350, { sublabel: 'core' }),
      node('n1', 'router', 500, 120),
      node('n2', 'cloud', 820, 120),
      node('e1', 'server', 860, 350),
      node('s1', 'switch', 500, 600, { labelPlacement: 'n' }),
      node('s2', 'firewall', 300, 600, { labelPlacement: 'e' }),
      node('w1', 'usergroup', 150, 350),
      node('c1', 'shape:circle', 700, 560, { shapeSize: 30 }),
      node('ap1', 'ap', 180, 150),
    ],
    links: [
      link('l-n1', 'hub', 'n1'),
      link('l-n2', 'hub', 'n2'),
      link('l-e1a', 'hub', 'e1'),
      link('l-e1b', 'e1', 'hub'), // sibling pair → parallel fan-out
      link('l-e1c', 'hub', 'e1', { label: 'third' }),
      link('l-s1', 'hub', 's1', { fromPort: 's', toPort: 'n' }),
      link('l-s2', 'hub', 's2', { fromPort: 'sw', toPort: 'ne' }),
      link('l-w1', 'w1', 'hub', { toPort: 'w' }),
      link('l-c1', 'hub', 'c1', { waypoints: [{ x: 520, y: 480 }] }),
      link('l-ap', 'ap1', 'hub', {
        lineStyle: 'orthogonal',
        waypoints: [{ x: 330, y: 150 }],
      }),
      link('l-tun', 'n2', 'e1', { type: 'tunnel' }),
      link('l-anchor', 'a1', 'hub'),
    ],
    anchors: [{ id: 'a1', x: 640, y: 660 }],
    ...extra,
  });
}

/* ── engine ↔ mirror ───────────────────────────────────────────────── */

describe('link-attach mirror agrees with the engine', () => {
  it('classic attachment: auto, ports, siblings, waypoints, shapes, anchors', () => {
    expectMirrorAgrees(hubPage());
  });

  it('anchor box on (page-level, default pad)', () => {
    expectMirrorAgrees(hubPage({ linkAttach: {} }));
  });

  it('anchor box with a custom pad and node-level overrides', () => {
    const p = hubPage({ linkAttach: { pad: 10 } });
    p.nodes[0]!.linkAttach = { pad: 2 };
    p.nodes[3]!.linkAttach = { distribute: true };
    expectMirrorAgrees(p);
  });

  it('node-level option alone activates the feature for that node', () => {
    const p = hubPage();
    p.nodes[0]!.linkAttach = { pad: 4, distribute: true };
    expectMirrorAgrees(p);
  });

  it('distribute with port offsets', () => {
    const p = hubPage({ linkAttach: { distribute: true } });
    p.links[0]!.fromPortOffset = 0.5;
    p.links[5]!.fromPortOffset = -0.75;
    p.links[5]!.toPortOffset = 1;
    p.links[7]!.toPortOffset = -0.3;
    p.links[8]!.fromPortOffset = 0.2;
    expectMirrorAgrees(p);
  });

  it('port offsets without distribute (side ports, auto, corner ignored)', () => {
    const p = hubPage({ linkAttach: {} });
    p.links[0]!.fromPortOffset = 0.5; // auto endpoint → box
    p.links[1]!.toPortOffset = -0.5; // auto on an ellipse → forces the box
    p.links[5]!.fromPortOffset = -1;
    p.links[6]!.fromPortOffset = 1; // corner port: ignored
    p.links[7]!.toPortOffset = 0.6;
    expectMirrorAgrees(p);
  });

  it('circle / ellipse silhouettes inflate by pad off the label side', () => {
    const p = page({
      linkAttach: { pad: 8 },
      nodes: [
        node('r', 'router', 300, 300, { labelPlacement: 'n' }),
        node('c', 'cloud', 700, 300),
        node('x', 'host', 300, 80),
        node('y', 'host', 700, 560),
      ],
      links: [
        link('rc', 'r', 'c'),
        link('rx', 'r', 'x'), // exits the label (north) side → box
        link('cy', 'c', 'y'), // exits the label (south) side → box
        link('xy', 'x', 'y'),
      ],
    });
    expectMirrorAgrees(p);
  });

  it('degenerate: close and overlapping nodes shrink pad → 0 → classic → centre', () => {
    for (const dx of [120, 90, 76, 70, 60, 30, 8, 0]) {
      const p = page({
        linkAttach: { pad: 6 },
        nodes: [node('a', 'ec', 400, 300), node('b', 'ec', 400 + dx, 300)],
        links: [link('ab', 'a', 'b'), link('ba', 'b', 'a', { type: 'tunnel' })],
      });
      expectMirrorAgrees(p);
    }
  });

  it('the sample document and the fixtures, classic and boxed', () => {
    const docs = [sampleDocument()];
    for (const rel of [
      '../../fixtures/EdgeHA_after.json',
      '../../fixtures/EdgeHA_before.json',
      './__fixtures__/anchor-routing.json',
    ]) {
      const raw = readFileSync(
        fileURLToPath(new URL(rel, import.meta.url)),
        'utf8',
      );
      const doc = parseDoc(raw);
      expect(doc, rel).not.toBeNull();
      docs.push(doc!);
    }
    for (const doc of docs)
      for (const pg of doc.pages) {
        const ctxHit = engineHitBoxes(doc.customNodes);
        const engine = engineEndpoints(pg);
        for (const variant of [
          pg,
          { ...pg, linkAttach: {} },
          { ...pg, linkAttach: { distribute: true, pad: 4 } },
        ]) {
          const v = variant as Page;
          const ctx = createAttachContext(v, { hitBoxes: ctxHit });
          const eng = v === pg ? engine : engineEndpoints(v);
          for (const l of v.links) {
            const m = ctx.endpoints(l);
            const e = eng.get(l.id);
            if (!e) continue;
            expect(m).not.toBeNull();
            expect(Math.abs(m!.from.x - e.from.x)).toBeLessThanOrEqual(0.01);
            expect(Math.abs(m!.from.y - e.from.y)).toBeLessThanOrEqual(0.01);
            expect(Math.abs(m!.to.x - e.to.x)).toBeLessThanOrEqual(0.01);
            expect(Math.abs(m!.to.y - e.to.y)).toBeLessThanOrEqual(0.01);
          }
        }
      }
  });
});

/* ── byte-identical when absent ───────────────────────────────────── */

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

describe('byte-identical output when the options are absent', () => {
  // SHA-256 of the headless render on origin/main at 5b82648 (PR #272, the
  // merge base of this feature) with no linkAttach anywhere. Any legitimate
  // render change in a later PR must update these alongside its own snapshot.
  const EXPECTED: Record<string, string> = {
    sampleDocument:
      '7c1a47f161b10e708b27ca9406740089f2864437c3b51f391795b5b74d5fc56e',
    'fixtures/EdgeHA_after.json':
      'b13355e102606d559c248cb7f17c9618fb83dee29b5d407000767e21102ed57f',
    'fixtures/EdgeHA_before.json':
      'ffa5ca461d5d3f29f1a7839dd4eef9549aa50f358f73d095b6f4357bb80ee1c3',
    'src/render/__fixtures__/anchor-routing.json':
      '1cf10ecf22c1114f135cab1eb2253b63cc5e09b7eee99b536d9c66faa74e2764',
  };

  it('sample document renders to the pre-feature bytes', () => {
    expect(sha(renderDocumentToSVG(sampleDocument()))).toBe(
      EXPECTED.sampleDocument,
    );
  });

  it.each([
    'fixtures/EdgeHA_after.json',
    'fixtures/EdgeHA_before.json',
    'src/render/__fixtures__/anchor-routing.json',
  ])('%s renders to the pre-feature bytes', (rel) => {
    const raw = readFileSync(
      fileURLToPath(new URL(`../../${rel}`, import.meta.url)),
      'utf8',
    );
    const doc = parseDoc(raw)!;
    expect(sha(renderDocumentToSVG(doc))).toBe(EXPECTED[rel]);
  });

  it('turning the option on does change the drawn link', () => {
    const base = hubPage();
    const on = hubPage({ linkAttach: {} });
    expect(renderPageToSVG(on, [])).not.toBe(renderPageToSVG(base, []));
  });
});

/* ── feature contracts ────────────────────────────────────────────── */

describe('anchor box geometry', () => {
  it('clears the label block on the label side and pads the others', () => {
    const n = node('hub', 'ec', 500, 350, { sublabel: 'core' });
    const b = anchorBox(n, 6);
    // ec hit AABB is 64×34 → padded 76×46; the south side extends past the
    // label (baseline y+24, 12px line + 13px sublabel) + pad.
    expect(b.x).toBe(500 - 32 - 6);
    expect(b.w).toBe(76);
    expect(b.y).toBe(350 - 17 - 6);
    expect(b.y + b.h).toBe(350 + 24 - 10 + 12 + 13 + 6);
    expect(b.labelSides).toEqual(['s']);
    // No label → a plain padded box.
    const plain = anchorBox({ id: 'x', type: 'ec', x: 0, y: 0 }, 6);
    expect(plain.h).toBe(46);
    expect(plain.labelSides).toEqual([]);
  });

  it('a south-attached link starts below the label instead of through it', () => {
    const p = page({
      nodes: [node('a', 'ec', 300, 200), node('b', 'ec', 300, 500)],
      links: [link('ab', 'a', 'b')],
    });
    const classic = linkEndpoints(p, p.links[0]!)!;
    const boxed = linkEndpoints({ ...p, linkAttach: {} }, p.links[0]!)!;
    // Classic: 3px under the icon (y = 200 + 17 + 3), inside the label block.
    expect(classic.from.y).toBe(220);
    // Boxed: under the label block + pad (200 + 24 − 10 + 12 + 6 = 232).
    expect(boxed.from.y).toBe(232);
    expect(boxed.from.x).toBe(300);
  });

  it('effective options merge the node over the page with a default pad', () => {
    const n = node('a', 'ec', 0, 0);
    expect(effectiveLinkAttach(undefined, n)).toBeNull();
    expect(effectiveLinkAttach({}, n)).toEqual({ pad: 6, distribute: false });
    expect(effectiveLinkAttach({ pad: 3, distribute: true }, n)).toEqual({
      pad: 3,
      distribute: true,
    });
    expect(
      effectiveLinkAttach(
        { pad: 3, distribute: true },
        {
          ...n,
          linkAttach: { pad: 9, distribute: false },
        },
      ),
    ).toEqual({ pad: 9, distribute: false });
    expect(
      effectiveLinkAttach(undefined, { ...n, linkAttach: { pad: -4 } }),
    ).toEqual({ pad: 0, distribute: false });
  });
});

describe('distribute', () => {
  const fan = (order: string[], offsets: Record<string, number> = {}): Page =>
    page({
      linkAttach: { distribute: true },
      nodes: [
        node('hub', 'switch', 500, 350),
        // All four rays leave the hub's north face (steep enough not to
        // exit east/west); x2 is declared toward the hub.
        node('x1', 'host', 350, 100),
        node('x2', 'host', 450, 100),
        node('x3', 'host', 550, 100),
        node('x4', 'host', 650, 100),
      ],
      links: order.map((id) =>
        link(`l-${id}`, id === 'x2' ? id : 'hub', id === 'x2' ? 'hub' : id, {
          ...(offsets[id] !== undefined ? { fromPortOffset: offsets[id] } : {}),
        }),
      ),
    });

  it('spaces a side evenly, ordered by the far end, independent of declaration order', () => {
    const a = fan(['x1', 'x2', 'x3', 'x4']);
    const b = fan(['x4', 'x1', 'x3', 'x2']);
    const ca = createAttachContext(a);
    const cb = createAttachContext(b);
    const xs = (p: Page, c: ReturnType<typeof createAttachContext>) =>
      ['x1', 'x2', 'x3', 'x4'].map((id) => {
        const l = p.links.find((k) => k.id === `l-${id}`)!;
        const e = c.endpoints(l)!;
        return l.from === 'hub' ? e.from : e.to;
      });
    const pa = xs(a, ca);
    const pb = xs(b, cb);
    expect(pa).toEqual(pb);
    // Four slots at 1/5 … 4/5 of the padded north side (switch 68×30 → 80 wide).
    const left = 500 - 34 - 6;
    for (let i = 0; i < 4; i++) {
      expect(pa[i]!.y).toBe(350 - 15 - 6);
      expect(pa[i]!.x).toBeCloseTo(left + (80 * (i + 1)) / 5, 6);
    }
    // The engine agrees for both declaration orders.
    expectMirrorAgrees(a);
    expectMirrorAgrees(b);
  });

  it('renders the same SVG for both declaration orders of the hub links', () => {
    // Paint order differs, so compare the link paths as a sorted set.
    const paths = (p: Page): string[] =>
      [...renderPageToSVG(p, []).matchAll(/<path\b[^>]*\bd="([^"]+)"/g)]
        .map((m) => m[1]!)
        .sort();
    expect(paths(fan(['x1', 'x2', 'x3', 'x4']))).toEqual(
      paths(fan(['x4', 'x1', 'x3', 'x2'])),
    );
  });

  it('applies and clamps port offsets along the slot side', () => {
    const plain = fan(['x1', 'x2', 'x3', 'x4']);
    const off = fan(['x1', 'x2', 'x3', 'x4'], { x1: 0.25, x4: 7 });
    const pick = (p: Page, id: string): Pt =>
      createAttachContext(p).endpoints(
        p.links.find((l) => l.id === `l-${id}`)!,
      )!.from;
    // 0.25 of the half-length (40px) shifts 10px right.
    expect(pick(off, 'x1').x).toBeCloseTo(pick(plain, 'x1').x + 10, 6);
    // 7 clamps to 1 → +40px, then clamps to the side's right end.
    expect(pick(off, 'x4').x).toBe(500 + 34 + 6);
    expect(pick(off, 'x4').y).toBe(pick(plain, 'x4').y);
    expectMirrorAgrees(off);
  });

  it('suppresses the sibling fan-out on the distributing end only', () => {
    const p = page({
      nodes: [
        node('a', 'ec', 200, 300, { linkAttach: { distribute: true } }),
        node('b', 'ec', 700, 300),
      ],
      links: [link('ab1', 'a', 'b'), link('ab2', 'a', 'b')],
    });
    const c = createAttachContext(p);
    const e1 = c.endpoints(p.links[0]!)!;
    const e2 = c.endpoints(p.links[1]!)!;
    // `a` distributes: two east slots at 1/3 and 2/3 of the face's ICON span
    // (padded 17 + 6 each way = 46px) — the south label extends the box but
    // never the slot span, so no slot sits level with the label text.
    expect(e1.from.x).toBe(200 + 32 + 6);
    expect(e2.from.x).toBe(200 + 32 + 6);
    expect(Math.abs(e1.from.y - e2.from.y)).toBeCloseTo(46 / 3, 6);
    for (const e of [e1, e2]) {
      expect(e.from.y).toBeGreaterThan(300 - 23);
      expect(e.from.y).toBeLessThan(300 + 23);
    }
    // `b` keeps the classic ±4.5px fan-out on its end (its trims converge a
    // little toward `a`'s single centre, so just under 9px apart) …
    expect(Math.abs(e1.to.y - e2.to.y)).toBeGreaterThan(8);
    expect(Math.abs(e1.to.y - e2.to.y)).toBeLessThanOrEqual(9);
    // … and the slots follow the far ends, so the siblings never cross.
    expect(Math.sign(e1.from.y - e2.from.y)).toBe(Math.sign(e1.to.y - e2.to.y));
    expectMirrorAgrees(p);
  });
});

describe('degenerate guard', () => {
  const pair = (dx: number): Page =>
    page({
      linkAttach: { pad: 6 },
      nodes: [node('a', 'ec', 400, 300), node('b', 'ec', 400 + dx, 300)],
      links: [link('ab', 'a', 'b')],
    });
  const spanOf = (dx: number): number => {
    const p = pair(dx);
    const e = linkEndpoints(p, p.links[0]!)!;
    return e.to.x - e.from.x;
  };

  it('uses the padded box, then the bare icon, then the classic trim, then centres', () => {
    // ec half-width 32: box insets 38 each → fine at 120px apart.
    expect(spanOf(120)).toBe(120 - 76);
    // 76px apart: the padded boxes touch (span 0 → reversed) → pad 0 (span 12).
    expect(spanOf(76)).toBe(76 - 64);
    // 64px apart: bare icons touch → classic silhouette + 3px gap also
    // reverses (insets 35 each) → centre → centre.
    expect(spanOf(64)).toBe(64);
    // 71px apart: box reversed, icon ok (span 7).
    expect(spanOf(71)).toBe(7);
    // Overlapping centres: zero-length, forward (well, zero).
    expect(spanOf(0)).toBe(0);
  });

  it('never draws a boxed link backwards', () => {
    for (let dx = 0; dx <= 140; dx += 2)
      expect(spanOf(dx), `dx=${dx}`).toBeGreaterThanOrEqual(0);
  });
});

/* ── document contract: catalog, validation, persistence, inspection ── */

describe('document contract', () => {
  it('the catalog advertises the fields with their ranges', () => {
    const ec = getNodeType('ec')!;
    const la = ec.fields.find((f) => f.key === 'linkAttach')!;
    expect(la.kind).toBe('object');
    expect(la.fields?.map((f) => f.key)).toEqual(['pad', 'distribute']);
    expect(la.fields?.find((f) => f.key === 'pad')?.range).toEqual([0, 200]);
    expect(
      getNodeType('shape:circle')!.fields.some((f) => f.key === 'linkAttach'),
    ).toBe(true);
    const line = getLinkType('line')!;
    for (const k of ['fromPortOffset', 'toPortOffset']) {
      const f = line.fields.find((x) => x.key === k)!;
      expect(f.kind).toBe('number');
      expect(f.range).toEqual([-1, 1]);
    }
  });

  it('validation warns on out-of-range offsets and malformed objects, never errors', () => {
    const p = hubPage({ linkAttach: { pad: -1 } });
    p.links[0]!.fromPortOffset = 1.5;
    p.links[1]!.toPortOffset = 'x' as unknown as number;
    p.nodes[0]!.linkAttach = { pad: 'big', distribute: 'yes' } as unknown as {
      pad: number;
    };
    p.nodes[1]!.linkAttach = [] as unknown as { pad: number };
    const doc = { title: 'T', customNodes: [], pages: [p] };
    const problems = validateDocument(doc);
    const msgs = problems.map((x) => x.message);
    expect(problems.filter((x) => x.level === 'error')).toEqual([]);
    expect(msgs).toContain('pad -1 should be a number between 0 and 200');
    expect(msgs).toContain(
      'fromPortOffset 1.5 should be a number between -1 and 1',
    );
    expect(msgs).toContain(
      'toPortOffset x should be a number between -1 and 1',
    );
    expect(msgs).toContain('pad big should be a number between 0 and 200');
    expect(msgs).toContain('distribute yes should be true or false');
    expect(msgs).toContain('linkAttach must be an object');
    // A well-formed document is quiet about these fields — except that the
    // fixture pins two link ends to corners, and under `distribute` a corner
    // pin is deliberately left where it is (side ports take slots, corners
    // never do), which validation calls out per link end.
    const ok = hubPage({ linkAttach: { pad: 4, distribute: true } });
    ok.links[0]!.fromPortOffset = -1;
    ok.nodes[0]!.linkAttach = {};
    const quiet = validateDocument({ title: 'T', customNodes: [], pages: [ok] })
      .map((x) => x.message)
      .filter((m) => /linkAttach|pad |PortOffset|distribute/.test(m));
    expect(quiet.every((m) => /is a corner pin/.test(m))).toBe(true);
    const cornerEnds = ok.links.flatMap((l) =>
      [l.fromPort, l.toPort].filter((p) => p?.length === 2),
    );
    expect(cornerEnds.length).toBeGreaterThan(0);
    expect(quiet).toHaveLength(cornerEnds.length);
  });

  it('persistence keeps a well-formed page option (an empty object too) and drops junk', () => {
    const doc = {
      title: 'T',
      customNodes: [],
      pages: [
        hubPage({ linkAttach: { pad: 3, distribute: true } }),
        hubPage({ linkAttach: {} }),
        hubPage(),
      ],
    };
    const back = parseDoc(serializeDoc(doc))!;
    expect(back.pages[0]!.linkAttach).toEqual({ pad: 3, distribute: true });
    expect(back.pages[1]!.linkAttach).toEqual({});
    expect(back.pages[2]!.linkAttach).toBeUndefined();
    const dirty = JSON.parse(serializeDoc(doc)) as {
      pages: Record<string, unknown>[];
    };
    dirty.pages[0]!.linkAttach = 'yes';
    dirty.pages[1]!.linkAttach = { pad: -9, distribute: 'no', bogus: 1 };
    const parsed = parseDoc(JSON.stringify(dirty))!;
    expect(parsed.pages[0]!.linkAttach).toBeUndefined();
    expect(parsed.pages[1]!.linkAttach).toEqual({ pad: 0 });
  });

  it('inspect_render reports a link through its own node label, and the box cures it', () => {
    const p = page({
      nodes: [node('a', 'ec', 400, 200), node('b', 'ec', 400, 500)],
      links: [link('ab', 'a', 'b')],
    });
    const before = inspectPage(p);
    expect(before.findings.map((f) => f.message)).toContainEqual(
      expect.stringContaining('runs through the label of its node "a"'),
    );
    const after = inspectPage({ ...p, linkAttach: {} });
    expect(
      after.findings.filter((f) =>
        f.message.includes('runs through the label'),
      ),
    ).toEqual([]);
  });

  it('inspect_render counts crossings on the drawn endpoints, not the centre chords', () => {
    // ab runs along y=300 between the trimmed ec edges (x 135…465). The
    // centre chord c→d (y 150…318) crosses it at (300,300); the DRAWN cd
    // stops 20px above d's centre (17px half-height + 3px gap) at y=298, so
    // the strokes never meet.
    const p = page({
      nodes: [
        node('a', 'ec', 100, 300),
        node('b', 'ec', 500, 300),
        node('c', 'ec', 300, 150),
        node('d', 'ec', 300, 318),
      ],
      links: [link('ab', 'a', 'b'), link('cd', 'c', 'd')],
    });
    expect(inspectPage(p).crossings.total).toBe(0);
    // Move d down 4px and the drawn end (y=302) does cross the wire.
    p.nodes[3]!.y = 322;
    expect(inspectPage(p).crossings.total).toBe(1);
  });
});
