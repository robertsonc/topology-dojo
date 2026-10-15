/**
 * Build the reference wiring sheet (proposal 0008) through the public
 * authoring API — the same calls an agent makes over MCP — lay it out with
 * the tiered algorithm, check it (validate / layout / inspect) and write the
 * fixture JSON plus light / dark SVG renders.
 *
 *   npx tsx scripts/build-wiring-sheet-fixture.ts [outDir]
 *
 * `fixtures/venue-distribution-leaf.json` is this script's output; the
 * golden test (src/render/wiring-sheet.test.ts) rebuilds the same document
 * and asserts the checks stay clean.
 */
import { writeFileSync } from 'node:fs';
import { createDocument } from '../src/api/builder.js';
import {
  defineLinkStyle,
  ETHERNET_MEDIA_STYLES,
} from '../src/api/link-styles.js';
import { defineTier } from '../src/api/tiers.js';
import { defineBundle } from '../src/api/bundles.js';
import { sheetViewBox } from '../src/api/sheet.js';
import { layoutDocument } from '../src/api/autolayout.js';
import { validateDocument } from '../src/api/validate.js';
import { analyzeLayout } from '../src/api/layout.js';
import { inspectPage } from '../src/render/inspect.js';
import { renderDocumentToSVG } from '../src/server/render.js';
import { serializeDoc } from '../src/pages/persist.js';
import { STOCK_NODE_SPECS } from '../src/nodes/stock.js';

const OUT = process.argv[2] ?? 'fixtures';
const chassis = STOCK_NODE_SPECS.find((s) => s.typeName === 'chassis')!;
const b = createDocument('HPE Discover 2026 – Venue Distribution Leaf Details')
  // A 48-port leaf: the stock chassis at twice the size, as a document type.
  .defineNodeType({
    ...chassis,
    typeName: 'chassis48',
    size: 60,
    portCount: 48,
    radius: 3,
  })
  .page({ name: 'Venue Distribution Leaf', viewBox: sheetViewBox('ansi-c')! });

const dev = (
  id: string,
  type: string,
  label: string,
  model: string,
  tier: string,
  extra: Record<string, unknown> = {},
) =>
  b.node({
    id,
    type,
    x: 0,
    y: 0,
    label,
    sublabel: `(${model})`,
    labelPlacement: 'n',
    tier,
    ...extra,
  });

dev('gw-wlan-01', 'chassis', 'GW-WLAN-01', 'HPE Aruba 9114', 'gw');
dev('gw-wlan-02', 'chassis', 'GW-WLAN-02', 'HPE Aruba 9114', 'gw');
dev('gw-ubt-01', 'chassis', 'GW-UBT-01', 'HPE Aruba 9114', 'gw');
dev('gw-ubt-02', 'chassis', 'GW-UBT-02', 'HPE Aruba 9114', 'gw');
dev('me-wlan-01', 'chassis', 'ME-WLAN-01', 'HPE Juniper ME-MX-6', 'gw');
dev('me-wlan-02', 'chassis', 'ME-WLAN-02', 'HPE Juniper ME-MX-6', 'gw');
dev(
  'sw-venue-01',
  'chassis48',
  'SW-VENUE-01',
  'HPE Juniper QFX5120-48Y',
  'dist',
  { portTable: { side: 'w' } },
);
dev(
  'sw-venue-02',
  'chassis48',
  'SW-VENUE-02',
  'HPE Juniper QFX5120-48Y',
  'dist',
  { portTable: { side: 'e' } },
);
dev('rt-core-01', 'chassis48', 'RT-CORE-01', 'HPE Juniper MX-304', 'core', {
  portTable: { side: 'w' },
});
dev('rt-core-02', 'chassis48', 'RT-CORE-02', 'HPE Juniper MX-304', 'core', {
  portTable: { side: 'e' },
});

let n = 0;
const link = (
  from: string,
  fromLabel: string,
  to: string,
  toLabel: string,
  style: string,
  fromBundle?: string,
  toBundle?: string,
) =>
  b.link({
    id: `l${n++}`,
    type: 'line',
    from,
    to,
    fromLabel,
    toLabel,
    style,
    lineStyle: 'curved',
    ...(fromBundle ? { fromBundle } : {}),
    ...(toBundle ? { toBundle } : {}),
  });

// Distribution ↔ gateways (switch side first).
for (const [sw, gwPort, mePorts] of [
  ['sw-venue-01', '0/0/4', ['xe0', 'xe2']],
  ['sw-venue-02', '0/0/5', ['xe1', 'xe3']],
] as const) {
  link(sw, 'xe-0/0/8', 'gw-wlan-01', gwPort, '10g-dac', 'ae8', 'lacp0');
  link(sw, 'xe-0/0/10', 'gw-wlan-02', gwPort, '10g-dac', 'ae10', 'lacp0');
  link(sw, 'xe-0/0/12', 'gw-ubt-01', gwPort, '10g-dac', 'ae12', 'lacp0');
  link(sw, 'xe-0/0/14', 'gw-ubt-02', gwPort, '10g-dac', 'ae14', 'lacp0');
  link(sw, 'xe-0/0/28', 'me-wlan-01', mePorts[0], '25g-dac', 'ae28', 'ae0');
  link(sw, 'xe-0/0/29', 'me-wlan-01', mePorts[1], '25g-dac', 'ae29', 'ae1');
  link(sw, 'xe-0/0/30', 'me-wlan-02', mePorts[0], '25g-dac', 'ae30', 'ae0');
  link(sw, 'xe-0/0/31', 'me-wlan-02', mePorts[1], '25g-dac', 'ae31', 'ae1');
}
link('sw-venue-01', 'xe-0/0/0', 'me-wlan-01', 'OOBM', '10g-dac');
link('sw-venue-02', 'xe-0/0/0', 'me-wlan-02', 'OOBM', '10g-dac');
// Distribution ↔ core, crossed, plus the ICLs.
link('sw-venue-01', 'et-0/0/48', 'rt-core-01', 'et-0/0/8', '100g-dac');
link('sw-venue-01', 'et-0/0/49', 'rt-core-02', 'et-0/0/9', '100g-dac');
link('sw-venue-02', 'et-0/0/48', 'rt-core-02', 'et-0/0/8', '100g-dac');
link('sw-venue-02', 'et-0/0/49', 'rt-core-01', 'et-0/0/9', '100g-dac');
link(
  'sw-venue-01',
  'et-0/0/55',
  'sw-venue-02',
  'et-0/0/55',
  '100g-dac',
  'icl',
  'icl',
);
link(
  'rt-core-01',
  'et-0/0/0',
  'rt-core-02',
  'et-0/0/0',
  '100g-dac',
  'icl',
  'icl',
);

// Gateway groups (captioned at the top) and the tier bands (captioned at the bottom).
b.zone({
  id: 'z-aos',
  label: 'AOS-10 Mobility',
  nodes: ['gw-wlan-01', 'gw-wlan-02'],
  labelAlign: 'center',
  borderStyle: 'dashed',
})
  .zone({
    id: 'z-ubt',
    label: 'AOS-10 User Based Tunneling',
    nodes: ['gw-ubt-01', 'gw-ubt-02'],
    labelAlign: 'center',
    borderStyle: 'dashed',
  })
  .zone({
    id: 'z-mist',
    label: 'Mist Mobility',
    nodes: ['me-wlan-01', 'me-wlan-02'],
    labelAlign: 'center',
    borderStyle: 'dashed',
  })
  .zone({
    id: 'tier:dist',
    label: 'Distribution',
    nodes: ['sw-venue-01', 'sw-venue-02'],
    labelAlign: 'center',
    labelPosition: 'bottom',
    borderStyle: 'dashed',
  })
  .zone({
    id: 'tier:core',
    label: 'Core',
    nodes: ['rt-core-01', 'rt-core-02'],
    labelAlign: 'center',
    labelPosition: 'bottom',
    borderStyle: 'dashed',
  });

const doc = b.build();
const page = doc.pages[0]!;
page.linkAttach = { pad: 4, distribute: true };
page.portLabels = 'pill';
for (const s of ETHERNET_MEDIA_STYLES) defineLinkStyle(doc, s);
defineTier(doc, { id: 'gw', name: 'Gateways' });
defineTier(doc, { id: 'dist', name: 'Distribution' });
defineTier(doc, { id: 'core', name: 'Core' });
defineBundle(doc, { id: 'icl', kind: 'icl' });
doc.sheet = {
  size: 'ansi-c',
  titleBlock: {
    subtitle: 'Venue Distribution Leaf Details',
    fields: [
      { label: 'Drawn by', value: 'Topology Dojo' },
      { label: 'Revision', value: '1' },
      { label: 'Date', value: '2026-10-15' },
      { label: 'Size', value: 'ANSI C' },
    ],
  },
};
doc.legend = { show: true, position: 'bl', columns: 4, title: 'Key' };

const r = layoutDocument(doc, {
  algorithm: 'tiered',
  mirror: true,
  spacing: 90,
  tierGap: 260,
});
console.log('moved', r.movedNodes);
const problems = validateDocument(doc);
console.log(
  'validate:',
  problems.length
    ? problems.map((p) => `${p.level} ${p.where}: ${p.message}`).join('\n')
    : 'clean',
);
const layout = analyzeLayout(doc);
console.log(
  'layout:',
  layout.length
    ? layout.map((p) => `${p.where}: ${p.message}`).join('\n')
    : 'clean',
);
const report = inspectPage(page, { customNodes: doc.customNodes });
console.log(
  'inspect:',
  JSON.stringify(report.counts ?? report, null, 0).slice(0, 600),
);
for (const f of (
  report as { findings?: { severity: string; message: string }[] }
).findings ?? [])
  console.log(' ', f.severity, f.message);
writeFileSync(`${OUT}/venue-distribution-leaf.json`, serializeDoc(doc));
writeFileSync(
  `${OUT}/venue-light.svg`,
  renderDocumentToSVG(doc, 0, { theme: 'light' }),
);
writeFileSync(
  `${OUT}/venue-dark.svg`,
  renderDocumentToSVG(doc, 0, { theme: 'dark' }),
);
console.log('written');
