/**
 * Test / demo fixture: the hw-catalog Phase 4 exit wire sheet — an
 * EC-10104 EdgeHA pair, each blan0 bonded across a CX 6300M VSF pair (one
 * lag per gateway), two ISPs. ANSI B landscape with a title block.
 *
 * Which EC port carries EdgeHA is a drawing choice here (wan1), not
 * catalog data.
 */
import type { TopologyDocument } from '../pages/model.js';
import { sheetViewBox } from '../api/sheet.js';
import type { LinkConfig } from '../vendor/topology-ds.js';

export function branchWiresheetDoc(): TopologyDocument {
  const cable = (
    l: Partial<LinkConfig> & Pick<LinkConfig, 'id' | 'from' | 'to'>,
  ): LinkConfig => ({
    ...l,
    type: 'line',
    lineStyle: 'orthogonal',
    cornerRadius: 6,
  });
  return {
    title: 'Branch wire sheet',
    customNodes: [],
    sheet: {
      size: 'ansi-b',
      orientation: 'landscape',
      titleBlock: {
        subtitle: 'EC-10104 EdgeHA pair to CX 6300M VSF pair',
        fields: [
          { label: 'Site', value: 'BR-0101' },
          { label: 'Rev', value: 'A' },
        ],
      },
    },
    bundles: [
      { id: 'blan0', kind: 'lag', lacp: false },
      { id: 'lag1', kind: 'lag', lacp: true },
      { id: 'lag2', kind: 'lag', lacp: true },
    ],
    pages: [
      {
        id: 'ws',
        name: 'Wire sheet',
        viewBox: sheetViewBox('ansi-b', 'landscape')!,
        view: 'wiresheet',
        nodes: [
          { id: 'isp1', type: 'cloud', x: 330, y: 170, label: 'ISP A' },
          { id: 'isp2', type: 'cloud', x: 1300, y: 170, label: 'ISP B' },
          {
            id: 'ec1',
            type: 'ec',
            x: 330,
            y: 400,
            label: 'BR-EC-01',
            hw: { model: 'edgeconnect-ec-10104', sku: 'S3N69A' },
          },
          {
            id: 'ec2',
            type: 'ec',
            x: 1300,
            y: 400,
            label: 'BR-EC-02',
            hw: { model: 'edgeconnect-ec-10104', sku: 'S3N69A' },
          },
          {
            id: 'sw',
            type: 'switch',
            x: 815,
            y: 690,
            label: 'BR-SW-01',
            hw: {
              model: 'aruba-cx-6300m-jl664a',
              sku: 'JL664A',
              stackMembers: 2,
            },
          },
        ],
        links: [
          cable({
            id: 'w1',
            from: 'ec1',
            to: 'isp1',
            fromInterface: 'wan0',
            label: 'ISP A',
          }),
          cable({
            id: 'w2',
            from: 'ec2',
            to: 'isp2',
            fromInterface: 'wan0',
            label: 'ISP B',
          }),
          cable({
            id: 'ha',
            from: 'ec1',
            to: 'ec2',
            fromInterface: 'wan1',
            toInterface: 'wan1',
            label: 'EdgeHA',
          }),
          cable({
            id: 'b1',
            from: 'ec1',
            to: 'sw',
            fromInterface: 'lan0',
            toInterface: '1/1/1',
            fromBundle: 'blan0',
            toBundle: 'lag1',
          }),
          cable({
            id: 'b2',
            from: 'ec1',
            to: 'sw',
            fromInterface: 'lan1',
            toInterface: '2/1/1',
            fromBundle: 'blan0',
            toBundle: 'lag1',
          }),
          cable({
            id: 'b3',
            from: 'ec2',
            to: 'sw',
            fromInterface: 'lan0',
            toInterface: '1/1/23',
            fromBundle: 'blan0',
            toBundle: 'lag2',
          }),
          cable({
            id: 'b4',
            from: 'ec2',
            to: 'sw',
            fromInterface: 'lan1',
            toInterface: '2/1/23',
            fromBundle: 'blan0',
            toBundle: 'lag2',
          }),
        ],
        anchors: [],
        zones: [],
        flowPaths: [],
        policyMarkers: [],
      },
    ],
  };
}
