import { describe, it, expect } from 'vitest';
import { nodeSpecToCode } from './codegen.js';
import { renderCustomNode } from './render.js';
import { defaultSpec } from './spec.js';
import type { CustomNodeSpec } from './spec.js';

/** Run a generated snippet against a stub engine; return the captured render fn. */
function evalSnippet(code: string): {
  render: (x: number, y: number, cfg?: { color?: string }) => string;
  defaults: { color: string };
  hitBox: { rx: number; ry: number };
} {
  let captured: unknown;
  const TopologyDesigner = {
    registerNodeType: (_name: string, def: unknown) => {
      captured = def;
    },
  };
  // eslint-disable-next-line no-new-func
  new Function('TopologyDesigner', code)(TopologyDesigner);
  return captured as ReturnType<typeof evalSnippet>;
}

const variants: Record<string, Partial<CustomNodeSpec>> = {
  'plain circle': {},
  'all embellishments': {
    shape: 'hexagon',
    icon: 'shield',
    glow: true,
    highlight: true,
    innerRing: true,
    pattern: true,
    patternType: 'crosshatch',
    leds: true,
    ledCount: 3,
    ledPos: 'bottom',
    badge: true,
    badgeText: 'VM',
    antenna: true,
    ports: true,
    portCount: 4,
    portPos: 'bottom',
  },
  'rectangle + star icon': { shape: 'rectangle', icon: 'server' },
  diamond: { shape: 'diamond', colorStroke: '#65aef9' },
};

describe('node copy-as-code (1.4)', () => {
  for (const [label, over] of Object.entries(variants)) {
    it(`renders identically to the interpreter — ${label}`, () => {
      const spec: CustomNodeSpec = {
        ...defaultSpec(),
        typeName: 'myNode',
        ...over,
      };
      const snippet = nodeSpecToCode(spec);
      const reg = evalSnippet(snippet);
      // Faithful at several positions and with a colour override.
      for (const [x, y, color] of [
        [0, 0, undefined],
        [200, 140, undefined],
        [640, 480, '#deb146'],
      ] as const) {
        expect(reg.render(x, y, color ? { color } : {})).toBe(
          renderCustomNode(spec, x, y, color ? { color } : {}),
        );
      }
      expect(reg.defaults.color).toBe(spec.colorStroke);
    });
  }

  it('emits a self-contained registerNodeType snippet', () => {
    const code = nodeSpecToCode({ ...defaultSpec(), typeName: 'edgeBox' });
    expect(code).toContain("TopologyDesigner.registerNodeType('edgeBox'");
    expect(code).toContain('render(x, y, cfg = {})');
    expect(code).toContain('hitBox:');
  });
});
