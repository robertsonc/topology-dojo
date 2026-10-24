/**
 * Catalog build (hw-catalog Phase 1; Node, build-time only): load a catalog
 * directory, lint it — a port of `catalog/tools/check_seed.py`, which stays
 * the CLI — and turn it into one content-hashed bundle.
 *
 * Findings use check_seed.py's exact text for every non-schema check so the
 * two can be compared line for line; schema findings name the same entry
 * but word the message the way Ajv does.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parseXml, type XmlElement } from '../import/xml.js';
import {
  BUNDLE_FORMAT,
  DATA_ROLES,
  type CatalogBundle,
  type Model,
  type Optics,
  type Platform,
} from './catalog.js';

/** check_seed.py ANCHOR_TOLERANCE: SVG anchor vs catalog centre. */
export const ANCHOR_TOLERANCE = 0.05;
/** Largest glyph file the build will read (bytes). */
export const MAX_GLYPH_BYTES = 512 * 1024;

export interface LoadedCatalog {
  root: string;
  platforms: Map<string, Platform>;
  models: Map<string, Model>;
  optics: Optics;
}

export class CatalogLoadError extends Error {}

function readJson(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw new CatalogLoadError(
      `cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new CatalogLoadError(
      `cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** `Catalog.load` in catalog_lib.py: files in name order, duplicate ids fail. */
export function loadCatalogDir(root: string): LoadedCatalog {
  const out: LoadedCatalog = {
    root,
    platforms: new Map(),
    models: new Map(),
    optics: { cage_accepts: {}, types: {} },
  };
  for (const kind of ['platforms', 'models'] as const) {
    const folder = path.join(root, kind);
    let files: string[];
    try {
      if (!statSync(folder).isDirectory()) throw new Error('not a directory');
      files = readdirSync(folder)
        .filter((f) => f.endsWith('.json'))
        .sort();
    } catch {
      throw new CatalogLoadError(`missing catalog folder: ${folder}`);
    }
    const target = out[kind] as Map<string, Platform | Model>;
    for (const f of files) {
      const file = path.join(folder, f);
      const data = readJson(file) as { id?: string };
      if (target.has(String(data.id)))
        throw new CatalogLoadError(
          `duplicate ${kind.slice(0, -1)} id '${String(data.id)}' in ${file}`,
        );
      target.set(String(data.id), data as Platform & Model);
    }
  }
  out.optics = readJson(path.join(root, 'optics.json')) as Optics;
  return out;
}

/**
 * Schema findings via Ajv (draft 2020-12; formats not asserted, matching
 * jsonschema's default). Each entry is validated against the `$defs` branch
 * its `kind` names, so a bad model reports the model problem rather than the
 * root `oneOf` failing against both branches; an entry with neither kind is
 * validated against the root.
 */
function schemaFindings(cat: LoadedCatalog, schemaFile: string): string[] {
  const schema = readJson(schemaFile) as Record<string, unknown>;
  const id = String(schema.$id);
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  ajv.addSchema(schema);
  const root = ajv.getSchema(id);
  const byKind: Record<string, ReturnType<typeof ajv.getSchema>> = {
    platform: ajv.getSchema(`${id}#/$defs/platform`),
    model: ajv.getSchema(`${id}#/$defs/model`),
  };
  if (!root || !byKind.platform || !byKind.model)
    throw new CatalogLoadError(`cannot compile schema ${schemaFile}`);
  const findings: string[] = [];
  for (const entry of [...cat.platforms.values(), ...cat.models.values()]) {
    const validate = byKind[String(entry.kind)] ?? root;
    if (validate(entry)) continue;
    for (const e of validate.errors ?? [])
      findings.push(
        `SCHEMA ${String(entry.id)}: ${e.message ?? e.keyword} at ${e.instancePath || '/'}`,
      );
  }
  return findings;
}

function opticsFindings(optics: Optics): string[] {
  const out: string[] = [];
  if (!optics || typeof optics !== 'object')
    return ['OPTICS: optics.json is not an object'];
  if (!optics.types || typeof optics.types !== 'object')
    out.push('OPTICS: missing types');
  if (!optics.cage_accepts || typeof optics.cage_accepts !== 'object')
    out.push('OPTICS: missing cage_accepts');
  for (const [name, t] of Object.entries(optics.types ?? {})) {
    if (!t || typeof t.form !== 'string')
      out.push(`OPTICS: ${name} has no form`);
    if (!['copper', 'mmf', 'smf', 'dac'].includes(t?.media))
      out.push(`OPTICS: ${name} media must be copper | mmf | smf | dac`);
    if (
      !Array.isArray(t?.speeds_mbps) ||
      !t.speeds_mbps.length ||
      !t.speeds_mbps.every((s) => Number.isInteger(s) && s > 0)
    )
      out.push(`OPTICS: ${name} needs speeds_mbps`);
  }
  return out;
}

/** check_svg in check_seed.py. */
export function checkSvg(
  file: string,
  pid: string,
  ports: Map<string, { x: number; y: number }>,
): string[] {
  const out: string[] = [];
  let root: XmlElement;
  try {
    if (statSync(file).size > MAX_GLYPH_BYTES)
      return [
        `SVG ${file}: cannot parse (larger than ${MAX_GLYPH_BYTES} bytes)`,
      ];
    root = parseXml(readFileSync(file, 'utf8'));
  } catch (err) {
    return [
      `SVG ${file}: cannot parse (${err instanceof Error ? err.message : String(err)})`,
    ];
  }
  if (root.attrs['data-platform'] !== pid)
    out.push(
      `SVG ${file}: data-platform=${root.attrs['data-platform'] === undefined ? 'None' : `'${root.attrs['data-platform']}'`}, expected '${pid}'`,
    );
  const seen = new Map<string, XmlElement>();
  const walk = (el: XmlElement): void => {
    if (el.name === 'g' && el.attrs['data-port'] !== undefined) {
      const port = el.attrs['data-port'];
      if (seen.has(port))
        out.push(`SVG ${file}: duplicate anchor for port ${port}`);
      seen.set(port, el);
    }
    el.children.forEach(walk);
  };
  walk(root);
  for (const [portId, spec] of ports) {
    const el = seen.get(portId);
    if (!el) {
      out.push(`SVG ${file}: no data-port anchor for ${portId}`);
      continue;
    }
    const num = (v: string | undefined): number =>
      v === undefined || v.trim() === '' ? NaN : Number(v);
    const cx = num(el.attrs['data-cx']);
    const cy = num(el.attrs['data-cy']);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
      out.push(`SVG ${file}: ${portId} anchor not numeric`);
      continue;
    }
    if (
      Math.abs(cx - spec.x) > ANCHOR_TOLERANCE ||
      Math.abs(cy - spec.y) > ANCHOR_TOLERANCE
    )
      out.push(
        `SVG ${file}: ${portId} anchor (${cx},${cy}) != catalog (${spec.x},${spec.y})`,
      );
  }
  const extra = [...seen.keys()].filter((k) => !ports.has(k)).sort();
  if (extra.length)
    out.push(
      `SVG ${file}: anchors with no catalog port: [${extra.map((e) => `'${e}'`).join(', ')}]`,
    );
  return out;
}

/**
 * Lint a loaded catalog — `check` in check_seed.py. Lines starting with
 * `WARN` are warnings (not-GA provenance); everything else is an error.
 */
export function checkCatalog(cat: LoadedCatalog, schemaFile: string): string[] {
  const findings = [
    ...schemaFindings(cat, schemaFile),
    ...opticsFindings(cat.optics),
  ];

  for (const [pid, pl] of cat.platforms) {
    const ids = pl.ports.map((p) => p.id);
    const dupes = [
      ...new Set(ids.filter((i, k) => ids.indexOf(i) !== k)),
    ].sort();
    if (dupes.length)
      findings.push(
        `PLATFORM ${pid}: duplicate port ids [${dupes.map((d) => `'${d}'`).join(', ')}]`,
      );
    for (const p of pl.ports)
      if (
        !(
          p.x >= 0 &&
          p.x <= pl.panel.width &&
          p.y >= 0 &&
          p.y <= pl.panel.height
        )
      )
        findings.push(`PLATFORM ${pid}: port ${p.id} center outside panel`);
    for (const [face, rel] of Object.entries(pl.glyphs ?? {})) {
      if (typeof rel !== 'string') continue;
      const ports = new Map(
        pl.ports
          .filter((p) => (p.face ?? 'front') === face)
          .map((p) => [p.id, p]),
      );
      findings.push(...checkSvg(path.join(cat.root, rel), pid, ports));
    }
  }

  for (const [mid, m] of cat.models) {
    const pl = cat.platforms.get(m.platform);
    if (!pl) {
      findings.push(`MODEL ${mid}: unknown platform '${m.platform}'`);
      continue;
    }
    const phys = new Set(pl.ports.map((p) => p.id));
    const names = m.interfaces.map((i) => i.name);
    if (names.length !== new Set(names).size)
      findings.push(`MODEL ${mid}: duplicate interface names`);
    const used = new Map<string, string>();
    for (const i of m.interfaces) {
      if (!phys.has(i.physical))
        findings.push(
          `MODEL ${mid}: interface ${i.name} -> unknown physical '${i.physical}'`,
        );
      if (used.has(i.physical))
        findings.push(
          `MODEL ${mid}: physical ${i.physical} bound twice (${used.get(i.physical)}, ${i.name})`,
        );
      used.set(i.physical, i.name);
      if (DATA_ROLES.has(i.role) && !i.speeds_mbps?.length)
        findings.push(
          `MODEL ${mid}: ${i.name} role ${i.role} needs speeds_mbps`,
        );
      const ref = i.provenance_ref ?? 0;
      if (ref >= m.provenance.length)
        findings.push(
          `MODEL ${mid}: ${i.name} provenance_ref ${ref} out of range`,
        );
    }
    for (const s of m.skus ?? [])
      if (s.provenance_ref >= m.provenance.length)
        findings.push(`MODEL ${mid}: sku ${s.sku} provenance_ref out of range`);
    for (const b of m.bond_groups ?? []) {
      const missing = b.members.filter((x) => !names.includes(x));
      if (missing.length)
        findings.push(
          `MODEL ${mid}: bond ${b.name} members not on model: [${missing.map((x) => `'${x}'`).join(', ')}]`,
        );
    }
    const sym = path.join(cat.root, `glyphs/symbols/${m.symbol}.svg`);
    let symOk = false;
    try {
      symOk = statSync(sym).isFile();
    } catch {
      symOk = false;
    }
    if (!symOk) findings.push(`MODEL ${mid}: missing symbol ${sym}`);
    if (!gaEligible(m))
      findings.push(
        `WARN MODEL ${mid}: no official_doc/internal_doc provenance; not GA-eligible`,
      );
  }
  return findings;
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

/**
 * The bundle for a loaded catalog. Entries are sorted by id so the hash
 * depends only on content, never on file order; the version is the first 12
 * hex chars of the SHA-256 of the canonical bundle without its version.
 */
export function buildBundle(cat: LoadedCatalog): CatalogBundle {
  const body = {
    format: BUNDLE_FORMAT,
    platforms: [...cat.platforms.values()].sort((a, b) =>
      a.id < b.id ? -1 : 1,
    ),
    models: [...cat.models.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    optics: cat.optics,
  };
  const version = createHash('sha256')
    .update(canonicalJson(body))
    .digest('hex')
    .slice(0, 12);
  return { ...body, version } as CatalogBundle;
}

/** The bundle file name for a version. */
export function bundleFileName(version: string): string {
  return `catalog-${version}.json`;
}
