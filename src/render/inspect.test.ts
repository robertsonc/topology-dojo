/**
 * Visual-quality inspection (inspect_render's engine). Each defect class the
 * report covers is provoked in isolation, plus one deliberately bad dense page
 * showing the text-clipping + routing findings that validate_topology's
 * semantic/layout checks alone would not communicate.
 */
import { describe, it, expect } from 'vitest';
import { inspectPage, type InspectReport } from './inspect.js';
import type { Page } from '../pages/model.js';
import type { NodeConfig, LinkConfig } from '../vendor/topology-ds.js';
import { validateDocument } from '../api/validate.js';

function page(partial: Partial<Page>): Page {
  return {
    id: 'p',
    name: 'Frame 1',
    viewBox: '0 0 1050 700',
    nodes: [],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
    ...partial,
  };
}

function node(id: string, x: number, y: number, label?: string): NodeConfig {
  return { id, type: 'ec', x, y, ...(label !== undefined ? { label } : {}) };
}

function link(id: string, from: string, to: string): LinkConfig {
  return { id, type: 'line', from, to };
}

const messages = (r: InspectReport): string =>
  r.findings.map((f) => f.message).join('\n');

describe('inspectPage', () => {
  it('reports a clean page as clean with no findings', () => {
    // Two well-spaced, well-labeled nodes centred on the page.
    const r = inspectPage(
      page({
        nodes: [node('a', 400, 350, 'EC-A'), node('b', 660, 350, 'EC-B')],
        links: [link('l1', 'a', 'b')],
      }),
    );
    expect(r.clean).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.omitted).toBe(0);
    expect(r.contentBounds).not.toBeNull();
    expect(r.margins!.left).toBeGreaterThan(0);
  });

  it('flags a node outside the viewBox as a crop problem with the overhang', () => {
    const r = inspectPage(page({ nodes: [node('far', 1200, 350, 'Far')] }));
    expect(r.clean).toBe(false);
    const f = r.findings.find(
      (x) => x.category === 'crop' && x.severity === 'problem',
    );
    expect(f).toBeDefined();
    expect(f!.message).toContain('"far"');
    expect(f!.message).toMatch(/~\d+px past the right page edge/);
  });

  it('flags a long label that collides with a neighbouring node', () => {
    // 22-char label ≈ 132px wide collides with the node 90px to the right.
    const r = inspectPage(
      page({
        nodes: [
          node('er2', 400, 350, 'edge-router-fallback-2'),
          node('er3', 490, 380),
        ],
      }),
    );
    const f = r.findings.find(
      (x) =>
        x.category === 'text' &&
        x.severity === 'problem' &&
        /collides with node "er3"/.test(x.message),
    );
    expect(f).toBeDefined();
    expect(f!.message).toContain('edge-router-fallback-2');
    expect(f!.message).toMatch(/~\d+px overlap/);
  });

  it('notes labels the renderer will truncate at 24 chars', () => {
    const r = inspectPage(
      page({
        nodes: [node('n', 500, 350, 'an-extremely-long-node-label-name')],
      }),
    );
    expect(messages(r)).toMatch(/truncates it to 24/);
  });

  it('flags overlapping nodes as a density problem', () => {
    const r = inspectPage(
      page({ nodes: [node('a', 400, 350), node('b', 410, 352)] }),
    );
    const f = r.findings.find(
      (x) => x.category === 'density' && x.severity === 'problem',
    );
    expect(f).toBeDefined();
    expect(f!.message).toMatch(/nodes "a" and "b" overlap/);
  });

  it('flags crossing links as a routing problem', () => {
    // An X: a→d and c→b cross mid-page; sharing-endpoint links never count.
    const r = inspectPage(
      page({
        nodes: [
          node('a', 300, 200),
          node('b', 700, 200),
          node('c', 300, 500),
          node('d', 700, 500),
        ],
        links: [link('l1', 'a', 'd'), link('l2', 'c', 'b')],
      }),
    );
    const f = r.findings.find(
      (x) => x.category === 'routing' && x.severity === 'problem',
    );
    expect(f).toBeDefined();
    expect(f!.message).toMatch(/links "l1" and "l2" cross/);
  });

  it('flags a link drawn through an unrelated node', () => {
    const r = inspectPage(
      page({
        nodes: [
          node('a', 300, 350),
          node('mid', 500, 350),
          node('b', 700, 350),
        ],
        links: [link('l1', 'a', 'b')],
      }),
    );
    expect(messages(r)).toMatch(
      /link "l1" passes through unrelated node "mid"/,
    );
  });

  it('flags degenerate flow-path geometry', () => {
    const r = inspectPage(
      page({
        nodes: [node('a', 300, 350), node('b', 700, 350)],
        links: [link('l1', 'a', 'b')],
        flowPaths: [
          {
            id: 'fp',
            waypoints: ['a', 'a', 'b', 'a'],
            color: '#01a982',
          },
        ],
      }),
    );
    expect(messages(r)).toMatch(/flow path "fp" repeats waypoint "a"/);
    expect(messages(r)).toMatch(/doubles back over "b"/);
  });

  it('flags a zone label overlapped by a node drawn on top of it', () => {
    // A non-member node parked on the zone's top-left corner sits on the label.
    const r = inspectPage(
      page({
        nodes: [node('m', 500, 350, 'Member'), node('intruder', 430, 285)],
        zones: [{ id: 'z1', label: 'Branch', nodes: ['m'] }],
      }),
    );
    expect(messages(r)).toMatch(/label of zone "z1" is overlapped by node/);
  });

  it('caps findings per category but keeps true totals', () => {
    // A pile of 12 coincident nodes → dozens of overlap problems.
    const nodes = Array.from({ length: 12 }, (_, i) =>
      node(`n${i}`, 500 + i, 350),
    );
    const r = inspectPage(page({ nodes }), { maxPerCategory: 3 });
    expect(r.findings.filter((f) => f.category === 'density').length).toBe(3);
    expect(r.counts.density.problems).toBeGreaterThan(3);
    expect(r.omitted).toBeGreaterThan(0);
  });

  it('surfaces text clipping + bad routing on a dense page that validate misses', () => {
    // Deliberately bad but SEMANTICALLY valid: every reference resolves, yet
    // the long labels collide between the columns and the diagonal links cross
    // — the visual defects validate_topology's messages never mention.
    const dense = page({
      nodes: [
        node('core1', 320, 300, 'core-aggregation-router-1'),
        node('core2', 440, 300, 'core-aggregation-router-2'),
        node('edge1', 320, 420, 'edge-firewall-cluster-a'),
        node('edge2', 440, 420, 'edge-firewall-cluster-b'),
        node('svc', 380, 420, 'svc'),
      ],
      links: [
        link('x1', 'core1', 'edge2'),
        link('x2', 'core2', 'edge1'),
        link('thru', 'edge1', 'edge2'),
      ],
    });
    const r = inspectPage(dense);
    expect(r.clean).toBe(false);
    // Text clipping: the ~150px-wide labels collide across the 120px columns.
    expect(r.counts.text.problems).toBeGreaterThan(0);
    expect(messages(r)).toMatch(/collide/);
    // Routing: the diagonal pair crosses, and 'thru' slices through "svc".
    expect(r.counts.routing.problems).toBeGreaterThan(0);
    expect(messages(r)).toMatch(/links "x1" and "x2" cross/);
    expect(messages(r)).toMatch(
      /link "thru" passes through unrelated node "svc"/,
    );

    // validate_topology (semantic pass) reports nothing about labels or
    // crossings for this page — the whole reason inspect_render exists.
    const semantic = validateDocument({
      title: 'T',
      pages: [dense],
      customNodes: [],
    });
    expect(semantic.filter((p) => p.level === 'error')).toEqual([]);
    expect(semantic.some((p) => /label|cross/.test(p.message))).toBe(false);

    // Bounded: the whole report stays a few KB even for a defective page.
    expect(JSON.stringify(r).length).toBeLessThan(4096);
  });
});
