/**
 * The light-theme contrast probe: every node type in a grid, every link /
 * wire type between neighbours, the engine accent colours as line links, an
 * orthogonal route, two zones, a flow path, the legend and a caption.
 */
import { nodeCatalog, linkCatalog } from '../api/catalog.js';
import type { TopologyDocument } from '../pages/model.js';
import type { LinkConfig, NodeConfig } from '../vendor/topology-ds.js';

/** Every node type in a grid, every link type between neighbours. */
export function lightProbe(): TopologyDocument {
  const types = nodeCatalog([])
    .map((n) => n.type)
    .filter((t) => t !== 'image');
  const cols = 8;
  const nodes: NodeConfig[] = types.map((type, i) => ({
    id: `n${i}`,
    type,
    x: 140 + (i % cols) * 220,
    y: 160 + Math.floor(i / cols) * 200,
    label: `${type} label`,
    sublabel: 'sublabel text',
    ...(type === 'callout' || type === 'text' ? { body: 'Body text' } : {}),
  }));
  const linkTypes = linkCatalog().map((l) => l.type);
  const links: LinkConfig[] = linkTypes.map((type, i) => ({
    id: `l-${type}`,
    type,
    from: `n${i * 2}`,
    to: `n${i * 2 + 1}`,
    label: `${type} link`,
    ...(type === 'blocked' ? { reason: 'policy deny' } : {}),
  }));
  // Every colour a link commonly takes.
  const colors = [
    '#01a982',
    '#65aef9',
    '#fc6161',
    '#deb146',
    '#7764fc',
    '#00a4b3',
    '#ec8c25',
  ];
  colors.forEach((color, i) =>
    links.push({
      id: `c${i}`,
      type: 'line',
      from: `n${20 + i}`,
      to: `n${21 + i}`,
      color,
      label: `line ${color}`,
    }),
  );
  links.push({
    id: 'orth',
    type: 'line',
    from: 'n30',
    to: 'n31',
    lineStyle: 'orthogonal',
    label: 'routed',
  });
  return {
    title: 'Light probe',
    customNodes: [],
    legend: { show: true, title: 'Key' },
    pages: [
      {
        id: 'p',
        name: 'probe',
        viewBox: '0 0 1900 1400',
        caption: 'Caption narration for the frame',
        nodes,
        links,
        anchors: [],
        zones: [
          {
            id: 'z1',
            nodes: ['n0', 'n1'],
            label: 'Zone label',
            sublabel: 'zone sublabel',
          },
          {
            id: 'z2',
            nodes: ['n8', 'n9'],
            label: 'Coloured zone',
            sublabel: 'sub',
            color: '#65aef9',
            borderStyle: 'solid',
          },
        ],
        flowPaths: [
          {
            id: 'f1',
            waypoints: ['n0', 'n1', 'n2'],
            label: 'flow path',
            color: '#01a982',
          },
        ],
        policyMarkers: [],
      },
    ],
  };
}
