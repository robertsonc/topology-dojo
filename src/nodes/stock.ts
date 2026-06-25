/**
 * Stock cloud-native node types — a first-class library of the cloud gateways
 * that otherwise had to be faked with generic routers / `ec` variants (QA
 * ISSUE-03): transit / internet / NAT / VPN / interconnect gateways.
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

export const STOCK_NODE_SPECS: CustomNodeSpec[] = [
  gateway('tgw', 'TGW', 'hexagon', AWS), // AWS Transit Gateway
  gateway('igw', 'IGW', 'square', AWS), // AWS Internet Gateway
  gateway('natgw', 'NAT', 'square', AWS), // AWS NAT Gateway
  gateway('vpngw', 'VPN', 'diamond', AWS), // VPN / Virtual Private Gateway
  gateway('dxgw', 'DX', 'hexagon', AWS), // AWS Direct Connect Gateway
  gateway('vwanhub', 'vWAN', 'hexagon', AZURE), // Azure Virtual WAN Hub
  gateway('expressroute', 'ER', 'diamond', AZURE), // Azure ExpressRoute Gateway
  gateway('cloudrouter', 'CGW', 'circle', GCP), // generic / GCP Cloud Router
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
};

/** True if `type` is one of the shipped cloud-native node types. */
export function isStockNodeType(type: string): boolean {
  return STOCK_TYPES.has(type);
}
