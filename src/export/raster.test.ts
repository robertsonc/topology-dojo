/**
 * The server-side rasterizer has one embedded font and no fallback: a
 * character that font lacks prints as an empty box unless it is spelled in
 * characters the font has.
 */
import { describe, expect, it } from 'vitest';
import { drawableText } from './raster.js';
import { nodeRasterizer } from '../server/raster.js';

const svg = (text: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 40" width="300" height="40">` +
  `<rect width="300" height="40" fill="#10141c"/>` +
  `<text x="10" y="26" fill="#ffffff" font-size="16">${text}</text></svg>`;

describe('drawableText', () => {
  it('spells arrows in characters the embedded font can draw', () => {
    expect(drawableText('LTE1→INET1')).toBe('LTE1-&gt;INET1');
    expect(drawableText('a ← b ↔ c ⇒ d')).toBe('a &lt;- b &lt;-&gt; c =&gt; d');
  });

  it('spells the deny, redirect and NAT marker icons', () => {
    expect(drawableText('✕ ↪ ⇄')).toBe('× -&gt; &lt;-&gt;');
  });

  it('keeps the markup well formed and leaves everything else alone', () => {
    const out = drawableText(svg('up ↑ down ↓ é ü — ok'));
    expect(out).toBe(svg('up ↑ down ↓ é ü — ok'));
    expect(drawableText(svg('a←b'))).not.toMatch(/<-/);
  });
});

describe('rasterizing a label with an arrow', () => {
  it('draws the arrow instead of an empty box', async () => {
    const r = await nodeRasterizer();
    const arrow = r.rasterize(svg('LTE1→INET1'), 1).pixels;
    const ascii = r.rasterize(svg('LTE1-&gt;INET1'), 1).pixels;
    // The same picture as the ASCII spelling, which the typeface draws as an
    // arrow.
    expect(Buffer.from(arrow).equals(Buffer.from(ascii))).toBe(true);
    // And not the picture of the two labels with nothing between them.
    const gap = r.rasterize(svg('LTE1 INET1'), 1).pixels;
    expect(Buffer.from(arrow).equals(Buffer.from(gap))).toBe(false);
  });
});
