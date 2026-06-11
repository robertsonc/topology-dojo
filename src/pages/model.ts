/**
 * The flipbook document model.
 *
 * A Document is an ordered list of Pages. Each Page is a COMPLETE, standalone
 * topology frame — like a sheet of transparency film. "Animation" is flipping
 * between pages; there is no delta/override/choreography machinery.
 *
 * Duplicating a page deep-copies it (independent frames): editing one page never
 * changes another. This is the deliberate simplicity of the flipbook model.
 */
import type {
  AnchorConfig,
  FlowPathConfig,
  LinkConfig,
  NodeConfig,
  PolicyMarkerConfig,
  RenderablePage,
  ZoneConfig,
} from '../vendor/topology-ds.js';
import type { CustomNodeSpec } from '../nodes/spec.js';
import type { LayerDef } from '../api/layers.js';
import { createDocument } from '../api/builder.js';

export interface Page extends RenderablePage {
  id: string;
  name: string;
  viewBox: string;
  nodes: NodeConfig[];
  links: LinkConfig[];
  anchors: AnchorConfig[];
  /** Expressive annotation layer — region groupings, animated routes, badges. */
  zones: ZoneConfig[];
  flowPaths: FlowPathConfig[];
  policyMarkers: PolicyMarkerConfig[];
}

export interface TopologyDocument {
  title: string;
  pages: Page[];
  /** User-designed node types, registered with the engine on load. */
  customNodes: CustomNodeSpec[];
  /**
   * Declared layers (bottom → top), e.g. underlay / overlay / policy. Elements
   * opt in via their `layer` field; untagged elements form the implicit base
   * layer beneath all declared layers. Optional — absent means unlayered.
   */
  layers?: LayerDef[];
}

let _seq = 0;
/** Monotonic id for new pages (stable within a session). */
export function newPageId(): string {
  return `p${Date.now().toString(36)}${(_seq++).toString(36)}`;
}

/**
 * Deep, independent copy of a page (the flipbook duplicate). The copy gets a new
 * id and an optional new name; nothing is shared with the source.
 */
export function duplicatePage(page: Page, name?: string): Page {
  const copy = structuredClone(page);
  copy.id = newPageId();
  copy.name = name ?? `${page.name} copy`;
  return copy;
}

/** An empty page sized to the standard canvas. */
export function blankPage(name: string): Page {
  return {
    id: newPageId(),
    name,
    viewBox: '0 0 1050 700',
    nodes: [],
    links: [],
    anchors: [],
    zones: [],
    flowPaths: [],
    policyMarkers: [],
  };
}

/**
 * A seed document: one page with a small SD-WAN frame, so the app shows the
 * legacy visuals immediately. Real authoring (editing on-canvas) arrives in the
 * editor-core phase.
 */
export function sampleDocument(): TopologyDocument {
  // A seeded custom node type demonstrates the Node Designer pipeline end to end.
  const sensor: CustomNodeSpec = {
    typeName: 'sensor',
    shape: 'hexagon',
    icon: 'signal',
    colorStroke: '#65aef9',
    colorFill: '#292d3a',
    size: 22,
    strokeW: 1.4,
    radius: 3,
    glow: true,
    highlight: true,
    innerRing: false,
    pattern: false,
    patternType: 'none',
    leds: true,
    ledCount: 2,
    ledColor: '#05cc93',
    ledPos: 'bottom',
    badge: false,
    badgeText: 'EDGE',
    badgeColor: '#01a982',
    antenna: true,
    ports: false,
    portCount: 4,
    portPos: 'bottom',
  };

  // Built via the headless authoring API — the same path code / an MCP server use.
  const doc = createDocument('Untitled').defineNodeType(sensor);
  doc
    .page({ id: newPageId(), name: 'Frame 1' })
    .node({ id: 'user', type: 'host', x: 130, y: 470, label: 'User' })
    .node({
      id: 'ec',
      type: 'ec',
      x: 330,
      y: 360,
      label: 'EC-Branch',
      color: '#01a982',
    })
    .node({ id: 'fw', type: 'firewall', x: 560, y: 360, label: 'SRX' })
    .node({
      id: 'hub',
      type: 'ec',
      x: 560,
      y: 180,
      label: 'EC-Hub',
      color: '#01a982',
    })
    .node({
      id: 'app',
      type: 'server',
      x: 780,
      y: 180,
      label: 'App',
      color: '#deb146',
    })
    .node({
      id: 'inet',
      type: 'cloud',
      x: 840,
      y: 460,
      label: 'Internet',
      color: '#b1b9be',
    })
    .node({ id: 'sensor1', type: 'sensor', x: 130, y: 200, label: 'Sensor' })
    .link({ id: 'lan', type: 'line', from: 'user', to: 'ec' })
    .link({
      id: 'overlay',
      type: 'tunnel',
      from: 'ec',
      to: 'hub',
      color: '#01a982',
      label: 'IPsec Overlay',
    })
    .link({ id: 'ec-fw', type: 'line', from: 'ec', to: 'fw', color: '#fc6161' })
    .link({
      id: 'hub-app',
      type: 'line',
      from: 'hub',
      to: 'app',
      color: '#deb146',
    })
    .link({
      id: 'breakout',
      type: 'line',
      from: 'fw',
      to: 'inet',
      color: '#b1b9be',
    })
    // The expressive annotation layer: a region grouping, an animated overlay
    // route, and an enforcement badge — all part of the document contract.
    .zone({
      id: 'zone_branch',
      label: 'Branch',
      nodes: ['user', 'ec', 'sensor1'],
      color: '#65aef9',
    })
    .flowPath({
      id: 'fp_app',
      label: 'App traffic',
      waypoints: ['user', 'ec', 'hub', 'app'],
      color: '#01a982',
      animation: 'particles',
      speed: 'medium',
    })
    .policyMarker({
      id: 'pm_fw',
      nodeId: 'fw',
      type: 'inspect',
      label: 'IDP',
      color: '#fc6161',
      align: 'NE',
    });
  return doc.build();
}
