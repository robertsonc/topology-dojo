/**
 * Per-frame caption: the frame's narration, drawn as a bottom-centred
 * subtitle in page coordinates so it reads the same on the canvas, during
 * playback, and in every render and export. DOM-free: the editor and the
 * headless renderer both draw it from here.
 *
 * A caption can be several sentences (500 characters, line breaks allowed),
 * so it wraps to the frame's width and the panel grows upward.
 */
import type { Page } from '../pages/model.js';
import { parseViewBox } from '../api/layout.js';

function escXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

/** Advance of one character of the 14px monospace caption face. */
const CHAR_W = 8.4;
const LINE_H = 18;
/** Side margin kept between the panel and the frame edge. */
const MARGIN = 20;
/** More lines than this and the caption is a paragraph, not a subtitle. */
const MAX_LINES = 6;

/** Greedy word wrap; a word longer than a line is broken. */
function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > maxChars) {
        if (line) lines.push(line);
        lines.push(w.slice(0, maxChars));
        w = w.slice(maxChars);
        line = '';
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= maxChars) line += ` ${w}`;
      else {
        lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
  }
  if (lines.length > MAX_LINES) {
    const kept = lines.slice(0, MAX_LINES);
    const last = kept[MAX_LINES - 1]!;
    kept[MAX_LINES - 1] = `${last.slice(0, Math.max(0, maxChars - 1))}…`;
    return kept;
  }
  return lines;
}

/** A positioned caption `<g>` for a page, or '' when the frame has no caption. */
export function captionSVG(page: Page): string {
  const text = (page.caption ?? '').trim();
  if (!text) return '';
  const [vx, vy, vw, vh] = parseViewBox(page.viewBox);
  const maxChars = Math.max(8, Math.floor((vw - 2 * MARGIN - 28) / CHAR_W));
  const lines = wrap(text, maxChars);
  const cx = vx + vw / 2;
  const open = `font-size="14" font-family="ui-monospace,monospace" fill="#e6e8e9">`;
  const panel = (w: number, h: number, y: number): string =>
    `<rect x="${cx - w / 2}" y="${y}" width="${w}" height="${h}" rx="8" ` +
    `fill="rgba(16,20,28,0.82)" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>`;

  if (lines.length <= 1) {
    // One line: the subtitle as it has always been drawn.
    const w = Math.min(vw - 2 * MARGIN, Math.max(120, text.length * 8 + 28));
    const h = 30;
    const y = vy + vh - h - 18;
    return (
      `<g class="tds-caption">` +
      panel(w, h, y) +
      `<text x="${cx}" y="${y + h / 2 + 5}" text-anchor="middle" ` +
      open +
      `${escXml(lines[0] ?? text)}</text>` +
      `</g>`
    );
  }
  const longest = Math.max(...lines.map((l) => l.length));
  const w = Math.min(vw - 2 * MARGIN, Math.max(120, longest * CHAR_W + 28));
  const h = lines.length * LINE_H + 12;
  const y = vy + vh - h - 18;
  return (
    `<g class="tds-caption">` +
    panel(w, h, y) +
    `<text x="${cx}" y="${y + 20}" text-anchor="middle" ` +
    open +
    lines
      .map(
        (l, i) =>
          `<tspan x="${cx}" dy="${i === 0 ? 0 : LINE_H}">${escXml(l)}</tspan>`,
      )
      .join('') +
    `</text>` +
    `</g>`
  );
}
