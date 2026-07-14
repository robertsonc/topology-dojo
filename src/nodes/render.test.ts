import { describe, it, expect } from 'vitest';
import { renderCustomNode, customHitBox } from './render.js';
import { defaultSpec, type CustomNodeSpec } from './spec.js';

describe('renderCustomNode', () => {
  it('renders the base shape and accent stroke, flat (no glow halo)', () => {
    const svg = renderCustomNode(defaultSpec(), 100, 50);
    expect(svg).toContain('<circle'); // circle base shape
    expect(svg).toContain('stroke="#01a982"'); // accent
    expect(svg).toContain('cx="100"');
    // Glow is now an emphasis-only channel applied at the render seam; the node
    // art itself carries no halo/blur.
    expect(svg).not.toContain('filter="url(#tds-glow');
  });

  it('cfg.color overrides the accent and stays flat', () => {
    const svg = renderCustomNode(defaultSpec(), 0, 0, { color: '#fc6161' });
    expect(svg).toContain('stroke="#fc6161"'); // accent overridden
    expect(svg).not.toContain('filter="url(#tds-'); // no baked glow/bloom
  });

  it('includes each enabled embellishment', () => {
    const spec: CustomNodeSpec = {
      ...defaultSpec(),
      shape: 'hexagon',
      icon: 'signal',
      leds: true,
      badge: true,
      badgeText: 'X',
      antenna: true,
      ports: true,
      portCount: 3,
    };
    const svg = renderCustomNode(spec, 0, 0);
    expect(svg).toContain('<polygon'); // hexagon
    expect(svg).toContain('<path'); // icon + antenna arcs
    expect(svg).toContain(`fill="${defaultSpec().ledColor}"`); // LED (flat, no bloom)
    expect(svg).not.toContain('filter="url(#tds-bloom)'); // no per-LED bloom
    expect(svg).toContain('>X</text>'); // badge text
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThanOrEqual(3); // 3 ports
  });

  it('uses a pattern fill when enabled', () => {
    const spec: CustomNodeSpec = {
      ...defaultSpec(),
      typeName: 'patty',
      pattern: true,
      patternType: 'dots',
    };
    const svg = renderCustomNode(spec, 0, 0);
    expect(svg).toContain('<pattern id="patty-pat"');
    expect(svg).toContain('fill="url(#patty-pat)"');
  });

  it('computes hitBox half-extents from the shape', () => {
    expect(
      customHitBox({ ...defaultSpec(), shape: 'hexagon', size: 22 }),
    ).toEqual({
      rx: 22,
      ry: 22,
    });
    // ellipse is wider than tall
    const e = customHitBox({ ...defaultSpec(), shape: 'ellipse', size: 20 });
    expect(e.rx).toBeGreaterThan(e.ry);
  });
});
