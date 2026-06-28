import { describe, it, expect } from 'vitest';
import { applyPalette } from './topology-ds.js';

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
