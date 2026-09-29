import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { ensureShim } from '../render/core.js';
import {
  collectIcons,
  glyphArts,
  glyphSvg,
  nodeIconSvg,
  themeMarkup,
  type IconEngine,
} from './icon-export.js';
import { ICONS } from './data.js';
import { STOCK_NODE_SPECS } from './stock.js';

function engine(): IconEngine {
  ensureShim();
  const mod = createRequire(import.meta.url)(
    '../../public/vendor/topology-ds.js',
  ) as { default?: IconEngine } & IconEngine;
  return mod.default ?? mod;
}

describe('themeMarkup', () => {
  it('tags themed fills/strokes and leaves accent colours alone', () => {
    const { markup } = themeMarkup(
      '<circle fill="#292d3a" stroke="#01a982"/><text fill="#e6e8e9">x</text>',
    );
    expect(markup).toContain('fill="#292d3a" stroke="#01a982" class="tds-f0"');
    expect(markup).toContain('fill="#e6e8e9" class="tds-f4"');
  });

  it('merges into an existing class and keeps rgba alpha', () => {
    const { markup, extra } = themeMarkup(
      '<rect class="a" fill="rgba(41,45,58,.5)"/>',
    );
    expect(markup).toContain('class="a tds-f0a.5"'.replace('.5', '_5'));
    expect([...extra]).toEqual(['f0:.5']);
  });

  it('replaces the unrecolourable label-glass gradient with a themed solid', () => {
    const { markup } = themeMarkup('<rect fill="url(#tds-labelGlass)"/>');
    expect(markup).not.toContain('url(#');
    expect(markup).toContain('tds-f2');
  });
});

describe('icon library export', () => {
  const arts = collectIcons(engine());

  it('covers every engine built-in (bar image) and every stock type', () => {
    const ids = new Set(arts.map((a) => a.id));
    for (const s of STOCK_NODE_SPECS) expect(ids.has(s.typeName)).toBe(true);
    for (const t of ['ec', 'router', 'firewall', 'cloud', 'shape-star'])
      expect(ids.has(t)).toBe(true);
    expect(new Set(ids).size).toBe(arts.length);
  });

  it('emits self-contained SVGs with a light-mode override', () => {
    for (const a of arts) {
      const svg = nodeIconSvg(a);
      expect(svg.startsWith('<svg xmlns=')).toBe(true);
      expect(svg).not.toMatch(/url\(#/); // no external <defs> dependency
      if (/tds-[fs]\d/.test(a.markup) || /class="tds-/.test(svg))
        expect(svg).toContain('prefers-color-scheme:light');
    }
  });

  it('exports one themed SVG per glyph, straight from the ICONS paths', () => {
    expect(glyphArts()).toHaveLength(Object.keys(ICONS).length);
    for (const [key, g] of Object.entries(ICONS)) {
      const svg = glyphSvg(key);
      expect(svg).toContain(`d="${g.d}"`);
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('prefers-color-scheme:light');
    }
    expect(() => glyphSvg('nope')).toThrow(/unknown icon glyph/);
  });
});
