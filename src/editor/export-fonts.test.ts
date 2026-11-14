import { describe, expect, it } from 'vitest';
import {
  embedDiagramFont,
  fontFaceCss,
  withStyle,
  type FontFace,
} from './export-fonts.js';

const bytes = (): Promise<ArrayBuffer> =>
  Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer);

const faces: FontFace[] = [
  { weight: '400', style: 'normal', range: '', url: 'https://x/a-400.woff2' },
  {
    weight: '700',
    style: 'normal',
    range: 'U+0000-00FF',
    url: 'https://x/a-700.woff?v=1',
  },
];

describe('fontFaceCss', () => {
  it('inlines each face as a data URI, keeping its descriptors', async () => {
    const css = await fontFaceCss(faces, bytes);
    expect(css).toBe(
      "@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:400;" +
        'src:url(data:font/woff2;base64,AQIDBA==)}' +
        "@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:700;" +
        'unicode-range:U+0000-00FF;src:url(data:font/woff;base64,AQIDBA==)}',
    );
  });

  it('is empty when a file cannot be read, or there are no faces', async () => {
    expect(
      await fontFaceCss(faces, () => Promise.reject(new Error('offline'))),
    ).toBe('');
    expect(await fontFaceCss([], bytes)).toBe('');
  });
});

describe('withStyle', () => {
  it('puts the style right after the root tag', () => {
    expect(withStyle('<svg viewBox="0 0 1 1"><g/></svg>', 'a{}')).toBe(
      '<svg viewBox="0 0 1 1"><style>a{}</style><g/></svg>',
    );
  });

  it('leaves the markup alone with no root tag or no css', () => {
    expect(withStyle('<g/>', 'a{}')).toBe('<g/>');
    expect(withStyle('<svg><g/></svg>', '')).toBe('<svg><g/></svg>');
  });
});

describe('embedDiagramFont', () => {
  it('returns the SVG unchanged where there is no page to read fonts from', async () => {
    const svg = '<svg viewBox="0 0 1 1"><g/></svg>';
    expect(await embedDiagramFont(svg)).toBe(svg);
  });
});
