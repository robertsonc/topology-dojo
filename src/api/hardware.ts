/**
 * Hardware bindings on a document (hw-catalog Phase 2): binding a node to a
 * catalog model, the interface-as-port-label fallback the renderers share,
 * per-node LACP on lag bundles, and shape checks for the new fields.
 *
 * Pure and DOM-free. The catalog itself (`src/catalog`) is passed in; this
 * module never loads it. Wiring rules live in `src/catalog/validate.ts`.
 */
import type { TopologyDocument } from '../pages/model.js';
import type {
  LinkConfig,
  NodeConfig,
  NodeHardware,
} from '../vendor/topology-ds.js';
import type { BundleDef } from './bundles.js';
import type { Catalog, Model } from '../catalog/catalog.js';

export type { NodeHardware };

/** Catalog category → the Topology Dojo node type a bound node draws as. */
export const CATEGORY_NODE_TYPE: Readonly<Record<Model['category'], string>> = {
  'sdwan-gateway': 'ec',
  'wlan-gateway': 'wlc',
  switch: 'switch',
  router: 'router',
  firewall: 'firewall',
  'access-point': 'ap',
  'nac-appliance': 'server',
  'virtual-appliance': 'vm',
};

/** Whether a node is bound to a catalog model. */
export function isBound(
  node: NodeConfig,
): node is NodeConfig & { hw: NodeHardware } {
  return (
    !!node.hw &&
    typeof node.hw === 'object' &&
    typeof node.hw.model === 'string'
  );
}

/** Whether any node on any page is bound. */
export function docHasBindings(doc: TopologyDocument): boolean {
  return doc.pages.some((p) => p.nodes.some(isBound));
}

/**
 * The port label drawn at one end of a link: the author's label, else the
 * bound interface name, else ''. Every renderer of port labels (engine
 * chips, pills, port tables) reads labels through this.
 */
export function endPortLabel(link: LinkConfig, end: 'from' | 'to'): string {
  const label = end === 'from' ? link.fromLabel : link.toLabel;
  if (typeof label === 'string' && label.trim()) return label.trim();
  const iface = end === 'from' ? link.fromInterface : link.toInterface;
  return typeof iface === 'string' ? iface.trim() : '';
}

/**
 * The link as the engine should draw it: interface names fill empty port
 * labels. Returns the same object when nothing changes.
 */
export function withInterfaceLabels<T extends LinkConfig>(link: T): T {
  let out: T | null = null;
  for (const end of ['from', 'to'] as const) {
    const key = end === 'from' ? 'fromLabel' : 'toLabel';
    const current = link[key];
    if (typeof current === 'string' && current.trim()) continue;
    const label = endPortLabel(link, end);
    if (!label) continue;
    out ??= { ...link };
    (out as Record<string, unknown>)[key] = label;
  }
  return out ?? link;
}

/** LACP requested for one node of a lag bundle. */
export function bundleLacp(
  def: BundleDef | undefined,
  nodeId: string,
): boolean {
  const v = def?.lacp;
  if (typeof v === 'boolean') return v;
  return !!v && v[nodeId] === true;
}

export interface BindResult {
  node: NodeConfig;
  /** The node type before binding, when the binding changed it. */
  previousType?: string;
  /** True when this bind pinned the document's catalog version. */
  pinned: boolean;
}

/**
 * Bind a node to a catalog model. Validates the model id; pins
 * `doc.catalogVersion` on the first binding; sets the node's type from the
 * model's category unless the author chose a custom (Node Designer) type.
 */
export function bindHardware(
  doc: TopologyDocument,
  node: NodeConfig,
  hw: NodeHardware,
  catalog: Catalog,
): BindResult {
  const model = catalog.models.get(hw.model);
  if (!model)
    throw new Error(
      `unknown hardware model "${hw.model}" (catalog ${catalog.version})`,
    );
  if (hw.sku !== undefined && !(model.skus ?? []).some((s) => s.sku === hw.sku))
    throw new Error(`model "${hw.model}" has no SKU "${hw.sku}"`);
  if (
    hw.stackMembers !== undefined &&
    (!Number.isInteger(hw.stackMembers) || hw.stackMembers < 1)
  )
    throw new Error('stackMembers must be a positive integer');
  const max = model.stackable?.max_members;
  if (hw.stackMembers !== undefined && hw.stackMembers > 1) {
    if (!max) throw new Error(`model "${hw.model}" is not stackable`);
    if (hw.stackMembers > max)
      throw new Error(`model "${hw.model}" stacks at most ${max} members`);
  }
  if (hw.face !== undefined && hw.face !== 'front' && hw.face !== 'rear')
    throw new Error('face must be "front" or "rear"');

  let pinned = false;
  if (!doc.catalogVersion) {
    doc.catalogVersion = catalog.version;
    pinned = true;
  }
  node.hw = {
    model: hw.model,
    ...(hw.sku !== undefined ? { sku: hw.sku } : {}),
    ...(hw.stackMembers !== undefined ? { stackMembers: hw.stackMembers } : {}),
    ...(hw.face !== undefined ? { face: hw.face } : {}),
  };
  const custom = doc.customNodes.some((c) => c.typeName === node.type);
  const next = CATEGORY_NODE_TYPE[model.category];
  const result: BindResult = { node, pinned };
  if (!custom && next && node.type !== next) {
    result.previousType = node.type;
    node.type = next;
  }
  return result;
}

/** Shape problems in hardware fields (only reported when the fields exist). */
export function hardwareShapeProblems(
  doc: TopologyDocument,
): { where: string; message: string }[] {
  const out: { where: string; message: string }[] = [];
  const str = (v: unknown): boolean => typeof v === 'string';
  doc.pages.forEach((page, pi) => {
    for (const n of page.nodes) {
      if (n.hw === undefined) continue;
      const where = `page[${pi}].node '${n.id}'`;
      const hw = n.hw as unknown as Record<string, unknown>;
      if (!hw || typeof hw !== 'object' || Array.isArray(hw)) {
        out.push({
          where,
          message: 'hw must be an object { model, sku?, stackMembers?, face? }',
        });
        continue;
      }
      if (
        !str(hw.model) ||
        !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(String(hw.model))
      )
        out.push({ where, message: 'hw.model must be a catalog model id' });
      if (hw.sku !== undefined && (!str(hw.sku) || String(hw.sku).length > 32))
        out.push({ where, message: 'hw.sku must be a SKU string' });
      if (
        hw.stackMembers !== undefined &&
        (!Number.isInteger(hw.stackMembers) || (hw.stackMembers as number) < 1)
      )
        out.push({
          where,
          message: 'hw.stackMembers must be a positive integer',
        });
      if (hw.face !== undefined && hw.face !== 'front' && hw.face !== 'rear')
        out.push({ where, message: 'hw.face must be "front" or "rear"' });
    }
    for (const l of page.links)
      for (const key of [
        'fromInterface',
        'toInterface',
        'fromOptic',
        'toOptic',
      ] as const)
        if (l[key] !== undefined && !str(l[key]))
          out.push({
            where: `page[${pi}].link '${l.id}'`,
            message: `${key} must be a string`,
          });
  });
  for (const b of doc.bundles ?? [])
    if (
      b.lacp !== undefined &&
      typeof b.lacp !== 'boolean' &&
      (typeof b.lacp !== 'object' ||
        Array.isArray(b.lacp) ||
        Object.values(b.lacp).some((v) => typeof v !== 'boolean'))
    )
      out.push({
        where: `bundle '${b.id}'`,
        message: 'lacp must be true / false or { nodeId: boolean }',
      });
  return out;
}
