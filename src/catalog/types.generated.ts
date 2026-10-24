/* GENERATED from catalog/schema/catalog.schema.json by
 * scripts/catalog-types.ts — do not edit; run `npm run catalog:types`. */

/**
 * One file per entry. kind=platform holds physical geometry shared across SKUs; kind=model binds a sellable model to a platform and gives OS-native interface names and constraints.
 */
export type TopologyDojoHardwareCatalogEntryV1 = Platform | Model;
export type Slug = string;
export type SpeedMbps =
  | 10
  | 100
  | 1000
  | 2500
  | 5000
  | 10000
  | 25000
  | 40000
  | 50000
  | 100000
  | 200000
  | 400000
  | 800000;

export interface Platform {
  kind: 'platform';
  id: Slug;
  name: string;
  form_factor:
    | 'desktop'
    | 'rack_1u'
    | 'rack_2u'
    | 'rack_4u_plus'
    | 'chassis_modular'
    | 'wall_ceiling_ap'
    | 'virtual';
  dims_mm?: {
    w: number;
    h: number;
    d: number;
  } | null;
  panel: {
    units: 'mm' | 'relative';
    width: number;
    height: number;
  };
  /**
   * @minItems 1
   */
  ports: [PhysicalPort, ...PhysicalPort[]];
  /**
   * Module bays (mini-PIM, line cards, uplink modules). Ports on a module come from the module's own catalog entry.
   */
  slots?: {
    id: Slug;
    accepts: string[];
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  }[];
  /**
   * traced = measured from a vendor figure or photo; schematic = plausible layout, NOT physically accurate. Wire sheets must badge schematic panels.
   */
  position_confidence: 'traced' | 'schematic';
  glyphs?: {
    front?: string;
    rear?: string;
  };
  /**
   * @minItems 1
   */
  provenance: [Provenance, ...Provenance[]];
}
export interface PhysicalPort {
  /**
   * Platform-local physical id, e.g. p0, sfp1, console. Stable across SKUs on this platform.
   */
  id: string;
  kind:
    | 'rj45'
    | 'sfp'
    | 'sfp_plus'
    | 'sfp28'
    | 'sfp56'
    | 'qsfp_plus'
    | 'qsfp28'
    | 'qsfp56'
    | 'qsfp_dd'
    | 'osfp'
    | 'usb_a'
    | 'usb_c'
    | 'usb_micro'
    | 'usb_mini'
    | 'console_rj45'
    | 'power_dc'
    | 'power_ac'
    | 'button'
    | 'lock'
    | 'led'
    | 'label';
  /**
   * Center X in panel units (mm when platform.dims_mm is set)
   */
  x: number;
  /**
   * Center Y in panel units
   */
  y: number;
  w?: number;
  h?: number;
  face?: 'front' | 'rear';
  /**
   * Silkscreen text, if any
   */
  label?: string;
}
export interface Provenance {
  /**
   * official_doc = vendor-published spec or guide; internal_doc = HPE-internal material; reseller = channel listing (never sufficient alone for GA); inferred = derived by convention, must be confirmed
   */
  tier: 'official_doc' | 'internal_doc' | 'reseller' | 'inferred';
  source: string;
  retrieved?: string;
  note?: string;
}
export interface Model {
  kind: 'model';
  id: Slug;
  vendor: 'hpe-aruba' | 'juniper' | 'hpe';
  family: string;
  name: string;
  skus?: {
    sku: string;
    variant?: string;
    provenance_ref: number;
  }[];
  os:
    | 'ecos'
    | 'aos-cx'
    | 'aos-8'
    | 'aos-10'
    | 'junos'
    | 'junos-evo'
    | 'mist-ap'
    | 'clearpass'
    | 'other';
  /**
   * Platform id; several models may share one platform (e.g. aruba-9004 and EC-10104).
   */
  platform: string;
  category:
    | 'sdwan-gateway'
    | 'wlan-gateway'
    | 'switch'
    | 'router'
    | 'firewall'
    | 'access-point'
    | 'nac-appliance'
    | 'virtual-appliance';
  /**
   * Topology symbol id for logical views
   */
  symbol: string;
  lifecycle?: 'current' | 'end-of-sale' | 'end-of-support' | 'unknown';
  stackable?: {
    tech?: 'vsf' | 'vc' | 'none';
    max_members?: number;
  } | null;
  /**
   * @minItems 1
   */
  interfaces: [Interface, ...Interface[]];
  /**
   * Fixed bond pairings. Absent = any same-speed members may bond (OS rules apply).
   */
  bond_groups?: BondGroup[];
  /**
   * @minItems 1
   */
  provenance: [Provenance, ...Provenance[]];
  /**
   * Known gaps a data owner must close before this entry is GA
   */
  todo?: string[];
}
/**
 * speeds_mbps is required for roles data/wan/lan/mgmt/stack/ha (enforced by the checker); console and usb carry none.
 */
export interface Interface {
  /**
   * OS-native name exactly as the CLI/API shows it, e.g. lan0, 1/1/25, ge-0/0/6. Use {member} for stack/VSF member substitution.
   */
  name: string;
  /**
   * platform.ports[].id this interface lives on
   */
  physical: string;
  /**
   * @minItems 1
   */
  speeds_mbps?: [SpeedMbps, ...SpeedMbps[]];
  role: 'data' | 'wan' | 'lan' | 'mgmt' | 'console' | 'usb' | 'stack' | 'ha';
  poe?: {
    standard?: '802.3af' | '802.3at' | '802.3bt-t3' | '802.3bt-t4' | 'passive';
    class_max?: number;
  } | null;
  /**
   * Child interface names when broken out, e.g. 1/1/49:1..4
   */
  breakout?: string[];
  /**
   * Index into model.provenance supporting this row
   */
  provenance_ref?: number;
}
export interface BondGroup {
  name: string;
  /**
   * @minItems 2
   */
  members: [string, string, ...string[]];
  lacp: 'required' | 'optional' | 'unsupported' | 'unknown';
  min_os?: string;
  note?: string;
}
