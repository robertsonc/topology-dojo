/**
 * §5 — EC + Axis (SSE/ZTNA) connector container variant.
 *
 * An `ec` node with `variant:"axis"` represents an Edge Connect that hosts the
 * Axis connector as a container. It must read distinctly from a plain EC (it
 * gains the inset connector mark + AXIS badge) while still being the same EC
 * chassis — not a separate node type and not a standalone connector node.
 */
import { describe, it, expect } from 'vitest';
import { renderPageToSVG } from '../server/render.js';
import type { Page } from '../pages/model.js';

function page(variant?: string): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 600 400',
    nodes: [{ id: 'e', type: 'ec', x: 300, y: 200, label: 'EC', variant }],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  } as unknown as Page;
}

describe('EC + Axis connector variant', () => {
  const plain = renderPageToSVG(page(), []);
  const axis = renderPageToSVG(page('axis'), []);

  it('renders the AXIS badge only on the axis variant', () => {
    expect(axis).toContain('>AXIS</text>');
    expect(plain).not.toContain('>AXIS</text>');
  });

  it('adds the inset hosted-connector mark', () => {
    // The connector container box (17×16) is unique to the axis branch — it is
    // the inset that signals "this EC hosts the connector".
    expect(axis).toContain('width="17" height="16"');
    expect(plain).not.toContain('width="17" height="16"');
  });

  it('keeps the shared EC chassis (still an EC, not a new node type)', () => {
    // The 60×30 chassis rect is the EC body both variants share.
    expect(plain).toContain('width="60" height="30"');
    expect(axis).toContain('width="60" height="30"');
  });
});
