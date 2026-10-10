/**
 * Node-label metrics — the ONE place the size and line-count rule of the
 * classic beside-the-glyph node label (label + sublabel) live on the
 * TypeScript side. The vendored engine (public/vendor/topology-ds.js, search
 * "MIRROR OF src/render/node-labels.ts") keeps a byte-for-byte copy of the
 * constants and the same algorithm; the inspector (`nodeLabelRect`), the
 * layout analyzer (`nodeFootprint`), the zone box (`render/zone-box`) and the
 * editor's label hit-test all size the drawn block from here. Keep the two in
 * lockstep.
 *
 * Rules (engine `_renderNodeLabel`):
 * - `label` without `labelWidth` is truncated to `TRUNCATE_CHARS` + "…" on one
 *   line — the pre-#271 behaviour, kept so existing documents render
 *   byte-identical. With `labelWidth` it word-wraps at `labelWidth / charW`
 *   characters into up to `maxLines` lines (ellipsis on the last kept line).
 * - `sublabel` always wraps: at `labelWidth / charW` characters when a width
 *   is set, else at `WRAP_CHARS` (26, shared with wire labels), up to
 *   `maxLines` lines with an ellipsis after that.
 * - Sublabel lines start one sublabel gap (`subGap`) below the last label
 *   line; every further line adds its line height.
 */
import type { NodeConfig } from '../vendor/topology-ds.js';
import { drawsOwnLabel } from '../api/geometry.js';
import { WRAP_CHARS, clampLabelWidth, wrapAtChars } from './wire-labels.js';

export interface NodeLabelMetrics {
  fontSize: number;
  /** Estimated advance per character at `fontSize`. */
  charW: number;
  lineH: number;
  maxLines: number;
}

/* mirror: public/vendor/topology-ds.js `NODE_LABEL` (keep in lockstep) */
export const NODE_LABEL: Readonly<{
  label: NodeLabelMetrics & { truncateChars: number };
  sublabel: NodeLabelMetrics;
  /** Baseline gap from the last label line to the first sublabel line. */
  subGap: number;
  /** How far the text box reaches above the label's first baseline. */
  ascent: number;
}> = {
  label: { fontSize: 10, charW: 6, lineH: 12, maxLines: 2, truncateChars: 24 },
  sublabel: { fontSize: 7.5, charW: 4.5, lineH: 9, maxLines: 2 },
  subGap: 13,
  ascent: 10,
};

export interface NodeLabelLines {
  label: string[];
  sublabel: string[];
  /** True when the label was wrapped (not truncated) and lost lines. */
  labelCut: boolean;
  /** True when the sublabel lost lines to the line cap. */
  sublabelCut: boolean;
}

/** Wrap at `maxChars`, keep `maxLines`, ellipsis on the last kept line. */
function wrapCapped(
  text: string,
  maxChars: number,
  maxLines: number,
): { lines: string[]; cut: boolean } {
  const lines = wrapAtChars(text, maxChars);
  if (lines.length <= maxLines) return { lines, cut: false };
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] =
    kept[maxLines - 1]!.slice(0, Math.max(1, maxChars - 1)) + '…';
  return { lines: kept, cut: true };
}

/** The lines the engine draws for a node's label and sublabel. */
export function nodeLabelLines(n: {
  label?: unknown;
  sublabel?: unknown;
  labelWidth?: unknown;
}): NodeLabelLines {
  const label = typeof n.label === 'string' ? n.label : '';
  const sublabel = typeof n.sublabel === 'string' ? n.sublabel : '';
  const w = clampLabelWidth(n.labelWidth);
  const L = NODE_LABEL.label,
    S = NODE_LABEL.sublabel;
  let labelLines: string[] = [];
  let labelCut = false;
  if (label) {
    if (w === undefined) {
      labelLines = [
        label.length > L.truncateChars
          ? label.slice(0, L.truncateChars) + '…'
          : label,
      ];
    } else {
      const r = wrapCapped(
        label,
        Math.max(1, Math.floor(w / L.charW)),
        L.maxLines,
      );
      labelLines = r.lines;
      labelCut = r.cut;
    }
  }
  let subLines: string[] = [];
  let sublabelCut = false;
  if (sublabel) {
    const maxChars =
      w === undefined ? WRAP_CHARS : Math.max(1, Math.floor(w / S.charW));
    const r = wrapCapped(sublabel, maxChars, S.maxLines);
    subLines = r.lines;
    sublabelCut = r.cut;
  }
  return { label: labelLines, sublabel: subLines, labelCut, sublabelCut };
}

/**
 * How far (px) the block's last baseline sits below the label's first
 * baseline: zero for a one-line label with no sublabel. North placements lift
 * the block by exactly this so its bottom line stays clear of the glyph
 * (engine `_nodeLabelPos`).
 */
export function nodeLabelDescent(lines: NodeLabelLines): number {
  const L = NODE_LABEL.label,
    S = NODE_LABEL.sublabel;
  let d = Math.max(0, lines.label.length - 1) * L.lineH;
  if (lines.sublabel.length)
    d += NODE_LABEL.subGap + (lines.sublabel.length - 1) * S.lineH;
  return d;
}

/** Width × height of the drawn block (longest line × char width; ascent +
 * descent + the label line height). */
export function nodeLabelBlockSize(lines: NodeLabelLines): {
  w: number;
  h: number;
} {
  const L = NODE_LABEL.label,
    S = NODE_LABEL.sublabel;
  const longest = (ls: string[]): number =>
    ls.reduce((n, l) => Math.max(n, l.length), 0);
  const w = Math.max(
    longest(lines.label) * L.charW,
    longest(lines.sublabel) * S.charW,
  );
  return { w, h: L.lineH + nodeLabelDescent(lines) };
}

/**
 * True when the engine draws the classic label block beside this node: it
 * has a label and is not a type that renders its own text (text boxes,
 * callouts, clouds, id cards, shapes without a placement).
 */
export function hasClassicLabel(n: NodeConfig): boolean {
  return typeof n.label === 'string' && n.label !== '' && !drawsOwnLabel(n);
}
