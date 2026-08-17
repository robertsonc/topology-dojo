/**
 * Hyperlinks + tooltips (plan Phase 3.1) — `href` renders as a clickable
 * `<a>` (http(s) ONLY — anything else is refused at the render seam) and
 * `tooltip` as an SVG `<title>` inside the element group, in the shared
 * engine path both the live canvas and headless exports use.
 */
import { describe, it, expect } from 'vitest';
import { renderPageToSVG } from '../server/render.js';
import type { Page } from '../pages/model.js';

function page(extra: {
  node?: Record<string, unknown>;
  link?: Record<string, unknown>;
  zone?: Record<string, unknown>;
}): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 600 400',
    nodes: [
      { id: 'a', type: 'host', x: 150, y: 200, label: 'A', ...extra.node },
      { id: 'b', type: 'host', x: 450, y: 200, label: 'B' },
    ],
    links: [{ id: 'ab', type: 'line', from: 'a', to: 'b', ...extra.link }],
    anchors: [],
    zones: extra.zone
      ? [{ id: 'z', label: 'Zone', nodes: ['a', 'b'], ...extra.zone }]
      : [],
    flowPaths: [],
    policyMarkers: [],
  } as unknown as Page;
}

describe('href renders as a clickable <a>', () => {
  it('wraps a node with an https href', () => {
    const svg = renderPageToSVG(
      page({ node: { href: 'https://wiki.example/host-a' } }),
      [],
    );
    expect(svg).toContain(
      '<a href="https://wiki.example/host-a" target="_blank" rel="noopener">',
    );
  });

  it('wraps a link and a zone too', () => {
    const svg = renderPageToSVG(
      page({
        link: { href: 'https://noc.example/circuits/ab' },
        zone: { href: 'https://wiki.example/zones/z' },
      }),
      [],
    );
    expect(svg).toContain('href="https://noc.example/circuits/ab"');
    expect(svg).toContain('href="https://wiki.example/zones/z"');
  });

  it('never emits a non-http(s) scheme (defense at the render seam)', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://x',
      'file:///etc/passwd',
    ]) {
      const svg = renderPageToSVG(page({ node: { href: bad } }), []);
      expect(svg).not.toContain('<a href');
    }
  });

  it('escapes attribute-breaking characters in the URL', () => {
    const svg = renderPageToSVG(
      page({ node: { href: 'https://x.example/?q="><script>' } }),
      [],
    );
    expect(svg).not.toContain('"><script>');
    expect(svg).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('tooltip renders as an SVG <title>', () => {
  it('adds a <title> inside the node group', () => {
    const svg = renderPageToSVG(
      page({ node: { tooltip: 'Primary uplink host' } }),
      [],
    );
    expect(svg).toContain('<title>Primary uplink host</title>');
  });

  it('escapes markup in the tooltip text', () => {
    const svg = renderPageToSVG(page({ node: { tooltip: '<b>bold</b>' } }), []);
    expect(svg).not.toContain('<b>bold</b>');
    expect(svg).toContain('<title>&lt;b&gt;bold&lt;/b&gt;</title>');
  });

  it('renders nothing extra when neither field is set', () => {
    const svg = renderPageToSVG(page({}), []);
    expect(svg).not.toContain('<title>');
    expect(svg).not.toContain('<a href');
  });
});
