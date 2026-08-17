/**
 * Validation for the hyperlink + tooltip fields (plan Phase 3.1): a
 * javascript: href is an ERROR (likely injection), a non-http(s) href is a
 * warning (it will not render as a link), an over-long tooltip is a warning,
 * and clean values validate silently. Also proves catalog coverage so the
 * fields are agent-discoverable.
 */
import { describe, expect, it } from 'vitest';
import { validateDocument } from './validate.js';
import { getAnnotationType, getLinkType, getNodeType } from './catalog.js';
import type { TopologyDocument } from '../pages/model.js';

function doc(extra: {
  node?: Record<string, unknown>;
  link?: Record<string, unknown>;
  zone?: Record<string, unknown>;
}): TopologyDocument {
  return {
    title: 'T',
    customNodes: [],
    pages: [
      {
        id: 'p',
        name: 'F',
        viewBox: '0 0 600 400',
        nodes: [
          { id: 'a', type: 'host', x: 100, y: 100, label: 'A', ...extra.node },
          { id: 'b', type: 'host', x: 400, y: 100, label: 'B' },
        ],
        links: [{ id: 'ab', type: 'line', from: 'a', to: 'b', ...extra.link }],
        anchors: [],
        zones: extra.zone
          ? [{ id: 'z', nodes: ['a'], label: 'Z', ...extra.zone }]
          : [],
        flowPaths: [],
        policyMarkers: [],
      },
    ],
  } as unknown as TopologyDocument;
}

describe('href/tooltip validation', () => {
  it('accepts clean https href + short tooltip on node, link, and zone', () => {
    const problems = validateDocument(
      doc({
        node: { href: 'https://wiki.example/a', tooltip: 'Primary host' },
        link: { href: 'http://noc.example/ab' },
        zone: { tooltip: 'Campus zone' },
      }),
    );
    expect(problems.filter((p) => /href|tooltip/.test(p.message))).toEqual([]);
  });

  it('errors on a javascript: href', () => {
    const problems = validateDocument(
      doc({ node: { href: 'javascript:alert(1)' } }),
    );
    const hit = problems.find((p) => p.message.includes('javascript:'));
    expect(hit?.level).toBe('error');
  });

  it('warns on a non-http(s) href', () => {
    const problems = validateDocument(doc({ link: { href: 'ftp://x' } }));
    const hit = problems.find((p) => p.message.includes('not an http(s) URL'));
    expect(hit?.level).toBe('warning');
  });

  it('warns on an over-long tooltip', () => {
    const problems = validateDocument(
      doc({ zone: { tooltip: 'x'.repeat(501) } }),
    );
    const hit = problems.find((p) => p.message.includes('501 chars'));
    expect(hit?.level).toBe('warning');
  });

  it('exposes href + tooltip in the catalog for nodes, links, and zones', () => {
    for (const fields of [
      getNodeType('host')?.fields,
      getNodeType('shape:rectangle')?.fields,
      getLinkType('line')?.fields,
      getAnnotationType('zone')?.fields,
    ]) {
      const keys = (fields ?? []).map((f) => f.key);
      expect(keys).toContain('href');
      expect(keys).toContain('tooltip');
    }
  });
});
