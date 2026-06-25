/**
 * Per-frame caption (2.1) — a one-line narration drawn as a bottom-centred
 * subtitle in page coordinates, so it appears on the canvas, during playback,
 * and in exports identically (like the legend).
 */
import type { Page } from '../pages/model.js';

function escXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

/** A positioned caption `<g>` for a page, or '' when the frame has no caption. */
export function captionSVG(page: Page): string {
  const text = (page.caption ?? '').trim();
  if (!text) return '';
  const [vx, vy, vw, vh] = page.viewBox.split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const w = Math.min(vw - 40, Math.max(120, text.length * 8 + 28));
  const h = 30;
  const x = vx + vw / 2 - w / 2;
  const y = vy + vh - h - 18;
  return (
    `<g class="tds-caption">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ` +
    `fill="rgba(16,20,28,0.82)" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>` +
    `<text x="${vx + vw / 2}" y="${y + h / 2 + 5}" text-anchor="middle" ` +
    `font-size="14" font-family="ui-monospace,monospace" fill="#e6e8e9">${escXml(text)}</text>` +
    `</g>`
  );
}
