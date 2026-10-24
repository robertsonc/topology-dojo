/**
 * hw-catalog Phase 4: glyph SVGs are untrusted. The sanitizer must strip
 * scripts, event handlers, foreignObject, external references and CSS
 * url(), cap size, and refuse DTDs — and leave a clean glyph intact.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MAX_GLYPH_BYTES,
  sanitizeSvg,
  sanitizeSvgText,
} from './sanitize-svg.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const glyphDir = `${root}catalog/data/glyphs/platforms`;

const HOSTILE = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)" data-platform="x">
<script>alert(2)</script>
<style>rect { fill: url(https://evil.example/x.svg#a) }</style>
<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
<image href="https://evil.example/p.png" width="1" height="1"/>
<a href="javascript:alert(3)"><rect width="1" height="1"/></a>
<use xlink:href="https://evil.example/s.svg#x"/>
<use href="#g"/>
<rect width="5" height="5" fill="url(#g)" onclick="alert(4)" style="fill:url(https://evil.example/y)"/>
<rect width="4" height="4" fill="url( 'https://evil.example/z' )"/>
<g data-port="p1" data-cx="1" data-cy="2"><circle r="1" cx="1" cy="2" ONMOUSEOVER="x()"/></g>
<animate attributeName="x" to="1"/>
<text x="1" y="1">a &lt; b</text>
</svg>`;

describe('sanitizeSvg', () => {
  const { svg, removed } = sanitizeSvgText(HOSTILE);

  it('strips every active or external construct', () => {
    for (const bad of [
      '<script',
      'alert',
      '<style',
      '<foreignObject',
      '<image',
      '<a ',
      'javascript:',
      'evil.example',
      'onload',
      'onclick',
      'ONMOUSEOVER',
      '<animate',
      'style=',
    ])
      expect(svg).not.toContain(bad);
    expect(removed.length).toBeGreaterThan(8);
  });

  it('keeps same-document references, anchors and text', () => {
    expect(svg).toContain('fill="url(#g)"');
    expect(svg).toContain('<use href="#g"/>');
    expect(svg).toContain('data-port="p1" data-cx="1" data-cy="2"');
    expect(svg).toContain('a &lt; b');
    expect(svg).toContain('<linearGradient id="g">');
  });

  it('is idempotent', () => {
    expect(sanitizeSvgText(svg).svg).toBe(svg);
    expect(sanitizeSvgText(svg).removed).toEqual([]);
  });

  it('caps size and refuses DTDs and non-SVG roots', () => {
    const big = `<svg>${'<g/>'.repeat(MAX_GLYPH_BYTES / 4 + 1)}</svg>`;
    expect(() => sanitizeSvg(big)).toThrow(/larger than/);
    expect(() =>
      sanitizeSvg(
        '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
      ),
    ).toThrow(/DTD/);
    expect(() => sanitizeSvg('<html/>')).toThrow(/expected <svg>/);
  });

  it('leaves every seed glyph whole (nothing to remove)', () => {
    for (const f of readdirSync(glyphDir)) {
      const { removed, svg: clean } = sanitizeSvgText(
        readFileSync(`${glyphDir}/${f}`, 'utf8'),
      );
      expect(removed, f).toEqual([]);
      expect(clean).toContain('data-port=');
    }
  });
});
