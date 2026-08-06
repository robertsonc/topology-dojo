import { describe, it, expect } from 'vitest';
import { renderDocumentToSVG } from '../server/render.js';
import { createDocument } from '../api/builder.js';
import { nodeHalf } from '../api/geometry.js';

const LONG =
  'This is a long free form annotation that should wrap inside the box';

describe('text node rendering (sized box, wrap, fill)', () => {
  it('renders the label exactly once (no duplicate below-node label)', () => {
    const doc = createDocument()
      .page()
      .node({ id: 't', type: 'text', x: 300, y: 100, label: 'Once only' })
      .build();
    const svg = renderDocumentToSVG(doc);
    expect(svg.match(/Once only/g)?.length).toBe(1);
    expect(svg).not.toContain('…'); // no 24-char truncation of the content
  });

  it('word-wraps the label to the box width', () => {
    const doc = createDocument()
      .page()
      .node({ id: 't', type: 'text', x: 300, y: 100, label: LONG, width: 180 })
      .build();
    const svg = renderDocumentToSVG(doc);
    // The full sentence never appears on a single line…
    expect(svg).not.toContain(`>${LONG}<`);
    // …but every word survives across the wrapped lines.
    for (const word of LONG.split(' ')) expect(svg).toContain(word);
  });

  it('draws a background panel + border when fill/borderColor are set', () => {
    const doc = createDocument()
      .page()
      .node({
        id: 't',
        type: 'text',
        x: 300,
        y: 100,
        label: 'Panel',
        width: 120,
        fill: '#22252e',
        borderColor: '#65aef9',
      })
      .build();
    const svg = renderDocumentToSVG(doc);
    expect(svg).toContain('fill="#22252e"');
    expect(svg).toMatch(/rect[^>]*width="120"[^>]*stroke="#65aef9"/);
  });

  it('respects align:"left" (start-anchored text)', () => {
    const doc = createDocument()
      .page()
      .node({
        id: 't',
        type: 'text',
        x: 300,
        y: 100,
        label: 'Left text',
        width: 160,
        align: 'left',
      })
      .build();
    expect(renderDocumentToSVG(doc)).toMatch(
      /text-anchor="start"[^>]*>Left text</,
    );
  });
});

describe('shape node rendering (sizing + centered labels)', () => {
  it('renders rectangle with explicit shapeWidth/shapeHeight', () => {
    const doc = createDocument()
      .page()
      .node({
        id: 'r',
        type: 'shape:rectangle',
        x: 300,
        y: 300,
        shapeWidth: 160,
        shapeHeight: 80,
      })
      .build();
    expect(renderDocumentToSVG(doc)).toMatch(
      /rect[^>]*width="160" height="80"/,
    );
  });

  it('draws the shape label centered + wrapped, not truncated below', () => {
    const label = 'Application tier with a long descriptive name';
    const doc = createDocument()
      .page()
      .node({
        id: 'r',
        type: 'shape:rectangle',
        x: 300,
        y: 300,
        label,
        shapeWidth: 160,
      })
      .build();
    const svg = renderDocumentToSVG(doc);
    expect(svg).not.toContain('…');
    for (const word of label.split(' ')) expect(svg).toContain(word);
  });

  it('keeps the classic below-node label when labelOffset is explicit', () => {
    const doc = createDocument()
      .page()
      .node({
        id: 'c',
        type: 'shape:circle',
        x: 300,
        y: 300,
        label: 'Below',
        labelOffset: 30,
      })
      .build();
    // Classic path draws at y + labelOffset.
    expect(renderDocumentToSVG(doc)).toMatch(/y="330"[^>]*>Below</);
  });
});

describe('size-aware node bounds', () => {
  it('shape bounds honor shapeSize / shapeWidth / shapeHeight', () => {
    expect(
      nodeHalf({ id: 's', type: 'shape:circle', x: 0, y: 0, shapeSize: 80 }),
    ).toEqual({ w: 40, h: 40 });
    expect(
      nodeHalf({
        id: 'r',
        type: 'shape:rectangle',
        x: 0,
        y: 0,
        shapeWidth: 160,
        shapeHeight: 80,
      }),
    ).toEqual({ w: 80, h: 40 });
    // Unsized shapes keep their legacy defaults.
    expect(nodeHalf({ id: 'd', type: 'shape:circle', x: 0, y: 0 })).toEqual({
      w: 18,
      h: 18,
    });
  });

  it('text bounds grow with an explicit width and wrapped lines', () => {
    const narrow = nodeHalf({
      id: 't',
      type: 'text',
      x: 0,
      y: 0,
      label: LONG,
      width: 180,
    });
    expect(narrow.w).toBe(90);
    // Wrapped into several lines → meaningfully taller than one line.
    expect(narrow.h).toBeGreaterThan(20);
  });
});
