import { describe, expect, it } from 'vitest';
import { pruneUnusedDefs, roundGeometry } from './prune-defs.js';
import { renderDocumentToSVG } from '../server/render.js';
import { sampleDocument } from '../pages/model.js';
import { buildTemplate } from '../api/templates.js';

describe('pruneUnusedDefs', () => {
  it('keeps what the drawing references and drops the rest', () => {
    const svg =
      '<svg><defs>' +
      '<filter id="glow"><feGaussianBlur stdDeviation="2"/></filter>' +
      '<filter id="unused"><feGaussianBlur stdDeviation="9"/></filter>' +
      '<pattern id="grid" width="4" height="4"><path d="M0 0h4"/></pattern>' +
      '<linearGradient id="dead"><stop offset="0"/></linearGradient>' +
      '</defs>' +
      '<rect fill="url(#grid)"/><circle filter="url(#glow)"/></svg>';
    const out = pruneUnusedDefs(svg);
    expect(out).toContain('id="glow"');
    expect(out).toContain('id="grid"');
    expect(out).not.toContain('id="unused"');
    expect(out).not.toContain('id="dead"');
    expect(out).toContain(
      '<rect fill="url(#grid)"/><circle filter="url(#glow)"/>',
    );
  });

  it('follows references between definitions', () => {
    // The pattern is used by the drawing and itself paints with a gradient.
    const svg =
      '<svg><defs>' +
      '<linearGradient id="g"><stop offset="0"/></linearGradient>' +
      '<pattern id="p"><rect fill="url(#g)"/></pattern>' +
      '<linearGradient id="g2" href="#g"/>' +
      '</defs><rect fill="url(#p)"/></svg>';
    const out = pruneUnusedDefs(svg);
    expect(out).toContain('id="p"');
    expect(out).toContain('id="g"');
    expect(out).not.toContain('id="g2"');
  });

  it('recognises href and xlink:href references, and keeps id-less children', () => {
    const svg =
      '<svg><defs><style>.a{fill:red}</style>' +
      '<symbol id="s"><path d="M0 0"/></symbol>' +
      '<symbol id="t"><path d="M1 1"/></symbol>' +
      '<symbol id="u"><path d="M2 2"/></symbol>' +
      '</defs><use href="#s"/><use xlink:href="#t"/></svg>';
    const out = pruneUnusedDefs(svg);
    expect(out).toContain('<style>.a{fill:red}</style>');
    expect(out).toContain('id="s"');
    expect(out).toContain('id="t"');
    expect(out).not.toContain('id="u"');
  });

  it('removes a defs block that ends up empty, and handles several blocks', () => {
    const svg =
      '<svg><defs><filter id="a"><feOffset/></filter></defs>' +
      '<defs><filter id="b"><feOffset/></filter></defs>' +
      '<g filter="url(#b)"/></svg>';
    expect(pruneUnusedDefs(svg)).toBe(
      '<svg><defs><filter id="b"><feOffset/></filter></defs><g filter="url(#b)"/></svg>',
    );
  });

  it('leaves the SVG untouched when there is nothing to prune or it cannot parse', () => {
    const fine =
      '<svg><defs><filter id="a"/></defs><g filter="url(#a)"/></svg>';
    expect(pruneUnusedDefs(fine)).toBe(fine);
    const none = '<svg><rect/></svg>';
    expect(pruneUnusedDefs(none)).toBe(none);
    const broken = '<svg><defs><filter id="a"><feOffset></defs><g/></svg>';
    expect(pruneUnusedDefs(broken)).toBe(broken);
  });

  it('on real renders removes most of the definition table and no drawing', () => {
    for (const doc of [sampleDocument(), buildTemplate('hub-spoke')]) {
      const svg = renderDocumentToSVG(doc, 0, { calm: true });
      const out = pruneUnusedDefs(svg);
      const body = (s: string): string =>
        s.replace(/<defs\b[^>]*>[\s\S]*?<\/defs>/g, '');
      // Everything outside <defs> is byte-for-byte what it was.
      expect(body(out)).toBe(body(svg));
      // Every reference still resolves.
      for (const m of out.matchAll(/url\(#([^)]+)\)/g))
        expect(out).toContain(`id="${m[1]}"`);
      expect(svg.length - out.length).toBeGreaterThan(10_000);
    }
  });
});

describe('roundGeometry', () => {
  it('rounds long decimals in geometry attributes only', () => {
    const svg =
      '<svg><path d="M235,165 L554.6666666666666,537.3333333333334"/>' +
      '<line x1="617.3179368653874" y1="2" x2="-0.0049999" y2="1.5"/>' +
      '<text x="10.123456" data-v="3.14159265">ratio 3.14159265</text>' +
      '<rect width="42" height="20.5" fill="#01a982" opacity=".0251234"/></svg>';
    expect(roundGeometry(svg)).toBe(
      '<svg><path d="M235,165 L554.67,537.33"/>' +
        '<line x1="617.32" y1="2" x2="0" y2="1.5"/>' +
        '<text x="10.12" data-v="3.14159265">ratio 3.14159265</text>' +
        '<rect width="42" height="20.5" fill="#01a982" opacity=".0251234"/></svg>',
    );
  });

  it('never moves anything by more than half a hundredth', () => {
    const svg = renderDocumentToSVG(buildTemplate('hub-spoke'), 0, {
      calm: true,
    });
    const numbers = (s: string): number[] =>
      [...s.matchAll(/\s(?:x1|y1|x2|y2|cx|cy|x|y)="(-?[\d.]+)"/g)].map((m) =>
        Number(m[1]),
      );
    const before = numbers(svg);
    const after = numbers(roundGeometry(svg));
    expect(after).toHaveLength(before.length);
    before.forEach((n, i) =>
      expect(Math.abs(n - after[i]!)).toBeLessThanOrEqual(0.005 + 1e-9),
    );
  });
});

describe('render profile', () => {
  it("'clean' is static, prunes definitions, and draws the same elements", () => {
    const doc = sampleDocument();
    const full = renderDocumentToSVG(doc, 0);
    const clean = renderDocumentToSVG(doc, 0, { profile: 'clean' });
    expect(full).toMatch(/<animate/);
    expect(clean).not.toMatch(/<animate/);
    expect(clean.length).toBeLessThan(full.length * 0.5);
    // Same nodes and links are drawn.
    const ids = (s: string): string[] =>
      [...s.matchAll(/data-tds-(?:node|link)="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids(clean)).toEqual(
      ids(renderDocumentToSVG(doc, 0, { calm: true })),
    );
    // Light theme and a brand palette still resolve their definitions.
    const light = renderDocumentToSVG(
      { ...doc, palette: { accent: '#ff8800' }, legend: { show: true } },
      0,
      { profile: 'clean', theme: 'light' },
    );
    for (const m of light.matchAll(/url\(#([^)]+)\)/g))
      expect(light).toContain(`id="${m[1]}"`);
  });

  it('the default build is untouched, and pruneDefs alone keeps animation', () => {
    const doc = sampleDocument();
    expect(renderDocumentToSVG(doc, 0, { profile: 'full' })).toBe(
      renderDocumentToSVG(doc, 0),
    );
    const pruned = renderDocumentToSVG(doc, 0, { pruneDefs: true });
    expect(pruned).toMatch(/<animate/);
    expect(pruned.length).toBeLessThan(renderDocumentToSVG(doc, 0).length);
  });
});
