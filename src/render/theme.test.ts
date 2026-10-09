/**
 * Light render theme (#264): the remap table's contrast, the colour pass
 * itself, and the headless render paths honouring `theme`.
 */
import { describe, it, expect } from 'vitest';
import {
  LIGHT_BACKGROUND,
  LIGHT_CANVAS,
  LIGHT_THEME_MAP,
  applyRenderTheme,
  compositeOver,
  contrastRatio,
  relativeLuminance,
  themeBackground,
} from './theme.js';
import { renderDocumentToSVG, renderPageToSVG } from '../server/render.js';
import { exportFlipbookHTML } from './flipbook.js';
import { createDocument } from '../api/builder.js';
import type { TopologyDocument } from '../pages/model.js';

/** Remapped value for an engine source colour. */
function mapped(from: string): string {
  const e = LIGHT_THEME_MAP.find(
    (x) => x.from.toLowerCase() === from.toLowerCase(),
  );
  if (!e) throw new Error(`no remap for ${from}`);
  return e.to;
}

/** A page touching every engine-drawn text/surface/overlay/accent at once. */
function representative(): TopologyDocument {
  const doc = createDocument('Theme')
    .layer({ id: 'under', name: 'Underlay' })
    .page({ name: 'Frame 1' })
    .viewBox('0 0 1200 700')
    .node({
      id: 'ec',
      type: 'ec',
      x: 150,
      y: 150,
      label: 'Branch',
      status: 'up',
    })
    .node({ id: 'sw', type: 'switch', x: 400, y: 150, label: 'Core' })
    .node({ id: 'fw', type: 'firewall', x: 650, y: 150, label: 'Edge FW' })
    .node({ id: 'cl', type: 'cloud', x: 900, y: 150, label: 'Internet' })
    .node({ id: 'id', type: 'idcard', x: 150, y: 400, label: 'Alice' })
    .node({
      id: 'note',
      type: 'callout',
      x: 450,
      y: 450,
      label: 'Replace during the window',
      target: 'fw',
    })
    .node({
      id: 'txt',
      type: 'text',
      x: 800,
      y: 450,
      label: 'Free text',
      width: 160,
    })
    .link({ id: 'l1', type: 'line', from: 'ec', to: 'sw', label: 'ge-0/0/1' })
    .link({ id: 'l2', type: 'tunnel', from: 'sw', to: 'fw', label: 'ipsec' })
    .link({ id: 'l3', type: 'line', from: 'fw', to: 'cl', status: 'down' })
    .zone({ id: 'z', label: 'Campus', nodes: ['ec', 'sw'] })
    .flowPath({ id: 'f', label: 'App', waypoints: ['ec', 'sw', 'fw'] })
    .policyMarker({ id: 'm', nodeId: 'fw', type: 'inspect' })
    .nextPage({ name: 'Frame 2' })
    .node({ id: 'ec', type: 'ec', x: 150, y: 150, label: 'Branch' })
    .build();
  doc.legend = { show: true, position: 'br' };
  return doc;
}

describe('LIGHT_THEME_MAP contrast (WCAG relative luminance)', () => {
  const bg = LIGHT_BACKGROUND;
  const text = LIGHT_THEME_MAP.filter((e) => e.role === 'text');
  const accents = LIGHT_THEME_MAP.filter((e) => e.role === 'accent');
  // Card surfaces that carry on-card text (not the border/divider grey).
  const textSurfaces = ['#292d3a', '#22252e', '#1d1f27'].map(mapped);
  // The label-glass top stop, as the pass really remaps it, flattened on the page.
  const glassTop = /stop-color="([^"]+)"/.exec(
    applyRenderTheme('<stop stop-color="rgba(34,37,46,.92)"/>', 'light'),
  )![1]!;
  const glass = compositeOver(glassTop, bg);
  // The solid chip fill the pass substitutes for the gradient.
  const chip = '#ffffff';

  it('the helpers reproduce the WCAG reference values', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(compositeOver('rgba(0,0,0,.5)', '#ffffff')).toBe('#808080');
  });

  it('every text grey reads at ≥ 4.5:1 on the page, the glass and the cards', () => {
    expect(text.length).toBeGreaterThanOrEqual(3);
    for (const t of text) {
      for (const surface of [bg, glass, chip, ...textSurfaces]) {
        const ratio = contrastRatio(t.to, surface);
        expect(
          ratio,
          `${t.from} → ${t.to} on ${surface}: ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('every accent reads at ≥ 3:1 on the page and on a white card', () => {
    expect(accents.length).toBeGreaterThanOrEqual(4);
    for (const a of accents) {
      for (const surface of [bg, chip]) {
        const ratio = contrastRatio(a.to, surface);
        expect(
          ratio,
          `${a.from} → ${a.to} on ${surface}: ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('the page background and every light surface are light, every text dark', () => {
    expect(relativeLuminance(bg)).toBeGreaterThan(0.7);
    for (const s of LIGHT_THEME_MAP.filter((e) => e.role === 'surface'))
      expect(relativeLuminance(s.to), s.from).toBeGreaterThan(0.6);
    for (const t of text)
      expect(relativeLuminance(t.to), t.from).toBeLessThan(0.2);
  });

  it('keeps the #8 card subset (what the icon exporter themes) stable', () => {
    expect(LIGHT_CANVAS).toEqual([
      { from: '292d3a', rgb: '41,45,58', to: '#ffffff', toRgb: '255,255,255' },
      { from: '22252e', rgb: '34,37,46', to: '#f2f5f8', toRgb: '242,245,248' },
      { from: '1d1f27', rgb: '29,31,39', to: '#e9edf2', toRgb: '233,237,242' },
      { from: '3e4550', rgb: '62,69,80', to: '#ccd4dc', toRgb: '204,212,220' },
      { from: 'e6e8e9', rgb: '230,232,233', to: '#1d1f27', toRgb: '29,31,39' },
    ]);
  });
});

describe('applyRenderTheme (colour pass)', () => {
  it('is the identity for the dark theme', () => {
    const svg = '<rect fill="#292d3a"/><text fill="#e6e8e9">x</text>';
    expect(applyRenderTheme(svg, 'dark')).toBe(svg);
  });

  it('never chains entries: remapped text is not re-mapped as a surface', () => {
    const out = applyRenderTheme(
      '<rect fill="#1d1f27"/><text fill="#e6e8e9">x</text>',
      'light',
    );
    expect(out).toBe('<rect fill="#e9edf2"/><text fill="#1d1f27">x</text>');
  });

  it('matches hex case-insensitively and keeps an 8-digit alpha byte', () => {
    expect(
      applyRenderTheme('<g fill="#E6E8E9" stroke="#1D1F2780"/>', 'light'),
    ).toBe('<g fill="#1d1f27" stroke="#e9edf280"/>');
  });

  it('remaps rgb()/rgba() forms of a hex source, preserving the alpha text', () => {
    expect(
      applyRenderTheme(
        '<stop stop-color="rgba(34,37,46,.92)"/><stop stop-color="rgba(29, 31, 39, 0.88)"/><r fill="rgb(41,45,58)"/>',
        'light',
      ),
    ).toBe(
      '<stop stop-color="rgba(242,245,248,.92)"/><stop stop-color="rgba(233,237,242,0.88)"/><r fill="rgb(255,255,255)"/>',
    );
  });

  it('flips translucent white overlays to same-alpha black, leaves opaque white', () => {
    expect(
      applyRenderTheme(
        '<a stroke="rgba(255,255,255,.06)"/><b fill="rgba(255,255,255,0.5)"/><c fill="#ffffff"/><d fill="rgba(255,255,255,1)"/>',
        'light',
      ),
    ).toBe(
      '<a stroke="rgba(0,0,0,.06)"/><b fill="rgba(0,0,0,0.5)"/><c fill="#ffffff"/><d fill="rgba(255,255,255,1)"/>',
    );
  });

  it('leaves document-sourced colours alone', () => {
    const svg =
      '<rect fill="#9b8cff" stroke="#ff8800"/><p fill="rgba(10,20,30,.5)"/>';
    expect(applyRenderTheme(svg, 'light')).toBe(svg);
  });

  it('swaps the label-glass gradient for a solid light chip', () => {
    expect(
      applyRenderTheme('<rect fill="url(#tds-labelGlass)"/>', 'light'),
    ).toBe('<rect fill="#ffffff"/>');
  });

  it('themeBackground picks the wrapper backdrop', () => {
    expect(themeBackground(undefined)).toBe('#0e1613');
    expect(themeBackground('dark')).toBe('#0e1613');
    expect(themeBackground('light')).toBe(LIGHT_BACKGROUND);
  });
});

describe('headless render with theme', () => {
  const doc = representative();

  it('dark is the default and is byte-identical to the explicit option', () => {
    const before = renderDocumentToSVG(doc);
    const after = renderDocumentToSVG(doc, 0, { theme: 'dark' });
    expect(after).toBe(before);
    expect(
      renderPageToSVG(doc.pages[0]!, doc.customNodes, { theme: 'dark' }),
    ).toBe(renderPageToSVG(doc.pages[0]!, doc.customNodes));
    // Today's dark output: engine backdrop, light label text, dark glass.
    expect(before).toContain('fill="#0e1613"');
    expect(before).toContain('fill="#e6e8e9"');
    expect(before).toContain('rgba(34,37,46,.92)');
  });

  it('light renders the light backdrop, dark text and no dark-tuned constants', () => {
    const svg = renderDocumentToSVG(doc, 0, { theme: 'light' });
    expect(svg).not.toBe(renderDocumentToSVG(doc));
    expect(svg).toContain(`fill="${LIGHT_BACKGROUND}"`);
    expect(svg).not.toContain('#0e1613');
    expect(svg).not.toContain('#e6e8e9');
    expect(svg).toContain('fill="#1d1f27"'); // label text
    expect(svg).toContain('fill="#5c6b76"'); // zone label grey
    expect(svg).not.toContain('url(#tds-labelGlass)'); // chips are solid
    expect(svg).not.toContain('rgba(255,255,255,.0'); // overlays flipped
    expect(svg).toContain('rgba(0,0,0,.06)'); // light grid + chip stroke
    // Legend panel themed with the page.
    expect(svg).toContain('tds-legend');
    expect(svg).not.toContain('rgba(20,24,32,0.86)');
    expect(svg).toContain('rgba(255,255,255,0.86)');
    // Every remaining <text> fill is one of the dark text greys or a darkened accent.
    const allowed = new Set([
      ...LIGHT_THEME_MAP.filter((e) => e.role !== 'surface').map((e) =>
        e.to.toLowerCase(),
      ),
      '#606a70',
    ]);
    for (const m of svg.matchAll(/<text[^>]*fill="([^"]*)"/g))
      expect(allowed.has(m[1]!.toLowerCase()), m[1]).toBe(true);
  });

  it('applies the brand palette before the theme so a document accent survives', () => {
    const branded = { ...doc, palette: { accent: '#ff8800' } };
    const svg = renderDocumentToSVG(branded, 0, { theme: 'light' });
    expect(svg).toContain('#ff8800');
    expect(svg).not.toContain('#01a982');
    expect(svg).not.toContain('#00875a'); // nothing left for the theme to darken
  });

  it('renderPageToSVG themes a bare page the same way', () => {
    const svg = renderPageToSVG(doc.pages[0]!, doc.customNodes, {
      theme: 'light',
    });
    expect(svg).toContain(`fill="${LIGHT_BACKGROUND}"`);
    expect(svg).not.toContain('#e6e8e9');
  });

  it('flipbook: light frames and light player chrome', () => {
    const dark = exportFlipbookHTML(doc, (d, i) => renderDocumentToSVG(d, i));
    const light = exportFlipbookHTML(
      doc,
      (d, i) => renderDocumentToSVG(d, i, { theme: 'light' }),
      { theme: 'light' },
    );
    expect(dark).toContain('background: #14161c');
    expect(light).toContain(`background: ${LIGHT_BACKGROUND}`);
    expect(light).not.toContain('#14161c');
    expect(
      light.match(new RegExp(`fill="${LIGHT_BACKGROUND}"`, 'g'))?.length,
    ).toBe(2);
    expect(light).not.toContain('#e6e8e9');
  });
});
