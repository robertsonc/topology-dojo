import { describe, it, expect } from 'vitest';
import { createDocument } from '../api/builder.js';
import { sheetSVG, titleBlockBox } from './sheet.js';
import { documentOverlaySVG } from './overlays.js';
import { sheetPaperPt, sheetViewBox } from '../api/sheet.js';
import { parseDoc, serializeDoc } from '../pages/persist.js';
import { validateDocument } from '../api/validate.js';
import { renderDocumentToSVG } from '../server/render.js';

function doc() {
  return createDocument('HPE Discover 2026 – Venue')
    .page()
    .node({ id: 'a', type: 'ec', x: 300, y: 300 })
    .build();
}

describe('sheet frame + title block (W6)', () => {
  it('maps standard sizes to a 96 dpi viewBox and 72 pt paper', () => {
    expect(sheetViewBox('ansi-c')).toBe('0 0 2112 1632');
    expect(sheetViewBox('ansi-c', 'portrait')).toBe('0 0 1632 2112');
    expect(sheetViewBox('a4')).toBe('0 0 1122 794');
    expect(sheetViewBox('custom')).toBeNull();
    expect(sheetPaperPt('ansi-c')).toEqual({ w: 1584, h: 1224 });
  });

  it('draws nothing without a sheet and the full frame with one', () => {
    const d = doc();
    expect(sheetSVG(d, d.pages[0]!)).toBe('');
    d.sheet = {
      titleBlock: {
        subtitle: 'Venue Distribution Leaf Details',
        fields: [
          { label: 'Drawn by', value: 'K. Marshall' },
          { label: 'Revision', value: '1' },
          { label: 'Date', value: '2026-10-15' },
          { label: 'Size', value: 'ANSI C' },
        ],
      },
    };
    const svg = sheetSVG(d, d.pages[0]!);
    expect(svg).toContain('class="tds-sheet"');
    expect(svg).toContain('stroke="#7d8a92"'); // border
    expect(svg).toContain('HPE Discover 2026 – Venue'); // top title + block
    expect(svg).toContain('Venue Distribution Leaf Details');
    expect(svg).toContain('Drawn by');
    const box = titleBlockBox(d, d.pages[0]!)!;
    expect(box.x + box.w).toBe(1050 - 24);
    expect(box.y + box.h).toBe(700 - 24);
  });

  it('keeps the legend inside the border and composes both overlays', () => {
    const d = doc();
    d.sheet = {};
    d.legend = { show: true, position: 'bl' };
    const svg = documentOverlaySVG(d, d.pages[0]!);
    expect(svg.indexOf('tds-sheet')).toBeLessThan(svg.indexOf('tds-legend'));
    expect(svg).toContain('translate(32,'); // 24 border + 8
    const svg2 = renderDocumentToSVG(d, 0);
    expect(svg2).toContain('tds-sheet');
  });

  it('round-trips through persist and validates size / logo / viewBox drift', () => {
    const d = doc();
    d.sheet = {
      size: 'ansi-c',
      border: false,
      titleBlock: { logoHref: 'https://example.com/logo.svg', show: false },
    };
    const back = parseDoc(serializeDoc(d))!;
    expect(back.sheet).toEqual(d.sheet);
    const junk = parseDoc({
      pages: [{ nodes: [], links: [] }],
      sheet: { size: 'letter', titleBlock: { logoHref: 'javascript:x' } },
    })!;
    expect(junk.sheet).toEqual({ titleBlock: {} });
    const p = validateDocument(d);
    expect(p.some((x) => /differs from the sheet size/.test(x.message))).toBe(
      true,
    );
    d.sheet.titleBlock!.logoHref = 'http://insecure';
    expect(
      validateDocument(d).some((x) =>
        /logoHref must be an https/.test(x.message),
      ),
    ).toBe(true);
  });
});
