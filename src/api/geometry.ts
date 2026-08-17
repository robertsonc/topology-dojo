/**
 * Pure node geometry — approximate axis-aligned bounds for each node type,
 * ported from the legacy editor's getNodeBounds. DOM-free, so it's shared by the
 * editor (hit-testing/selection) and the layout analyzer (overlap detection).
 *
 * Node art is drawn by the vendored engine centered on (x, y); these are the
 * half-extents (from the center) of the drawn glyph — labels are accounted for
 * separately by the layout analyzer's footprint.
 */
import type { NodeConfig } from '../vendor/topology-ds.js';

/** Half-width / half-height per node type (extent from the node's center). */
const HALF: Record<string, { w: number; h: number }> = {
  ec: { w: 28, h: 18 },
  switch: { w: 22, h: 8 },
  switchEnterprise: { w: 44, h: 16 },
  cloud: { w: 55, h: 32 },
  host: { w: 14, h: 18 },
  connector: { w: 16, h: 16 },
  apps: { w: 26, h: 22 },
  saas: { w: 18, h: 18 },
  server: { w: 14, h: 22 },
  router: { w: 18, h: 18 },
  firewall: { w: 20, h: 18 },
  database: { w: 16, h: 20 },
  idcard: { w: 97, h: 37 },
  ap: { w: 18, h: 16 },
  text: { w: 40, h: 10 },
  custom: { w: 20, h: 20 },
  'shape:arrow': { w: 24, h: 12 },
  'shape:square': { w: 18, h: 18 },
  'shape:rectangle': { w: 28, h: 16 },
  'shape:triangle': { w: 20, h: 18 },
  'shape:circle': { w: 18, h: 18 },
  'shape:ellipse': { w: 26, h: 16 },
  'shape:diamond': { w: 20, h: 20 },
  'shape:pentagon': { w: 20, h: 20 },
  'shape:hexagon': { w: 22, h: 20 },
  'shape:star': { w: 22, h: 22 },
  'shape:cross': { w: 18, h: 18 },
};

/** Number to use when a config field is a positive number, else undefined. */
function posNum(v: unknown): number | undefined {
  return typeof v === 'number' && v > 0 ? v : undefined;
}

/**
 * Estimated line count for a text node's label/sublabel, mirroring the engine's
 * greedy word-wrap (~0.6em per glyph; explicit newlines respected).
 */
function wrappedLines(text: string, width: number, fontSize: number): number {
  const maxChars = Math.max(1, Math.floor(width / (fontSize * 0.6)));
  let count = 0;
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const cand = line ? `${line} ${word}` : word;
      if (cand.length <= maxChars || !line) line = cand;
      else {
        count++;
        line = word;
      }
    }
    count++;
  }
  return count;
}

export function nodeHalf(node: NodeConfig): { w: number; h: number } {
  if (node.type === 'text') {
    // Mirror the engine's text-box metrics (renderText): wrap width, padding,
    // main + sublabel blocks — so selection and overlap checks track the box.
    const fontSize = posNum(node.fontSize) ?? 14;
    const padding = posNum(node.padding) ?? 8;
    const width = posNum(node.width);
    const label =
      typeof node.label === 'string' && node.label ? node.label : 'Text';
    const sublabel = typeof node.sublabel === 'string' ? node.sublabel : '';
    const innerW = width
      ? Math.max(8, width - padding * 2)
      : Number.MAX_SAFE_INTEGER;
    const lines = width
      ? wrappedLines(label, innerW, fontSize)
      : label.split('\n').length;
    const subSize = Math.max(8, fontSize * 0.7);
    const subLines = sublabel
      ? width
        ? wrappedLines(sublabel, innerW, subSize)
        : sublabel.split('\n').length
      : 0;
    const blockH =
      lines * fontSize * 1.3 +
      (subLines ? subLines * subSize * 1.4 + subSize * 0.3 : 0);
    const estW =
      width ?? Math.max(50, label.length * fontSize * 0.6 + padding * 2);
    return { w: estW / 2, h: (blockH + padding * 2) / 2 };
  }
  if (node.type === 'image') {
    // Mirror the engine's renderImage box (default 96×72, min 16).
    const w = Math.max(16, posNum(node.imageW) ?? 96);
    const h = Math.max(16, posNum(node.imageH) ?? 72);
    return { w: w / 2, h: h / 2 };
  }
  if (node.type.startsWith('shape:')) {
    // Honor explicit sizing (shapeSize, or shapeWidth/shapeHeight where the
    // renderer supports them) so bounds track the drawn shape.
    const base = HALF[node.type] ?? HALF.custom!;
    const size = posNum(node.shapeSize);
    // Only rectangle/ellipse render independent width/height; the rest are
    // uniform shapes driven by shapeSize alone.
    const wh = node.type === 'shape:rectangle' || node.type === 'shape:ellipse';
    const w = (wh ? posNum(node.shapeWidth) : undefined) ?? size;
    const h = (wh ? posNum(node.shapeHeight) : undefined) ?? size;
    return {
      w: w !== undefined ? w / 2 : base.w,
      h: h !== undefined ? h / 2 : base.h,
    };
  }
  return HALF[node.type] ?? HALF.custom!;
}

export interface BoundsRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Axis-aligned bounds rect (top-left origin) for a node. */
export function nodeBounds(node: NodeConfig): BoundsRect {
  const h = nodeHalf(node);
  return { x: node.x - h.w, y: node.y - h.h, w: h.w * 2, h: h.h * 2 };
}
