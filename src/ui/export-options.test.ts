import { describe, expect, it } from 'vitest';
import { exportRenderOptions } from './export-options.js';

const palette = { id: 'azure', accent: '#0a84ff', secondary: '#5ac8fa' };
const layers = [{ id: 'underlay', name: 'Underlay' }];
const linkStyles = [{ id: 'trunk', color: '#65aef9', width: 3 }];

describe('exportRenderOptions', () => {
  it('carries the document brand palette', () => {
    const opts = exportRenderOptions({ palette }, {}, 'dark');
    expect(opts.palette).toEqual(palette);
  });

  it('has no palette key for a document without one', () => {
    expect(exportRenderOptions({}, {}, 'dark')).not.toHaveProperty('palette');
  });

  it('carries the layers, link styles and theme the canvas draws with', () => {
    const opts = exportRenderOptions({ layers, linkStyles }, {}, 'light');
    expect(opts.layers).toBe(layers);
    expect(opts.linkStyles).toBe(linkStyles);
    expect(opts.theme).toBe('light');
  });

  it("carries the frame's emphasis, when it has any", () => {
    expect(
      exportRenderOptions({}, { emphasis: ['fw', 'ec-fw'] }, 'dark').emphasis,
    ).toEqual(['fw', 'ec-fw']);
    expect(exportRenderOptions({}, {}, 'dark')).not.toHaveProperty('emphasis');
  });
});
