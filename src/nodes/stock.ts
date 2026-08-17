/**
 * Stock node types — a first-class shipped library beyond the vendored
 * engine's built-ins:
 *
 * 1. Cloud gateways (QA ISSUE-03): transit / internet / NAT / VPN /
 *    interconnect gateways in provider accent colors.
 * 2. A generic IT/network pack (plan Phase 3.3): the everyday inventory a
 *    network map needs — load balancer, proxy, IDS, DNS, storage, VoIP,
 *    cameras, VMs/containers, and so on — brand-neutral by design (original
 *    compositions of the Designer's shape/icon primitives, no vendor asset
 *    licensing).
 *
 * They are authored as `CustomNodeSpec`s and rendered through the same pure
 * interpreter (`renderCustomNode`) the Node Designer uses — so they need no
 * vendored-engine edit and draw identically in the browser, the Worker, and
 * headless tests. Unlike user custom nodes they ship with the app: validation,
 * the catalog/palette, and every render path treat them as built-ins, so they
 * are available in every document without a per-document definition.
 *
 * Cloud *containers* (Region / VPC / VNet / Subnet) are intentionally left to
 * zones, which already render nested correctly and actually group their member
 * nodes — a gateway is a point object, a container is a boundary.
 */
import { defaultSpec, type CustomNodeSpec } from './spec.js';

/** Provider accent colors (AWS / Azure / GCP). */
const AWS = '#ff9900';
const AZURE = '#0078d4';
const GCP = '#4285f4';
/** House accents for the generic pack (match the app's palette families). */
const GREEN = '#01a982';
const BLUE = '#65aef9';
const GOLD = '#deb146';
const RED = '#fc6161';
const SLATE = '#7d8a92';

function spec(
  partial: Partial<CustomNodeSpec> & { typeName: string },
): CustomNodeSpec {
  const base = defaultSpec();
  const colorStroke = partial.colorStroke ?? base.colorStroke;
  return {
    ...base,
    glow: true,
    badge: true,
    badgeColor: colorStroke,
    ...partial,
    colorStroke,
  };
}

/** A gateway glyph: a compact badged shape in a provider color. */
function gateway(
  typeName: string,
  badgeText: string,
  shape: CustomNodeSpec['shape'],
  colorStroke: string,
): CustomNodeSpec {
  return spec({ typeName, badgeText, shape, colorStroke, size: 26 });
}

/** A generic-pack glyph: shape + icon in a house accent, no badge noise. */
function device(
  typeName: string,
  shape: CustomNodeSpec['shape'],
  icon: string,
  colorStroke: string,
  extra: Partial<CustomNodeSpec> = {},
): CustomNodeSpec {
  return spec({
    typeName,
    shape,
    icon,
    colorStroke,
    size: 24,
    badge: false,
    ...extra,
  });
}

export const STOCK_NODE_SPECS: CustomNodeSpec[] = [
  gateway('tgw', 'TGW', 'hexagon', AWS), // AWS Transit Gateway
  gateway('igw', 'IGW', 'square', AWS), // AWS Internet Gateway
  gateway('natgw', 'NAT', 'square', AWS), // AWS NAT Gateway
  gateway('vpngw', 'VPN', 'diamond', AWS), // VPN / Virtual Private Gateway
  gateway('dxgw', 'DX', 'hexagon', AWS), // AWS Direct Connect Gateway
  gateway('vwanhub', 'vWAN', 'hexagon', AZURE), // Azure Virtual WAN Hub
  gateway('expressroute', 'ER', 'diamond', AZURE), // Azure ExpressRoute Gateway
  gateway('cloudrouter', 'CGW', 'circle', GCP), // generic / GCP Cloud Router
  // ── Generic IT/network pack (Phase 3.3) ──
  device('loadbalancer', 'hexagon', 'layers', GREEN, {
    badge: true,
    badgeText: 'LB',
  }),
  device('proxy', 'square', 'link', GREEN),
  device('wlc', 'square', 'wifi', GREEN),
  device('modem', 'rectangle', 'signal', GREEN, { leds: true, ledCount: 3 }),
  device('dns', 'circle', 'globe', BLUE),
  device('webserver', 'square', 'globe', GOLD),
  device('mailserver', 'square', 'bell', GOLD),
  device('nas', 'rectangle', 'database', BLUE, { leds: true, ledCount: 2 }),
  device('ups', 'rectangle', 'power', SLATE),
  device('printer', 'rectangle', 'terminal', SLATE),
  device('camera', 'circle', 'eye', SLATE),
  device('voip', 'circle', 'bell', BLUE),
  device('iot', 'circle', 'cpu', BLUE, { antenna: true }),
  device('vm', 'square', 'cpu', BLUE),
  device('containerNode', 'square', 'code', BLUE),
  device('k8s', 'hexagon', 'gear', BLUE),
  device('ids', 'diamond', 'eye', RED, { badge: true, badgeText: 'IDS' }),
  device('vpnconc', 'diamond', 'lock', RED),
  device('usergroup', 'circle', 'users', GOLD),
];

const STOCK_TYPES = new Set(STOCK_NODE_SPECS.map((s) => s.typeName));

/** Friendly palette / catalog labels (typeName → human name). */
export const STOCK_NODE_LABELS: Record<string, string> = {
  tgw: 'Transit Gateway',
  igw: 'Internet Gateway',
  natgw: 'NAT Gateway',
  vpngw: 'VPN Gateway',
  dxgw: 'Direct Connect GW',
  vwanhub: 'Virtual WAN Hub',
  expressroute: 'ExpressRoute GW',
  cloudrouter: 'Cloud Router',
  loadbalancer: 'Load Balancer',
  proxy: 'Proxy',
  wlc: 'Wireless Controller',
  modem: 'Modem / ONT',
  dns: 'DNS Server',
  webserver: 'Web Server',
  mailserver: 'Mail Server',
  nas: 'NAS / Storage',
  ups: 'UPS',
  printer: 'Printer',
  camera: 'IP Camera',
  voip: 'VoIP Phone',
  iot: 'IoT Device',
  vm: 'Virtual Machine',
  containerNode: 'Container',
  k8s: 'Kubernetes',
  ids: 'IDS / IPS',
  vpnconc: 'VPN Concentrator',
  usergroup: 'User Group',
};

/** Palette category + search aliases per stock type (default: Cloud). */
export const STOCK_NODE_META: Record<
  string,
  { category: string; keywords?: string[] }
> = {
  tgw: { category: 'Cloud', keywords: ['aws', 'transit'] },
  igw: { category: 'Cloud', keywords: ['aws', 'internet gateway'] },
  natgw: { category: 'Cloud', keywords: ['aws', 'nat'] },
  vpngw: { category: 'Cloud', keywords: ['aws', 'vgw', 'ipsec'] },
  dxgw: { category: 'Cloud', keywords: ['aws', 'direct connect'] },
  vwanhub: { category: 'Cloud', keywords: ['azure', 'virtual wan'] },
  expressroute: { category: 'Cloud', keywords: ['azure', 'er'] },
  cloudrouter: { category: 'Cloud', keywords: ['gcp', 'google'] },
  loadbalancer: {
    category: 'Network',
    keywords: ['lb', 'vip', 'haproxy', 'f5', 'balancer'],
  },
  proxy: {
    category: 'Network',
    keywords: ['forward', 'reverse', 'squid', 'gateway'],
  },
  wlc: {
    category: 'Network',
    keywords: ['wireless controller', 'wifi', 'wlan'],
  },
  modem: { category: 'Network', keywords: ['ont', 'dsl', 'cable', 'fiber'] },
  dns: { category: 'Compute', keywords: ['resolver', 'bind', 'nameserver'] },
  webserver: {
    category: 'Compute',
    keywords: ['http', 'nginx', 'apache', 'www'],
  },
  mailserver: {
    category: 'Compute',
    keywords: ['smtp', 'imap', 'exchange', 'email'],
  },
  nas: {
    category: 'Compute',
    keywords: ['storage', 'filer', 'san', 'backup'],
  },
  ups: { category: 'Endpoint', keywords: ['battery', 'power', 'apc'] },
  printer: { category: 'Endpoint', keywords: ['print', 'mfp'] },
  camera: {
    category: 'Endpoint',
    keywords: ['cctv', 'surveillance', 'video'],
  },
  voip: {
    category: 'Endpoint',
    keywords: ['sip', 'pbx', 'phone', 'telephony'],
  },
  iot: { category: 'Endpoint', keywords: ['sensor', 'embedded', 'device'] },
  vm: {
    category: 'Compute',
    keywords: ['virtual machine', 'hypervisor', 'esxi', 'kvm'],
  },
  containerNode: {
    category: 'Compute',
    keywords: ['docker', 'pod', 'container'],
  },
  k8s: {
    category: 'Compute',
    keywords: ['kubernetes', 'cluster', 'orchestrator'],
  },
  ids: {
    category: 'Security',
    keywords: ['intrusion', 'ips', 'sensor', 'snort'],
  },
  vpnconc: {
    category: 'Security',
    keywords: ['vpn', 'ipsec', 'remote access', 'concentrator'],
  },
  usergroup: {
    category: 'Endpoint',
    keywords: ['team', 'users', 'department'],
  },
};

/** True if `type` is one of the shipped cloud-native node types. */
export function isStockNodeType(type: string): boolean {
  return STOCK_TYPES.has(type);
}
