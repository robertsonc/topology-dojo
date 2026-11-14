import { describe, it, expect } from 'vitest';
import { captionSVG } from './caption.js';
import type { Page } from '../pages/model.js';

const base: Page = {
  id: 'p',
  name: 'F1',
  viewBox: '0 0 1000 600',
  nodes: [],
  links: [],
  anchors: [],
  zones: [],
  flowPaths: [],
  policyMarkers: [],
};

describe('per-frame caption (2.1)', () => {
  it('renders nothing without a caption', () => {
    expect(captionSVG(base)).toBe('');
    expect(captionSVG({ ...base, caption: '   ' })).toBe('');
  });

  it('renders a bottom-centred subtitle with the caption text', () => {
    const svg = captionSVG({ ...base, caption: 'Cloud security plane' });
    expect(svg).toContain('class="tds-caption"');
    expect(svg).toContain('Cloud security plane');
    expect(svg).toContain('text-anchor="middle"');
    // Centred on the viewBox horizontally (x = vx + vw/2 = 500).
    expect(svg).toContain('x="500"');
  });

  it('escapes caption text', () => {
    const svg = captionSVG({ ...base, caption: '<b> & "x"' });
    expect(svg).toContain('&lt;b&gt; &amp; &quot;x&quot;');
    expect(svg).not.toContain('<b>');
  });
});

describe('caption layout', () => {
  it('a one-line caption is drawn exactly as before', () => {
    expect(captionSVG({ ...base, caption: 'Cloud security plane' })).toBe(
      '<g class="tds-caption">' +
        '<rect x="406" y="552" width="188" height="30" rx="8" ' +
        'fill="rgba(16,20,28,0.82)" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>' +
        '<text x="500" y="572" text-anchor="middle" ' +
        'font-size="14" font-family="ui-monospace,monospace" fill="#e6e8e9">Cloud security plane</text>' +
        '</g>',
    );
  });

  const long =
    'Failover: the primary MPLS circuit at the branch has gone down, so the ' +
    'edge moves every business-critical flow onto the Internet underlay and ' +
    'the voice class onto LTE until the circuit returns to service.';

  it('wraps a long caption instead of running off both edges', () => {
    const svg = captionSVG({ ...base, caption: long });
    const lines = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(
      (m) => m[1]!,
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(long);
    // Every line fits the frame (1000 wide, 20 px margins, 14 px padding).
    for (const line of lines)
      expect(line.length * 8.4).toBeLessThanOrEqual(932);
    // The panel sits inside the frame and grows upward from the same bottom.
    const [, x, y, w, h] =
      /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/
        .exec(svg)!
        .map(Number);
    expect(x).toBeGreaterThanOrEqual(20);
    expect(x! + w!).toBeLessThanOrEqual(980);
    expect(y! + h!).toBe(582);
    expect(h).toBe(lines.length * 18 + 12);
  });

  it('keeps explicit line breaks', () => {
    const svg = captionSVG({ ...base, caption: 'Step 1\nStep 2' });
    expect(
      [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]),
    ).toEqual(['Step 1', 'Step 2']);
  });

  it('stops at six lines and marks the cut', () => {
    const svg = captionSVG({
      ...base,
      viewBox: '0 0 300 600',
      caption: long,
    });
    const lines = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(
      (m) => m[1]!,
    );
    expect(lines).toHaveLength(6);
    expect(lines[5]!.endsWith('…')).toBe(true);
  });
});
