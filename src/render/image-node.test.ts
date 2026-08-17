/**
 * Image node (plan Phase 3.2) — renders an embedded `<image>` clipped to a
 * rounded box in the shared engine path; refuses non-https/non-data:image
 * sources (placeholder instead); sizes and fit map to SVG semantics.
 */
import { describe, it, expect } from 'vitest';
import { renderPageToSVG } from '../server/render.js';
import { nodeHalf } from '../api/geometry.js';
import { validateDocument } from '../api/validate.js';
import type { Page, TopologyDocument } from '../pages/model.js';

const PNG_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function page(node: Record<string, unknown>): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 600 400',
    nodes: [{ id: 'img1', type: 'image', x: 300, y: 200, ...node }],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  } as unknown as Page;
}

function doc(node: Record<string, unknown>): TopologyDocument {
  return {
    title: 'T',
    customNodes: [],
    pages: [page(node)],
  } as unknown as TopologyDocument;
}

describe('image node rendering', () => {
  it('renders an <image> with a rounded clip for a data:image URI', () => {
    const svg = renderPageToSVG(page({ imageHref: PNG_URI }), []);
    expect(svg).toContain('<image href="data:image/png;base64,');
    expect(svg).toContain('clipPath id="tds-imgclip-img1"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it('honours https sources, explicit size, cover fit, and corner radius', () => {
    const svg = renderPageToSVG(
      page({
        imageHref: 'https://cdn.example/logo.png',
        imageW: 200,
        imageH: 100,
        imageFit: 'cover',
        cornerRadius: 0,
      }),
      [],
    );
    expect(svg).toContain('href="https://cdn.example/logo.png"');
    expect(svg).toContain('width="200" height="100"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
  });

  it('renders a placeholder (never an <image>) for unsafe sources', () => {
    for (const bad of [
      undefined,
      'http://insecure.example/x.png', // http (not https) — placeholder
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///x.png',
    ]) {
      const svg = renderPageToSVG(
        page(bad === undefined ? {} : { imageHref: bad }),
        [],
      );
      expect(svg).not.toContain('<image');
      expect(svg).toContain('stroke-dasharray="5 4"'); // the placeholder frame
    }
  });

  it('draws the label below the image box by default', () => {
    const svg = renderPageToSVG(
      page({ imageHref: PNG_URI, imageH: 100, label: 'Rack photo' }),
      [],
    );
    // y=200, h=100 → label at 200 + 50 + 14 = 264.
    expect(svg).toContain('y="264"');
    expect(svg).toContain('Rack photo');
  });
});

describe('image node geometry + validation', () => {
  it('nodeHalf tracks the image box (default and explicit)', () => {
    expect(nodeHalf({ id: 'i', type: 'image', x: 0, y: 0 })).toEqual({
      w: 48,
      h: 36,
    });
    expect(
      nodeHalf({
        id: 'i',
        type: 'image',
        x: 0,
        y: 0,
        imageW: 200,
        imageH: 100,
      }),
    ).toEqual({ w: 100, h: 50 });
  });

  it('warns on a missing or non-https/non-data source', () => {
    const missing = validateDocument(doc({}));
    expect(missing.some((p) => p.message.includes('no imageHref'))).toBe(true);
    const insecure = validateDocument(
      doc({ imageHref: 'http://x.example/a.png' }),
    );
    const hit = insecure.find((p) => p.message.includes('https://'));
    expect(hit?.level).toBe('warning');
  });

  it('errors on an oversized inline data URI', () => {
    const big = `data:image/png;base64,${'A'.repeat(300 * 1024)}`;
    const problems = validateDocument(doc({ imageHref: big }));
    const hit = problems.find((p) => p.message.includes('under 256KB'));
    expect(hit?.level).toBe('error');
  });

  it('validates cleanly with a good data URI', () => {
    const problems = validateDocument(doc({ imageHref: PNG_URI }));
    expect(problems.filter((p) => p.message.includes('image'))).toEqual([]);
  });
});
