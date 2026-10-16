import { describe, it, expect } from 'vitest';
import { createDocument } from '../api/builder.js';
import {
  bundleOutlines,
  pillLength,
  portPills,
  portPillsSVG,
  stripPillLabels,
} from './port-pills.js';
import { defineBundle, usedBundleKinds } from '../api/bundles.js';
import { renderDocumentToSVG } from '../server/render.js';
import { analyzeLayout } from '../api/layout.js';
import { validateDocument } from '../api/validate.js';
import { buildLegendItems } from '../editor/legend.js';
import { parseDoc, serializeDoc } from '../pages/persist.js';
import { getLinkType, getNodeType } from '../api/catalog.js';
import { inspectPage } from './inspect.js';

/** A gateway dual-homed to two switches below, in pill mode with distribute. */
function fabric(portLabels: 'pill' | 'chip' = 'pill') {
  const doc = createDocument('P')
    .page({ viewBox: '0 0 1200 800' })
    .node({ id: 'gw', type: 'chassis', x: 600, y: 150, label: 'GW-01' })
    .node({ id: 'sw1', type: 'chassis', x: 350, y: 500, label: 'SW-01' })
    .node({ id: 'sw2', type: 'chassis', x: 850, y: 500, label: 'SW-02' })
    .link({
      id: 'a',
      type: 'line',
      from: 'gw',
      to: 'sw1',
      fromLabel: '0/0/4',
      toLabel: 'xe-0/0/8',
      fromBundle: 'ae0',
      toBundle: 'ae0',
    })
    .link({
      id: 'b',
      type: 'line',
      from: 'gw',
      to: 'sw2',
      fromLabel: '0/0/5',
      toLabel: 'xe-0/0/8',
      fromBundle: 'ae0',
      toBundle: 'ae0',
    })
    .link({
      id: 'icl',
      type: 'line',
      from: 'sw1',
      to: 'sw2',
      fromLabel: 'et-0/0/55',
      toLabel: 'et-0/0/55',
      fromBundle: 'icl',
      toBundle: 'icl',
    })
    .build();
  const page = doc.pages[0]!;
  page.linkAttach = { distribute: true };
  page.portLabels = portLabels;
  defineBundle(doc, { id: 'icl', kind: 'icl' });
  return doc;
}

describe('port pills (W4)', () => {
  it('sizes a pill to its label and places it outward from the attach point', () => {
    expect(pillLength('ae0')).toBe(22);
    expect(pillLength('xe-0/0/48')).toBe(48);
    const doc = fabric();
    const pills = portPills(doc.pages[0]!);
    expect(pills.map((p) => `${p.linkId}:${p.end}:${p.side}`).sort()).toEqual([
      'a:from:s',
      'a:to:n',
      'b:from:s',
      'b:to:n',
      'icl:from:e',
      'icl:to:w',
    ]);
    const gwS = pills.filter((p) => p.nodeId === 'gw');
    // South pills hang below the gateway's anchor box, vertical (narrow, tall).
    for (const p of gwS) {
      expect(p.rect.y).toBeCloseTo(p.at.y, 5);
      expect(p.rect.w).toBe(12);
      expect(p.rect.h).toBe(pillLength(p.label));
    }
    // Distribute slots keep the two gateway pills apart.
    expect(Math.abs(gwS[0]!.rect.x - gwS[1]!.rect.x)).toBeGreaterThan(12);
    // ICL pills are horizontal (wide, short) on east / west.
    const icl = pills.find((p) => p.linkId === 'icl' && p.end === 'from')!;
    expect(icl.rect.h).toBe(12);
    expect(icl.rect.x).toBeCloseTo(icl.at.x, 5);
  });

  it('draws rotated pill text and suppresses the engine chips', () => {
    const doc = fabric();
    const svg = portPillsSVG(doc, doc.pages[0]!);
    expect(svg).toContain('class="tds-port-pills"');
    expect(svg).toContain('rotate(-90');
    expect(svg).toContain('>xe-0/0/8<');
    const out = renderDocumentToSVG(doc, 0);
    expect(out).toContain('tds-port-pills');
    // The engine's glass chip markup for the port text is gone; the pill
    // text is the only occurrence. Chip mode keeps the engine chip.
    expect(out).not.toContain('opacity=".9">0/0/4<');
    expect((out.match(/>0\/0\/4</g) ?? []).length).toBe(1);
    expect(renderDocumentToSVG(fabric('chip'), 0)).toContain(
      'opacity=".9">0/0/4<',
    );
    const nodes = new Map(doc.pages[0]!.nodes.map((n) => [n.id, n]));
    const stripped = stripPillLabels(
      doc.pages[0]!,
      doc.pages[0]!.links[0]!,
      nodes,
    );
    expect(stripped.fromLabel).toBeUndefined();
    expect(stripped.toLabel).toBeUndefined();
    // Chip mode is untouched.
    const chip = fabric('chip');
    expect(portPills(chip.pages[0]!)).toEqual([]);
    expect(
      stripPillLabels(chip.pages[0]!, chip.pages[0]!.links[0]!, nodes),
    ).toBe(chip.pages[0]!.links[0]);
  });

  it('is catalogued, persisted and validated', () => {
    expect(
      getNodeType('switch')!.fields.find((f) => f.key === 'portLabels')
        ?.options,
    ).toEqual(['', 'chip', 'pill']);
    expect(
      getLinkType('line')!.fields.some((f) => f.key === 'fromBundle'),
    ).toBe(true);
    const doc = fabric();
    const back = parseDoc(serializeDoc(doc))!;
    expect(back.pages[0]!.portLabels).toBe('pill');
    expect(back.bundles).toEqual([{ id: 'icl', kind: 'icl' }]);
    delete doc.pages[0]!.linkAttach;
    const p = validateDocument(doc);
    expect(p.some((x) => /without linkAttach.distribute/.test(x.message))).toBe(
      true,
    );
  });

  it('the analyzer flags overlapping pills and the inspector keeps wire labels clear', () => {
    const doc = fabric();
    expect(
      analyzeLayout(doc).filter((p) => /port pill/.test(p.message)),
    ).toEqual([]);
    // Two parallel links to the same switch fan only 9px apart without
    // distribute, so their 12px pills overlap on the gateway.
    doc.pages[0]!.linkAttach = {};
    doc.pages[0]!.links.push({
      id: 'a2',
      type: 'line',
      from: 'gw',
      to: 'sw1',
      fromLabel: '0/0/6',
      toLabel: 'xe-0/0/9',
    });
    const warn = analyzeLayout(doc).filter((p) =>
      /port pills .* overlap on node "gw"/.test(p.message),
    );
    expect(warn).toHaveLength(1);
    doc.pages[0]!.links.pop();
    doc.pages[0]!.linkAttach = { distribute: true };
    const report = inspectPage(doc.pages[0]!, { customNodes: doc.customNodes });
    expect(report).toBeTruthy();
  });
});

describe('bundles (W3)', () => {
  it('outlines each (node, bundle) group and skips ICL', () => {
    const doc = fabric();
    const pills = portPills(doc.pages[0]!);
    const outlines = bundleOutlines(pills, doc.bundles);
    expect(
      outlines.map((o) => `${o.nodeId}:${o.bundle}:${o.kind}`).sort(),
    ).toEqual(['gw:ae0:lag']); // single-member groups draw no ring
    const gw = outlines.find((o) => o.nodeId === 'gw')!;
    const members = pills.filter((p) => p.nodeId === 'gw');
    for (const m of members) {
      expect(m.rect.x).toBeGreaterThanOrEqual(gw.rect.x);
      expect(m.rect.x + m.rect.w).toBeLessThanOrEqual(gw.rect.x + gw.rect.w);
    }
    defineBundle(doc, { id: 'ae0', kind: 'ecmp' });
    const svg = portPillsSVG(doc, doc.pages[0]!);
    expect(svg).toContain('data-bundle="ae0"');
    expect(svg).toContain('stroke-dasharray="3 2"');
  });

  it('keys the legend with the bundle kinds in use', () => {
    const doc = fabric();
    expect(usedBundleKinds(doc.bundles, doc.pages[0]!.links)).toEqual([
      'lag',
      'icl',
    ]);
    const items = buildLegendItems(doc, doc.pages[0]!);
    const bundles = items.filter((i) => i.shape === 'bundle');
    expect(bundles.map((b) => b.label)).toEqual(['LACP LAG']);
    defineBundle(doc, { id: 'ae0', kind: 'ecmp' });
    expect(
      buildLegendItems(doc, doc.pages[0]!).filter(
        (i) => i.shape === 'bundle',
      )[0]!.dash,
    ).toBe('dashed');
  });
});
