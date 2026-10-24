/**
 * Catalog-aware wiring validation (hw-catalog Phase 2) — a port of
 * `catalog/tools/ref_validate.py`, the executable spec. Rule codes are the
 * contract (`catalog/fixtures/wiring/*.json` pins them for both
 * implementations); messages are free-form.
 *
 * Runs per page (a page is a complete standalone frame), and only for
 * endpoints on hardware-bound nodes (`node.hw`); everything else stays
 * unconstrained, exactly as an unmodeled endpoint in the reference. Bonds
 * are lag bundles: for each bound node, the link ends naming one lag bundle
 * form that node's bond, with LACP from the bundle definition.
 */
import type { Page, TopologyDocument } from '../pages/model.js';
import type { NodeConfig } from '../vendor/topology-ds.js';
import { bundleKind, endBundle } from '../api/bundles.js';
import { bundleLacp, isBound } from '../api/hardware.js';
import {
  CAGE_KINDS,
  DATA_ROLES,
  type Catalog,
  type ResolvedInterface,
} from './catalog.js';

export type RuleCode =
  | 'E_MODEL_UNKNOWN'
  | 'E_PORT_UNKNOWN'
  | 'E_MEMBER_RANGE'
  | 'E_ROLE_NOT_DATA'
  | 'E_PORT_REUSED'
  | 'E_OPTIC_ON_FIXED'
  | 'E_OPTIC_UNKNOWN'
  | 'E_OPTIC_CAGE'
  | 'E_MEDIA_MISMATCH'
  | 'E_FIBER_TYPE'
  | 'E_SPEED_NO_OVERLAP'
  | 'E_BOND_UNKNOWN_MEMBER'
  | 'E_BOND_PAIR'
  | 'E_BOND_LACP'
  | 'E_BOND_SPEED'
  | 'W_OPTIC_UNDECLARED'
  | 'W_INTERFACE_UNASSIGNED'
  | 'I_SCHEMATIC_PANEL';

export interface WiringFinding {
  code: RuleCode;
  /** error (E_*) · warning (W_*) · note (I_*). */
  level: 'error' | 'warning' | 'note';
  /** Location, e.g. "page[0].link 'l1' end br-ec". */
  where: string;
  message: string;
}

const levelOf = (code: RuleCode): WiringFinding['level'] =>
  code.startsWith('E_') ? 'error' : code.startsWith('W_') ? 'warning' : 'note';

interface Endpoint {
  node: string;
  iface: ResolvedInterface | null;
  /** copper | mmf | smf | dac | null (unknown) */
  media: string | null;
  /** null = unconstrained (unmodeled endpoint). */
  speeds: ReadonlySet<number> | null;
}

interface Bond {
  node: string;
  name: string;
  members: string[];
  lacp: boolean;
}

const intersect = (
  a: ReadonlySet<number>,
  b: Iterable<number>,
): Set<number> => {
  const out = new Set<number>();
  for (const v of b) if (a.has(v)) out.add(v);
  return out;
};
const sorted = (s: ReadonlySet<number>): number[] =>
  [...s].sort((x, y) => x - y);

function validatePage(
  catalog: Catalog,
  doc: TopologyDocument,
  page: Page,
  pi: number,
): WiringFinding[] {
  const findings: WiringFinding[] = [];
  const add = (code: RuleCode, where: string, message: string): void => {
    findings.push({
      code,
      level: levelOf(code),
      where: `page[${pi}].${where}`,
      message,
    });
  };
  const nodes = new Map<string, NodeConfig>(page.nodes.map((n) => [n.id, n]));
  const cabled = new Map<string, number>(); // `${node}\0${iface}` → count
  const linkSpeed = new Map<string, number | null>();
  const key = (node: string, name: string): string => `${node}\u0000${name}`;

  for (const n of page.nodes) {
    if (!isBound(n) || !catalog.models.has(n.hw.model)) continue;
    const platform = catalog.platformFor(n.hw.model);
    if (platform.position_confidence === 'schematic')
      add(
        'I_SCHEMATIC_PANEL',
        `node '${n.id}'`,
        `${platform.id} panel is schematic — port positions are not physically accurate`,
      );
  }

  const resolveEnd = (
    nodeId: string,
    ifName: string | undefined,
    optic: string | undefined,
    linkId: string,
  ): Endpoint => {
    const where = `link '${linkId}' end ${nodeId}`;
    const node = nodes.get(nodeId);
    if (!node || !isBound(node))
      return { node: nodeId, iface: null, media: null, speeds: null };
    const modelId = node.hw.model;
    if (!catalog.models.has(modelId)) {
      add(
        'E_MODEL_UNKNOWN',
        where,
        `model "${modelId}" is not in catalog ${catalog.version}`,
      );
      return { node: nodeId, iface: null, media: null, speeds: null };
    }
    if (!ifName) {
      add(
        'W_INTERFACE_UNASSIGNED',
        where,
        'bound node end has no interface yet',
      );
      return { node: nodeId, iface: null, media: null, speeds: null };
    }
    const iface = catalog.resolveInterface(modelId, ifName);
    if (!iface) {
      add(
        'E_PORT_UNKNOWN',
        where,
        `"${ifName}" is not an interface on ${modelId}`,
      );
      return { node: nodeId, iface: null, media: null, speeds: null };
    }
    const k = key(nodeId, iface.name);
    cabled.set(k, (cabled.get(k) ?? 0) + 1);
    if (iface.member !== null) {
      const limit =
        node.hw.stackMembers ||
        catalog.model(modelId).stackable?.max_members ||
        1;
      if (iface.member > limit)
        add('E_MEMBER_RANGE', where, `member ${iface.member} > ${limit}`);
    }
    if (!DATA_ROLES.has(iface.role)) {
      add('E_ROLE_NOT_DATA', where, `${iface.name} is a ${iface.role} port`);
      return { node: nodeId, iface, media: null, speeds: null };
    }
    if (!CAGE_KINDS.has(iface.physicalKind)) {
      if (optic)
        add(
          'E_OPTIC_ON_FIXED',
          where,
          `${optic} on a fixed ${iface.physicalKind} port`,
        );
      return { node: nodeId, iface, media: 'copper', speeds: iface.speeds };
    }
    if (!optic) {
      add(
        'W_OPTIC_UNDECLARED',
        where,
        `${iface.name} (${iface.physicalKind}) has no optic, so media is unchecked`,
      );
      return { node: nodeId, iface, media: null, speeds: iface.speeds };
    }
    const type = catalog.optics.types[optic];
    if (!type) {
      add(
        'E_OPTIC_UNKNOWN',
        where,
        `optic "${optic}" is not in the optics table`,
      );
      return { node: nodeId, iface, media: null, speeds: iface.speeds };
    }
    const accepts = catalog.optics.cage_accepts[iface.physicalKind] ?? [
      iface.physicalKind,
    ];
    if (!accepts.includes(type.form)) {
      add(
        'E_OPTIC_CAGE',
        where,
        `${optic} (${type.form}) does not fit ${iface.physicalKind}`,
      );
      return { node: nodeId, iface, media: null, speeds: null };
    }
    return {
      node: nodeId,
      iface,
      media: type.media,
      speeds: intersect(iface.speeds, type.speeds_mbps),
    };
  };

  for (const l of page.links) {
    const a = resolveEnd(l.from, l.fromInterface, l.fromOptic, l.id);
    const z = resolveEnd(l.to, l.toInterface, l.toOptic, l.id);
    if (a.media && z.media && a.media !== z.media) {
      const fiber = new Set([a.media, z.media]);
      if (fiber.has('mmf') && fiber.has('smf') && fiber.size === 2)
        add('E_FIBER_TYPE', `link '${l.id}'`, `${a.media} vs ${z.media}`);
      else
        add('E_MEDIA_MISMATCH', `link '${l.id}'`, `${a.media} vs ${z.media}`);
    }
    // Same order of checks as the reference: an unconstrained end adopts the
    // other end's speeds without an overlap check.
    let common: ReadonlySet<number> | null;
    if (a.speeds === null) common = z.speeds;
    else if (z.speeds === null) common = a.speeds;
    else {
      common = intersect(a.speeds, z.speeds);
      if (!common.size)
        add(
          'E_SPEED_NO_OVERLAP',
          `link '${l.id}'`,
          `[${sorted(a.speeds)}] vs [${sorted(z.speeds)}] Mb/s`,
        );
    }
    const negotiated = common && common.size ? Math.max(...common) : null;
    for (const ep of [a, z])
      if (ep.iface) linkSpeed.set(key(ep.node, ep.iface.name), negotiated);
  }

  for (const [k, count] of cabled)
    if (count > 1) {
      const [node, name] = k.split('\u0000') as [string, string];
      add('E_PORT_REUSED', `node '${node}'`, `${name} cabled ${count}x`);
    }

  for (const bond of pageBonds(doc, page)) {
    const where = `node '${bond.node}' bond ${bond.name}`;
    const node = nodes.get(bond.node);
    const model =
      node && isBound(node) ? catalog.models.get(node.hw.model) : undefined;
    const missing = bond.members.filter(
      (m) => !linkSpeed.has(key(bond.node, m)),
    );
    if (missing.length)
      add(
        'E_BOND_UNKNOWN_MEMBER',
        where,
        `unresolved members: ${missing.join(', ')}`,
      );
    if (model?.bond_groups?.length) {
      const want = new Set(bond.members);
      const group = model.bond_groups.find(
        (g) =>
          g.members.length === want.size && g.members.every((m) => want.has(m)),
      );
      if (!group)
        add(
          'E_BOND_PAIR',
          where,
          `[${bond.members.join(', ')}] is not a bond group (${model.bond_groups
            .map((g) => `[${g.members.join(', ')}]`)
            .join(' ')})`,
        );
      else if (bond.lacp && group.lacp === 'unsupported')
        add('E_BOND_LACP', where, `${group.name} is static-only (no LACP)`);
    }
    const speeds = new Set<number>();
    for (const m of bond.members) {
      const s = linkSpeed.get(key(bond.node, m));
      if (s !== undefined && s !== null) speeds.add(s);
    }
    if (speeds.size > 1)
      add('E_BOND_SPEED', where, `members at [${sorted(speeds)}] Mb/s`);
  }
  return findings;
}

/**
 * The bonds on a page: for each bound node, the link ends on it naming a lag
 * bundle (declared kind lag, or undeclared), grouped by bundle name. A
 * member is the end's interface name; an end with no interface has no name
 * to bond and is reported as W_INTERFACE_UNASSIGNED on its link instead.
 */
export function pageBonds(doc: TopologyDocument, page: Page): Bond[] {
  const bound = new Map(
    page.nodes.filter(isBound).map((n) => [n.id, n] as const),
  );
  const byKey = new Map<string, Bond>();
  for (const l of page.links)
    for (const end of ['from', 'to'] as const) {
      const nodeId = l[end];
      if (!bound.has(nodeId)) continue;
      const name = endBundle(l, end);
      if (!name || bundleKind(doc.bundles, name) !== 'lag') continue;
      const iface = end === 'from' ? l.fromInterface : l.toInterface;
      const k = `${nodeId}\u0000${name}`;
      let bond = byKey.get(k);
      if (!bond) {
        bond = {
          node: nodeId,
          name,
          members: [],
          lacp: bundleLacp(
            doc.bundles?.find((b) => b.id === name),
            nodeId,
          ),
        };
        byKey.set(k, bond);
      }
      if (iface && !bond.members.includes(iface)) bond.members.push(iface);
    }
  return [...byKey.values()].filter((b) => b.members.length > 0);
}

/** Every catalog wiring finding in a document, page by page. */
export function validateWiring(
  doc: TopologyDocument,
  catalog: Catalog,
): WiringFinding[] {
  return doc.pages.flatMap((page, pi) => validatePage(catalog, doc, page, pi));
}
