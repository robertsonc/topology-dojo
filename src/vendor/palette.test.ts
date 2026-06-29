import { describe, it, expect } from 'vitest';
import { applyPalette, lightenCanvas } from './topology-ds.js';

describe('lightenCanvas (light-mode card remap, #8)', () => {
  it('flips dark card surfaces to light and light text to dark', () => {
    const svg =
      '<rect fill="#292d3a"/><rect fill="#22252e"/><circle fill="#1d1f27"/>' +
      '<text fill="#e6e8e9">Node</text>';
    const out = lightenCanvas(svg);
    expect(out).not.toContain('#292d3a');
    expect(out).not.toContain('#22252e');
    expect(out).toContain('#ffffff'); // main card surface → white
    expect(out).toContain('<text fill="#1d1f27">Node</text>'); // text → dark
  });

  it('swaps the rgba label-glass gradient fill for a solid light chip', () => {
    const svg = '<rect fill="url(#tds-labelGlass)"/>';
    const out = lightenCanvas(svg);
    expect(out).not.toContain('url(#tds-labelGlass)');
    expect(out).toContain('fill="#ffffff"');
  });

  it('leaves semantic accent/alert colours untouched', () => {
    const svg = '<rect stroke="#01a982"/><rect stroke="#fc6161"/>';
    expect(lightenCanvas(svg)).toBe(svg);
  });
});

describe('applyPalette (brand-colour remap, #7)', () => {
  it('remaps the engine accent green in both #hex and rgba() forms', () => {
    const svg =
      '<rect stroke="#01a982"/><rect fill="#01A982"/>' +
      '<feFlood flood-color="rgba(1,169,130,.2)"/>';
    const out = applyPalette(svg, { accent: '#0a84ff' });
    expect(out).not.toContain('#01a982');
    expect(out).not.toContain('#01A982');
    expect(out).not.toContain('rgba(1,169,130');
    expect(out).toContain('#0a84ff');
    expect(out).toContain('rgba(10,132,255,.2)');
  });

  it('remaps the secondary blue only when a secondary is given', () => {
    const svg = '<rect stroke="#65aef9"/>';
    expect(applyPalette(svg, { accent: '#0a84ff' })).toContain('#65aef9');
    expect(
      applyPalette(svg, { accent: '#0a84ff', secondary: '#b58cff' }),
    ).toContain('#b58cff');
  });

  it('leaves functional colours (reds, greys) untouched', () => {
    const svg = '<rect fill="#fc6161"/><rect fill="#b1b9be"/>';
    const out = applyPalette(svg, { accent: '#0a84ff', secondary: '#b58cff' });
    expect(out).toContain('#fc6161');
    expect(out).toContain('#b1b9be');
  });

  it('leaves the SVG unchanged for an invalid target colour', () => {
    const svg = '<rect stroke="#01a982"/>';
    expect(applyPalette(svg, { accent: 'not-a-hex' })).toBe(svg);
  });
});
