/**
 * Build the map backdrops (`src/render/backdrops.generated.ts`) from Natural
 * Earth 1:110m land, via the `world-atlas` package (ISC; Natural Earth data
 * is public domain — no attribution required).
 *
 * For each backdrop: clip every land ring to the region's lon/lat box
 * (Sutherland–Hodgman against the rectangle), project with Equal Earth (an
 * equal-area projection, so continents keep their relative size), drop
 * slivers, simplify, and normalise into a 0..W × 0..H box. The output is
 * plain SVG path data — no runtime dependency, no network.
 *
 * Usage: npm run build:backdrops   (--check verifies the committed file)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

type Pt = [number, number];
type Ring = Pt[];

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: {
    land: {
      geometries: { type: string; arcs: number[][][] | number[][] }[];
    };
  };
}

/** lon/lat boxes: [west, south, east, north]. */
const REGIONS: Record<string, [number, number, number, number]> = {
  world: [-180, -58, 180, 84],
  amer: [-170, 7, -50, 75],
  latam: [-118, -56, -33, 33],
  emea: [-20, -36, 60, 72],
  apac: [60, -48, 180, 56],
};

/** Output width of every backdrop (height follows the aspect ratio). */
const WIDTH = 1000;

const require = createRequire(import.meta.url);
const topo = JSON.parse(
  readFileSync(require.resolve('world-atlas/land-110m.json'), 'utf8'),
) as Topology;

/** Decode quantised, delta-encoded TopoJSON arcs to lon/lat rings. */
function decodeArcs(t: Topology): Pt[][] {
  const [sx, sy] = t.transform.scale;
  const [tx, ty] = t.transform.translate;
  return t.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty] as Pt;
    });
  });
}

function landRings(t: Topology): Ring[] {
  const arcs = decodeArcs(t);
  const arc = (i: number): Pt[] =>
    i >= 0 ? arcs[i]! : [...arcs[~i]!].reverse();
  const ring = (ids: number[]): Ring => {
    const out: Pt[] = [];
    ids.forEach((id, k) => {
      const pts = arc(id);
      out.push(...(k === 0 ? pts : pts.slice(1)));
    });
    return out;
  };
  const rings: Ring[] = [];
  for (const g of t.objects.land.geometries) {
    const polys =
      g.type === 'Polygon' ? [g.arcs as number[][]] : (g.arcs as number[][][]);
    for (const poly of polys) for (const r of poly) rings.push(unwrap(ring(r)));
  }
  return rings;
}

/**
 * A ring that crosses the antimeridian jumps from +180 to −180 and would
 * draw a line across the whole map. Unwrap it by continuity (each step
 * under 180° of longitude), then shift the whole ring so its mean sits
 * within ±180: only the overhanging tail (e.g. Chukotka, Fiji's far side)
 * then lies outside every region box and is clipped away.
 */
function unwrap(r: Ring): Ring {
  const out: Ring = [];
  let offset = 0;
  r.forEach(([x, y], i) => {
    if (i > 0) {
      const prev = r[i - 1]![0];
      if (x - prev > 180) offset -= 360;
      else if (prev - x > 180) offset += 360;
    }
    out.push([x + offset, y]);
  });
  const mean = out.reduce((a, p) => a + p[0], 0) / out.length;
  const shift = mean > 180 ? -360 : mean < -180 ? 360 : 0;
  return shift ? out.map(([x, y]) => [x + shift, y] as Pt) : out;
}

/** Sutherland–Hodgman: clip a ring against an axis-aligned box. */
function clipRing(r: Ring, [w, s, e, n]: [number, number, number, number]) {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= w, (a, b) => at(a, b, 0, w)],
    [(p) => p[0] <= e, (a, b) => at(a, b, 0, e)],
    [(p) => p[1] >= s, (a, b) => at(a, b, 1, s)],
    [(p) => p[1] <= n, (a, b) => at(a, b, 1, n)],
  ];
  let out = r;
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!;
      const prev = input[(i + input.length - 1) % input.length]!;
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cross(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}
function at(a: Pt, b: Pt, axis: 0 | 1, v: number): Pt {
  const t = (v - a[axis]) / (b[axis] - a[axis]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Equal Earth projection (Šavrič, Patterson & Jenny 2018), unit sphere. */
const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
function equalEarth([lon, lat]: Pt): Pt {
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  const th = Math.asin(M * Math.sin(p));
  const t2 = th * th;
  const t6 = t2 * t2 * t2;
  const x =
    (l * Math.cos(th)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x, -y]; // SVG y grows downward
}

/** Drop points closer than `tol` to the last kept one (cheap simplify). */
function thin(r: Pt[], tol: number): Pt[] {
  const out: Pt[] = [];
  for (const p of r) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= tol) out.push(p);
  }
  return out;
}

function areaOf(r: Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i]!;
    const [x2, y2] = r[(i + 1) % r.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

function build(): string {
  const rings = landRings(topo);
  const entries: string[] = [];
  for (const [name, box] of Object.entries(REGIONS)) {
    const projected = rings
      .map((r) => clipRing(r, box))
      .filter((r) => r.length >= 3)
      .map((r) => r.map(equalEarth));
    const [x0, y0] = equalEarth([box[0], box[3]]);
    const xs = projected.flat().map((p) => p[0]);
    const ys = projected.flat().map((p) => p[1]);
    const minX = Math.min(...xs, x0);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys, y0);
    const maxY = Math.max(...ys);
    const k = WIDTH / (maxX - minX);
    const height = Math.round((maxY - minY) * k);
    const tol = name === 'world' ? 1.5 : 1;
    const d = projected
      .map((r) =>
        thin(
          r.map(([x, y]) => [(x - minX) * k, (y - minY) * k] as Pt),
          tol,
        ),
      )
      .filter((r) => r.length >= 3 && areaOf(r) > 4)
      .map(
        (r) =>
          'M' +
          r.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') +
          'Z',
      )
      .join('');
    entries.push(
      `  ${name}: {\n    w: ${WIDTH},\n    h: ${height},\n    d: '${d}',\n  },`,
    );
  }
  return (
    `// GENERATED by scripts/build-backdrops.ts — do not edit.\n` +
    `// Natural Earth 1:110m land (public domain) via world-atlas (ISC),\n` +
    `// clipped per region, Equal Earth projection, normalised to w × h.\n` +
    `export interface Backdrop {\n  w: number;\n  h: number;\n  d: string;\n}\n\n` +
    `export const BACKDROPS = {\n${entries.join('\n')}\n} as const satisfies Record<string, Backdrop>;\n`
  );
}

const OUT = 'src/render/backdrops.generated.ts';
const next = build();
if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== next) {
    console.error(`${OUT} is stale — run npm run build:backdrops`);
    process.exit(1);
  }
} else {
  writeFileSync(OUT, next);
  console.log(`wrote ${OUT} (${Math.round(next.length / 1024)} KB)`);
}
