/**
 * Copy-as-code (1.4): turn a CustomNodeSpec into a self-contained
 * `TopologyDesigner.registerNodeType('<name>', { render(x,y,cfg){…} })` snippet
 * that, pasted into a TopologyDesigner instance, renders identically to the
 * in-app designer.
 *
 * Rather than re-implement the render pipeline (and risk drift), we drive the
 * real interpreter `renderCustomNode` at three coordinate samples and recover,
 * for every number in its output, whether it is a constant, an `x`-offset, or a
 * `y`-offset — because the interpreter only ever uses x/y as `x ± k` / `y ± k`,
 * never `x * spec`. Reassembling those into a template literal yields source
 * that is faithful by construction.
 */
import type { CustomNodeSpec } from './spec.js';
import { renderCustomNode, customHitBox } from './render.js';

/** Sentinel passed as cfg.color so colour positions can be swapped for `${c}`. */
const C_TOKEN = '__TDS_C__';
// Match ints, decimals, AND leading-dot decimals (".06") so opacity=".06" round-trips.
const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:[eE]-?\d+)?/g;
const EPS = 1e-4;

/** Single-quote a string literal (Studio's snippet style). */
function sq(s: string): string {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

/** Split an SVG string into alternating literal / numeric tokens (raw strings kept). */
function tokenize(svg: string): {
  lits: string[];
  nums: number[];
  raws: string[];
} {
  const lits: string[] = [];
  const nums: number[] = [];
  const raws: string[] = [];
  let last = 0;
  for (const m of svg.matchAll(NUM)) {
    lits.push(svg.slice(last, m.index));
    nums.push(Number(m[0]));
    raws.push(m[0]);
    last = m.index + m[0].length;
  }
  lits.push(svg.slice(last));
  return { lits, nums, raws };
}

/** Escape a literal segment for safe inclusion in a backtick template. */
function escTemplate(s: string): string {
  return s.replace(/[\\`]/g, '\\$&').replace(/\$\{/g, '\\${');
}

/**
 * The `${…}` expression (or verbatim literal) for a token. Constants keep their
 * exact original string (so ".06" stays ".06"); x/y offsets reuse the raw
 * magnitude so the generated SVG is byte-identical to the interpreter's.
 */
function exprFor(raw: string, n0: number, dx: number, dy: number): string {
  const isX = Math.abs(dx - 1) < EPS && Math.abs(dy) < EPS;
  const isY = Math.abs(dy - 1) < EPS && Math.abs(dx) < EPS;
  if (!isX && !isY) return raw; // constant — verbatim
  const axis = isX ? 'x' : 'y';
  // Exact-zero offset → just the axis. (A sub-ULP float residue like 1.47e-15 is
  // NOT exact zero — keep it as `${x + 1.47e-15}` so it round-trips byte-for-byte.)
  if (raw === '0') return '${' + axis + '}';
  void n0;
  const neg = raw.startsWith('-');
  const mag = neg ? raw.slice(1) : raw;
  return '${' + axis + (neg ? ' - ' : ' + ') + mag + '}';
}

/** Build the render body (a backtick template literal's contents). */
function buildTemplate(spec: CustomNodeSpec): string {
  const s0 = renderCustomNode(spec, 0, 0, { color: C_TOKEN });
  const sx = renderCustomNode(spec, 1, 0, { color: C_TOKEN });
  const sy = renderCustomNode(spec, 0, 1, { color: C_TOKEN });
  const t0 = tokenize(s0);
  const tx = tokenize(sx);
  const ty = tokenize(sy);
  // Structure must be identical across samples (only coordinates differ).
  if (
    t0.nums.length !== tx.nums.length ||
    t0.nums.length !== ty.nums.length ||
    t0.lits.some((l, i) => l !== tx.lits[i] || l !== ty.lits[i])
  ) {
    throw new Error('codegen: interpreter output is not coordinate-stable');
  }
  let out = '';
  for (let i = 0; i < t0.nums.length; i++) {
    out += escTemplate(t0.lits[i]!);
    out += exprFor(
      t0.raws[i]!,
      t0.nums[i]!,
      tx.nums[i]! - t0.nums[i]!,
      ty.nums[i]! - t0.nums[i]!,
    );
  }
  out += escTemplate(t0.lits[t0.nums.length]!);
  // Colour: the sentinel only appears in literal segments → swap for `${c}`.
  return out.split(C_TOKEN).join('${c}');
}

/** Emit the full `registerNodeType(...)` snippet for a spec. */
export function nodeSpecToCode(spec: CustomNodeSpec): string {
  const body = buildTemplate(spec);
  const hit = customHitBox(spec);
  const name = sq(spec.typeName);
  const stroke = sq(spec.colorStroke);
  return (
    `TopologyDesigner.registerNodeType(${name}, {\n` +
    `  render(x, y, cfg = {}) {\n` +
    `    const c = cfg.color || ${stroke};\n` +
    `    return \`${body}\`;\n` +
    `  },\n` +
    `  defaults: { color: ${stroke} },\n` +
    `  hitBox: { rx: ${hit.rx}, ry: ${hit.ry} },\n` +
    `});\n`
  );
}
