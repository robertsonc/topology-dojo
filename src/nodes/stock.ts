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
/** Places family accent (sites, not devices). */
const TEAL = '#00a4b3';

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
  // ── Places (proposal 0011, tier 1): sites rather than devices — SD-WAN
  // site tiles, ZTNA remote workers. One shape and colour for the family so
  // a site never reads as an appliance.
  device('branchoffice', 'square', 'building', TEAL, { size: 26 }),
  device('campus', 'square', 'campus', TEAL, { size: 26 }),
  device('datacenter', 'square', 'datacenter', TEAL, { size: 26 }),
  device('homeoffice', 'square', 'home', TEAL, { size: 26 }),
  // ── Tier 1 (proposal 0011): SASE / NAC / identity / SOC / management.
  // Badged where the glyph alone is shared (shield, key, fingerprint).
  device('ssepop', 'hexagon', 'cloud', GREEN, {
    badge: true,
    badgeText: 'SSE',
  }),
  device('nac', 'square', 'fingerprint', RED, {
    badge: true,
    badgeText: 'NAC',
  }),
  device('authserver', 'square', 'key', RED, {
    badge: true,
    badgeText: 'AAA',
  }),
  device('waf', 'hexagon', 'shield', RED, { badge: true, badgeText: 'WAF' }),
  device('siem', 'square', 'chart', BLUE, { badge: true, badgeText: 'SIEM' }),
  device('directory', 'square', 'directory', GOLD),
  device('orchestrator', 'square', 'dashboard', GREEN),
  // Shape encodes forwarding role: router = circle (4 arrows), L3 switch =
  // rounded square (8 arrows), switch = wide chassis.
  device('l3switch', 'square', 'l3switch', GREEN, { radius: 8 }),
  device('mobile', 'square', 'mobile', SLATE),
  device('managedendpoint', 'square', 'laptopcheck', SLATE),
  // ── Tier 2 (proposal 0011): segmentation, wireless WAN, out-of-band and
  // power, privileged access, and SSE threat storytelling.
  device('vrf', 'square', 'layers', GREEN, { badge: true, badgeText: 'VRF' }),
  device('satellite', 'circle', 'dish', BLUE),
  device('cellular', 'circle', 'tower', BLUE, {
    badge: true,
    badgeText: '5G',
  }),
  device('microwave', 'circle', 'tower', BLUE, {
    badge: true,
    badgeText: 'MW',
  }),
  device('consoleserver', 'rectangle', 'terminal', SLATE, {
    leds: true,
    ledCount: 2,
  }),
  // Passive: a port row and no status LEDs (a cable ending here is a
  // cross-connect, not a transceiver).
  spec({
    typeName: 'patchpanel',
    shape: 'chassis',
    icon: null,
    colorStroke: SLATE,
    colorFill: '#22252e',
    size: 30,
    radius: 2,
    badge: false,
    glow: false,
    ports: true,
    portCount: 24,
    portPos: 'bottom',
  }),
  device('pdu', 'rectangle', 'lightning', SLATE),
  device('jumphost', 'square', 'terminal', RED, {
    badge: true,
    badgeText: 'JMP',
  }),
  device('pam', 'square', 'key', RED, { badge: true, badgeText: 'PAM' }),
  device('mdm', 'square', 'mobile', BLUE, { badge: true, badgeText: 'MDM' }),
  device('attacker', 'diamond', 'user', RED),
  device('infectedhost', 'square', 'bug', RED),
  // Verdict is a colour, not a type: recolour green (clean), grey
  // (unknown) or red (malicious).
  device('file', 'square', 'file', SLATE),
  device('website', 'circle', 'globe', SLATE),
  // ── Wiring-sheet chassis (proposal 0008, W7): a generic rack-unit front
  // panel with a port row and status LEDs, sized so pills / anchor-box
  // slots land along its long bottom edge. Name + model go in the node's
  // label / sublabel (labelPlacement 'n' reads like a drawing sheet).
  spec({
    typeName: 'chassis',
    shape: 'chassis',
    icon: null,
    colorStroke: SLATE,
    colorFill: '#22252e',
    size: 30,
    radius: 2,
    badge: false,
    highlight: true,
    leds: true,
    ledCount: 2,
    ledPos: 'left',
    ports: true,
    portCount: 24,
    portPos: 'bottom',
  }),
];

const STOCK_TYPES = new Set(STOCK_NODE_SPECS.map((s) => s.typeName));

/** Friendly palette / catalog labels (typeName → human name). */
export const STOCK_NODE_LABELS: Record<string, string> = {
  chassis: 'Chassis (1RU)',
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
  branchoffice: 'Branch Office',
  campus: 'Campus',
  datacenter: 'Data Center',
  homeoffice: 'Home Office',
  ssepop: 'SSE PoP',
  nac: 'NAC',
  authserver: 'Auth Server',
  waf: 'WAF',
  siem: 'SIEM',
  directory: 'Directory',
  orchestrator: 'Orchestrator',
  l3switch: 'L3 Switch',
  mobile: 'Mobile',
  managedendpoint: 'Managed Endpoint',
  vrf: 'VRF',
  satellite: 'Satellite Terminal',
  cellular: 'LTE / 5G Router',
  microwave: 'Microwave Radio',
  consoleserver: 'Console Server',
  patchpanel: 'Patch Panel',
  pdu: 'PDU',
  jumphost: 'Jump Host',
  pam: 'PAM',
  mdm: 'MDM',
  attacker: 'Attacker',
  infectedhost: 'Infected Host',
  file: 'File',
  website: 'Website',
};

/** Palette category + search aliases per stock type (default: Cloud). */
export const STOCK_NODE_META: Record<
  string,
  { category: string; keywords?: string[] }
> = {
  chassis: {
    category: 'Network',
    keywords: [
      'rack',
      '1ru',
      'front panel',
      'switch',
      'router',
      'qfx',
      'mx',
      'leaf',
      'spine',
      'wiring',
    ],
  },
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
  branchoffice: {
    category: 'Places',
    keywords: ['branch', 'site', 'office', 'store', 'retail', 'spoke'],
  },
  campus: {
    category: 'Places',
    keywords: ['site', 'headquarters', 'hq', 'buildings', 'corporate'],
  },
  datacenter: {
    category: 'Places',
    keywords: ['dc', 'data centre', 'hub', 'colo', 'racks', 'site'],
  },
  homeoffice: {
    category: 'Places',
    keywords: ['home', 'remote worker', 'teleworker', 'wfh', 'residence'],
  },
  ssepop: {
    category: 'Security',
    keywords: ['sase', 'sse', 'pop', 'swg', 'casb', 'ztna', 'security cloud'],
  },
  nac: {
    category: 'Security',
    keywords: [
      'network access control',
      'clearpass',
      'posture',
      '802.1x',
      'profiling',
    ],
  },
  authserver: {
    category: 'Security',
    keywords: ['radius', 'tacacs', 'aaa', 'authentication', 'ise'],
  },
  waf: {
    category: 'Security',
    keywords: ['web application firewall', 'app protection', 'owasp'],
  },
  siem: {
    category: 'Security',
    keywords: ['soc', 'logs', 'syslog', 'splunk', 'sentinel', 'analytics'],
  },
  directory: {
    category: 'Security',
    keywords: [
      'active directory',
      'ad',
      'ldap',
      'entra',
      'idp',
      'identity store',
    ],
  },
  orchestrator: {
    category: 'Edge',
    keywords: [
      'controller',
      'management',
      'orchestrator',
      'mist',
      'central',
      'sd-wan manager',
      'nms',
    ],
  },
  l3switch: {
    category: 'Network',
    keywords: [
      'layer 3',
      'multilayer',
      'core',
      'leaf',
      'spine',
      'evpn',
      'routing switch',
    ],
  },
  mobile: {
    category: 'Endpoint',
    keywords: ['phone', 'smartphone', 'tablet', 'byod', 'ios', 'android'],
  },
  managedendpoint: {
    category: 'Endpoint',
    keywords: ['managed', 'corporate laptop', 'mdm', 'posture', 'compliant'],
  },
  vrf: {
    category: 'Network',
    keywords: [
      'vrf',
      'vdom',
      'vsys',
      'virtual context',
      'segment',
      'tenant',
      'routing instance',
    ],
  },
  satellite: {
    category: 'Network',
    keywords: ['leo', 'starlink', 'geo', 'vsat', 'satellite wan'],
  },
  cellular: {
    category: 'Network',
    keywords: ['lte', '5g', '4g', 'wireless wan', 'cellular', 'fwa'],
  },
  microwave: {
    category: 'Network',
    keywords: ['radio link', 'point to point', 'ptp', 'backhaul', 'mw'],
  },
  consoleserver: {
    category: 'Network',
    keywords: ['oob', 'out of band', 'serial', 'terminal server', 'opengear'],
  },
  patchpanel: {
    category: 'Network',
    keywords: ['patch', 'cross connect', 'cabling', 'mdf', 'idf'],
  },
  pdu: {
    category: 'Endpoint',
    keywords: ['power', 'rack power', 'power strip'],
  },
  jumphost: {
    category: 'Security',
    keywords: ['bastion', 'jump box', 'admin access'],
  },
  pam: {
    category: 'Security',
    keywords: ['privileged access', 'vault', 'cyberark', 'password vault'],
  },
  mdm: {
    category: 'Security',
    keywords: [
      'endpoint manager',
      'intune',
      'uem',
      'device management',
      'posture source',
    ],
  },
  attacker: {
    category: 'Security',
    keywords: ['threat actor', 'adversary', 'hacker', 'attack'],
  },
  infectedhost: {
    category: 'Security',
    keywords: ['malware', 'compromised', 'infected laptop', 'bot'],
  },
  file: {
    category: 'Security',
    keywords: ['document', 'download', 'sandbox', 'verdict', 'payload'],
  },
  website: {
    category: 'Security',
    keywords: ['url', 'site', 'phishing', 'swg', 'web category', 'verdict'],
  },
};

/** True if `type` is one of the shipped cloud-native node types. */
export function isStockNodeType(type: string): boolean {
  return STOCK_TYPES.has(type);
}
