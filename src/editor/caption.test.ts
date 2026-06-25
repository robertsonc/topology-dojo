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
