/**
 * Build the map backdrops (`src/render/backdrops.generated.ts`) from Natural
 * Earth 1:110m admin-0 countries, via the `world-atlas` package (ISC; Natural
 * Earth data is public domain — no attribution required).
 *
 * Countries are grouped into the business regions people use (North
 * America, LATAM, Europe, Middle East, Africa, APAC) by where their main
 * landmass sits, with explicit lists where geography alone misleads (see
 * `groupOf`). Each group becomes one *piece* — a land fill plus faint
 * country-border strokes — projected with Equal Earth (equal-area) into one
 * shared world frame, so pieces are stored once and the backdrops are just
 * combinations with a crop box (AMER = NA + LATAM, EMEA = Europe + Middle
 * East + Africa, World = everything).
 *
 * Russia is split at 60°E: its western part belongs to Europe, its eastern
 * part is a separate piece used only by the world map, so the Europe and
 * EMEA maps are not stretched to the Bering Strait. Border strokes never
 * include such cut edges, only real coasts and frontiers.
 *
 * Usage: npm run build:backdrops   (--check verifies the committed file)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

type Pt = [number, number];
type Ring = Pt[];
type Box = [number, number, number, number]; // west, south, east, north

interface Geometry {
  type: string;
  id?: string;
  properties: { name: string };
  arcs: number[][][] | number[][];
}
interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: { countries: { geometries: Geometry[] } };
}

const require = createRequire(import.meta.url);
const topo = JSON.parse(
  readFileSync(require.resolve('world-atlas/countries-110m.json'), 'utf8'),
) as Topology;

/* ── grouping ──────────────────────────────────────────────────────── */

type Group = 'na' | 'latam' | 'europe' | 'me' | 'africa' | 'apac';

/** ISO 3166-1 numeric codes placed explicitly. */
const NORTH_AMERICA = new Set(['840', '124', '304']); // US, Canada, Greenland
const MIDDLE_EAST = new Set([
  '682', // Saudi Arabia
  '887', // Yemen
  '512', // Oman
  '784', // United Arab Emirates
  '634', // Qatar
  '414', // Kuwait
  '368', // Iraq
  '364', // Iran
  '760', // Syria
  '400', // Jordan
  '376', // Israel
  '422', // Lebanon
  '275', // Palestine
]);
const EUROPE = new Set([
  '792', // Turkey
  '196', // Cyprus
  '268', // Georgia
  '051', // Armenia
  '031', // Azerbaijan
  '643', // Russia (west of 60°E; the east is its own piece)
]);
/** Features world-atlas ships without an ISO code. */
const BY_NAME: Record<string, Group> = {
  'N. Cyprus': 'europe',
  Kosovo: 'europe',
  Somaliland: 'africa',
};
/** Not drawn: Antarctica, French Southern Territories. */
const EXCLUDED = new Set(['010', '260']);

/** A country's group, from its explicit lists or its centroid (lon/lat). */
function groupOf(g: Geometry, [lon, lat]: Pt): Group | null {
  const id = g.id;
  if (id && EXCLUDED.has(id)) return null;
  if (!id) return BY_NAME[g.properties.name] ?? null;
  if (NORTH_AMERICA.has(id)) return 'na';
  if (MIDDLE_EAST.has(id)) return 'me';
  if (EUROPE.has(id)) return 'europe';
  if (lon < -25) return 'latam'; // Mexico, Central America, Caribbean, South America
  if (lon < 52 && lat < 37.5) return 'africa';
  if (lon < 45) return 'europe';
  return 'apac'; // Central, South, East and South-East Asia; Oceania
}

/* ── geometry ──────────────────────────────────────────────────────── */

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

/** Every polygon (outer ring + holes) of a geometry, in lon/lat. */
function polygonsOf(g: Geometry, arcs: Pt[][]): Ring[][] {
  const arc = (i: number): Pt[] =>
    i >= 0 ? arcs[i]! : [...arcs[~i]!].reverse();
  const ring = (ids: number[]): Ring => {
    const out: Pt[] = [];
    ids.forEach((id, k) => {
      const pts = arc(id);
      out.push(...(k === 0 ? pts : pts.slice(1)));
    });
    return unwrap(out);
  };
  const polys =
    g.type === 'Polygon' ? [g.arcs as number[][]] : (g.arcs as number[][][]);
  return polys.map((poly) => poly.map(ring));
}

/**
 * A ring that crosses the antimeridian jumps from +180 to −180 and would
 * draw a line across the map. Unwrap it by continuity (each step under 180°
 * of longitude), then shift it so its mean sits within ±180: only the
 * overhanging tail then falls outside the world box and is clipped away.
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

function shoelace(r: Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i]!;
    const [x2, y2] = r[(i + 1) % r.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** The mean vertex of the largest ring — where a landmass sits. */
function centroidOf(rings: Ring[]): Pt {
  const big = rings.reduce((a, r) =>
    Math.abs(shoelace(r)) > Math.abs(shoelace(a)) ? r : a,
  );
  const n = big.length;
  return [
    big.reduce((s, p) => s + p[0], 0) / n,
    big.reduce((s, p) => s + p[1], 0) / n,
  ];
}

/** Sutherland–Hodgman: clip a ring against an axis-aligned box. */
function clipRing(r: Ring, [w, s, e, n]: Box): Ring {
  const at = (a: Pt, b: Pt, axis: 0 | 1, v: number): Pt => {
    const t = (v - a[axis]) / (b[axis] - a[axis]);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
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

/** True when segment a→b runs along one of the box's edges (a cut edge). */
function onBoxEdge(a: Pt, b: Pt, [w, s, e, n]: Box): boolean {
  const eps = 1e-6;
  const same = (u: number, v: number, k: number) =>
    Math.abs(u - k) < eps && Math.abs(v - k) < eps;
  return (
    same(a[0], b[0], w) ||
    same(a[0], b[0], e) ||
    same(a[1], b[1], s) ||
    same(a[1], b[1], n)
  );
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

/* ── pieces and backdrops ──────────────────────────────────────────── */

/** The drawn world: no Antarctica, no Arctic sliver. */
const WORLD: Box = [-180, -58, 180, 84];
const RUSSIA_SPLIT = 60;
const WIDTH = 1000;

// Shared world frame: projected world box → 0..WIDTH × 0..H.
const [wx0] = equalEarth([-180, 0]);
const [wx1] = equalEarth([180, 0]);
const [, wy0] = equalEarth([0, WORLD[3]]);
const K = WIDTH / (wx1 - wx0);
const toFrame = (p: Pt): Pt => {
  const [x, y] = equalEarth(p);
  return [(x - wx0) * K, (y - wy0) * K];
};

type PieceName = Group | 'russiaEast';
interface Piece {
  fill: Pt[][];
  borders: Pt[][];
  /** Some ring was cut by a split (not just the world edge). */
  cut: boolean;
}

function emptyPiece(): Piece {
  return { fill: [], borders: [], cut: false };
}

/** Add a clipped ring: its fill, and its border minus cut edges. */
function addRing(piece: Piece, ring: Ring, box: Box, split = false): void {
  const r = clipRing(ring, box);
  if (r.length < 3) return;
  piece.fill.push(r.map(toFrame));
  if (split && r.some((a, i) => onBoxEdge(a, r[(i + 1) % r.length]!, box)))
    piece.cut = true;
  let run: Pt[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    if (onBoxEdge(a, b, box)) {
      if (run.length > 1) piece.borders.push(run.map(toFrame));
      run = [];
      continue;
    }
    if (!run.length) run.push(a);
    run.push(b);
  }
  if (run.length > 1) piece.borders.push(run.map(toFrame));
}

function buildPieces(): Record<PieceName, Piece> {
  const arcs = decodeArcs(topo);
  const pieces: Record<PieceName, Piece> = {
    na: emptyPiece(),
    latam: emptyPiece(),
    europe: emptyPiece(),
    me: emptyPiece(),
    africa: emptyPiece(),
    apac: emptyPiece(),
    russiaEast: emptyPiece(),
  };
  for (const g of topo.objects.countries.geometries) {
    const polys = polygonsOf(g, arcs);
    if (!polys.length) continue;
    const group = groupOf(g, centroidOf(polys.flat()));
    if (!group) continue;
    for (const poly of polys) {
      // Overseas parts follow where they sit, not their country: French
      // Guiana is drawn with LATAM, not Europe.
      const [lon] = centroidOf(poly);
      const americas = group === 'na' || group === 'latam';
      const here: Group =
        lon < -25 && !americas
          ? 'latam'
          : lon >= -25 && americas
            ? 'europe'
            : group;
      // Russian islands just west of the antimeridian (Wrangel, the
      // Chukotka coast) have negative longitudes: they belong east.
      const far = g.id === '643' && lon < 0;
      for (const raw of poly) {
        const ring = far ? raw.map(([x, y]) => [x + 360, y] as Pt) : raw;
        if (g.id === '643') {
          const west: Box = [WORLD[0], WORLD[1], RUSSIA_SPLIT, WORLD[3]];
          const east: Box = [RUSSIA_SPLIT, WORLD[1], WORLD[2], WORLD[3]];
          addRing(pieces.europe, ring, west, true);
          addRing(pieces.russiaEast, ring, east, true);
        } else addRing(pieces[here], ring, WORLD);
      }
    }
  }
  return pieces;
}

/** Each backdrop: the pieces it draws. */
const BACKDROPS: Record<string, PieceName[]> = {
  world: ['na', 'latam', 'europe', 'me', 'africa', 'apac', 'russiaEast'],
  na: ['na'],
  latam: ['latam'],
  amer: ['na', 'latam'],
  europe: ['europe'],
  africa: ['africa'],
  emea: ['europe', 'me', 'africa'],
  apac: ['apac'],
};

/** Drop points closer than `tol` to the last kept one (cheap simplify). */
function thin(r: Pt[], tol: number, closed: boolean): Pt[] {
  const out: Pt[] = [];
  r.forEach((p, i) => {
    const last = out[out.length - 1];
    const keep =
      !last ||
      Math.hypot(p[0] - last[0], p[1] - last[1]) >= tol ||
      (!closed && i === r.length - 1);
    if (keep) out.push(p);
  });
  return out;
}

const fmt = (n: number) => n.toFixed(1);
function pathOf(lines: Pt[][], closed: boolean): string {
  return lines
    .map((l) => thin(l, 0.6, closed))
    .filter((l) =>
      closed ? l.length >= 3 && Math.abs(shoelace(l)) > 0.3 : l.length >= 2,
    )
    .map(
      (l) =>
        'M' +
        l.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L') +
        (closed ? 'Z' : ''),
    )
    .join('');
}

function bboxOf(pieces: Piece[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const pts = pieces.flatMap((p) => p.fill.flat());
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.floor(Math.min(...xs));
  const y = Math.floor(Math.min(...ys));
  return {
    x,
    y,
    w: Math.ceil(Math.max(...xs)) - x,
    h: Math.ceil(Math.max(...ys)) - y,
  };
}

function build(): string {
  const pieces = buildPieces();
  const pieceSrc = Object.entries(pieces)
    .map(
      ([name, p]) =>
        // Uncut pieces stroke their own fill for borders; only a piece cut by
        // the Russia split carries separate border lines without the seam.
        `  ${name}: {\n    d: '${pathOf(p.fill, true)}',\n` +
        (p.cut ? `    b: '${pathOf(p.borders, false)}',\n` : '') +
        `  },`,
    )
    .join('\n');
  const backdropSrc = Object.entries(BACKDROPS)
    .map(([name, list]) => {
      const { x, y, w, h } = bboxOf(list.map((n) => pieces[n]));
      return `  ${name}: { pieces: [${list.map((n) => `'${n}'`).join(', ')}], x: ${x}, y: ${y}, w: ${w}, h: ${h} },`;
    })
    .join('\n');
  return (
    `// GENERATED by scripts/build-backdrops.ts — do not edit.\n` +
    `// Natural Earth 1:110m countries (public domain) via world-atlas (ISC),\n` +
    `// grouped into business regions, Equal Earth projection, one shared\n` +
    `// world frame (${WIDTH} wide). d = land fill, b = country borders.\n` +
    `export const BACKDROP_PIECES = {\n${pieceSrc}\n} as const;\n\n` +
    `export type BackdropPieceName = keyof typeof BACKDROP_PIECES;\n\n` +
    `/** Each backdrop: its pieces and its crop box in the world frame. */\n` +
    `export const BACKDROP_REGIONS = {\n${backdropSrc}\n} as const satisfies Record<\n  string,\n  {\n    pieces: readonly BackdropPieceName[];\n    x: number;\n    y: number;\n    w: number;\n    h: number;\n  }\n>;\n`
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
