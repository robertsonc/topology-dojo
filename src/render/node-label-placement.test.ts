/**
 * Node label placement (`labelPlacement`, `labelOffsetX`, `labelOffset`).
 *
 * The compass code moves the classic below-node label around the glyph;
 * explicit offsets are absolute distances from the node centre that override
 * the placement's defaults, so pre-placement documents render unchanged.
 * The engine (public/vendor/topology-ds.js `_nodeLabelPos`) and the headless
 * mirror (`nodeLabelPos`) must agree.
 */
import { describe, it, expect } from 'vitest';
import { renderPageToSVG } from '../server/render.js';
import { nodeLabelPos } from './label-placement.js';
import { inspectPage } from './inspect.js';
import type { Page } from '../pages/model.js';
import type { NodeConfig } from '../vendor/topology-ds.js';

function pageWith(node: Record<string, unknown>): Page {
  return {
    id: 'p',
    name: 'F',
    viewBox: '0 0 1050 700',
    nodes: [{ id: 'n', type: 'firewall', x: 300, y: 300, ...node }],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  } as unknown as Page;
}

/** Position + anchor of the `<text>` whose content is `label`. */
function textAt(
  svg: string,
  label: string,
): { x: number; y: number; anchor: string } | null {
  const m = svg.match(
    new RegExp(
      `<text x="([\\d.-]+)" y="([\\d.-]+)" text-anchor="(\\w+)"[^>]*>${label}</text>`,
    ),
  );
  return m ? { x: +m[1]!, y: +m[2]!, anchor: m[3]! } : null;
}

describe('node label placement', () => {
  it('defaults to the classic centred label 24px below the node', () => {
    const svg = renderPageToSVG(pageWith({ label: 'FW' }));
    expect(textAt(svg, 'FW')).toEqual({ x: 300, y: 324, anchor: 'middle' });
  });

  it('keeps an explicit labelOffset as the absolute baseline offset', () => {
    const svg = renderPageToSVG(pageWith({ label: 'FW', labelOffset: 40 }));
    expect(textAt(svg, 'FW')).toEqual({ x: 300, y: 340, anchor: 'middle' });
  });

  it('places the label above the node for "n" (sublabel stacks below it)', () => {
    const svg = renderPageToSVG(pageWith({ label: 'FW', labelPlacement: 'n' }));
    const t = textAt(svg, 'FW')!;
    expect(t.anchor).toBe('middle');
    expect(t.y).toBeLessThan(300 - 18); // clear of the firewall glyph (hh=18)
    const withSub = renderPageToSVG(
      pageWith({ label: 'FW', sublabel: 'srx', labelPlacement: 'n' }),
    );
    const l = textAt(withSub, 'FW')!;
    const s = textAt(withSub, 'srx')!;
    expect(l.y).toBe(t.y - 13); // lifted one line so the sublabel …
    expect(s.y).toBe(t.y); // … lands where the single label sat
  });

  it('anchors east/west labels just outside the glyph', () => {
    const e = textAt(
      renderPageToSVG(pageWith({ label: 'FW', labelPlacement: 'e' })),
      'FW',
    )!;
    expect(e.anchor).toBe('start');
    expect(e.x).toBe(300 + 20 + 6); // firewall hw=20
    expect(e.y).toBe(304);
    const w = textAt(
      renderPageToSVG(pageWith({ label: 'FW', labelPlacement: 'w' })),
      'FW',
    )!;
    expect(w.anchor).toBe('end');
    expect(w.x).toBe(300 - 26);
  });

  it('honours labelOffsetX / labelOffset as absolute nudges on a placement', () => {
    const svg = renderPageToSVG(
      pageWith({
        label: 'FW',
        labelPlacement: 'ne',
        labelOffsetX: 50,
        labelOffset: -40,
      }),
    );
    expect(textAt(svg, 'FW')).toEqual({ x: 350, y: 260, anchor: 'start' });
  });

  it('moves a shape label outside the shape when a placement is set', () => {
    const inside = renderPageToSVG(
      pageWith({ type: 'shape:rectangle', label: 'Box' }),
    );
    expect(textAt(inside, 'Box')!.y).toBeLessThan(310); // centred in-shape
    const below = renderPageToSVG(
      pageWith({ type: 'shape:rectangle', label: 'Box', labelPlacement: 's' }),
    );
    expect(textAt(below, 'Box')!.y).toBe(324);
  });

  it('mirrors the engine for every compass code', () => {
    for (const code of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
      const node = {
        id: 'n',
        type: 'router',
        x: 400,
        y: 200,
        label: 'R1',
        sublabel: 'core',
        labelPlacement: code,
      } as NodeConfig;
      const svg = renderPageToSVG(pageWith(node));
      expect(textAt(svg, 'R1'), code).toEqual(nodeLabelPos(node));
    }
  });

  it('is accepted by validation and feeds inspect label geometry', () => {
    // A west-placed label on the left node reaches toward the right node's
    // label only if the mirror tracks the anchor; here they are well apart, so
    // the report must not flag a collision.
    const page = {
      ...pageWith({ label: 'Left', labelPlacement: 'w' }),
    } as Page;
    page.nodes.push({
      id: 'r',
      type: 'firewall',
      x: 420,
      y: 300,
      label: 'Right',
      labelPlacement: 'e',
    } as unknown as (typeof page.nodes)[number]);
    const report = inspectPage(page);
    expect(
      report.findings.filter((f) => /labels of nodes/.test(f.message)),
    ).toEqual([]);
  });
});
