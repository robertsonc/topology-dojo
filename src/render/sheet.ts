/**
 * Sheet frame + title block renderer (W6): the border, the top-centred
 * document title and the bottom-right title block, as an SVG `<g>` in page
 * coordinates (drawn into the editor overlay and every export, like the
 * legend). Colours come from the engine's own vocabulary so the light theme
 * and the brand palette remap them with the rest of the art.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import {
  SHEET_MARGIN,
  SHEET_MAX_FIELDS,
  type SheetField,
} from '../api/sheet.js';

function escXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

const ROW_H = 18;
const PAD = 10;
const BLOCK_W = 340;
/** Logo cell width when a logo is set. */
const LOGO_W = 90;

/** Text-column width: the fixed minimum, grown for a long title / subtitle. */
function blockTextW(
  doc: TopologyDocument,
  tb: NonNullable<TopologyDocument['sheet']>['titleBlock'],
): number {
  const titleW = doc.title.length * 7.4 + PAD * 2;
  const subW = (tb?.subtitle?.length ?? 0) * 6.6 + PAD * 2;
  return Math.ceil(Math.max(BLOCK_W, titleW, subW));
}

/** The title block's box (for other overlays to avoid), or null when off. */
export function titleBlockBox(
  doc: TopologyDocument,
  page: Page,
): { x: number; y: number; w: number; h: number } | null {
  const tb = doc.sheet?.titleBlock;
  if (!doc.sheet || !tb || tb.show === false) return null;
  const [vx, vy, vw, vh] = page.viewBox.split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const fields = (tb.fields ?? []).slice(0, SHEET_MAX_FIELDS);
  const rows = 1 + (tb.subtitle ? 1 : 0) + Math.ceil(fields.length / 2);
  const w = blockTextW(doc, tb) + (tb.logoHref ? LOGO_W : 0);
  const h = PAD * 2 + rows * ROW_H;
  const m = SHEET_MARGIN;
  return { x: vx + vw - m - w, y: vy + vh - m - h, w, h };
}

/** The sheet overlay for a page, or '' when the document has no sheet. */
export function sheetSVG(doc: TopologyDocument, page: Page): string {
  const sheet = doc.sheet;
  if (!sheet) return '';
  const [vx, vy, vw, vh] = page.viewBox.split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const m = SHEET_MARGIN;
  let s = `<g class="tds-sheet">`;
  if (sheet.border !== false)
    s +=
      `<rect x="${vx + m}" y="${vy + m}" width="${vw - 2 * m}" height="${vh - 2 * m}" ` +
      `fill="none" stroke="#7d8a92" stroke-width="1.5"/>`;
  if (sheet.title !== false && doc.title.trim())
    s +=
      `<text x="${vx + vw / 2}" y="${vy + m + 30}" text-anchor="middle" font-size="20" font-weight="700" ` +
      `font-family="ui-sans-serif,system-ui,sans-serif" fill="#01a982">${escXml(doc.title)}</text>`;
  const box = titleBlockBox(doc, page);
  const tb = sheet.titleBlock;
  if (box && tb) {
    const fields: SheetField[] = (tb.fields ?? []).slice(0, SHEET_MAX_FIELDS);
    const textW = blockTextW(doc, tb);
    s +=
      `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="6" ` +
      `fill="rgba(20,24,32,0.86)" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>`;
    let y = box.y + PAD + 13;
    s +=
      `<text x="${box.x + PAD}" y="${y}" font-size="12" font-weight="700" letter-spacing=".5" ` +
      `font-family="ui-monospace,monospace" fill="#01a982">${escXml(doc.title)}</text>`;
    if (tb.subtitle) {
      y += ROW_H;
      s +=
        `<text x="${box.x + PAD}" y="${y}" font-size="11" ` +
        `font-family="ui-monospace,monospace" fill="#e6e8e9">${escXml(tb.subtitle)}</text>`;
    }
    const colW = (textW - PAD * 2) / 2;
    fields.forEach((f, i) => {
      if (i % 2 === 0) y += ROW_H;
      const x = box.x + PAD + (i % 2) * colW;
      s +=
        `<text x="${x}" y="${y}" font-size="9.5" font-family="ui-monospace,monospace" fill="#e6e8e9">` +
        `<tspan font-weight="700">${escXml(f.label)}:</tspan> ${escXml(f.value)}</text>`;
    });
    if (tb.logoHref && /^https:\/\//i.test(tb.logoHref))
      s +=
        `<image x="${box.x + textW}" y="${box.y + PAD}" width="${LOGO_W - PAD}" height="${box.h - PAD * 2}" ` +
        `preserveAspectRatio="xMidYMid meet" href="${escXml(tb.logoHref)}"/>`;
  }
  return s + `</g>`;
}
