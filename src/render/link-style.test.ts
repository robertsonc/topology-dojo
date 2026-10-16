import { describe, it, expect } from 'vitest';
import { createDocument } from '../api/builder.js';
import { renderDocumentToSVG } from '../server/render.js';

describe('link styles in the headless render (W1)', () => {
  it('draws a styled link with the style colour and width', () => {
    const doc = createDocument('S')
      .page()
      .node({ id: 'a', type: 'ec', x: 100, y: 100 })
      .node({ id: 'b', type: 'ec', x: 400, y: 100 })
      .link({ id: 'l', type: 'line', from: 'a', to: 'b', style: 'red' })
      .build();
    doc.linkStyles = [{ id: 'red', color: '#e01b24', width: 3 }];
    const svg = renderDocumentToSVG(doc, 0);
    expect(svg).toContain('stroke="#e01b24"');
    expect(svg).toContain('stroke-width="3"');
  });

  it('leaves an unstyled document byte-identical', () => {
    const build = () =>
      createDocument('S')
        .page()
        .node({ id: 'a', type: 'ec', x: 100, y: 100 })
        .node({ id: 'b', type: 'ec', x: 400, y: 100 })
        .link({ id: 'l', type: 'line', from: 'a', to: 'b' })
        .build();
    const plain = renderDocumentToSVG(build(), 0);
    const withStyles = build();
    withStyles.linkStyles = [{ id: 'red', color: '#e01b24' }];
    expect(renderDocumentToSVG(withStyles, 0)).toBe(plain);
  });
});
