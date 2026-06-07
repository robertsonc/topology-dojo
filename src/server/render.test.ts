import { describe, it, expect } from 'vitest';
import { renderDocumentToSVG } from './render.js';
import { createDocument } from '../api/builder.js';
import { defaultSpec } from '../nodes/spec.js';

describe('headless render (Node, no browser)', () => {
  it('renders a document to a standalone SVG string', () => {
    const doc = createDocument('Net')
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 200, label: 'EC-Branch' })
      .node({ id: 'b', type: 'cloud', x: 600, y: 200, label: 'Internet' })
      .link({ id: 'l', type: 'tunnel', from: 'a', to: 'b' })
      .build();
    const svg = renderDocumentToSVG(doc);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 1050 700"');
    expect(svg).toContain('EC-Branch'); // built-in node label rendered
    expect(svg).toContain('Internet');
    expect(svg).toContain('<defs'); // engine filter defs present
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('renders custom node types headlessly', () => {
    const doc = createDocument()
      .defineNodeType({
        ...defaultSpec(),
        typeName: 'sensor',
        colorStroke: '#65aef9',
      })
      .page()
      .node({ id: 'n', type: 'sensor', x: 100, y: 100, label: 'S' })
      .build();
    const svg = renderDocumentToSVG(doc);
    expect(svg).toContain('#65aef9'); // custom interpreter ran in Node
  });

  it('renders the annotation layer (zone, flow path, policy marker)', () => {
    const doc = createDocument('Net')
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 200 })
      .node({ id: 'b', type: 'cloud', x: 600, y: 200 })
      .zone({ id: 'z', label: 'Edge', nodes: ['a', 'b'], color: '#65aef9' })
      .flowPath({
        id: 'f',
        label: 'App',
        waypoints: ['a', 'b'],
        color: '#01a982',
      })
      .policyMarker({ id: 'm', nodeId: 'a', type: 'inspect', color: '#fc6161' })
      .build();
    const svg = renderDocumentToSVG(doc);
    expect(svg).toContain('tds-zone'); // zone rectangle group
    expect(svg).toContain('data-zone-id="z"');
    expect(svg).toContain('data-tds-flowpath="f"'); // animated overlay route
    expect(svg).toContain('data-tds-marker="m"'); // enforcement badge
  });

  it('calm mode suppresses animation in the output', () => {
    const doc = createDocument()
      .page()
      .node({ id: 'a', type: 'ec', x: 200, y: 200 })
      .node({ id: 'b', type: 'cloud', x: 600, y: 200 })
      .flowPath({ id: 'f', waypoints: ['a', 'b'], animation: 'particles' })
      .build();
    const lively = renderDocumentToSVG(doc, 0);
    const calm = renderDocumentToSVG(doc, 0, { calm: true });
    expect(lively).toContain('<animateMotion'); // particles animate by default
    expect(calm).not.toContain('<animateMotion'); // calm = static frame
    expect(calm).toContain('data-tds-flowpath="f"'); // route still drawn
  });

  it('throws on an out-of-range page index', () => {
    const doc = createDocument().page().build();
    expect(() => renderDocumentToSVG(doc, 5)).toThrow();
  });
});
