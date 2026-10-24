/**
 * Light-theme contrast, measured as drawn. `theme.test.ts` checks the
 * light palette as solid hex; this renders a probe page with every node
 * type, every link / wire type, flow paths, zones, a callout, the legend,
 * the caption and a wire sheet in `theme: "light"`, composites every
 * stroke and text paint over its actual backdrop (nested opacity included)
 * and holds them to WCAG:
 *
 * - primary link / flow strokes (tagged `data-tds-role="primary"` by the
 *   engine in light renders) >= 3:1, and every link has one;
 * - text >= 4.5:1 (node, zone, wire, legend, caption labels).
 *
 * Fill washes and other decoration are not measured: only tagged primary
 * strokes and text are. Text the engine tags `data-tds-role="wash"` (the
 * decorative glyph art inside node icons) is exempt.
 */
import { describe, expect, it } from 'vitest';
import { renderDocumentToSVG } from '../server/render.js';
import { measure, type Measured } from '../testing/contrast.js';
import { themeBackground } from './theme.js';
import { captionSVG } from '../editor/caption.js';
import { buildBundle, loadCatalogDir } from '../catalog/build.js';
import { Catalog } from '../catalog/catalog.js';
import { branchWiresheetDoc } from './wiresheet-fixtures.js';
import { fileURLToPath } from 'node:url';
import { lightProbe as probe } from '../testing/light-probe.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

const bg = themeBackground('light');
const fails = (m: Measured[]): string[] =>
  m
    .filter((x) =>
      x.kind === 'text'
        ? x.role !== 'wash' && x.ratio < 4.5
        : x.role === 'primary' && x.ratio < 3,
    )
    .map(
      (x) =>
        `${x.what} ${x.color} α${x.alpha.toFixed(2)} → ${x.ratio.toFixed(2)}:1`,
    );

describe('light theme — composited contrast', () => {
  const doc = probe();
  const svg = renderDocumentToSVG(doc, 0, { theme: 'light', calm: true });
  const withCaption = svg.replace(
    '</svg>',
    `${captionSVG(doc.pages[0]!)}</svg>`,
  );
  const measured = measure(withCaption, bg);

  it('measures the probe (sanity)', () => {
    expect(measured.filter((m) => m.kind === 'text').length).toBeGreaterThan(
      80,
    );
  });

  it('every link draws a primary stroke at >= 3:1', () => {
    for (const l of doc.pages[0]!.links) {
      const i = svg.indexOf(`data-tds-link="${l.id}"`);
      expect(i, l.id).toBeGreaterThan(-1);
    }
    const primaries = measured.filter(
      (m) => m.role === 'primary' && m.kind === 'stroke',
    );
    // One primary stroke per link (blocked draws two half-segments).
    expect(primaries.length).toBeGreaterThanOrEqual(doc.pages[0]!.links.length);
    expect(fails(primaries)).toEqual([]);
  });

  it('every label reads at >= 4.5:1', () => {
    expect(fails(measured.filter((m) => m.kind === 'text'))).toEqual([]);
  });

  it('primary strokes are at least 1.5px', () => {
    const thin = measured.filter(
      (m) =>
        m.role === 'primary' && m.kind === 'stroke' && (m.width ?? 0) < 1.5,
    );
    expect(thin.map((m) => `${m.what} w=${m.width}`)).toEqual([]);
  });

  it('a wire sheet holds the same bar', () => {
    const catalog = new Catalog(
      buildBundle(loadCatalogDir(`${root}catalog/data`)),
    );
    const ws = renderDocumentToSVG(branchWiresheetDoc(), 0, {
      theme: 'light',
      calm: true,
      hardware: { catalog },
    });
    expect(fails(measure(ws, bg).filter((m) => m.kind === 'text'))).toEqual([]);
  });
});
