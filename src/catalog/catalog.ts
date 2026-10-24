/**
 * Hardware catalog core (hw-catalog Phase 1) — the runtime-agnostic half:
 * the bundle shape, an indexed `Catalog`, and `resolveInterface`, a port of
 * `catalog/tools/catalog_lib.py` (the executable spec). Shared by the Node
 * stdio server, the Worker and the build; no file system or fetch here.
 *
 * Parity with Python is pinned by `catalog/fixtures/resolve/golden.json`,
 * which `resolve_probe.py` writes and `catalog.test.ts` asserts against.
 */
import type {
  BondGroup,
  Interface,
  Model,
  PhysicalPort,
  Platform,
  SpeedMbps,
} from './types.generated.js';

export type { BondGroup, Interface, Model, PhysicalPort, Platform, SpeedMbps };

/** Roles that carry traffic (a cable may land on them). */
export const DATA_ROLES: ReadonlySet<string> = new Set([
  'data',
  'wan',
  'lan',
  'mgmt',
  'stack',
  'ha',
]);

/** Physical kinds that are optic cages (take a transceiver or DAC). */
export const CAGE_KINDS: ReadonlySet<string> = new Set([
  'sfp',
  'sfp_plus',
  'sfp28',
  'sfp56',
  'qsfp_plus',
  'qsfp28',
  'qsfp56',
  'qsfp_dd',
  'osfp',
]);

/**
 * `catalog/data/optics.json` — not covered by the entry schema, so typed by
 * hand and shape-checked by the build (`checkCatalog`).
 */
export interface OpticType {
  form: string;
  media: 'copper' | 'mmf' | 'smf' | 'dac';
  speeds_mbps: number[];
}
export interface Optics {
  cage_accepts: Record<string, string[]>;
  cage_accepts_note?: string;
  types: Record<string, OpticType>;
}

/** Bundle format tag; bump when the bundle layout (not the data) changes. */
export const BUNDLE_FORMAT = 'topology-dojo/catalog-bundle@1';

/**
 * One published catalog: every entry plus the optics table, named by the
 * content hash (`version`). Documents pin `version` once a node is bound.
 */
export interface CatalogBundle {
  format: typeof BUNDLE_FORMAT;
  /** First 12 hex chars of the SHA-256 of the canonical bundle content. */
  version: string;
  platforms: Platform[];
  models: Model[];
  optics: Optics;
}

/** An OS-native interface name resolved to its catalog row. */
export interface ResolvedInterface {
  name: string;
  modelId: string;
  physicalId: string;
  physicalKind: PhysicalPort['kind'];
  role: Interface['role'];
  speeds: ReadonlySet<number>;
  /** The `{member}` (stack / VSF member) the name expanded, else null. */
  member: number | null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/** GA-eligible: at least one official_doc or internal_doc provenance row. */
export function gaEligible(m: Model): boolean {
  return m.provenance.some(
    (p) => p.tier === 'official_doc' || p.tier === 'internal_doc',
  );
}

/** JSON with object keys sorted at every level and no whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** A catalog bundle indexed for lookups. Immutable once built. */
export class Catalog {
  readonly version: string;
  readonly platforms: ReadonlyMap<string, Platform>;
  readonly models: ReadonlyMap<string, Model>;
  readonly optics: Optics;
  /** Compiled `{member}` templates, per model, in interface-row order. */
  private readonly templates = new Map<string, (RegExp | null)[]>();

  constructor(bundle: CatalogBundle) {
    this.version = bundle.version;
    this.platforms = new Map(bundle.platforms.map((p) => [p.id, p]));
    this.models = new Map(bundle.models.map((m) => [m.id, m]));
    this.optics = bundle.optics;
  }

  /** The model, or throws (Python raises KeyError the same way). */
  model(modelId: string): Model {
    const m = this.models.get(modelId);
    if (!m) throw new Error(`unknown catalog model "${modelId}"`);
    return m;
  }

  platformFor(modelId: string): Platform {
    const m = this.model(modelId);
    const p = this.platforms.get(m.platform);
    if (!p)
      throw new Error(
        `model "${modelId}" names unknown platform "${m.platform}"`,
      );
    return p;
  }

  private compiled(model: Model): (RegExp | null)[] {
    let list = this.templates.get(model.id);
    if (!list) {
      list = model.interfaces.map((row) =>
        row.name.includes('{member}')
          ? new RegExp(
              '^' +
                escapeRegExp(row.name).replace(
                  escapeRegExp('{member}'),
                  '([1-9][0-9]*)',
                ) +
                '$',
            )
          : null,
      );
      this.templates.set(model.id, list);
    }
    return list;
  }

  /**
   * Map an OS-native interface name to its catalog row, expanding
   * `{member}` templates — `Catalog.resolve_interface` in catalog_lib.py.
   * First matching row wins; member numbers have no leading zero; the whole
   * name must match (no trailing characters, newline included).
   */
  resolveInterface(modelId: string, name: string): ResolvedInterface | null {
    const model = this.model(modelId);
    const phys = new Map(this.platformFor(modelId).ports.map((p) => [p.id, p]));
    const patterns = this.compiled(model);
    for (let i = 0; i < model.interfaces.length; i++) {
      const row = model.interfaces[i]!;
      let member: number | null = null;
      const re = patterns[i];
      if (re) {
        const m = re.exec(name);
        if (!m) continue;
        member = Number(m[1]);
      } else if (row.name !== name) {
        continue;
      }
      const p = phys.get(row.physical);
      if (!p)
        throw new Error(
          `model "${modelId}" interface "${row.name}" names unknown physical "${row.physical}"`,
        );
      return {
        name,
        modelId,
        physicalId: p.id,
        physicalKind: p.kind,
        role: row.role,
        speeds: new Set(row.speeds_mbps ?? []),
        member,
      };
    }
    return null;
  }
}
