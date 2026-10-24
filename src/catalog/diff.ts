/**
 * `catalog_diff` (hw-catalog Phase 3): what changed, between two catalog
 * versions, for the models a document binds, and which cabling findings
 * that change adds or clears.
 */
import type { TopologyDocument } from '../pages/model.js';
import { isBound } from '../api/hardware.js';
import { canonicalJson, type Catalog, type Model } from './catalog.js';
import { validateWiring, type WiringFinding } from './validate.js';

export interface ModelChange {
  model: string;
  status: 'unchanged' | 'changed' | 'added' | 'removed';
  /** Top-level model fields that differ (`platform geometry` for the panel). */
  fields?: string[];
  interfacesAdded?: string[];
  interfacesRemoved?: string[];
}

export interface CatalogDiff {
  fromVersion: string;
  toVersion: string;
  models: ModelChange[];
  /** Findings `toVersion` reports that `fromVersion` does not. */
  newFindings: WiringFinding[];
  /** Findings `fromVersion` reports that `toVersion` does not. */
  clearedFindings: WiringFinding[];
  /** Links with an error under `toVersion` that `fromVersion` did not report. */
  linksNowFailing: { page: number; linkId: string; codes: string[] }[];
}

function modelChange(id: string, a?: Model, b?: Model): ModelChange {
  if (!a && !b) return { model: id, status: 'unchanged' };
  if (!a) return { model: id, status: 'added' };
  if (!b) return { model: id, status: 'removed' };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const fields = [...keys]
    .filter(
      (k) =>
        canonicalJson((a as unknown as Record<string, unknown>)[k]) !==
        canonicalJson((b as unknown as Record<string, unknown>)[k]),
    )
    .sort();
  if (!fields.length) return { model: id, status: 'unchanged' };
  const before = new Set(a.interfaces.map((i) => i.name));
  const after = new Set(b.interfaces.map((i) => i.name));
  const added = [...after].filter((n) => !before.has(n));
  const removed = [...before].filter((n) => !after.has(n));
  return {
    model: id,
    status: 'changed',
    fields,
    ...(added.length ? { interfacesAdded: added } : {}),
    ...(removed.length ? { interfacesRemoved: removed } : {}),
  };
}

const key = (f: WiringFinding): string => `${f.code}|${f.where}`;

export function catalogDiff(
  doc: TopologyDocument,
  from: Catalog,
  to: Catalog,
): CatalogDiff {
  const ids = [
    ...new Set(
      doc.pages.flatMap((p) => p.nodes.filter(isBound).map((n) => n.hw.model)),
    ),
  ].sort();
  const models = ids.map((id) => {
    const change = modelChange(id, from.models.get(id), to.models.get(id));
    if (change.status !== 'unchanged') return change;
    // Same model entry, but its shared platform geometry may have moved.
    const pa = from.models.has(id) ? from.platformFor(id) : undefined;
    const pb = to.models.has(id) ? to.platformFor(id) : undefined;
    return pa && pb && canonicalJson(pa) !== canonicalJson(pb)
      ? { model: id, status: 'changed' as const, fields: ['platform geometry'] }
      : change;
  });
  const before = validateWiring(doc, from);
  const after = validateWiring(doc, to);
  const had = new Set(before.map(key));
  const has = new Set(after.map(key));
  const newFindings = after.filter((f) => !had.has(key(f)));
  const failing = new Map<
    string,
    { page: number; linkId: string; codes: string[] }
  >();
  for (const f of newFindings) {
    const m =
      f.level === 'error'
        ? /^page\[(\d+)\]\.link '([^']*)'/.exec(f.where)
        : null;
    if (!m) continue;
    const k = `${m[1]}|${m[2]}`;
    const row = failing.get(k) ?? {
      page: Number(m[1]),
      linkId: m[2]!,
      codes: [],
    };
    if (!row.codes.includes(f.code)) row.codes.push(f.code);
    failing.set(k, row);
  }
  return {
    fromVersion: from.version,
    toVersion: to.version,
    models,
    newFindings,
    clearedFindings: before.filter((f) => !has.has(key(f))),
    linksNowFailing: [...failing.values()],
  };
}
